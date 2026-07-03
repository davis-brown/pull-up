package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

// checkInRadiusM is the geo-verification tolerance. Generous on purpose:
// GPS drift and indoor gyms make tight radii reject real players. This is
// friction against spam, not security.
const checkInRadiusM = 150.0

var validCheckInSources = map[string]bool{"manual": true, "geofence_prompt": true, "geofence_auto": true}

type checkInRequest struct {
	Lat    float64 `json:"lat"`
	Lng    float64 `json:"lng"`
	Source string  `json:"source,omitempty"`
}

func (s *Server) handleCheckIn(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	var req checkInRequest
	if !readJSON(w, r, &req) {
		return
	}
	if !validLatLng(req.Lat, req.Lng) {
		writeError(w, http.StatusBadRequest, "lat/lng out of range")
		return
	}
	if req.Source == "" {
		req.Source = "manual"
	}
	if !validCheckInSources[req.Source] {
		writeError(w, http.StatusBadRequest, "source must be manual, geofence_prompt, or geofence_auto")
		return
	}

	distance, err := s.store.Queries.CourtCheckInDistance(r.Context(), gen.CourtCheckInDistanceParams{
		Lng: req.Lng, Lat: req.Lat, CourtID: courtID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "court not found")
			return
		}
		s.internalError(w, "check-in distance", err)
		return
	}
	if distance > checkInRadiusM {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error":      "you need to be at the court to check in",
			"distance_m": distance,
			"max_m":      checkInRadiusM,
		})
		return
	}

	uid := userID(r)
	// One active check-in per user: close any existing one first.
	if err := s.store.Queries.CloseActiveCheckInsForUser(r.Context(), uid); err != nil {
		s.internalError(w, "close prior check-ins", err)
		return
	}
	d := float32(distance)
	checkIn, err := s.store.Queries.CreateCheckIn(r.Context(), gen.CreateCheckInParams{
		CourtID: courtID, UserID: uid, Source: req.Source,
		Lng: req.Lng, Lat: req.Lat, DistanceM: &d,
	})
	if err != nil {
		s.internalError(w, "create check-in", err)
		return
	}
	// A person verified at the court is the strongest signal it's real.
	if err := s.store.Queries.PromoteCourtIfPending(r.Context(), courtID); err != nil {
		s.log.Error("promote court after check-in", "err", err)
	}
	writeJSON(w, http.StatusCreated, checkIn)
}

func (s *Server) handleCheckOut(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Queries.CloseActiveCheckInsForUser(r.Context(), userID(r)); err != nil {
		s.internalError(w, "check out", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleCurrentCheckIn(w http.ResponseWriter, r *http.Request) {
	checkIn, err := s.store.Queries.GetActiveCheckInForUser(r.Context(), userID(r))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusOK, map[string]any{"check_in": nil})
			return
		}
		s.internalError(w, "current check-in", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"check_in": checkIn})
}

type reportRequest struct {
	PlayerCount *int16  `json:"player_count"`
	RunQuality  *string `json:"run_quality"`
	Note        *string `json:"note"`
}

var validRunQualities = map[string]bool{"empty": true, "casual": true, "good_run": true, "packed": true}

func (s *Server) handleCreateReport(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	var req reportRequest
	if !readJSON(w, r, &req) {
		return
	}
	if req.PlayerCount == nil && req.RunQuality == nil && req.Note == nil {
		writeError(w, http.StatusBadRequest, "report at least one of player_count, run_quality, note")
		return
	}
	if req.PlayerCount != nil && (*req.PlayerCount < 0 || *req.PlayerCount > 200) {
		writeError(w, http.StatusBadRequest, "player_count must be between 0 and 200")
		return
	}
	if req.RunQuality != nil && !validRunQualities[*req.RunQuality] {
		writeError(w, http.StatusBadRequest, "run_quality must be empty, casual, good_run, or packed")
		return
	}
	if req.Note != nil {
		trimmed := strings.TrimSpace(*req.Note)
		if len(trimmed) > 280 {
			writeError(w, http.StatusBadRequest, "note must be at most 280 characters")
			return
		}
		req.Note = &trimmed
	}
	report, err := s.store.Queries.CreateCrowdReport(r.Context(), gen.CreateCrowdReportParams{
		CourtID: courtID, UserID: userID(r),
		PlayerCount: req.PlayerCount, RunQuality: req.RunQuality, Note: req.Note,
	})
	if err != nil {
		s.internalError(w, "create report", err)
		return
	}
	writeJSON(w, http.StatusCreated, report)
}

func (s *Server) handleCourtActivity(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	checkIns, err := s.store.Queries.ListActiveCheckIns(r.Context(), courtID)
	if err != nil {
		s.internalError(w, "list check-ins", err)
		return
	}
	reports, err := s.store.Queries.ListRecentReports(r.Context(), courtID)
	if err != nil {
		s.internalError(w, "list reports", err)
		return
	}
	// Empty results must serialize as [], not null — clients iterate these.
	if checkIns == nil {
		checkIns = []gen.ListActiveCheckInsRow{}
	}
	if reports == nil {
		reports = []gen.ListRecentReportsRow{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"active_count": len(checkIns),
		"check_ins":    checkIns,
		"reports":      reports,
	})
}
