package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

const (
	// leaderboardMaxEntries bounds the response. A pickup court's board is
	// interesting at the top; past a screenful it is a directory.
	leaderboardMaxEntries = 25
)

// leaderboardEntry is one ranked player. Rank is 1-based and assigned by
// the server so every client agrees on ties (dense ordering by the query's
// ORDER BY, not by score equality — two players on the same score keep
// distinct ranks, ordered by name).
type leaderboardEntry struct {
	Rank        int       `json:"rank"`
	UserID      uuid.UUID `json:"user_id"`
	DisplayName string    `json:"display_name"`
	AvatarURL   *string   `json:"avatar_url"`
	// Score is check-ins on a court board and XP on a circle board; the
	// metric field says which, so one client component renders both.
	Score  int    `json:"score"`
	Metric string `json:"metric"`
}

type leaderboardResponse struct {
	Metric string `json:"metric"`
	// Both boards rank over the current SEASON rather than a rolling
	// window (phase 22b). A rolling window never ends, so standing just
	// drifts; a season closes, which is what makes a board worth topping.
	Season  seasonInfo         `json:"season"`
	Entries []leaderboardEntry `json:"entries"`
	// ViewerRank is the viewer's own position, or null when they do not
	// appear. On a court board that means they have not checked in here
	// during the window; it is also null when they rank past the returned
	// slice, so the client can say "not ranked yet" rather than implying
	// they are absent from the sport.
	ViewerRank *int `json:"viewer_rank"`
}

// handleCourtLeaderboard ranks players by appearances at one court.
func (s *Server) handleCourtLeaderboard(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	viewer := userID(r)
	season := currentSeason()
	rows, err := s.store.Queries.CourtLeaderboard(r.Context(), gen.CourtLeaderboardParams{
		CourtID:    courtID,
		Since:      season.StartedAt,
		ViewerID:   viewer,
		MaxEntries: leaderboardMaxEntries,
	})
	if err != nil {
		s.internalError(w, "court leaderboard", err)
		return
	}
	entries := make([]leaderboardEntry, 0, len(rows))
	for i, row := range rows {
		entries = append(entries, leaderboardEntry{
			Rank:        i + 1,
			UserID:      row.UserID,
			DisplayName: row.DisplayName,
			AvatarURL:   row.AvatarUrl,
			Score:       int(row.CheckIns),
			Metric:      "check_ins",
		})
	}
	writeJSON(w, http.StatusOK, leaderboardResponse{
		Metric:     "check_ins",
		Season:     season,
		Entries:    entries,
		ViewerRank: viewerRank(entries, viewer),
	})
}

// handleCircleLeaderboard ranks the viewer and the people they follow by XP.
func (s *Server) handleCircleLeaderboard(w http.ResponseWriter, r *http.Request) {
	viewer := userID(r)
	season := currentSeason()
	rows, err := s.store.Queries.CircleLeaderboard(r.Context(), gen.CircleLeaderboardParams{
		Since:      season.StartedAt,
		ViewerID:   viewer,
		MaxEntries: leaderboardMaxEntries,
	})
	if err != nil {
		s.internalError(w, "circle leaderboard", err)
		return
	}
	entries := make([]leaderboardEntry, 0, len(rows))
	for i, row := range rows {
		entries = append(entries, leaderboardEntry{
			Rank:        i + 1,
			UserID:      row.UserID,
			DisplayName: row.DisplayName,
			AvatarURL:   row.AvatarUrl,
			Score:       int(row.Xp),
			Metric:      "xp",
		})
	}
	writeJSON(w, http.StatusOK, leaderboardResponse{
		Metric:     "xp",
		Season:     season,
		Entries:    entries,
		ViewerRank: viewerRank(entries, viewer),
	})
}

func viewerRank(entries []leaderboardEntry, viewer uuid.UUID) *int {
	for i := range entries {
		if entries[i].UserID == viewer {
			rank := entries[i].Rank
			return &rank
		}
	}
	return nil
}
