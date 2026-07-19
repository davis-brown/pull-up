package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

func (s *Server) handleGetMe(w http.ResponseWriter, r *http.Request) {
	user, err := s.store.Queries.GetUserByID(r.Context(), userID(r))
	if err != nil {
		// A valid token can outlive the account (deleted account): 401 so
		// the client clears its session instead of retrying.
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusUnauthorized, "account no longer exists")
			return
		}
		s.internalError(w, "get me", err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

// validStyleTags enumerates the allowed player-card style tags. Exported at
// package level (rather than inlined) so tests in this package can reference
// the same set of values.
var validStyleTags = []string{"shooter", "pass_first", "defense", "rim_runner", "casual", "competitive"}

var validPositions = map[string]bool{"guard": true, "wing": true, "forward": true, "center": true}

var validSkillLevels = map[string]bool{"beginner": true, "intermediate": true, "advanced": true, "elite": true}

// validAvailability enumerates the structured availability windows a player
// can advertise; free-text scheduling is deliberately not supported.
var validAvailability = []string{
	"weekday_morning", "weekday_lunch", "weekday_evening",
	"weekend_morning", "weekend_afternoon", "weekend_evening",
}

func isValidAvailability(window string) bool {
	for _, w := range validAvailability {
		if w == window {
			return true
		}
	}
	return false
}

func isValidStyleTag(tag string) bool {
	for _, t := range validStyleTags {
		if t == tag {
			return true
		}
	}
	return false
}

type patchMeRequest struct {
	DisplayName  *string                  `json:"display_name"`
	AvatarURL    optionalNullable[string] `json:"avatar_url"`
	IsPrivate    *bool                    `json:"is_private"`
	JerseyNumber optionalNullable[int]    `json:"jersey_number"`
	Position     optionalNullable[string] `json:"position"`
	HeightCm     optionalNullable[int]    `json:"height_cm"`
	StyleTags    []string                 `json:"style_tags"`
	SkillLevel   optionalNullable[string] `json:"skill_level"`
	Availability []string                 `json:"availability"`
}

// optionalNullable distinguishes an omitted PATCH field from an explicit
// JSON null, allowing nullable columns to be cleared intentionally.
type optionalNullable[T any] struct {
	Set   bool
	Value *T
}

func (f *optionalNullable[T]) UnmarshalJSON(data []byte) error {
	f.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		f.Value = nil
		return nil
	}
	var value T
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	f.Value = &value
	return nil
}

func (s *Server) handlePatchMe(w http.ResponseWriter, r *http.Request) {
	var req patchMeRequest
	if !readJSON(w, r, &req) {
		return
	}
	if req.DisplayName != nil {
		trimmed := strings.TrimSpace(*req.DisplayName)
		if trimmed == "" || len(trimmed) > 50 {
			writeError(w, http.StatusBadRequest, "display_name must be 1-50 characters")
			return
		}
		req.DisplayName = &trimmed
	}
	if req.JerseyNumber.Value != nil && (*req.JerseyNumber.Value < 0 || *req.JerseyNumber.Value > 99) {
		writeError(w, http.StatusBadRequest, "jersey_number must be 0-99")
		return
	}
	if req.Position.Value != nil && !validPositions[*req.Position.Value] {
		writeError(w, http.StatusBadRequest, "position must be one of guard, wing, forward, center")
		return
	}
	if req.HeightCm.Value != nil && (*req.HeightCm.Value < 120 || *req.HeightCm.Value > 250) {
		writeError(w, http.StatusBadRequest, "height_cm must be 120-250")
		return
	}
	if req.StyleTags != nil {
		if len(req.StyleTags) > 3 {
			writeError(w, http.StatusBadRequest, "style_tags must have at most 3 entries")
			return
		}
		for _, tag := range req.StyleTags {
			if !isValidStyleTag(tag) {
				writeError(w, http.StatusBadRequest, "invalid style tag: "+tag)
				return
			}
		}
	}
	if req.SkillLevel.Value != nil && !validSkillLevels[*req.SkillLevel.Value] {
		writeError(w, http.StatusBadRequest, "skill_level must be one of beginner, intermediate, advanced, elite")
		return
	}
	if req.Availability != nil {
		if len(req.Availability) > len(validAvailability) {
			writeError(w, http.StatusBadRequest, "availability has too many entries")
			return
		}
		seen := map[string]bool{}
		for _, window := range req.Availability {
			if !isValidAvailability(window) {
				writeError(w, http.StatusBadRequest, "invalid availability window: "+window)
				return
			}
			if seen[window] {
				writeError(w, http.StatusBadRequest, "duplicate availability window: "+window)
				return
			}
			seen[window] = true
		}
	}
	uid := userID(r)
	if req.AvatarURL.Value != nil {
		value := strings.TrimSpace(*req.AvatarURL.Value)
		if !validAvatarURL(uid, value) {
			writeError(w, http.StatusBadRequest, "avatar_url must reference your avatar upload")
			return
		}
		key := strings.TrimPrefix(value, "/photos/")
		claimed, err := s.store.Queries.ClaimPendingUpload(r.Context(), gen.ClaimPendingUploadParams{
			StorageKey: key,
			OwnerID:    uid,
			Purpose:    "avatar",
		})
		if err != nil || claimed != key {
			writeError(w, http.StatusBadRequest, "avatar_url must reference a pending upload")
			return
		}
		req.AvatarURL.Value = &value
	}
	var jerseyNumber *int16
	if req.JerseyNumber.Value != nil {
		v := int16(*req.JerseyNumber.Value)
		jerseyNumber = &v
	}
	var heightCm *int16
	if req.HeightCm.Value != nil {
		v := int16(*req.HeightCm.Value)
		heightCm = &v
	}
	user, err := s.store.Queries.UpdateUser(r.Context(), gen.UpdateUserParams{
		ID:              uid,
		DisplayName:     req.DisplayName,
		AvatarUrlSet:    req.AvatarURL.Set,
		AvatarUrl:       req.AvatarURL.Value,
		IsPrivate:       req.IsPrivate,
		JerseyNumberSet: req.JerseyNumber.Set,
		JerseyNumber:    jerseyNumber,
		PositionSet:     req.Position.Set,
		Position:        req.Position.Value,
		HeightCmSet:     req.HeightCm.Set,
		HeightCm:        heightCm,
		StyleTags:       req.StyleTags,
		SkillLevelSet:   req.SkillLevel.Set,
		SkillLevel:      req.SkillLevel.Value,
		Availability:    req.Availability,
	})
	if err != nil {
		s.internalError(w, "update user", err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

var (
	photoUUIDRe = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
	photoKeyRe  = regexp.MustCompile(`^(?:courts|avatars)/` + photoUUIDRe + `/` + photoUUIDRe + `\.jpg$`)
)

func isAllowedPhotoKey(key string) bool {
	return photoKeyRe.MatchString(key)
}

func validAvatarURL(uid uuid.UUID, value string) bool {
	key := strings.TrimPrefix(value, "/photos/")
	if key == value || len(value) > 300 {
		return false
	}
	return isAllowedPhotoKey(key) && strings.HasPrefix(key, "avatars/"+uid.String()+"/")
}

func (s *Server) handleCreateAvatarUpload(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	key := fmt.Sprintf("avatars/%s/%s.jpg", uid, uuid.NewString())
	if err := s.store.Queries.CreatePendingUpload(r.Context(), gen.CreatePendingUploadParams{
		StorageKey: key,
		OwnerID:    uid,
		Purpose:    "avatar",
	}); err != nil {
		s.internalError(w, "record pending upload", err)
		return
	}
	exp := time.Now().Add(uploadURLTTL).Unix()
	writeJSON(w, http.StatusOK, map[string]any{
		"avatar_url":           "/photos/" + key,
		"upload_path":          "/photos/upload/" + key,
		"upload_authorization": uploadAuthorization(s.cfg.UploadSigningSecret, key, exp),
	})
}

func (s *Server) handleDeleteAvatar(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Queries.ClearUserAvatar(r.Context(), userID(r)); err != nil {
		s.internalError(w, "clear avatar", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
