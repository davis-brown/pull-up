package api

import (
	"net/http"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

// GET /feed — the signed-in user's personalized feed: mutual-follow friends
// checked in right now, plus upcoming runs from followed planners or favorited
// courts. Personalized; the requireAuth middleware already sets Cache-Control:
// no-store for this route group.
func (s *Server) handleGetFeed(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)

	friends, err := s.store.Queries.ListFriendsCheckedIn(r.Context(), uid)
	if err != nil {
		s.internalError(w, "feed friends", err)
		return
	}
	runs, err := s.store.Queries.ListFeedRuns(r.Context(), uid)
	if err != nil {
		s.internalError(w, "feed runs", err)
		return
	}
	if friends == nil {
		friends = []gen.ListFriendsCheckedInRow{}
	}
	if runs == nil {
		runs = []gen.ListFeedRunsRow{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"friends_here":  friends,
		"upcoming_runs": runs,
	})
}
