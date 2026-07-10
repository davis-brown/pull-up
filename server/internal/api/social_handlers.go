package api

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

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

func (s *Server) handleFollow(w http.ResponseWriter, r *http.Request) {
	targetID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	uid := userID(r)
	if targetID == uid {
		writeError(w, http.StatusBadRequest, "you cannot follow yourself")
		return
	}
	blocked, err := s.store.Queries.AreBlocked(r.Context(), gen.AreBlockedParams{BlockerID: uid, BlockedID: targetID})
	if err != nil {
		s.internalError(w, "check blocked", err)
		return
	}
	if blocked {
		writeError(w, http.StatusConflict, "cannot follow this user")
		return
	}
	if err := s.store.Queries.Follow(r.Context(), gen.FollowParams{FollowerID: uid, FolloweeID: targetID}); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		s.internalError(w, "follow", err)
		return
	}
	count, _ := s.store.Queries.CountFollowers(r.Context(), targetID)
	writeJSON(w, http.StatusOK, map[string]any{"following": true, "follower_count": count})
}

func (s *Server) handleUnfollow(w http.ResponseWriter, r *http.Request) {
	targetID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	if err := s.store.Queries.Unfollow(r.Context(), gen.UnfollowParams{FollowerID: userID(r), FolloweeID: targetID}); err != nil {
		s.internalError(w, "unfollow", err)
		return
	}
	count, _ := s.store.Queries.CountFollowers(r.Context(), targetID)
	writeJSON(w, http.StatusOK, map[string]any{"following": false, "follower_count": count})
}

func (s *Server) handleListFollowers(w http.ResponseWriter, r *http.Request) {
	s.listFollowRows(w, r, true)
}

func (s *Server) handleListFollowing(w http.ResponseWriter, r *http.Request) {
	s.listFollowRows(w, r, false)
}

func (s *Server) listFollowRows(w http.ResponseWriter, r *http.Request, followers bool) {
	targetID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	const limit = 100
	var rows any
	if followers {
		rows, err = s.store.Queries.ListFollowers(r.Context(), gen.ListFollowersParams{FolloweeID: targetID, Limit: limit})
	} else {
		rows, err = s.store.Queries.ListFollowing(r.Context(), gen.ListFollowingParams{FollowerID: targetID, Limit: limit})
	}
	if err != nil {
		s.internalError(w, "list follows", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": rows})
}
