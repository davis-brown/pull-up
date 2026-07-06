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

	"github.com/davisbrown/pull-up/server/internal/push"
	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

// --- photos -----------------------------------------------------------------

const uploadURLTTL = 10 * time.Minute

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
		"photo": photo,
		"upload_path": fmt.Sprintf("/photos/upload/%s?exp=%d&sig=%s",
			key, exp, signUpload(s.cfg.JWTSecret, key, exp)),
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

// --- favorites ----------------------------------------------------------------

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

// --- push tokens -----------------------------------------------------------

type pushTokenRequest struct {
	Token string `json:"token"`
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
	w.WriteHeader(http.StatusNoContent)
}

// notifyRunStarted alerts favoriters when a court's first active check-in
// lands (0 → 1 transition). Fire-and-forget from the check-in handler.
func (s *Server) notifyRunStarted(courtID, actor uuid.UUID) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	count, err := s.store.Queries.CountActiveCheckIns(ctx, courtID)
	if err != nil || count != 1 {
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
	if err := push.Send(ctx, tokens,
		fmt.Sprintf("Run starting at %s", court.Name),
		"Someone just checked in at a court you follow.",
		map[string]string{"courtId": courtID.String()},
	); err != nil {
		s.log.Error("push notify", "court", courtID, "err", err)
	}
}

// --- oauth ---------------------------------------------------------------

type oauthRequest struct {
	Provider    string `json:"provider"`
	IDToken     string `json:"id_token"`
	DisplayName string `json:"display_name,omitempty"`
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

	user, err := s.store.Queries.GetUserByOAuth(r.Context(), gen.GetUserByOAuthParams{
		AuthProvider: identity.Provider, OauthSubject: &identity.Subject,
	})
	if err == nil {
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
	email := identity.Email
	if email == "" {
		// Apple can withhold email on subsequent logins; synthesize a stable one.
		email = fmt.Sprintf("%s-%s@users.pullup.local", identity.Provider, identity.Subject)
	}
	created, err := s.store.Queries.CreateOAuthUser(r.Context(), gen.CreateOAuthUserParams{
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
	s.issueTokens(w, r, created.ID, created)
}

// --- check-in history -------------------------------------------------------

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

// --- moderation -----------------------------------------------------------

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
	if err := s.store.Queries.SetPhotoStatus(r.Context(), gen.SetPhotoStatusParams{
		ID: photoID, Status: req.Status,
	}); err != nil {
		s.internalError(w, "set photo status", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func ptr[T any](v T) *T { return &v }
