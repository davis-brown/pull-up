package api

import (
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

const (
	// dupeRadiusM is how close a new submission must be to an existing court
	// to be treated as a likely duplicate.
	dupeRadiusM = 75.0
	// verifyUpvotes promotes a pending court to verified (reputation-weighted:
	// a vote counts 1-3x depending on the voter's reputation tier).
	verifyUpvotes = 2
	// rejectNetVotes hides a court (also weighted).
	rejectNetVotes = -3
	maxSearchRadiusM = 50_000.0

	// Reputation awards.
	repCheckIn       = 1 // geo-verified check-in (max once per court per 20h)
	repCourtVerified = 5 // your submitted court got verified by someone else
)

var validSurfaces = map[string]bool{"asphalt": true, "concrete": true, "hardwood": true, "rubber": true, "other": true}

// courtSummary is the map-pin payload shared by bbox and near-me responses.
type courtSummary struct {
	ID           uuid.UUID     `json:"id"`
	Name         string        `json:"name"`
	Lat          float64       `json:"lat"`
	Lng          float64       `json:"lng"`
	Address      *string       `json:"address"`
	HoopCount    *int16        `json:"hoop_count"`
	Indoor       bool          `json:"indoor"`
	Surface      *string       `json:"surface"`
	Lighting     *bool         `json:"lighting"`
	IsPublic     bool          `json:"is_public"`
	Source       string        `json:"source"`
	Status       string        `json:"status"`
	ActiveCount  int32         `json:"active_count"`
	DistanceM    *float64      `json:"distance_m,omitempty"`
	LatestReport *latestReport `json:"latest_report"`
}

type latestReport struct {
	PlayerCount *int16    `json:"player_count"`
	RunQuality  *string   `json:"run_quality"`
	CreatedAt   time.Time `json:"created_at"`
}

func newLatestReport(playerCount *int16, runQuality *string, createdAt time.Time) *latestReport {
	if playerCount == nil && runQuality == nil {
		return nil
	}
	return &latestReport{PlayerCount: playerCount, RunQuality: runQuality, CreatedAt: createdAt}
}

func (s *Server) handleListCourts(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if bbox := q.Get("bbox"); bbox != "" {
		s.listCourtsInBBox(w, r, bbox)
		return
	}
	lat, errLat := strconv.ParseFloat(q.Get("lat"), 64)
	lng, errLng := strconv.ParseFloat(q.Get("lng"), 64)
	if errLat != nil || errLng != nil {
		writeError(w, http.StatusBadRequest, "provide either bbox=minLng,minLat,maxLng,maxLat or lat= and lng=")
		return
	}
	if !validLatLng(lat, lng) {
		writeError(w, http.StatusBadRequest, "lat/lng out of range")
		return
	}
	radius := 5000.0
	if v := q.Get("radius_m"); v != "" {
		parsed, err := strconv.ParseFloat(v, 64)
		if err != nil || parsed <= 0 || parsed > maxSearchRadiusM {
			writeError(w, http.StatusBadRequest, "radius_m must be between 1 and 50000")
			return
		}
		radius = parsed
	}
	rows, err := s.store.Queries.CourtsNearby(r.Context(), gen.CourtsNearbyParams{Lng: lng, Lat: lat, RadiusM: radius})
	if err != nil {
		s.internalError(w, "courts nearby", err)
		return
	}
	// Approximate the search circle as a bbox for the auto-seeder.
	dLat := radius / 111_320
	dLng := radius / (111_320 * math.Max(0.1, math.Cos(lat*math.Pi/180)))
	s.requestSeeding(lng-dLng, lat-dLat, lng+dLng, lat+dLat)
	out := make([]courtSummary, 0, len(rows))
	for _, c := range rows {
		d := c.DistanceM
		out = append(out, courtSummary{
			ID: c.ID, Name: c.Name, Lat: c.Lat, Lng: c.Lng, Address: c.Address,
			HoopCount: c.HoopCount, Indoor: c.Indoor, Surface: c.Surface, Lighting: c.Lighting,
			IsPublic: c.IsPublic, Source: c.Source, Status: c.Status, ActiveCount: c.ActiveCount,
			DistanceM:    &d,
			LatestReport: newLatestReport(c.LatestPlayerCount, c.LatestRunQuality, c.LatestReportAt),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"courts": out})
}

func (s *Server) listCourtsInBBox(w http.ResponseWriter, r *http.Request, bbox string) {
	parts := strings.Split(bbox, ",")
	if len(parts) != 4 {
		writeError(w, http.StatusBadRequest, "bbox must be minLng,minLat,maxLng,maxLat")
		return
	}
	vals := make([]float64, 4)
	for i, p := range parts {
		v, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bbox must be minLng,minLat,maxLng,maxLat")
			return
		}
		vals[i] = v
	}
	rows, err := s.store.Queries.CourtsInBBox(r.Context(), gen.CourtsInBBoxParams{
		MinLng: vals[0], MinLat: vals[1], MaxLng: vals[2], MaxLat: vals[3],
	})
	if err != nil {
		s.internalError(w, "courts in bbox", err)
		return
	}
	s.requestSeeding(vals[0], vals[1], vals[2], vals[3])
	out := make([]courtSummary, 0, len(rows))
	for _, c := range rows {
		out = append(out, courtSummary{
			ID: c.ID, Name: c.Name, Lat: c.Lat, Lng: c.Lng, Address: c.Address,
			HoopCount: c.HoopCount, Indoor: c.Indoor, Surface: c.Surface, Lighting: c.Lighting,
			IsPublic: c.IsPublic, Source: c.Source, Status: c.Status, ActiveCount: c.ActiveCount,
			LatestReport: newLatestReport(c.LatestPlayerCount, c.LatestRunQuality, c.LatestReportAt),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"courts": out})
}

func (s *Server) handleGetCourt(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	court, err := s.store.Queries.GetCourt(r.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "court not found")
			return
		}
		s.internalError(w, "get court", err)
		return
	}
	// First detail view kicks off one-time enrichment (address + photos).
	if s.enricher != nil && court.EnrichedAt == nil {
		s.enricher.Request(court.ID)
	}
	writeJSON(w, http.StatusOK, court)
}

type createCourtRequest struct {
	Name             string   `json:"name"`
	Lat              float64  `json:"lat"`
	Lng              float64  `json:"lng"`
	Address          *string  `json:"address"`
	HoopCount        *int16   `json:"hoop_count"`
	Indoor           bool     `json:"indoor"`
	Surface          *string  `json:"surface"`
	Lighting         *bool    `json:"lighting"`
	IsPublic         *bool    `json:"is_public"`
	IgnoreDuplicates bool     `json:"ignore_duplicates"`
}

func (s *Server) handleCreateCourt(w http.ResponseWriter, r *http.Request) {
	var req createCourtRequest
	if !readJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 120 {
		writeError(w, http.StatusBadRequest, "name is required (max 120 chars)")
		return
	}
	if !validLatLng(req.Lat, req.Lng) {
		writeError(w, http.StatusBadRequest, "lat/lng out of range")
		return
	}
	if req.Surface != nil && !validSurfaces[*req.Surface] {
		writeError(w, http.StatusBadRequest, "surface must be one of asphalt, concrete, hardwood, rubber, other")
		return
	}
	if req.HoopCount != nil && (*req.HoopCount < 1 || *req.HoopCount > 50) {
		writeError(w, http.StatusBadRequest, "hoop_count must be between 1 and 50")
		return
	}

	if !req.IgnoreDuplicates {
		dupes, err := s.store.Queries.FindNearbyCourts(r.Context(), gen.FindNearbyCourtsParams{
			Lng: req.Lng, Lat: req.Lat, RadiusM: dupeRadiusM,
		})
		if err != nil {
			s.internalError(w, "dupe check", err)
			return
		}
		if len(dupes) > 0 {
			writeJSON(w, http.StatusConflict, map[string]any{
				"error":            "possible duplicate courts nearby; retry with ignore_duplicates=true to create anyway",
				"possible_duplicates": dupes,
			})
			return
		}
	}

	isPublic := true
	if req.IsPublic != nil {
		isPublic = *req.IsPublic
	}
	uid := userID(r)
	court, err := s.store.Queries.CreateCourt(r.Context(), gen.CreateCourtParams{
		Name: req.Name, Lng: req.Lng, Lat: req.Lat,
		Address: req.Address, HoopCount: req.HoopCount, Indoor: req.Indoor,
		Surface: req.Surface, Lighting: req.Lighting, IsPublic: isPublic,
		SubmittedBy: &uid,
	})
	if err != nil {
		s.internalError(w, "create court", err)
		return
	}
	writeJSON(w, http.StatusCreated, court)
}

type voteRequest struct {
	Vote int16 `json:"vote"`
}

func (s *Server) handleVoteCourt(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	var req voteRequest
	if !readJSON(w, r, &req) {
		return
	}
	if req.Vote != 1 && req.Vote != -1 {
		writeError(w, http.StatusBadRequest, "vote must be 1 or -1")
		return
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
	uid := userID(r)
	// The submitter's own vote doesn't count toward verification.
	if court.SubmittedBy != nil && *court.SubmittedBy == uid && req.Vote == 1 {
		writeError(w, http.StatusBadRequest, "you cannot upvote your own submission")
		return
	}
	if err := s.store.Queries.UpsertCourtVote(r.Context(), gen.UpsertCourtVoteParams{
		CourtID: courtID, UserID: uid, Vote: req.Vote,
	}); err != nil {
		s.internalError(w, "vote", err)
		return
	}
	stats, err := s.store.Queries.CourtVoteStats(r.Context(), courtID)
	if err != nil {
		s.internalError(w, "vote stats", err)
		return
	}
	// Verification decisions use reputation-weighted tallies; the displayed
	// net_votes stays a plain headcount.
	weighted, err := s.store.Queries.CourtVoteStatsWeighted(r.Context(), courtID)
	if err != nil {
		s.internalError(w, "weighted vote stats", err)
		return
	}
	status := court.Status
	if weighted.NetWeighted <= rejectNetVotes && status != "rejected" {
		if err := s.store.Queries.SetCourtStatus(r.Context(), gen.SetCourtStatusParams{ID: courtID, Status: "rejected"}); err != nil {
			s.internalError(w, "reject court", err)
			return
		}
		status = "rejected"
	} else if weighted.WeightedUpvotes >= verifyUpvotes && status == "pending" {
		submitter, err := s.store.Queries.PromoteCourtIfPending(r.Context(), courtID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			s.internalError(w, "promote court", err)
			return
		}
		if err == nil && submitter != nil && *submitter != uid {
			s.awardReputation(r.Context(), *submitter, repCourtVerified)
		}
		status = "verified"
	}
	writeJSON(w, http.StatusOK, map[string]any{"net_votes": stats.NetVotes, "status": status})
}

type flagRequest struct {
	EntityType string    `json:"entity_type"`
	EntityID   uuid.UUID `json:"entity_id"`
	Reason     string    `json:"reason"`
}

func (s *Server) handleCreateFlag(w http.ResponseWriter, r *http.Request) {
	var req flagRequest
	if !readJSON(w, r, &req) {
		return
	}
	switch req.EntityType {
	case "court", "photo", "report":
	default:
		writeError(w, http.StatusBadRequest, "entity_type must be court, photo, or report")
		return
	}
	req.Reason = strings.TrimSpace(req.Reason)
	if req.Reason == "" || len(req.Reason) > 500 {
		writeError(w, http.StatusBadRequest, "reason is required (max 500 chars)")
		return
	}
	if err := s.store.Queries.CreateFlag(r.Context(), gen.CreateFlagParams{
		UserID: userID(r), EntityType: req.EntityType, EntityID: req.EntityID, Reason: req.Reason,
	}); err != nil {
		s.internalError(w, "create flag", err)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func validLatLng(lat, lng float64) bool {
	return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}
