package api

import (
	"context"

	"github.com/davisbrown/pull-up/server/internal/push"
)

// sendPush is push.Send plus cleanup: tokens Expo reports as
// DeviceNotRegistered are deleted, so uninstalled devices stop being
// targeted (and stop counting as reachable in the streak-nudge query).
func (s *Server) sendPush(ctx context.Context, tokens []string, title, body string, data map[string]string) error {
	dead, err := push.Send(ctx, tokens, title, body, data)
	if len(dead) > 0 {
		if n, derr := s.store.Queries.DeletePushTokens(ctx, dead); derr != nil {
			s.log.Error("prune push tokens", "err", derr)
		} else {
			s.log.Info("pruned push tokens", "count", n)
		}
	}
	return err
}
