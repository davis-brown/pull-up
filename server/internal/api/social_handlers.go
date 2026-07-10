package api

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

func (s *Server) handleGetProfile(w http.ResponseWriter, r *http.Request) {
	targetID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	stats, err := s.store.Queries.GetProfileStats(r.Context(), targetID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		s.internalError(w, "profile stats", err)
		return
	}
	streak, err := s.store.Queries.CurrentStreakDays(r.Context(), targetID)
	if err != nil {
		s.internalError(w, "streak", err)
		return
	}

	var isFollowing, followsYou bool
	if viewer := s.optionalUserID(r); viewer != uuid.Nil && viewer != targetID {
		isFollowing, _ = s.store.Queries.IsFollowing(r.Context(),
			gen.IsFollowingParams{FollowerID: viewer, FolloweeID: targetID})
		followsYou, _ = s.store.Queries.IsFollowing(r.Context(),
			gen.IsFollowingParams{FollowerID: targetID, FolloweeID: viewer})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id":                 stats.ID,
		"display_name":       stats.DisplayName,
		"avatar_url":         stats.AvatarUrl,
		"reputation":         stats.Reputation,
		"member_since":       stats.MemberSince,
		"check_in_count":     stats.CheckInCount,
		"courts_added_count": stats.CourtsAddedCount,
		"follower_count":     stats.FollowerCount,
		"following_count":    stats.FollowingCount,
		"streak_days":        streak,
		"is_following":       isFollowing,
		"follows_you":        followsYou,
	})
}
