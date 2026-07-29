package api

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

// courtFacts maps each player-confirmable fact to its allowed values. Facts
// mirror courts columns; boolean columns use "yes"/"no" in the ledger.
// hoop_count uses discrete buckets, so an off-bucket court matches no chip.
var courtFacts = map[string][]string{
	"rim_type":       {"single", "double"},
	"net_type":       {"chain", "nylon", "none"},
	"lighting":       {"yes", "no"},
	"surface":        {"asphalt", "concrete", "hardwood", "rubber", "other"},
	"hoop_count":     {"1", "2", "4", "6", "8"},
	"covered":        {"yes", "no"},
	"fenced":         {"yes", "no"},
	"drinking_water": {"yes", "no"},
	"toilets":        {"yes", "no"},
	"parking":        {"yes", "no"},
	"access":         {"public", "private", "customers"},
	"fee":            {"yes", "no"},
}

func validFactValue(fact, value string) bool {
	for _, v := range courtFacts[fact] {
		if v == value {
			return true
		}
	}
	return false
}

type factSummary struct {
	Fact            string    `json:"fact"`
	Confirmations   int       `json:"confirmations"`
	LastConfirmedAt time.Time `json:"last_confirmed_at"`
	MajorityValue   string    `json:"majority_value"`
}

func (s *Server) courtFactSummaries(r *http.Request, courtID uuid.UUID) ([]factSummary, error) {
	rows, err := s.store.Queries.CourtFactSummaries(r.Context(), courtID)
	if err != nil {
		return nil, err
	}
	out := make([]factSummary, 0, len(rows))
	for _, row := range rows {
		out = append(out, factSummary{
			Fact:            row.Fact,
			Confirmations:   int(row.Confirmations),
			LastConfirmedAt: row.LastConfirmedAt,
			MajorityValue:   row.MajorityValue,
		})
	}
	return out, nil
}

func (s *Server) handleListCourtFacts(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	facts, err := s.courtFactSummaries(r, courtID)
	if err != nil {
		s.internalError(w, "list court facts", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"facts": facts})
}

type confirmFactRequest struct {
	Fact  string `json:"fact"`
	Value string `json:"value"`
}

func (s *Server) handleConfirmCourtFact(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	var req confirmFactRequest
	if !readJSON(w, r, &req) {
		return
	}
	if _, ok := courtFacts[req.Fact]; !ok {
		writeError(w, http.StatusBadRequest, "unknown fact")
		return
	}
	if !validFactValue(req.Fact, req.Value) {
		writeError(w, http.StatusBadRequest, "invalid value for "+req.Fact)
		return
	}
	if _, err := s.store.Queries.GetCourt(r.Context(), courtID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "court not found")
			return
		}
		s.internalError(w, "confirm fact: load court", err)
		return
	}
	if err := s.store.Queries.UpsertFactConfirmation(r.Context(), gen.UpsertFactConfirmationParams{
		CourtID: courtID, UserID: userID(r), Fact: req.Fact, Value: req.Value,
	}); err != nil {
		s.internalError(w, "confirm fact", err)
		return
	}
	// Keyed per court per day, so re-tapping chips isn't a farm.
	s.awardXP(r.Context(), userID(r), "fact_confirmed",
		"fact:"+courtID.String()+":"+utcDay(time.Now()), xpFactConfirmed)

	// The court's stored value follows the recent-window majority, so a
	// wrong tap gets outvoted rather than moderated.
	majority, err := s.store.Queries.CourtFactMajority(r.Context(), gen.CourtFactMajorityParams{
		CourtID: courtID, Fact: req.Fact,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		s.internalError(w, "confirm fact: majority", err)
		return
	}
	if err == nil && majority != "" {
		if err := s.applyFactMajority(r, courtID, req.Fact, majority); err != nil {
			s.internalError(w, "confirm fact: apply", err)
			return
		}
	}

	facts, err := s.courtFactSummaries(r, courtID)
	if err != nil {
		s.internalError(w, "confirm fact: summaries", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"facts": facts})
}

func (s *Server) applyFactMajority(r *http.Request, courtID uuid.UUID, fact, value string) error {
	params := gen.UpdateCourtAttributesParams{ID: courtID}
	yes := value == "yes"
	switch fact {
	case "rim_type":
		params.RimType = &value
	case "net_type":
		params.NetType = &value
	case "surface":
		params.Surface = &value
	case "access":
		params.Access = &value
	case "lighting":
		params.Lighting = &yes
	case "covered":
		params.Covered = &yes
	case "fenced":
		params.Fenced = &yes
	case "drinking_water":
		params.DrinkingWater = &yes
	case "toilets":
		params.Toilets = &yes
	case "parking":
		params.Parking = &yes
	case "fee":
		params.Fee = &yes
	case "hoop_count":
		// value comes from courtFacts' bucket allowlist, so it always parses.
		if n, err := strconv.Atoi(value); err == nil {
			h := int16(n)
			params.HoopCount = &h
		}
	}
	_, err := s.store.Queries.UpdateCourtAttributes(r.Context(), params)
	return err
}
