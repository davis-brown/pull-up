package store_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/davisbrown/pull-up/server/internal/store"
	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

// These tests exercise the PostGIS queries against a real database.
// They are skipped unless TEST_DATABASE_URL points at a Postgres with
// PostGIS available (e.g. the docker-compose db with a scratch database):
//
//	TEST_DATABASE_URL=postgres://pullup:pullup@localhost:5432/pullup_test?sslmode=disable go test ./internal/store/...
//
// The internal/api package's HTTP tests point at the same database and
// truncate the same tables between tests. `go test ./...` runs different
// packages' test binaries concurrently, so both packages take a Postgres
// advisory lock (see testDBLockKey) around setup+truncate to keep one
// package's reset from clobbering another package's in-flight test.

const testDBLockKey = 0x7075_6c6c_7570 // "pullup" — arbitrary, just needs to match internal/api's

func acquireTestDBLock(t *testing.T, ctx context.Context, databaseURL string) {
	t.Helper()
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatalf("test db lock connect: %v", err)
	}
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock($1)", int64(testDBLockKey)); err != nil {
		t.Fatalf("acquire test db lock: %v", err)
	}
	t.Cleanup(func() {
		conn.Exec(context.Background(), "SELECT pg_advisory_unlock($1)", int64(testDBLockKey))
		conn.Close(context.Background())
	})
}

func testStore(t *testing.T) *store.Store {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping PostGIS integration tests")
	}
	ctx := context.Background()
	acquireTestDBLock(t, ctx, url)
	st, err := store.New(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(st.Close)
	if err := st.Migrate(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// Isolate each run.
	if _, err := st.Pool.Exec(ctx,
		"TRUNCATE users, refresh_tokens, courts, check_ins, crowd_reports, court_votes, court_photos, flags, seed_regions, sessions, session_rsvps, court_messages CASCADE"); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	return st
}

func createUser(t *testing.T, st *store.Store, email string) uuid.UUID {
	t.Helper()
	hash := "x"
	u, err := st.Queries.CreateUser(context.Background(), gen.CreateUserParams{
		Email: email, PasswordHash: &hash, DisplayName: "Test User",
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	return u.ID
}

func createCourt(t *testing.T, st *store.Store, name string, lat, lng float64, submittedBy uuid.UUID) gen.CreateCourtRow {
	t.Helper()
	c, err := st.Queries.CreateCourt(context.Background(), gen.CreateCourtParams{
		Name: name, Lng: lng, Lat: lat, Indoor: false, IsPublic: true, SubmittedBy: &submittedBy,
	})
	if err != nil {
		t.Fatalf("create court %s: %v", name, err)
	}
	return c
}

// Rucker Park, NYC.
const ruckerLat, ruckerLng = 40.829256, -73.936192

func TestCourtsNearbyRadius(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	uid := createUser(t, st, "geo@test.local")

	near := createCourt(t, st, "Near Court", ruckerLat, ruckerLng, uid)
	// ~0.01 deg latitude ≈ 1.1 km north.
	createCourt(t, st, "Far Court", ruckerLat+0.05, ruckerLng, uid) // ~5.5 km

	rows, err := st.Queries.CourtsNearby(ctx, gen.CourtsNearbyParams{
		Lng: ruckerLng, Lat: ruckerLat, RadiusM: 2000,
	})
	if err != nil {
		t.Fatalf("nearby: %v", err)
	}
	if len(rows) != 1 || rows[0].ID != near.ID {
		t.Fatalf("want only Near Court within 2km, got %d rows", len(rows))
	}
	if rows[0].DistanceM > 5 {
		t.Errorf("distance to same point = %f m, want ~0", rows[0].DistanceM)
	}

	all, err := st.Queries.CourtsNearby(ctx, gen.CourtsNearbyParams{
		Lng: ruckerLng, Lat: ruckerLat, RadiusM: 10_000,
	})
	if err != nil {
		t.Fatalf("nearby wide: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("want both courts within 10km, got %d", len(all))
	}
	if all[0].ID != near.ID {
		t.Error("results must be ordered by distance")
	}
}

func TestCourtsInBBox(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	uid := createUser(t, st, "bbox@test.local")

	in := createCourt(t, st, "Inside", ruckerLat, ruckerLng, uid)
	createCourt(t, st, "Outside", ruckerLat+1, ruckerLng+1, uid)

	rows, err := st.Queries.CourtsInBBox(ctx, gen.CourtsInBBoxParams{
		MinLng: ruckerLng - 0.01, MinLat: ruckerLat - 0.01,
		MaxLng: ruckerLng + 0.01, MaxLat: ruckerLat + 0.01,
	})
	if err != nil {
		t.Fatalf("bbox: %v", err)
	}
	if len(rows) != 1 || rows[0].ID != in.ID {
		t.Fatalf("want only Inside court, got %d rows", len(rows))
	}
}

func TestCheckInFlow(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	uid := createUser(t, st, "checkin@test.local")
	court := createCourt(t, st, "Court A", ruckerLat, ruckerLng, uid)
	courtB := createCourt(t, st, "Court B", ruckerLat+0.05, ruckerLng, uid)

	// Distance check: at the court vs ~5.5 km away.
	d, err := st.Queries.CourtCheckInDistance(ctx, gen.CourtCheckInDistanceParams{
		Lng: ruckerLng, Lat: ruckerLat, CourtID: court.ID,
	})
	if err != nil {
		t.Fatalf("distance: %v", err)
	}
	if d > 5 {
		t.Errorf("at-court distance = %f, want ~0", d)
	}
	dFar, err := st.Queries.CourtCheckInDistance(ctx, gen.CourtCheckInDistanceParams{
		Lng: ruckerLng, Lat: ruckerLat, CourtID: courtB.ID,
	})
	if err != nil {
		t.Fatalf("distance far: %v", err)
	}
	if dFar < 4000 || dFar > 7000 {
		t.Errorf("far distance = %f m, want ~5500", dFar)
	}

	// Check in to A, then to B: only B's must remain active (one per user).
	dm := float32(1)
	if _, err := st.Queries.CreateCheckIn(ctx, gen.CreateCheckInParams{
		CourtID: court.ID, UserID: uid, Source: "manual", Lng: ruckerLng, Lat: ruckerLat, DistanceM: &dm,
	}); err != nil {
		t.Fatalf("check in A: %v", err)
	}
	if err := st.Queries.CloseActiveCheckInsForUser(ctx, uid); err != nil {
		t.Fatalf("close: %v", err)
	}
	if _, err := st.Queries.CreateCheckIn(ctx, gen.CreateCheckInParams{
		CourtID: courtB.ID, UserID: uid, Source: "geofence_auto", Lng: ruckerLng, Lat: ruckerLat + 0.05, DistanceM: &dm,
	}); err != nil {
		t.Fatalf("check in B: %v", err)
	}

	countA, err := st.Queries.CountActiveCheckIns(ctx, court.ID)
	if err != nil {
		t.Fatalf("count A: %v", err)
	}
	countB, err := st.Queries.CountActiveCheckIns(ctx, courtB.ID)
	if err != nil {
		t.Fatalf("count B: %v", err)
	}
	if countA != 0 || countB != 1 {
		t.Errorf("active counts A=%d B=%d, want 0 and 1", countA, countB)
	}

	current, err := st.Queries.GetActiveCheckInForUser(ctx, uid)
	if err != nil {
		t.Fatalf("current: %v", err)
	}
	if current.CourtID != courtB.ID || current.Source != "geofence_auto" {
		t.Errorf("current check-in = %+v", current)
	}
	if !current.ExpiresAt.After(time.Now().Add(110 * time.Minute)) {
		t.Errorf("expires_at %v not ~2h out", current.ExpiresAt)
	}
}

func TestCheckInExpiryFiltering(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	uid := createUser(t, st, "expiry@test.local")
	court := createCourt(t, st, "Expiry Court", ruckerLat, ruckerLng, uid)

	dm := float32(1)
	row, err := st.Queries.CreateCheckIn(ctx, gen.CreateCheckInParams{
		CourtID: court.ID, UserID: uid, Source: "manual", Lng: ruckerLng, Lat: ruckerLat, DistanceM: &dm,
	})
	if err != nil {
		t.Fatalf("check in: %v", err)
	}
	// Force the check-in into the past.
	if _, err := st.Pool.Exec(ctx, "UPDATE check_ins SET expires_at = now() - interval '1 minute' WHERE id = $1", row.ID); err != nil {
		t.Fatalf("expire: %v", err)
	}
	count, err := st.Queries.CountActiveCheckIns(ctx, court.ID)
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Errorf("expired check-in still counted: %d", count)
	}
	if _, err := st.Queries.GetActiveCheckInForUser(ctx, uid); err == nil {
		t.Error("expired check-in returned as current")
	} else if err != pgx.ErrNoRows {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestFindNearbyCourtsDupeCheck(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	uid := createUser(t, st, "dupe@test.local")
	createCourt(t, st, "Existing", ruckerLat, ruckerLng, uid)

	// 30 m away → duplicate; 300 m away → not.
	dupes, err := st.Queries.FindNearbyCourts(ctx, gen.FindNearbyCourtsParams{
		Lng: ruckerLng, Lat: ruckerLat + 0.00027, RadiusM: 75,
	})
	if err != nil {
		t.Fatalf("dupes: %v", err)
	}
	if len(dupes) != 1 {
		t.Errorf("want 1 dupe at ~30m, got %d", len(dupes))
	}
	far, err := st.Queries.FindNearbyCourts(ctx, gen.FindNearbyCourtsParams{
		Lng: ruckerLng, Lat: ruckerLat + 0.0027, RadiusM: 75,
	})
	if err != nil {
		t.Fatalf("far: %v", err)
	}
	if len(far) != 0 {
		t.Errorf("want no dupes at ~300m, got %d", len(far))
	}
}

func TestOSMUpsertIdempotent(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()

	osmType, osmID := "way", int64(222333444)
	name1 := "OSM Court"
	first, err := st.Queries.UpsertOSMCourt(ctx, gen.UpsertOSMCourtParams{
		Name: name1, Lng: ruckerLng, Lat: ruckerLat, Indoor: false, OsmType: &osmType, OsmID: &osmID,
	})
	if err != nil {
		t.Fatalf("first upsert: %v", err)
	}

	// Simulate the court getting verified by the crowd, then a re-import.
	if _, err := st.Queries.PromoteCourtIfPending(ctx, first.ID); err != nil {
		t.Fatalf("promote: %v", err)
	}
	second, err := st.Queries.UpsertOSMCourt(ctx, gen.UpsertOSMCourtParams{
		Name: "OSM Court Renamed", Lng: ruckerLng, Lat: ruckerLat, Indoor: false, OsmType: &osmType, OsmID: &osmID,
	})
	if err != nil {
		t.Fatalf("second upsert: %v", err)
	}
	if second.ID != first.ID {
		t.Fatal("re-import created a new row instead of updating")
	}

	court, err := st.Queries.GetCourt(ctx, first.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if court.Name != "OSM Court Renamed" {
		t.Errorf("name not updated on re-import: %q", court.Name)
	}
	if court.Status != "verified" {
		t.Errorf("re-import clobbered status: %q, want verified", court.Status)
	}
}

func TestSeedTileClaimSemantics(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	params := gen.ClaimSeedTileParams{TileX: -296, TileY: 163}

	// First claim wins.
	if _, err := st.Queries.ClaimSeedTile(ctx, params); err != nil {
		t.Fatalf("first claim: %v", err)
	}
	// Second claim while importing (fresh) must lose.
	if _, err := st.Queries.ClaimSeedTile(ctx, params); err != pgx.ErrNoRows {
		t.Fatalf("concurrent claim should return ErrNoRows, got %v", err)
	}
	// Done tiles are never re-claimed.
	found := int32(12)
	if err := st.Queries.MarkSeedTile(ctx, gen.MarkSeedTileParams{
		TileX: params.TileX, TileY: params.TileY, Status: "done", CourtsFound: &found,
	}); err != nil {
		t.Fatalf("mark done: %v", err)
	}
	if _, err := st.Queries.ClaimSeedTile(ctx, params); err != pgx.ErrNoRows {
		t.Fatalf("done tile should not be reclaimable, got %v", err)
	}
	// Failed tiles become reclaimable after the 24h backoff.
	if err := st.Queries.MarkSeedTile(ctx, gen.MarkSeedTileParams{
		TileX: params.TileX, TileY: params.TileY, Status: "failed",
	}); err != nil {
		t.Fatalf("mark failed: %v", err)
	}
	if _, err := st.Queries.ClaimSeedTile(ctx, params); err != pgx.ErrNoRows {
		t.Fatalf("failed tile inside backoff should not be reclaimable, got %v", err)
	}
	if _, err := st.Pool.Exec(ctx,
		"UPDATE seed_regions SET updated_at = now() - interval '25 hours' WHERE tile_x = $1 AND tile_y = $2",
		params.TileX, params.TileY); err != nil {
		t.Fatalf("age tile: %v", err)
	}
	if _, err := st.Queries.ClaimSeedTile(ctx, params); err != nil {
		t.Fatalf("stale failed tile should be reclaimable: %v", err)
	}
}

func TestVerifiedCheckInPromotesCourt(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	uid := createUser(t, st, "promote@test.local")
	court := createCourt(t, st, "Pending Court", ruckerLat, ruckerLng, uid)

	if _, err := st.Queries.PromoteCourtIfPending(ctx, court.ID); err != nil {
		t.Fatalf("promote: %v", err)
	}
	got, err := st.Queries.GetCourt(ctx, court.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Status != "verified" {
		t.Errorf("status = %q, want verified", got.Status)
	}
}

func TestPhase3Sessions(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	planner := createUser(t, st, "planner@test.local")
	joiner := createUser(t, st, "joiner@test.local")
	court := createCourt(t, st, "Session Court", ruckerLat, ruckerLng, planner)

	starts := time.Now().Add(3 * time.Hour).Truncate(time.Second)
	sess, err := st.Queries.CreateSession(ctx, gen.CreateSessionParams{
		CourtID: court.ID, CreatedBy: planner, StartsAt: starts,
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	for _, uid := range []uuid.UUID{planner, joiner} {
		if err := st.Queries.UpsertRSVP(ctx, gen.UpsertRSVPParams{
			SessionID: sess.ID, UserID: uid, Status: "going",
		}); err != nil {
			t.Fatalf("rsvp: %v", err)
		}
	}

	rows, err := st.Queries.ListUpcomingSessions(ctx, gen.ListUpcomingSessionsParams{
		CourtID: court.ID, ViewerID: joiner,
	})
	if err != nil {
		t.Fatalf("list sessions: %v", err)
	}
	if len(rows) != 1 || rows[0].GoingCount != 2 || rows[0].MyRsvp != "going" {
		t.Fatalf("want 1 session, 2 going, viewer going; got %+v", rows)
	}

	// Flipping to out drops the count; anonymous viewers see no my_rsvp.
	if err := st.Queries.UpsertRSVP(ctx, gen.UpsertRSVPParams{
		SessionID: sess.ID, UserID: joiner, Status: "out",
	}); err != nil {
		t.Fatalf("rsvp out: %v", err)
	}
	rows, _ = st.Queries.ListUpcomingSessions(ctx, gen.ListUpcomingSessionsParams{
		CourtID: court.ID, ViewerID: uuid.Nil,
	})
	if len(rows) != 1 || rows[0].GoingCount != 1 || rows[0].MyRsvp != "" {
		t.Fatalf("want 1 going and empty my_rsvp for anon; got %+v", rows)
	}

	// Only the creator can cancel.
	n, err := st.Queries.CancelSession(ctx, gen.CancelSessionParams{ID: sess.ID, CreatedBy: joiner})
	if err != nil || n != 0 {
		t.Fatalf("non-creator cancel: n=%d err=%v, want 0 rows", n, err)
	}
	n, err = st.Queries.CancelSession(ctx, gen.CancelSessionParams{ID: sess.ID, CreatedBy: planner})
	if err != nil || n != 1 {
		t.Fatalf("creator cancel: n=%d err=%v, want 1 row", n, err)
	}
	rows, _ = st.Queries.ListUpcomingSessions(ctx, gen.ListUpcomingSessionsParams{
		CourtID: court.ID, ViewerID: uuid.Nil,
	})
	if len(rows) != 0 {
		t.Fatalf("canceled session still listed: %+v", rows)
	}
}

func TestPhase3ChatAndModeration(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	uid := createUser(t, st, "chatter@test.local")
	court := createCourt(t, st, "Chat Court", ruckerLat, ruckerLng, uid)

	msg, err := st.Queries.CreateCourtMessage(ctx, gen.CreateCourtMessageParams{
		CourtID: court.ID, UserID: uid, Body: "who's running at 6?",
	})
	if err != nil {
		t.Fatalf("create message: %v", err)
	}
	if msg.DisplayName != "Test User" {
		t.Errorf("display_name = %q", msg.DisplayName)
	}

	last, err := st.Queries.LastMessageAt(ctx, uid)
	if err != nil || time.Since(last) > time.Minute {
		t.Fatalf("last message at = %v err=%v, want just now", last, err)
	}

	rows, err := st.Queries.ListCourtMessages(ctx, court.ID)
	if err != nil || len(rows) != 1 {
		t.Fatalf("list messages: %d rows, err=%v", len(rows), err)
	}

	// Hidden messages disappear from the list and reappear on unhide.
	if n, err := st.Queries.SetMessageHidden(ctx, gen.SetMessageHiddenParams{ID: msg.ID, Hidden: true}); err != nil || n != 1 {
		t.Fatalf("hide: n=%d err=%v", n, err)
	}
	if rows, _ = st.Queries.ListCourtMessages(ctx, court.ID); len(rows) != 0 {
		t.Fatal("hidden message still listed")
	}
	if n, err := st.Queries.SetMessageHidden(ctx, gen.SetMessageHiddenParams{ID: msg.ID, Hidden: false}); err != nil || n != 1 {
		t.Fatalf("unhide: n=%d err=%v", n, err)
	}
	if rows, _ = st.Queries.ListCourtMessages(ctx, court.ID); len(rows) != 1 {
		t.Fatal("unhidden message not listed")
	}
}

func TestPhase3ReputationWeighting(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	submitter := createUser(t, st, "submitter@test.local")
	vet := createUser(t, st, "veteran@test.local")
	rookie := createUser(t, st, "rookie@test.local")
	court := createCourt(t, st, "Weighted Court", ruckerLat, ruckerLng, submitter)

	// 60 reputation lands in the 2x tier (50-99).
	if err := st.Queries.AddReputation(ctx, gen.AddReputationParams{ID: vet, Reputation: 60}); err != nil {
		t.Fatalf("add reputation: %v", err)
	}
	for _, v := range []struct {
		uid  uuid.UUID
		vote int16
	}{{vet, 1}, {rookie, -1}} {
		if err := st.Queries.UpsertCourtVote(ctx, gen.UpsertCourtVoteParams{
			CourtID: court.ID, UserID: v.uid, Vote: v.vote,
		}); err != nil {
			t.Fatalf("vote: %v", err)
		}
	}
	stats, err := st.Queries.CourtVoteStatsWeighted(ctx, court.ID)
	if err != nil {
		t.Fatalf("weighted stats: %v", err)
	}
	// vet: +1 × 2, rookie: −1 × 1.
	if stats.NetWeighted != 1 || stats.WeightedUpvotes != 2 {
		t.Fatalf("weighted = %+v, want net 1, upvotes 2", stats)
	}

	// Check-in reputation guard: first check-in has no prior, second does.
	d := float32(5)
	ci1, err := st.Queries.CreateCheckIn(ctx, gen.CreateCheckInParams{
		CourtID: court.ID, UserID: rookie, Source: "manual", Lng: ruckerLng, Lat: ruckerLat, DistanceM: &d,
	})
	if err != nil {
		t.Fatalf("check-in: %v", err)
	}
	recent, err := st.Queries.HasRecentCheckInAtCourt(ctx, gen.HasRecentCheckInAtCourtParams{
		UserID: rookie, CourtID: court.ID, ExcludeID: ci1.ID,
	})
	if err != nil || recent {
		t.Fatalf("first check-in: recent=%v err=%v, want false", recent, err)
	}
	ci2, err := st.Queries.CreateCheckIn(ctx, gen.CreateCheckInParams{
		CourtID: court.ID, UserID: rookie, Source: "manual", Lng: ruckerLng, Lat: ruckerLat, DistanceM: &d,
	})
	if err != nil {
		t.Fatalf("second check-in: %v", err)
	}
	recent, err = st.Queries.HasRecentCheckInAtCourt(ctx, gen.HasRecentCheckInAtCourtParams{
		UserID: rookie, CourtID: court.ID, ExcludeID: ci2.ID,
	})
	if err != nil || !recent {
		t.Fatalf("second check-in: recent=%v err=%v, want true", recent, err)
	}
}
