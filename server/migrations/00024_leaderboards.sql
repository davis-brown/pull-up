-- +goose Up
-- Phase 22: scoped leaderboards. No new state — both boards are reads over
-- data already captured. This migration exists only for the index.
--
-- The court board counts check-ins per player over a rolling window. The
-- existing check_ins indexes do not serve that: check_ins_court_active is
-- partial (checked-out rows excluded) and keyed on expires_at, which is
-- about who is at a court NOW; check_ins_user_idx leads with user_id, the
-- wrong end for a per-court scan. Ranking needs every check-in at one
-- court in a date range, including checked-out ones.
CREATE INDEX check_ins_court_created_idx ON check_ins (court_id, created_at DESC);

-- +goose Down
DROP INDEX check_ins_court_created_idx;
