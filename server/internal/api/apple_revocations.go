package api

import "context"

// Claim a small batch with a retry lease so scheduler and deletion requests can
// drain concurrently. Tokens never appear in logs or API responses.
func (s *Server) drainAppleRevocations(ctx context.Context) {
	if !s.apple.Enabled() {
		return
	}
	rows, err := s.store.Pool.Query(ctx, `UPDATE apple_revocations SET attempts=attempts+1, next_attempt_at=now()+interval '1 hour' WHERE id IN (SELECT id FROM apple_revocations WHERE next_attempt_at<=now() AND client_id=$1 ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 3) RETURNING id, encrypted_token`, s.apple.ClientID)
	if err != nil {
		s.log.Error("claim Apple revocations", "err", err)
		return
	}
	type job struct {
		id    int64
		token []byte
	}
	jobs := []job{}
	for rows.Next() {
		var j job
		if err := rows.Scan(&j.id, &j.token); err != nil {
			rows.Close()
			s.log.Error("read Apple revocation", "err", err)
			return
		}
		jobs = append(jobs, j)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		s.log.Error("read Apple revocations", "err", err)
		return
	}
	for _, j := range jobs {
		if err := s.apple.Revoke(ctx, j.token); err != nil {
			s.log.Error("Apple revocation pending retry", "job", j.id, "err", err)
			continue
		}
		if _, err := s.store.Pool.Exec(ctx, `DELETE FROM apple_revocations WHERE id=$1`, j.id); err != nil {
			s.log.Error("complete Apple revocation", "job", j.id, "err", err)
		}
	}
}
