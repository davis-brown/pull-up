package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

func TestFavoritesFlow(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	uid := createUser(t, st, "fan@test.local")
	court := createCourt(t, st, "Favorite Court", ruckerLat, ruckerLng, uid)

	fav, err := st.Queries.IsFavorite(ctx, gen.IsFavoriteParams{UserID: uid, CourtID: court.ID})
	if err != nil {
		t.Fatalf("is favorite (before): %v", err)
	}
	if fav {
		t.Fatal("court should not be favorited yet")
	}

	if err := st.Queries.AddFavorite(ctx, gen.AddFavoriteParams{UserID: uid, CourtID: court.ID}); err != nil {
		t.Fatalf("add favorite: %v", err)
	}
	// Adding twice must not error (ON CONFLICT DO NOTHING).
	if err := st.Queries.AddFavorite(ctx, gen.AddFavoriteParams{UserID: uid, CourtID: court.ID}); err != nil {
		t.Fatalf("add favorite again: %v", err)
	}

	fav, err = st.Queries.IsFavorite(ctx, gen.IsFavoriteParams{UserID: uid, CourtID: court.ID})
	if err != nil {
		t.Fatalf("is favorite (after): %v", err)
	}
	if !fav {
		t.Fatal("court should be favorited")
	}

	list, err := st.Queries.ListFavoriteCourts(ctx, uid)
	if err != nil {
		t.Fatalf("list favorites: %v", err)
	}
	if len(list) != 1 || list[0].ID != court.ID {
		t.Fatalf("want [%s], got %+v", court.ID, list)
	}

	if err := st.Queries.RemoveFavorite(ctx, gen.RemoveFavoriteParams{UserID: uid, CourtID: court.ID}); err != nil {
		t.Fatalf("remove favorite: %v", err)
	}
	fav, err = st.Queries.IsFavorite(ctx, gen.IsFavoriteParams{UserID: uid, CourtID: court.ID})
	if err != nil {
		t.Fatalf("is favorite (removed): %v", err)
	}
	if fav {
		t.Fatal("court should no longer be favorited")
	}
}

func TestPushTokenFavoriterLookup(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	actor := createUser(t, st, "actor@test.local")
	fan := createUser(t, st, "fan2@test.local")
	court := createCourt(t, st, "Push Court", ruckerLat, ruckerLng, actor)

	if err := st.Queries.UpsertPushToken(ctx, gen.UpsertPushTokenParams{Token: "actor-token", UserID: actor}); err != nil {
		t.Fatalf("upsert actor token: %v", err)
	}
	if err := st.Queries.UpsertPushToken(ctx, gen.UpsertPushTokenParams{Token: "fan-token", UserID: fan}); err != nil {
		t.Fatalf("upsert fan token: %v", err)
	}
	if err := st.Queries.AddFavorite(ctx, gen.AddFavoriteParams{UserID: actor, CourtID: court.ID}); err != nil {
		t.Fatalf("actor favorite: %v", err)
	}
	if err := st.Queries.AddFavorite(ctx, gen.AddFavoriteParams{UserID: fan, CourtID: court.ID}); err != nil {
		t.Fatalf("fan favorite: %v", err)
	}

	tokens, err := st.Queries.ListFavoriterPushTokens(ctx, gen.ListFavoriterPushTokensParams{
		CourtID: court.ID, UserID: actor,
	})
	if err != nil {
		t.Fatalf("list favoriter tokens: %v", err)
	}
	if len(tokens) != 1 || tokens[0] != "fan-token" {
		t.Fatalf("want only the fan's token (acting user excluded), got %v", tokens)
	}

	// Re-registering the same token for a different user reassigns it
	// (device changed hands / user switched accounts).
	if err := st.Queries.UpsertPushToken(ctx, gen.UpsertPushTokenParams{Token: "fan-token", UserID: actor}); err != nil {
		t.Fatalf("reassign token: %v", err)
	}
	tokens, err = st.Queries.ListFavoriterPushTokens(ctx, gen.ListFavoriterPushTokensParams{
		CourtID: court.ID, UserID: actor,
	})
	if err != nil {
		t.Fatalf("list after reassign: %v", err)
	}
	if len(tokens) != 0 {
		t.Fatalf("token should have moved to actor and been excluded, got %v", tokens)
	}
}

func TestOAuthUserLifecycle(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	subject := "google-subject-123"

	if _, err := st.Queries.GetUserByOAuth(ctx, gen.GetUserByOAuthParams{
		AuthProvider: "google", OauthSubject: &subject,
	}); err != pgx.ErrNoRows {
		t.Fatalf("want ErrNoRows before signup, got %v", err)
	}

	created, err := st.Queries.CreateOAuthUser(ctx, gen.CreateOAuthUserParams{
		Email: "oauth@test.local", DisplayName: "OAuth Player",
		AuthProvider: "google", OauthSubject: &subject,
	})
	if err != nil {
		t.Fatalf("create oauth user: %v", err)
	}
	if created.IsAdmin {
		t.Error("new oauth user must not be an admin by default")
	}

	found, err := st.Queries.GetUserByOAuth(ctx, gen.GetUserByOAuthParams{
		AuthProvider: "google", OauthSubject: &subject,
	})
	if err != nil {
		t.Fatalf("get oauth user: %v", err)
	}
	if found.ID != created.ID {
		t.Fatalf("looked up wrong user: got %s, want %s", found.ID, created.ID)
	}

	otherSubject := "google-subject-456"
	if _, err := st.Queries.GetUserByOAuth(ctx, gen.GetUserByOAuthParams{
		AuthProvider: "google", OauthSubject: &otherSubject,
	}); err != pgx.ErrNoRows {
		t.Fatalf("want ErrNoRows for unrelated subject, got %v", err)
	}
}

func TestCheckInHistoryOrdering(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	uid := createUser(t, st, "history@test.local")
	courtA := createCourt(t, st, "History Court A", ruckerLat, ruckerLng, uid)
	courtB := createCourt(t, st, "History Court B", ruckerLat+0.05, ruckerLng, uid)

	dm := float32(1)
	if _, err := st.Queries.CreateCheckIn(ctx, gen.CreateCheckInParams{
		CourtID: courtA.ID, UserID: uid, Source: "manual", Lng: ruckerLng, Lat: ruckerLat, DistanceM: &dm, PartySize: 1, HasBall: false,
	}); err != nil {
		t.Fatalf("check in A: %v", err)
	}
	if err := st.Queries.CloseActiveCheckInsForUser(ctx, uid); err != nil {
		t.Fatalf("close A: %v", err)
	}
	if _, err := st.Queries.CreateCheckIn(ctx, gen.CreateCheckInParams{
		CourtID: courtB.ID, UserID: uid, Source: "geofence_prompt", Lng: ruckerLng, Lat: ruckerLat + 0.05, DistanceM: &dm, PartySize: 1, HasBall: false,
	}); err != nil {
		t.Fatalf("check in B: %v", err)
	}

	history, err := st.Queries.ListUserCheckInHistory(ctx, uid)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(history) != 2 {
		t.Fatalf("want 2 history rows, got %d", len(history))
	}
	if history[0].CourtID != courtB.ID {
		t.Errorf("most recent check-in should be first, got %+v", history[0])
	}
	if history[1].CheckedOutAt == nil {
		t.Error("court A check-in should be checked out")
	}
	if history[0].CheckedOutAt != nil {
		t.Error("court B check-in should still be active")
	}
}

func TestFlagsAndModeration(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	reporter := createUser(t, st, "reporter@test.local")
	admin := createUser(t, st, "admin@test.local")
	court := createCourt(t, st, "Flagged Court", ruckerLat, ruckerLng, reporter)

	isAdmin, err := st.Queries.GetUserAdmin(ctx, reporter)
	if err != nil {
		t.Fatalf("get user admin: %v", err)
	}
	if isAdmin {
		t.Fatal("fresh user should not be admin")
	}

	if err := st.Queries.CreateFlag(ctx, gen.CreateFlagParams{
		UserID: reporter, EntityType: "court", EntityID: court.ID, Reason: "Wrong location",
	}); err != nil {
		t.Fatalf("create flag: %v", err)
	}

	open, err := st.Queries.ListOpenFlags(ctx)
	if err != nil {
		t.Fatalf("list open flags: %v", err)
	}
	if len(open) != 1 || open[0].EntityID != court.ID || open[0].Reporter != "Test User" {
		t.Fatalf("unexpected open flags: %+v", open)
	}

	if err := st.Queries.ResolveFlag(ctx, gen.ResolveFlagParams{ID: open[0].ID, ResolvedBy: &admin}); err != nil {
		t.Fatalf("resolve flag: %v", err)
	}
	// Resolving twice is a no-op (WHERE resolved_at IS NULL), not an error.
	if err := st.Queries.ResolveFlag(ctx, gen.ResolveFlagParams{ID: open[0].ID, ResolvedBy: &admin}); err != nil {
		t.Fatalf("resolve flag again: %v", err)
	}

	open, err = st.Queries.ListOpenFlags(ctx)
	if err != nil {
		t.Fatalf("list open flags after resolve: %v", err)
	}
	if len(open) != 0 {
		t.Fatalf("resolved flag should not be open, got %d", len(open))
	}

	if err := st.Queries.SetCourtStatus(ctx, gen.SetCourtStatusParams{ID: court.ID, Status: "rejected"}); err != nil {
		t.Fatalf("set court status: %v", err)
	}
	got, err := st.Queries.GetCourt(ctx, court.ID)
	if err != nil {
		t.Fatalf("get court: %v", err)
	}
	if got.Status != "rejected" {
		t.Errorf("court status = %q, want rejected", got.Status)
	}

	photo, err := st.Queries.CreateCourtPhoto(ctx, gen.CreateCourtPhotoParams{
		CourtID: court.ID, UserID: reporter, StorageKey: "courts/x/y.jpg",
	})
	if err != nil {
		t.Fatalf("create photo: %v", err)
	}
	if err := st.Queries.SetPhotoStatus(ctx, gen.SetPhotoStatusParams{ID: photo.ID, Status: "removed"}); err != nil {
		t.Fatalf("set photo status: %v", err)
	}
	visible, err := st.Queries.ListCourtPhotos(ctx, court.ID)
	if err != nil {
		t.Fatalf("list photos: %v", err)
	}
	if len(visible) != 0 {
		t.Fatalf("removed photo should not be listed as visible, got %d", len(visible))
	}
}

func TestAdminSearchPromoteDemote(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()

	hash := "x"
	alice, err := st.Queries.CreateUser(ctx, gen.CreateUserParams{
		Email: "alice@test.local", PasswordHash: &hash, DisplayName: "Alice Admin",
	})
	if err != nil {
		t.Fatalf("create alice: %v", err)
	}
	bob, err := st.Queries.CreateUser(ctx, gen.CreateUserParams{
		Email: "bob@test.local", PasswordHash: &hash, DisplayName: "Bob Baller",
	})
	if err != nil {
		t.Fatalf("create bob: %v", err)
	}

	count, err := st.Queries.CountAdmins(ctx)
	if err != nil {
		t.Fatalf("count admins (none yet): %v", err)
	}
	if count != 0 {
		t.Fatalf("want 0 admins, got %d", count)
	}

	byEmail, err := st.Queries.SearchUsers(ctx, "alice@")
	if err != nil {
		t.Fatalf("search by email: %v", err)
	}
	if len(byEmail) != 1 || byEmail[0].ID != alice.ID {
		t.Fatalf("search by email = %+v, want just alice", byEmail)
	}
	byName, err := st.Queries.SearchUsers(ctx, "Baller")
	if err != nil {
		t.Fatalf("search by name: %v", err)
	}
	if len(byName) != 1 || byName[0].ID != bob.ID {
		t.Fatalf("search by name = %+v, want just bob", byName)
	}

	promoted, err := st.Queries.SetUserAdmin(ctx, gen.SetUserAdminParams{ID: alice.ID, IsAdmin: true})
	if err != nil {
		t.Fatalf("promote alice: %v", err)
	}
	if !promoted.IsAdmin {
		t.Fatal("alice should be admin after promotion")
	}
	if err := st.Queries.CreateAdminAction(ctx, gen.CreateAdminActionParams{
		ActorID: alice.ID, Action: "promote", TargetUserID: alice.ID,
	}); err != nil {
		t.Fatalf("record promote action: %v", err)
	}

	count, err = st.Queries.CountAdmins(ctx)
	if err != nil {
		t.Fatalf("count admins (one): %v", err)
	}
	if count != 1 {
		t.Fatalf("want 1 admin, got %d", count)
	}

	demoted, err := st.Queries.SetUserAdmin(ctx, gen.SetUserAdminParams{ID: alice.ID, IsAdmin: false})
	if err != nil {
		t.Fatalf("demote alice: %v", err)
	}
	if demoted.IsAdmin {
		t.Fatal("alice should not be admin after demotion")
	}
	if err := st.Queries.CreateAdminAction(ctx, gen.CreateAdminActionParams{
		ActorID: bob.ID, Action: "demote", TargetUserID: alice.ID,
	}); err != nil {
		t.Fatalf("record demote action: %v", err)
	}

	actions, err := st.Queries.ListAdminActions(ctx)
	if err != nil {
		t.Fatalf("list admin actions: %v", err)
	}
	if len(actions) != 2 {
		t.Fatalf("want 2 recorded actions, got %d", len(actions))
	}
	if actions[0].Action != "demote" || actions[0].ActorName != "Bob Baller" || actions[0].TargetName != "Alice Admin" {
		t.Errorf("most recent action = %+v, want bob's demote of alice", actions[0])
	}

	// SetUserAdmin on a nonexistent user must surface as ErrNoRows so the
	// handler can 404 instead of silently succeeding.
	if _, err := st.Queries.SetUserAdmin(ctx, gen.SetUserAdminParams{ID: uuid.New(), IsAdmin: true}); err != pgx.ErrNoRows {
		t.Fatalf("want ErrNoRows for missing user, got %v", err)
	}
}
