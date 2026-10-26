package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

const (
	uploadURLTTL = 10 * time.Minute
	// maxPhotosPerDay bounds upload storage and the pre-publication review queue.
	maxPhotosPerDay = 10
)

func (s *Server) handleCreatePhoto(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	if _, err := s.store.Queries.GetCourt(r.Context(), courtID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "court not found")
			return
		}
		s.internalError(w, "get court", err)
		return
	}
	recent, err := s.store.Queries.CountRecentPhotosByUser(r.Context(), userID(r))
	if err != nil {
		s.internalError(w, "count recent photos", err)
		return
	}
	if recent >= maxPhotosPerDay {
		writeError(w, http.StatusTooManyRequests, "photo limit reached for today — try again tomorrow")
		return
	}
	key := fmt.Sprintf("courts/%s/%s.jpg", courtID, uuid.NewString())
	photo, err := s.store.Queries.CreateCourtPhoto(r.Context(), gen.CreateCourtPhotoParams{
		CourtID: courtID, UserID: userID(r), StorageKey: key,
	})
	if err != nil {
		s.internalError(w, "create photo", err)
		return
	}
	exp := time.Now().Add(uploadURLTTL).Unix()
	writeJSON(w, http.StatusCreated, map[string]any{
		"photo":                photo,
		"upload_path":          "/photos/upload/" + key,
		"upload_authorization": uploadAuthorization(s.cfg.UploadSigningSecret, key, exp),
	})
}

func (s *Server) handleListPhotos(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	photos, err := s.store.Queries.ListCourtPhotos(r.Context(), courtID)
	if err != nil {
		s.internalError(w, "list photos", err)
		return
	}
	if photos == nil {
		photos = []gen.ListCourtPhotosRow{}
	}
	external, err := s.store.Queries.ListExternalPhotos(r.Context(), courtID)
	if err != nil {
		s.internalError(w, "list external photos", err)
		return
	}
	if external == nil {
		external = []gen.ListExternalPhotosRow{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"photos": photos, "external": external})
}

func (s *Server) handleAddFavorite(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	if err := s.store.Queries.AddFavorite(r.Context(), gen.AddFavoriteParams{
		UserID: userID(r), CourtID: courtID,
	}); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			writeError(w, http.StatusNotFound, "court not found")
			return
		}
		s.internalError(w, "add favorite", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"favorite": true})
}

func (s *Server) handleRemoveFavorite(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	if err := s.store.Queries.RemoveFavorite(r.Context(), gen.RemoveFavoriteParams{
		UserID: userID(r), CourtID: courtID,
	}); err != nil {
		s.internalError(w, "remove favorite", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"favorite": false})
}

func (s *Server) handleIsFavorite(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	fav, err := s.store.Queries.IsFavorite(r.Context(), gen.IsFavoriteParams{
		UserID: userID(r), CourtID: courtID,
	})
	if err != nil {
		s.internalError(w, "is favorite", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"favorite": fav})
}

func (s *Server) handleListFavorites(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.Queries.ListFavoriteCourts(r.Context(), userID(r))
	if err != nil {
		s.internalError(w, "list favorites", err)
		return
	}
	if rows == nil {
		rows = []gen.ListFavoriteCourtsRow{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"courts": rows})
}

type pushTokenRequest struct {
	Token string `json:"token"`
	// Token registration is the one moment every notification-capable user
	// passes through, so it doubles as the timezone capture point.
	Timezone string `json:"timezone,omitempty"`
}

func (s *Server) handleRegisterPushToken(w http.ResponseWriter, r *http.Request) {
	var req pushTokenRequest
	if !readJSON(w, r, &req) {
		return
	}
	req.Token = strings.TrimSpace(req.Token)
	if req.Token == "" || len(req.Token) > 200 {
		writeError(w, http.StatusBadRequest, "token is required")
		return
	}
	if err := s.store.Queries.UpsertPushToken(r.Context(), gen.UpsertPushTokenParams{
		Token: req.Token, UserID: userID(r),
	}); err != nil {
		s.internalError(w, "register push token", err)
		return
	}
	if tz := strings.TrimSpace(req.Timezone); validTimezone(tz) {
		if err := s.store.Queries.SetUserTimezone(r.Context(), gen.SetUserTimezoneParams{
			ID: userID(r), Timezone: &tz,
		}); err != nil {
			s.log.Error("set user timezone", "err", err)
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUnregisterPushToken(w http.ResponseWriter, r *http.Request) {
	var req pushTokenRequest
	if !readJSON(w, r, &req) {
		return
	}
	req.Token = strings.TrimSpace(req.Token)
	if req.Token == "" || len(req.Token) > 200 {
		writeError(w, http.StatusBadRequest, "token is required")
		return
	}
	if _, err := s.store.Queries.DeletePushToken(r.Context(), gen.DeletePushTokenParams{
		Token: req.Token, UserID: userID(r),
	}); err != nil {
		s.internalError(w, "unregister push token", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// notifyRunStarted alerts favoriters when a check-in lands at an empty court.
// The caller decides "empty" under the court lock; this only applies the
// cooldown, so a check-in/check-out loop can't push on every cycle.
func (s *Server) notifyRunStarted(courtID, actor, checkInID uuid.UUID) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	recent, err := s.store.Queries.CourtHadRecentCheckIn(ctx, gen.CourtHadRecentCheckInParams{
		CourtID: courtID, ExcludeID: checkInID,
	})
	if err != nil || recent {
		return
	}
	tokens, err := s.store.Queries.ListFavoriterPushTokens(ctx, gen.ListFavoriterPushTokensParams{
		CourtID: courtID, UserID: actor,
	})
	if err != nil || len(tokens) == 0 {
		return
	}
	court, err := s.store.Queries.GetCourt(ctx, courtID)
	if err != nil {
		return
	}
	if err := s.sendPush(ctx, tokens,
		fmt.Sprintf("Run starting at %s", court.Name),
		"Someone just checked in at a court you follow.",
		map[string]string{"courtId": courtID.String()},
	); err != nil {
		s.log.Error("push notify", "court", courtID, "err", err)
	}
}

type oauthRequest struct {
	Provider          string `json:"provider"`
	IDToken           string `json:"id_token"`
	DisplayName       string `json:"display_name,omitempty"`
	AuthorizationCode string `json:"authorization_code,omitempty"`
	TermsVersion      string `json:"terms_version,omitempty"`
}

func (s *Server) handleOAuth(w http.ResponseWriter, r *http.Request) {
	var req oauthRequest
	if !readJSON(w, r, &req) {
		return
	}
	if !s.oauth.Enabled(req.Provider) {
		writeError(w, http.StatusBadRequest, "provider not supported or not configured")
		return
	}
	identity, err := s.oauth.Verify(r.Context(), req.Provider, req.IDToken)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid identity token")
		return
	}
	var appleToken []byte
	if req.Provider == "apple" {
		if !s.apple.Enabled() {
			writeError(w, http.StatusServiceUnavailable, "Apple sign-in is temporarily unavailable")
			return
		}
		var freshToken string
		appleToken, freshToken, err = s.apple.Exchange(r.Context(), req.AuthorizationCode)
		if err != nil {
			writeError(w, http.StatusBadGateway, "Could not complete Apple sign-in. Please try again.")
			return
		}
		fresh, verifyErr := s.oauth.Verify(r.Context(), "apple", freshToken)
		if verifyErr != nil || fresh.Subject != identity.Subject {
			writeError(w, http.StatusUnauthorized, "Apple authorization did not match this account")
			return
		}
	}

	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		s.internalError(w, "begin OAuth sign-in", err)
		return
	}
	defer tx.Rollback(r.Context())
	queries := s.store.Queries.WithTx(tx)
	user, err := queries.GetUserByOAuth(r.Context(), gen.GetUserByOAuthParams{
		AuthProvider: identity.Provider, OauthSubject: &identity.Subject,
	})
	if err == nil {
		if !s.saveOAuthAuthorization(w, r, tx, user.ID, appleToken, req.TermsVersion) {
			return
		}
		if err := tx.Commit(r.Context()); err != nil {
			s.internalError(w, "commit OAuth sign-in", err)
			return
		}
		s.issueTokens(w, r, user.ID, user)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		s.internalError(w, "oauth lookup", err)
		return
	}

	// First sign-in: create the account. Apple only shares the name on the
	// first authorization, so the client passes it through when it has it.
	displayName := strings.TrimSpace(req.DisplayName)
	if displayName == "" {
		displayName = identity.Name
	}
	if displayName == "" {
		displayName = "Player"
	}
	if len(displayName) > 50 {
		displayName = displayName[:50]
	}
	if s.cfg.ModerationRequired && req.TermsVersion != contentConsentVersion {
		writeError(w, http.StatusBadRequest, "accept the current terms before creating an account")
		return
	}
	if !s.screenText(w, r, "display_name", displayName) {
		return
	}
	email := identity.Email
	if email == "" {
		// Apple can withhold email, and an unverified one is dropped by
		// Verify; synthesize a stable placeholder.
		email = fmt.Sprintf("%s-%s@users.pullup.local", identity.Provider, identity.Subject)
	}
	created, err := queries.CreateOAuthUser(r.Context(), gen.CreateOAuthUserParams{
		Email:        email,
		DisplayName:  displayName,
		AuthProvider: identity.Provider,
		OauthSubject: &identity.Subject,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeError(w, http.StatusConflict, "an account with that email already exists — sign in with your password")
			return
		}
		s.internalError(w, "create oauth user", err)
		return
	}
	if !s.saveOAuthAuthorization(w, r, tx, created.ID, appleToken, req.TermsVersion) {
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.internalError(w, "commit OAuth registration", err)
		return
	}
	s.issueTokens(w, r, created.ID, created)
}

func (s *Server) saveOAuthAuthorization(w http.ResponseWriter, r *http.Request, tx pgx.Tx, uid uuid.UUID, token []byte, version string) bool {
	if len(token) == 0 && version != contentConsentVersion {
		return true
	}
	if _, err := tx.Exec(r.Context(), `UPDATE users SET apple_refresh_token=coalesce($2,apple_refresh_token), content_consent_version=CASE WHEN $3=$4 THEN $3 ELSE content_consent_version END WHERE id=$1`, uid, token, version, contentConsentVersion); err != nil {
		s.internalError(w, "save Apple authorization", err)
		return false
	}
	return true
}

func (s *Server) handleCheckInHistory(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.Queries.ListUserCheckInHistory(r.Context(), userID(r))
	if err != nil {
		s.internalError(w, "check-in history", err)
		return
	}
	if rows == nil {
		rows = []gen.ListUserCheckInHistoryRow{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"check_ins": rows})
}

func (s *Server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		isAdmin, err := s.store.Queries.GetUserAdmin(r.Context(), userID(r))
		if err != nil || !isAdmin {
			writeError(w, http.StatusForbidden, "admin only")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleListFlags(w http.ResponseWriter, r *http.Request) {
	flags, err := s.store.Queries.ListOpenFlags(r.Context())
	if err != nil {
		s.internalError(w, "list flags", err)
		return
	}
	if flags == nil {
		flags = []gen.ListOpenFlagsRow{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"flags": flags})
}

func (s *Server) handleResolveFlag(w http.ResponseWriter, r *http.Request) {
	flagID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid flag id")
		return
	}
	if err := s.store.Queries.ResolveFlag(r.Context(), gen.ResolveFlagParams{
		ID: flagID, ResolvedBy: ptr(userID(r)),
	}); err != nil {
		s.internalError(w, "resolve flag", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type setStatusRequest struct {
	Status string `json:"status"`
}

func (s *Server) handleAdminSetCourtStatus(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	var req setStatusRequest
	if !readJSON(w, r, &req) {
		return
	}
	switch req.Status {
	case "pending", "verified", "rejected":
	default:
		writeError(w, http.StatusBadRequest, "status must be pending, verified, or rejected")
		return
	}
	if err := s.store.Queries.SetCourtStatus(r.Context(), gen.SetCourtStatusParams{
		ID: courtID, Status: req.Status,
	}); err != nil {
		s.internalError(w, "set court status", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAdminSetPhotoStatus(w http.ResponseWriter, r *http.Request) {
	photoID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid photo id")
		return
	}
	var req setStatusRequest
	if !readJSON(w, r, &req) {
		return
	}
	switch req.Status {
	case "visible", "flagged", "removed":
	default:
		writeError(w, http.StatusBadRequest, "status must be visible, flagged, or removed")
		return
	}
	n, err := s.store.Queries.SetPhotoStatus(r.Context(), gen.SetPhotoStatusParams{
		ID: photoID, Status: req.Status,
	})
	if err != nil {
		s.internalError(w, "set photo status", err)
		return
	}
	if n == 0 {
		writeError(w, http.StatusNotFound, "photo not found or already removed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleAdminSetExternalPhotoStatus hides or restores an auto-fetched
// external photo. The row is KEPT when hidden, so re-enrichment's ON CONFLICT
// DO NOTHING can't resurrect a photo an admin already hid. Hiding also
// enqueues the cached R2 object for deletion; a later restore self-heals
// because the cache refills on the next read.
func (s *Server) handleAdminSetExternalPhotoStatus(w http.ResponseWriter, r *http.Request) {
	photoID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid photo id")
		return
	}
	var req setStatusRequest
	if !readJSON(w, r, &req) {
		return
	}
	switch req.Status {
	case "visible", "hidden":
	default:
		writeError(w, http.StatusBadRequest, "status must be visible or hidden")
		return
	}
	row, err := s.store.Queries.SetExternalPhotoStatus(r.Context(), gen.SetExternalPhotoStatusParams{
		ID: photoID, Status: req.Status,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "external photo not found")
			return
		}
		s.internalError(w, "set external photo status", err)
		return
	}
	if req.Status == "hidden" {
		key := fmt.Sprintf("ext/%s/%s", row.Source, row.SourceID)
		if err := s.store.Queries.ScheduleObjectDeletion(r.Context(), key); err != nil {
			// Non-fatal: the photo is already hidden and won't be served. The
			// worst case is a leaked thumbnail, not a moderation failure.
			s.log.Error("schedule external photo deletion", "key", key, "err", err)
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func ptr[T any](v T) *T { return &v }
