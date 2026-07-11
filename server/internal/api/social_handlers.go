package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/davisbrown/pull-up/server/internal/push"
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

	var isFollowing, followsYou, hasRequested bool
	if viewer := s.optionalUserID(r); viewer != uuid.Nil && viewer != targetID {
		isFollowing, _ = s.store.Queries.IsFollowing(r.Context(),
			gen.IsFollowingParams{FollowerID: viewer, FolloweeID: targetID})
		followsYou, _ = s.store.Queries.IsFollowing(r.Context(),
			gen.IsFollowingParams{FollowerID: targetID, FolloweeID: viewer})
		hasRequested, _ = s.store.Queries.IsFollowRequested(r.Context(),
			gen.IsFollowRequestedParams{RequesterID: viewer, TargetID: targetID})
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
		"has_requested":      hasRequested,
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
	target, err := s.store.Queries.GetUserByID(r.Context(), targetID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		s.internalError(w, "load target", err)
		return
	}
	if target.IsPrivate {
		already, err := s.store.Queries.IsFollowing(r.Context(),
			gen.IsFollowingParams{FollowerID: uid, FolloweeID: targetID})
		if err != nil {
			s.internalError(w, "check following", err)
			return
		}
		if !already {
			if err := s.store.Queries.CreateFollowRequest(r.Context(),
				gen.CreateFollowRequestParams{RequesterID: uid, TargetID: targetID}); err != nil {
				s.internalError(w, "create follow request", err)
				return
			}
			requester, _ := s.store.Queries.GetUserByID(r.Context(), uid)
			go s.notifyFollowRequest(targetID, requester.DisplayName)
			writeJSON(w, http.StatusOK, map[string]any{"requested": true})
			return
		}
	}
	if err := s.store.Queries.Follow(r.Context(), gen.FollowParams{FollowerID: uid, FolloweeID: targetID}); err != nil {
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
	if err := s.store.Queries.DeleteFollowRequest(r.Context(),
		gen.DeleteFollowRequestParams{RequesterID: userID(r), TargetID: targetID}); err != nil {
		s.internalError(w, "cancel request", err)
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

func (s *Server) handleListFollowRequests(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.Queries.ListIncomingFollowRequests(r.Context(), userID(r))
	if err != nil {
		s.internalError(w, "list follow requests", err)
		return
	}
	if rows == nil {
		rows = []gen.ListIncomingFollowRequestsRow{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"requests": rows})
}

func (s *Server) handleAcceptFollowRequest(w http.ResponseWriter, r *http.Request) {
	requesterID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	me := userID(r)
	n, err := s.store.Queries.AcceptFollowRequest(r.Context(),
		gen.AcceptFollowRequestParams{RequesterID: requesterID, TargetID: me})
	if err != nil {
		s.internalError(w, "accept follow request", err)
		return
	}
	if n == 0 {
		writeError(w, http.StatusNotFound, "no such follow request")
		return
	}
	accepter, _ := s.store.Queries.GetUserByID(r.Context(), me)
	go s.notifyFollowAccepted(requesterID, accepter.DisplayName)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRejectFollowRequest(w http.ResponseWriter, r *http.Request) {
	requesterID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	if err := s.store.Queries.DeleteFollowRequest(r.Context(),
		gen.DeleteFollowRequestParams{RequesterID: requesterID, TargetID: userID(r)}); err != nil {
		s.internalError(w, "reject follow request", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// notifyFollowRequest pings a private user that someone asked to follow them.
func (s *Server) notifyFollowRequest(targetID uuid.UUID, requesterName string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	tokens, err := s.store.Queries.ListUserPushTokens(ctx, targetID)
	if err != nil || len(tokens) == 0 {
		return
	}
	_ = push.Send(ctx, tokens, "New follow request",
		fmt.Sprintf("%s wants to follow you.", requesterName),
		map[string]string{"type": "follow_request"})
}

// notifyFollowAccepted pings the requester that their request was accepted.
func (s *Server) notifyFollowAccepted(requesterID uuid.UUID, accepterName string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	tokens, err := s.store.Queries.ListUserPushTokens(ctx, requesterID)
	if err != nil || len(tokens) == 0 {
		return
	}
	_ = push.Send(ctx, tokens, "Follow request accepted",
		fmt.Sprintf("%s accepted your follow request.", accepterName),
		map[string]string{"type": "follow_accepted"})
}
