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
		"TRUNCATE object_deletion_queue, users, refresh_tokens, courts, check_ins, crowd_reports, court_votes, court_photos, flags, seed_regions, sessions, session_rsvps, court_messages, follows, favorites, blocked_users, follow_requests CASCADE"); err != nil {
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

func TestSearchCourtsByName(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	uid := createUser(t, st, "court-search@test.local")

	exact := createCourt(t, st, "Rucker Park", ruckerLat, ruckerLng, uid)
	createCourt(t, st, "Rucker Park Annex", ruckerLat+0.01, ruckerLng, uid)
	createCourt(t, st, "West Rucker Park Courts", ruckerLat+0.02, ruckerLng, uid)
	rejected := createCourt(t, st, "Rucker Park Closed", ruckerLat+0.03, ruckerLng, uid)
	if err := st.Queries.SetCourtStatus(ctx, gen.SetCourtStatusParams{ID: rejected.ID, Status: "rejected"}); err != nil {
		t.Fatalf("reject court: %v", err)
	}

	rows, err := st.Queries.SearchCourtsByName(ctx, gen.SearchCourtsByNameParams{
		Query: "rucker park", BiasLat: float64Ptr(ruckerLat), BiasLng: float64Ptr(ruckerLng),
	})
	if err != nil {
		t.Fatalf("search courts: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("rows = %d, want 3", len(rows))
	}
	if rows[0].ID != exact.ID {
		t.Fatalf("first result = %q, want exact match", rows[0].Name)
	}
	for _, row := range rows {
		if row.ID == rejected.ID {
			t.Fatal("rejected court appeared in search")
		}
	}
	wildcardRows, err := st.Queries.SearchCourtsByName(ctx, gen.SearchCourtsByNameParams{Query: "%_"})
	if err != nil {
		t.Fatalf("search wildcard literals: %v", err)
	}
	if len(wildcardRows) != 0 {
		t.Fatalf("wildcard literals matched %d courts", len(wildcardRows))
	}
}

func float64Ptr(value float64) *float64 { return &value }

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
		CourtID: court.ID, UserID: uid, Source: "manual", DistanceM: &dm, PartySize: 1, HasBall: false,
	}); err != nil {
		t.Fatalf("check in A: %v", err)
	}
	if err := st.Queries.CloseActiveCheckInsForUser(ctx, uid); err != nil {
		t.Fatalf("close: %v", err)
	}
	if _, err := st.Queries.CreateCheckIn(ctx, gen.CreateCheckInParams{
		CourtID: courtB.ID, UserID: uid, Source: "geofence_auto", DistanceM: &dm, PartySize: 1, HasBall: false,
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
		CourtID: court.ID, UserID: uid, Source: "manual", DistanceM: &dm, PartySize: 1, HasBall: false,
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

// TestCourtHourlyCheckInHistoryOverlapsBuckets is the store-level regression
// for the Gate-2 finding: a check-in must contribute its party_size to EVERY
// local hour its active window [created_at, checked_out_at/expires_at)
// overlaps, not just its start hour. A check-in starting at 10:30 and active
// until 12:00 (90 minutes, tz_offset 0) must land in both the 10 and 11
// o'clock buckets, and must not leak into 9 or 12.
func TestCourtHourlyCheckInHistoryOverlapsBuckets(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	uid := createUser(t, st, "overlap@test.local")
	court := createCourt(t, st, "Overlap Court", ruckerLat, ruckerLng, uid)

	// Anchor to today (comfortably inside the trailing 56-day window) at a
	// fixed UTC hour that can't wrap past midnight, so dow is unambiguous.
	today := time.Now().UTC().Truncate(24 * time.Hour)
	createdAt := today.Add(10*time.Hour + 30*time.Minute)
	expiresAt := createdAt.Add(90 * time.Minute) // 12:00 -> spans hours 10 and 11

	const partySize = 4
	if _, err := st.Pool.Exec(ctx, `
		INSERT INTO check_ins (court_id, user_id, source, created_at, expires_at, party_size)
		VALUES ($1, $2, 'manual', $3, $4, $5)`,
		court.ID, uid, createdAt, expiresAt, partySize); err != nil {
		t.Fatalf("insert check-in: %v", err)
	}

	rows, err := st.Queries.CourtHourlyCheckInHistory(ctx, gen.CourtHourlyCheckInHistoryParams{
		TzOffsetMinutes: 0,
		CourtIds:        []uuid.UUID{court.ID},
		Dow:             int32(createdAt.Weekday()),
	})
	if err != nil {
		t.Fatalf("history: %v", err)
	}

	byHour := make(map[int]int32, len(rows))
	for _, r := range rows {
		byHour[int(r.LocalHour)] = r.TotalHeads
	}
	if byHour[10] != partySize {
		t.Errorf("hour 10 total_heads = %d, want %d", byHour[10], partySize)
	}
	if byHour[11] != partySize {
		t.Errorf("hour 11 total_heads = %d, want %d (window overlap must spill into the second hour)", byHour[11], partySize)
	}
	if _, ok := byHour[9]; ok {
		t.Errorf("hour 9 should have no rows, got %d", byHour[9])
	}
	if _, ok := byHour[12]; ok {
		t.Errorf("hour 12 should have no rows (window ends exactly at 12:00, exclusive), got %d", byHour[12])
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

	rows, err := st.Queries.ListCourtMessages(ctx, gen.ListCourtMessagesParams{CourtID: court.ID, ViewerID: uuid.Nil})
	if err != nil || len(rows) != 1 {
		t.Fatalf("list messages: %d rows, err=%v", len(rows), err)
	}

	// Hidden messages disappear from the list and reappear on unhide.
	if n, err := st.Queries.SetMessageHidden(ctx, gen.SetMessageHiddenParams{ID: msg.ID, Hidden: true}); err != nil || n != 1 {
		t.Fatalf("hide: n=%d err=%v", n, err)
	}
	if rows, _ = st.Queries.ListCourtMessages(ctx, gen.ListCourtMessagesParams{CourtID: court.ID, ViewerID: uuid.Nil}); len(rows) != 0 {
		t.Fatal("hidden message still listed")
	}
	if n, err := st.Queries.SetMessageHidden(ctx, gen.SetMessageHiddenParams{ID: msg.ID, Hidden: false}); err != nil || n != 1 {
		t.Fatalf("unhide: n=%d err=%v", n, err)
	}
	if rows, _ = st.Queries.ListCourtMessages(ctx, gen.ListCourtMessagesParams{CourtID: court.ID, ViewerID: uuid.Nil}); len(rows) != 1 {
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
		CourtID: court.ID, UserID: rookie, Source: "manual", DistanceM: &d, PartySize: 1, HasBall: false,
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
	if err := st.Queries.CloseActiveCheckInsForUser(ctx, rookie); err != nil {
		t.Fatalf("close first check-in: %v", err)
	}
	ci2, err := st.Queries.CreateCheckIn(ctx, gen.CreateCheckInParams{
		CourtID: court.ID, UserID: rookie, Source: "manual", DistanceM: &d, PartySize: 1, HasBall: false,
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

func TestComplianceBlockAndDelete(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	alice := createUser(t, st, "alice-comp@test.local")
	bob := createUser(t, st, "bob-comp@test.local")
	court := createCourt(t, st, "Compliance Court", ruckerLat, ruckerLng, alice)

	if _, err := st.Queries.CreateCourtMessage(ctx, gen.CreateCourtMessageParams{
		CourtID: court.ID, UserID: bob, Body: "hello",
	}); err != nil {
		t.Fatalf("message: %v", err)
	}

	// Blocking hides bob's messages from alice, but not from anonymous.
	if err := st.Queries.BlockUser(ctx, gen.BlockUserParams{BlockerID: alice, BlockedID: bob}); err != nil {
		t.Fatalf("block: %v", err)
	}
	rows, _ := st.Queries.ListCourtMessages(ctx, gen.ListCourtMessagesParams{CourtID: court.ID, ViewerID: alice})
	if len(rows) != 0 {
		t.Fatal("blocked user's message still visible to blocker")
	}
	rows, _ = st.Queries.ListCourtMessages(ctx, gen.ListCourtMessagesParams{CourtID: court.ID, ViewerID: uuid.Nil})
	if len(rows) != 1 {
		t.Fatal("message hidden from anonymous viewer")
	}
	blocked, err := st.Queries.ListBlockedUsers(ctx, alice)
	if err != nil || len(blocked) != 1 || blocked[0].BlockedID != bob {
		t.Fatalf("blocked list = %+v err=%v", blocked, err)
	}
	if err := st.Queries.UnblockUser(ctx, gen.UnblockUserParams{BlockerID: alice, BlockedID: bob}); err != nil {
		t.Fatalf("unblock: %v", err)
	}
	rows, _ = st.Queries.ListCourtMessages(ctx, gen.ListCourtMessagesParams{CourtID: court.ID, ViewerID: alice})
	if len(rows) != 1 {
		t.Fatal("message still hidden after unblock")
	}

	// Deleting alice detaches her court but keeps it, and removes her row.
	if err := st.Queries.DetachUserFromCourts(ctx, &alice); err != nil {
		t.Fatalf("detach courts: %v", err)
	}
	if err := st.Queries.DetachUserFromResolvedFlags(ctx, &alice); err != nil {
		t.Fatalf("detach flags: %v", err)
	}
	if n, err := st.Queries.DeleteUser(ctx, alice); err != nil || n != 1 {
		t.Fatalf("delete user: n=%d err=%v", n, err)
	}
	got, err := st.Queries.GetCourt(ctx, court.ID)
	if err != nil {
		t.Fatalf("court gone after submitter deletion: %v", err)
	}
	if got.SubmittedBy != nil {
		t.Error("submitted_by not detached")
	}
}

// insertCheckInDaysAgo inserts a check-in whose created_at falls on the UTC
// calendar day `daysAgo` days before today (0 = today, 1 = yesterday, ...),
// computed in SQL so the test is stable regardless of when it runs.
func insertCheckInDaysAgo(t *testing.T, st *store.Store, courtID, userID uuid.UUID, daysAgo int) {
	t.Helper()
	ctx := context.Background()
	_, err := st.Pool.Exec(ctx, `
		INSERT INTO check_ins (court_id, user_id, source, created_at, expires_at, checked_out_at)
		VALUES (
			$1, $2, 'manual',
			(((now() AT TIME ZONE 'UTC')::date - (INTERVAL '1 day' * $3::int) + INTERVAL '12 hours') AT TIME ZONE 'UTC'),
			(((now() AT TIME ZONE 'UTC')::date - (INTERVAL '1 day' * $3::int) + INTERVAL '14 hours') AT TIME ZONE 'UTC'),
			(((now() AT TIME ZONE 'UTC')::date - (INTERVAL '1 day' * $3::int) + INTERVAL '14 hours') AT TIME ZONE 'UTC')
		)`, courtID, userID, daysAgo)
	if err != nil {
		t.Fatalf("insert check-in %d days ago: %v", daysAgo, err)
	}
}

func TestCurrentStreakDays(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	owner := createUser(t, st, "streak-owner@test.local")
	court := createCourt(t, st, "Streak Court", ruckerLat, ruckerLng, owner)

	cases := []struct {
		name     string
		email    string
		daysAgo  []int
		wantDays int32
	}{
		{"today+yesterday+2ago", "streak-a@test.local", []int{0, 1, 2}, 3},
		{"today+2ago gap yesterday", "streak-b@test.local", []int{0, 2}, 1},
		{"only yesterday", "streak-c@test.local", []int{1}, 1},
		{"only 2ago lapsed", "streak-d@test.local", []int{2}, 0},
		{"same day twice", "streak-e@test.local", []int{0, 0}, 1},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			uid := createUser(t, st, tc.email)
			for _, d := range tc.daysAgo {
				insertCheckInDaysAgo(t, st, court.ID, uid, d)
			}
			got, err := st.Queries.CurrentStreakDays(ctx, uid)
			if err != nil {
				t.Fatalf("CurrentStreakDays: %v", err)
			}
			if got != tc.wantDays {
				t.Errorf("CurrentStreakDays(%s) = %d, want %d", tc.name, got, tc.wantDays)
			}
		})
	}
}

func TestFollowGraph(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	a := createUser(t, st, "follower@test.local")
	b := createUser(t, st, "followee@test.local")

	if err := st.Queries.Follow(ctx, gen.FollowParams{FollowerID: a, FolloweeID: b}); err != nil {
		t.Fatalf("follow: %v", err)
	}
	// Idempotent.
	if err := st.Queries.Follow(ctx, gen.FollowParams{FollowerID: a, FolloweeID: b}); err != nil {
		t.Fatalf("follow again: %v", err)
	}
	following, err := st.Queries.IsFollowing(ctx, gen.IsFollowingParams{FollowerID: a, FolloweeID: b})
	if err != nil || !following {
		t.Fatalf("IsFollowing = %v, %v; want true", following, err)
	}
	if n, _ := st.Queries.CountFollowers(ctx, b); n != 1 {
		t.Errorf("followers of b = %d, want 1", n)
	}
	if n, _ := st.Queries.CountFollowing(ctx, a); n != 1 {
		t.Errorf("following of a = %d, want 1", n)
	}
	followers, err := st.Queries.ListFollowers(ctx, gen.ListFollowersParams{FolloweeID: b, Limit: 10})
	if err != nil || len(followers) != 1 || followers[0].ID != a {
		t.Fatalf("ListFollowers = %+v, err=%v", followers, err)
	}
	followees, err := st.Queries.ListFollowing(ctx, gen.ListFollowingParams{FollowerID: a, Limit: 10})
	if err != nil || len(followees) != 1 || followees[0].ID != b {
		t.Fatalf("ListFollowing = %+v, err=%v", followees, err)
	}
	// DeleteFollowsBetween severs both directions.
	if err := st.Queries.DeleteFollowsBetween(ctx, gen.DeleteFollowsBetweenParams{FollowerID: a, FolloweeID: b}); err != nil {
		t.Fatalf("delete between: %v", err)
	}
	following, _ = st.Queries.IsFollowing(ctx, gen.IsFollowingParams{FollowerID: a, FolloweeID: b})
	if following {
		t.Error("still following after DeleteFollowsBetween")
	}
}

func TestFeedFriendsHere(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	viewer := createUser(t, st, "feed-viewer@test.local")
	friend := createUser(t, st, "feed-friend@test.local")
	stranger := createUser(t, st, "feed-stranger@test.local")
	court := createCourt(t, st, "Feed Court", ruckerLat, ruckerLng, viewer)

	// Mutual follow between viewer and friend; one-directional to stranger.
	for _, p := range []gen.FollowParams{
		{FollowerID: viewer, FolloweeID: friend},
		{FollowerID: friend, FolloweeID: viewer},
		{FollowerID: viewer, FolloweeID: stranger},
	} {
		if err := st.Queries.Follow(ctx, p); err != nil {
			t.Fatalf("follow %+v: %v", p, err)
		}
	}

	dm := float32(1)
	for _, uid := range []uuid.UUID{friend, stranger} {
		if _, err := st.Queries.CreateCheckIn(ctx, gen.CreateCheckInParams{
			CourtID: court.ID, UserID: uid, Source: "manual", DistanceM: &dm, PartySize: 1, HasBall: false,
		}); err != nil {
			t.Fatalf("check in %v: %v", uid, err)
		}
	}

	rows, err := st.Queries.ListFriendsCheckedIn(ctx, viewer)
	if err != nil {
		t.Fatalf("friends here: %v", err)
	}
	if len(rows) != 1 || rows[0].ID != friend {
		t.Fatalf("friends_here = %+v, want only the mutual friend", rows)
	}
	if rows[0].CourtName != "Feed Court" {
		t.Errorf("court name = %q, want Feed Court", rows[0].CourtName)
	}
}

func TestFeedRuns(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	viewer := createUser(t, st, "runs-viewer@test.local")
	followed := createUser(t, st, "runs-followed@test.local")
	stranger := createUser(t, st, "runs-stranger@test.local")
	favCourt := createCourt(t, st, "Fav Court", ruckerLat, ruckerLng, viewer)
	otherCourt := createCourt(t, st, "Other Court", ruckerLat+0.05, ruckerLng, followed)

	if err := st.Queries.Follow(ctx, gen.FollowParams{FollowerID: viewer, FolloweeID: followed}); err != nil {
		t.Fatalf("follow: %v", err)
	}
	if err := st.Queries.AddFavorite(ctx, gen.AddFavoriteParams{UserID: viewer, CourtID: favCourt.ID}); err != nil {
		t.Fatalf("favorite: %v", err)
	}

	future := time.Now().Add(3 * time.Hour)
	mkSession := func(courtID, planner uuid.UUID) {
		if _, err := st.Queries.CreateSession(ctx, gen.CreateSessionParams{
			CourtID: courtID, CreatedBy: planner, StartsAt: future, Note: nil,
		}); err != nil {
			t.Fatalf("create session: %v", err)
		}
	}
	mkSession(otherCourt.ID, followed) // in feed: followed planner
	mkSession(favCourt.ID, stranger)   // in feed: favorited court
	mkSession(favCourt.ID, viewer)     // excluded: own run
	mkSession(otherCourt.ID, stranger) // excluded: neither

	rows, err := st.Queries.ListFeedRuns(ctx, viewer)
	if err != nil {
		t.Fatalf("feed runs: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("feed runs = %d, want 2", len(rows))
	}
	for _, r := range rows {
		if r.CreatedBy == viewer {
			t.Errorf("own run leaked into feed: %+v", r)
		}
		if r.CourtName == "" {
			t.Errorf("missing court_name: %+v", r)
		}
	}
}

func TestFollowRequestLifecycle(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	requester := createUser(t, st, "req@test.local")
	target := createUser(t, st, "tgt@test.local")

	// Create request: the first insert affects 1 row; a duplicate affects 0
	// (ON CONFLICT DO NOTHING) — this row count is what gates the re-notify.
	if n, err := st.Queries.CreateFollowRequest(ctx, gen.CreateFollowRequestParams{
		RequesterID: requester, TargetID: target,
	}); err != nil || n != 1 {
		t.Fatalf("first create request = %d, %v; want 1", n, err)
	}
	if n, err := st.Queries.CreateFollowRequest(ctx, gen.CreateFollowRequestParams{
		RequesterID: requester, TargetID: target,
	}); err != nil || n != 0 {
		t.Fatalf("duplicate create request = %d, %v; want 0", n, err)
	}
	got, err := st.Queries.IsFollowRequested(ctx, gen.IsFollowRequestedParams{RequesterID: requester, TargetID: target})
	if err != nil || !got {
		t.Fatalf("IsFollowRequested = %v, %v; want true", got, err)
	}
	// No follow edge exists yet.
	if f, _ := st.Queries.IsFollowing(ctx, gen.IsFollowingParams{FollowerID: requester, FolloweeID: target}); f {
		t.Fatal("pending request must not create a follow edge")
	}

	// Accept: request → follow, atomically.
	n, err := st.Queries.AcceptFollowRequest(ctx, gen.AcceptFollowRequestParams{RequesterID: requester, TargetID: target})
	if err != nil || n != 1 {
		t.Fatalf("AcceptFollowRequest = %d, %v; want 1", n, err)
	}
	if f, _ := st.Queries.IsFollowing(ctx, gen.IsFollowingParams{FollowerID: requester, FolloweeID: target}); !f {
		t.Error("accept did not create the follow edge")
	}
	if got, _ := st.Queries.IsFollowRequested(ctx, gen.IsFollowRequestedParams{RequesterID: requester, TargetID: target}); got {
		t.Error("request should be gone after accept")
	}
	// Accepting again is a no-op (0 rows).
	if n, _ := st.Queries.AcceptFollowRequest(ctx, gen.AcceptFollowRequestParams{RequesterID: requester, TargetID: target}); n != 0 {
		t.Errorf("second accept = %d, want 0", n)
	}
}

func TestCourtFilters(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	uid := createUser(t, st, "filter@test.local")
	lit := createCourt(t, st, "Lit Court", ruckerLat, ruckerLng, uid)
	createCourt(t, st, "Dark Court", ruckerLat+0.001, ruckerLng, uid)
	if _, err := st.Pool.Exec(ctx, "UPDATE courts SET lighting = true WHERE id = $1", lit.ID); err != nil {
		t.Fatalf("set lighting: %v", err)
	}

	litArg := true
	rows, err := st.Queries.CourtsNearby(ctx, gen.CourtsNearbyParams{
		Lng: ruckerLng, Lat: ruckerLat, RadiusM: 5000, Lit: &litArg,
	})
	if err != nil {
		t.Fatalf("nearby lit: %v", err)
	}
	if len(rows) != 1 || rows[0].ID != lit.ID {
		t.Fatalf("lit filter returned %d rows, want only Lit Court", len(rows))
	}
	// No filter → both courts.
	all, _ := st.Queries.CourtsNearby(ctx, gen.CourtsNearbyParams{Lng: ruckerLng, Lat: ruckerLat, RadiusM: 5000})
	if len(all) != 2 {
		t.Errorf("no-filter returned %d, want 2", len(all))
	}
}

func TestReseedAndCount(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()

	// Claim + mark one tile done.
	if _, err := st.Queries.ClaimSeedTile(ctx, gen.ClaimSeedTileParams{TileX: 100, TileY: 100}); err != nil {
		t.Fatalf("claim: %v", err)
	}
	found := int32(3)
	if err := st.Queries.MarkSeedTile(ctx, gen.MarkSeedTileParams{TileX: 100, TileY: 100, Status: "done", CourtsFound: &found}); err != nil {
		t.Fatalf("mark: %v", err)
	}
	settled, err := st.Queries.CountSettledTilesInRange(ctx, gen.CountSettledTilesInRangeParams{MinX: 100, MaxX: 100, MinY: 100, MaxY: 100})
	if err != nil || settled != 1 {
		t.Fatalf("count settled = %d, %v; want 1", settled, err)
	}
	// A 'failed' tile also counts as settled (so the client stops polling).
	if _, err := st.Queries.ClaimSeedTile(ctx, gen.ClaimSeedTileParams{TileX: 101, TileY: 100}); err != nil {
		t.Fatalf("claim 101: %v", err)
	}
	if err := st.Queries.MarkSeedTile(ctx, gen.MarkSeedTileParams{TileX: 101, TileY: 100, Status: "failed", CourtsFound: nil}); err != nil {
		t.Fatalf("mark failed: %v", err)
	}
	if s2, _ := st.Queries.CountSettledTilesInRange(ctx, gen.CountSettledTilesInRangeParams{MinX: 100, MaxX: 101, MinY: 100, MaxY: 100}); s2 != 2 {
		t.Errorf("settled over done+failed = %d, want 2", s2)
	}
	// A fresh 'done' tile is NOT re-claimable.
	if _, err := st.Queries.ClaimSeedTile(ctx, gen.ClaimSeedTileParams{TileX: 100, TileY: 100}); err == nil {
		t.Error("fresh done tile should not be re-claimable")
	}
	// Age it past 90 days → re-claimable.
	if _, err := st.Pool.Exec(ctx, "UPDATE seed_regions SET updated_at = now() - interval '91 days' WHERE tile_x=100 AND tile_y=100"); err != nil {
		t.Fatalf("age: %v", err)
	}
	if _, err := st.Queries.ClaimSeedTile(ctx, gen.ClaimSeedTileParams{TileX: 100, TileY: 100}); err != nil {
		t.Errorf("90-day-old done tile should be re-claimable: %v", err)
	}
}

func TestSeedTileQueue(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()

	// Enqueue is idempotent.
	for i := 0; i < 2; i++ {
		if err := st.Queries.EnqueueSeedTile(ctx, gen.EnqueueSeedTileParams{TileX: 5, TileY: 7}); err != nil {
			t.Fatalf("enqueue %d: %v", i, err)
		}
	}
	// Claim returns the pending tile.
	row, err := st.Queries.ClaimNextSeedTile(ctx)
	if err != nil || row.TileX != 5 || row.TileY != 7 {
		t.Fatalf("claim next = %+v, %v; want tile (5,7)", row, err)
	}
	// Now claimed ('importing'), no other pending tile → ErrNoRows.
	if _, err := st.Queries.ClaimNextSeedTile(ctx); err == nil {
		t.Error("expected no claimable tile after the only one was claimed")
	}
	// Enqueue does not reset a non-pending tile: (5,7) is 'importing'.
	if err := st.Queries.EnqueueSeedTile(ctx, gen.EnqueueSeedTileParams{TileX: 5, TileY: 7}); err != nil {
		t.Fatalf("re-enqueue: %v", err)
	}
	if _, err := st.Queries.ClaimNextSeedTile(ctx); err == nil {
		t.Error("re-enqueue must not resurrect an importing tile as pending")
	}
}

func TestEnrichmentQueue(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	uid := createUser(t, st, "enrichq@test.local")
	c := createCourt(t, st, "Enrich Court", ruckerLat, ruckerLng, uid)

	// Not requested yet → nothing to claim.
	if _, err := st.Queries.ClaimNextCourtEnrichment(ctx); err == nil {
		t.Error("no court requested yet, claim should be empty")
	}
	if err := st.Queries.RequestEnrichment(ctx, c.ID); err != nil {
		t.Fatalf("request: %v", err)
	}
	claimed, err := st.Queries.ClaimNextCourtEnrichment(ctx)
	if err != nil || claimed.ID != c.ID {
		t.Fatalf("claim enrichment = %+v, %v; want court %s", claimed, err, c.ID)
	}
	// The active lease prevents a concurrent duplicate claim.
	if _, err := st.Queries.ClaimNextCourtEnrichment(ctx); err == nil {
		t.Error("leased court should not be re-claimable")
	}
	if err := st.Queries.MarkCourtEnrichmentComplete(ctx, c.ID); err != nil {
		t.Fatalf("complete enrichment: %v", err)
	}
	if _, err := st.Queries.ClaimNextCourtEnrichment(ctx); err == nil {
		t.Error("completed court should not be re-claimable")
	}
}

func TestSetCourtAttributesIfNull(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	uid := createUser(t, st, "attrs@test.local")

	// A court that already knows its surface but nothing else.
	existing := "asphalt"
	c, err := st.Queries.CreateCourt(ctx, gen.CreateCourtParams{
		Name: "Attr Court", Lng: ruckerLng, Lat: ruckerLat,
		Surface: &existing, Indoor: false, IsPublic: true, SubmittedBy: &uid,
	})
	if err != nil {
		t.Fatalf("create court: %v", err)
	}

	newSurface := "concrete"
	lit := true
	var hoops int16 = 4
	indoor := true
	if err := st.Queries.SetCourtAttributesIfNull(ctx, gen.SetCourtAttributesIfNullParams{
		ID:        c.ID,
		Surface:   &newSurface, // must NOT clobber the existing 'asphalt'
		Lighting:  &lit,        // fills a null
		HoopCount: &hoops,      // fills a null
		Indoor:    &indoor,     // additive: false -> true
	}); err != nil {
		t.Fatalf("set attributes: %v", err)
	}

	got, err := st.Queries.GetCourt(ctx, c.ID)
	if err != nil {
		t.Fatalf("get court: %v", err)
	}
	if got.Surface == nil || *got.Surface != "asphalt" {
		t.Errorf("surface = %v, want asphalt (not clobbered)", got.Surface)
	}
	if got.Lighting == nil || !*got.Lighting {
		t.Errorf("lighting = %v, want true (filled)", got.Lighting)
	}
	if got.HoopCount == nil || *got.HoopCount != 4 {
		t.Errorf("hoop_count = %v, want 4 (filled)", got.HoopCount)
	}
	if !got.Indoor {
		t.Error("indoor = false, want true (additive)")
	}

	// A second pass that would turn indoor back off must not: indoor is additive.
	off := false
	if err := st.Queries.SetCourtAttributesIfNull(ctx, gen.SetCourtAttributesIfNullParams{
		ID: c.ID, Indoor: &off,
	}); err != nil {
		t.Fatalf("second set: %v", err)
	}
	if got, _ := st.Queries.GetCourt(ctx, c.ID); !got.Indoor {
		t.Error("indoor flipped back to false; must stay true")
	}
}
