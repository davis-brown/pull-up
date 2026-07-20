package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/davisbrown/pull-up/server/internal/push"
	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

const (
	// maxSessionLead is how far ahead a run can be planned.
	maxSessionLead = 14 * 24 * time.Hour
	// chatCooldown is the minimum gap between messages from one user.
	chatCooldown = 5 * time.Second
)

// optionalUserID resolves the viewer on public endpoints that personalize
// when a valid token happens to be present (e.g. my_rsvp on session lists).
// Invalid or missing tokens yield the zero UUID, never an error.
func (s *Server) optionalUserID(r *http.Request) uuid.UUID {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || token == "" {
		return uuid.Nil
	}
	uid, err := s.issuer.VerifyAccessToken(token)
	if err != nil {
		return uuid.Nil
	}
	return uid
}

// awardReputation is best-effort: reputation is a soft signal, never worth
// failing the request that earned it.
func (s *Server) awardReputation(ctx context.Context, userID uuid.UUID, points int32) {
	if err := s.store.Queries.AddReputation(ctx, gen.AddReputationParams{ID: userID, Reputation: points}); err != nil {
		s.log.Error("award reputation", "user", userID, "err", err)
	}
}

type createSessionRequest struct {
	StartsAt time.Time `json:"starts_at"`
	Note     *string   `json:"note"`
}

func (s *Server) handleCreateSession(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	var req createSessionRequest
	if !readJSON(w, r, &req) {
		return
	}
	now := time.Now()
	if req.StartsAt.Before(now.Add(-10 * time.Minute)) {
		writeError(w, http.StatusBadRequest, "starts_at must be in the future")
		return
	}
	if req.StartsAt.After(now.Add(maxSessionLead)) {
		writeError(w, http.StatusBadRequest, "starts_at must be within the next 14 days")
		return
	}
	if req.Note != nil {
		trimmed := strings.TrimSpace(*req.Note)
		if len(trimmed) > 280 {
			writeError(w, http.StatusBadRequest, "note must be at most 280 characters")
			return
		}
		if trimmed == "" {
			req.Note = nil
		} else {
			req.Note = &trimmed
		}
	}
	court, err := s.store.Queries.GetCourt(r.Context(), courtID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "court not found")
			return
		}
		s.internalError(w, "get court", err)
		return
	}
	if court.Status == "rejected" {
		writeError(w, http.StatusUnprocessableEntity, "cannot plan a run at a rejected court")
		return
	}
	uid := userID(r)
	session, err := s.store.Queries.CreateSession(r.Context(), gen.CreateSessionParams{
		CourtID: courtID, CreatedBy: uid, StartsAt: req.StartsAt, Note: req.Note,
	})
	if err != nil {
		s.internalError(w, "create session", err)
		return
	}
	// Creator is implicitly going.
	if err := s.store.Queries.UpsertRSVP(r.Context(), gen.UpsertRSVPParams{
		SessionID: session.ID, UserID: uid, Status: "going",
	}); err != nil {
		s.log.Error("rsvp creator", "session", session.ID, "err", err)
	}
	s.runBackground("notify session planned", func() {
		s.notifySessionPlanned(courtID, court.Name, uid, session.StartsAt)
	})
	// This run may be exactly what a "looking for a run" bucket was
	// waiting on (phase 19) — notify its seekers if so.
	if date, windowKey, ok := bucketForSessionTime(session.StartsAt); ok {
		s.runBackground("notify run intent converted", func() {
			s.notifyRunIntentConverted(courtID, court.Name, date, windowKey, uid, session.ID)
		})
	}
	writeJSON(w, http.StatusCreated, session)
}

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	viewer := s.optionalUserID(r)
	if viewer != uuid.Nil {
		// Response is personalized (my_rsvp per viewer); never let a shared
		// cache serve one signed-in user's RSVP state to another.
		w.Header().Set("Cache-Control", "no-store")
	}
	rows, err := s.store.Queries.ListUpcomingSessions(r.Context(), gen.ListUpcomingSessionsParams{
		CourtID: courtID, ViewerID: viewer,
	})
	if err != nil {
		s.internalError(w, "list sessions", err)
		return
	}
	if rows == nil {
		rows = []gen.ListUpcomingSessionsRow{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": rows})
}

// handleNearbyRuns serves the Activity tab's "runs near you" rail: upcoming
// sessions at any non-rejected court in the radius, for everyone — a player
// with zero follows still discovers organized runs (phase 17).
func (s *Server) handleNearbyRuns(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	lat, errLat := strconv.ParseFloat(q.Get("lat"), 64)
	lng, errLng := strconv.ParseFloat(q.Get("lng"), 64)
	if errLat != nil || errLng != nil || !validLatLng(lat, lng) {
		writeError(w, http.StatusBadRequest, "lat and lng are required")
		return
	}
	radius := 5000.0
	if v := q.Get("radius_m"); v != "" {
		parsed, err := strconv.ParseFloat(v, 64)
		if err != nil || parsed < 1 || parsed > 50000 {
			writeError(w, http.StatusBadRequest, "radius_m must be between 1 and 50000")
			return
		}
		radius = parsed
	}
	viewer := s.optionalUserID(r)
	if viewer != uuid.Nil {
		// Blocked-organizer filtering personalizes the list.
		w.Header().Set("Cache-Control", "no-store")
	}
	rows, err := s.store.Queries.ListNearbyUpcomingSessions(r.Context(), gen.ListNearbyUpcomingSessionsParams{
		Lat: lat, Lng: lng, RadiusM: radius, ViewerID: viewer,
	})
	if err != nil {
		s.internalError(w, "nearby runs", err)
		return
	}
	if rows == nil {
		rows = []gen.ListNearbyUpcomingSessionsRow{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"runs": rows})
}

func (s *Server) handleCancelSession(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	n, err := s.store.Queries.CancelSession(r.Context(), gen.CancelSessionParams{ID: id, CreatedBy: userID(r)})
	if err != nil {
		s.internalError(w, "cancel session", err)
		return
	}
	if n == 0 {
		writeError(w, http.StatusNotFound, "session not found, already canceled, or not yours")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type rsvpRequest struct {
	Status string `json:"status"`
}

func (s *Server) handleRSVP(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	var req rsvpRequest
	if !readJSON(w, r, &req) {
		return
	}
	if req.Status != "going" && req.Status != "out" {
		writeError(w, http.StatusBadRequest, "status must be going or out")
		return
	}
	session, err := s.store.Queries.GetSession(r.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "session not found")
			return
		}
		s.internalError(w, "get session", err)
		return
	}
	if session.CanceledAt != nil {
		writeError(w, http.StatusUnprocessableEntity, "this run was canceled")
		return
	}
	if time.Now().After(session.StartsAt.Add(2 * time.Hour)) {
		writeError(w, http.StatusUnprocessableEntity, "this run has already ended")
		return
	}
	if err := s.store.Queries.UpsertRSVP(r.Context(), gen.UpsertRSVPParams{
		SessionID: id, UserID: userID(r), Status: req.Status,
	}); err != nil {
		s.internalError(w, "rsvp", err)
		return
	}
	goingCount, err := s.store.Queries.CountSessionAttendees(r.Context(), id)
	if err != nil {
		s.internalError(w, "count attendees", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": req.Status, "going_count": goingCount})
}

func (s *Server) handleSessionAttendees(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	goingCount, err := s.store.Queries.CountSessionAttendees(r.Context(), id)
	if err != nil {
		s.internalError(w, "count attendees", err)
		return
	}
	attendees, err := s.store.Queries.ListSessionAttendees(r.Context(), gen.ListSessionAttendeesParams{
		SessionID: id, ViewerID: s.optionalUserID(r),
	})
	if err != nil {
		s.internalError(w, "list attendees", err)
		return
	}
	if attendees == nil {
		attendees = []gen.ListSessionAttendeesRow{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"going_count": goingCount, "attendees": attendees})
}

// notifySessionPlanned pings favoriters of the court and followers of the
// planner (except the planner), deduplicated.
func (s *Server) notifySessionPlanned(courtID uuid.UUID, courtName string, actor uuid.UUID, startsAt time.Time) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tokens, err := s.store.Queries.ListSessionNotifyTokens(ctx, gen.ListSessionNotifyTokensParams{
		Actor: actor, CourtID: courtID,
	})
	if err != nil || len(tokens) == 0 {
		return
	}
	if err := push.Send(ctx, tokens,
		fmt.Sprintf("Run planned at %s", courtName),
		"Someone scheduled a run at a court you follow. Tap to RSVP.",
		map[string]string{"courtId": courtID.String(), "startsAt": startsAt.Format(time.RFC3339)},
	); err != nil {
		s.log.Error("push notify session", "court", courtID, "err", err)
	}
}

type messageRequest struct {
	Body string `json:"body"`
}

func (s *Server) handleCreateMessage(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	var req messageRequest
	if !readJSON(w, r, &req) {
		return
	}
	body := strings.TrimSpace(req.Body)
	if body == "" || len(body) > 500 {
		writeError(w, http.StatusBadRequest, "message must be 1-500 characters")
		return
	}
	uid := userID(r)
	lastAt, err := s.store.Queries.LastMessageAt(r.Context(), uid)
	if err != nil {
		s.internalError(w, "chat rate limit", err)
		return
	}
	if time.Since(lastAt) < chatCooldown {
		writeError(w, http.StatusTooManyRequests, "slow down — one message every few seconds")
		return
	}
	msg, err := s.store.Queries.CreateCourtMessage(r.Context(), gen.CreateCourtMessageParams{
		CourtID: courtID, UserID: uid, Body: body,
	})
	if err != nil {
		s.internalError(w, "create message", err)
		return
	}
	writeJSON(w, http.StatusCreated, msg)
}

func (s *Server) handleListMessages(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	rows, err := s.store.Queries.ListCourtMessages(r.Context(), gen.ListCourtMessagesParams{
		CourtID: courtID, ViewerID: s.optionalUserID(r),
	})
	if err != nil {
		s.internalError(w, "list messages", err)
		return
	}
	if rows == nil {
		rows = []gen.ListCourtMessagesRow{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": rows})
}

type messageStatusRequest struct {
	Status string `json:"status"`
}

func (s *Server) handleAdminSetMessageStatus(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid message id")
		return
	}
	var req messageStatusRequest
	if !readJSON(w, r, &req) {
		return
	}
	if req.Status != "hidden" && req.Status != "visible" {
		writeError(w, http.StatusBadRequest, "status must be hidden or visible")
		return
	}
	n, err := s.store.Queries.SetMessageHidden(r.Context(), gen.SetMessageHiddenParams{
		ID: id, Hidden: req.Status == "hidden",
	})
	if err != nil {
		s.internalError(w, "set message status", err)
		return
	}
	if n == 0 {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": req.Status})
}
