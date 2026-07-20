package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

const (
	// A game needs at least one player a side; 5-on-5 plus a generous
	// margin for miscounts bounds the upper end.
	minTeamSize  = 1
	maxTeamSize  = 8
	maxCourtGame = 20 // games returned per court listing

	// xpGamePlayed is granted to every participant of a CONFIRMED game.
	// Only on confirmation: an unconfirmed result is an unverified claim,
	// and paying out on those would make game recording the most farmable
	// action in the app.
	xpGamePlayed = 10
)

type recordGameRequest struct {
	// Team rosters by user id. The recorder must appear in one of them:
	// you log games you played in, not games you watched.
	TeamA       []string `json:"team_a"`
	TeamB       []string `json:"team_b"`
	WinningTeam *int     `json:"winning_team"` // 0 = team_a, 1 = team_b
	ScoreWin    *int     `json:"score_win"`
	ScoreLose   *int     `json:"score_lose"`
}

// parseRoster validates one side's user ids: well-formed, in range, and
// free of duplicates. Cross-team duplicates are caught by the caller.
func parseRoster(raw []string, seen map[uuid.UUID]bool) ([]uuid.UUID, error) {
	if len(raw) < minTeamSize || len(raw) > maxTeamSize {
		return nil, errors.New("each team needs between 1 and 8 players")
	}
	out := make([]uuid.UUID, 0, len(raw))
	for _, s := range raw {
		id, err := uuid.Parse(s)
		if err != nil {
			return nil, errors.New("invalid player id")
		}
		if seen[id] {
			return nil, errors.New("a player can only appear once")
		}
		seen[id] = true
		out = append(out, id)
	}
	return out, nil
}

func (s *Server) handleRecordGame(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	var req recordGameRequest
	if !readJSON(w, r, &req) {
		return
	}
	if req.WinningTeam == nil || (*req.WinningTeam != 0 && *req.WinningTeam != 1) {
		writeError(w, http.StatusBadRequest, "winning_team must be 0 or 1")
		return
	}
	seen := map[uuid.UUID]bool{}
	teamA, err := parseRoster(req.TeamA, seen)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	teamB, err := parseRoster(req.TeamB, seen)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	uid := userID(r)
	if !seen[uid] {
		writeError(w, http.StatusBadRequest, "you must be one of the players")
		return
	}
	// Scores are optional, but a partial or self-contradicting score is a
	// data-entry mistake worth rejecting rather than storing.
	var scoreWin, scoreLose *int16
	if req.ScoreWin != nil || req.ScoreLose != nil {
		if req.ScoreWin == nil || req.ScoreLose == nil {
			writeError(w, http.StatusBadRequest, "give both score_win and score_lose, or neither")
			return
		}
		if *req.ScoreWin < 0 || *req.ScoreWin > 200 || *req.ScoreLose < 0 || *req.ScoreLose > 200 {
			writeError(w, http.StatusBadRequest, "scores must be between 0 and 200")
			return
		}
		if *req.ScoreWin <= *req.ScoreLose {
			writeError(w, http.StatusBadRequest, "the winning score must be higher")
			return
		}
		win, lose := int16(*req.ScoreWin), int16(*req.ScoreLose)
		scoreWin, scoreLose = &win, &lose
	}

	court, err := s.store.Queries.GetCourt(r.Context(), courtID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "court not found")
			return
		}
		s.internalError(w, "get court", err)
		return
	}
	if court.Status == "rejected" {
		writeError(w, http.StatusUnprocessableEntity, "cannot record a game at a rejected court")
		return
	}

	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		s.internalError(w, "begin record game", err)
		return
	}
	defer tx.Rollback(r.Context())
	q := s.store.Queries.WithTx(tx)

	game, err := q.CreateGame(r.Context(), gen.CreateGameParams{
		CourtID: courtID, RecordedBy: uid,
		WinningTeam: int16(*req.WinningTeam),
		ScoreWin:    scoreWin, ScoreLose: scoreLose,
	})
	if err != nil {
		s.internalError(w, "create game", err)
		return
	}
	for team, roster := range [][]uuid.UUID{teamA, teamB} {
		for _, playerID := range roster {
			if err := q.AddGameParticipant(r.Context(), gen.AddGameParticipantParams{
				GameID: game.ID, UserID: playerID, Team: int16(team),
				IsRecorder: playerID == uid,
			}); err != nil {
				// A bad player id is the client's error, not ours: the FK
				// is the only thing validating that these users exist.
				writeError(w, http.StatusBadRequest, "one of the players does not exist")
				return
			}
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.internalError(w, "commit record game", err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"game": game})
}

func (s *Server) handleConfirmGame(w http.ResponseWriter, r *http.Request) {
	gameID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid game id")
		return
	}
	uid := userID(r)
	game, err := s.store.Queries.GetGame(r.Context(), gameID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "game not found")
			return
		}
		s.internalError(w, "get game", err)
		return
	}
	participant, err := s.store.Queries.GetGameParticipant(r.Context(), gen.GetGameParticipantParams{
		GameID: gameID, UserID: uid,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusForbidden, "you were not in this game")
			return
		}
		s.internalError(w, "get game participant", err)
		return
	}
	// Only the losing side settles a result. A winner (or the recorder,
	// who is auto-confirmed at creation) agreeing proves nothing.
	if participant.Team == game.WinningTeam {
		writeError(w, http.StatusForbidden, "only the other team can confirm a result")
		return
	}

	if _, err := s.store.Queries.ConfirmGameParticipant(r.Context(), gen.ConfirmGameParticipantParams{
		GameID: gameID, UserID: uid,
	}); err != nil {
		s.internalError(w, "confirm game participant", err)
		return
	}
	flipped, err := s.store.Queries.ConfirmGameIfOpposingAgreed(r.Context(), gameID)
	if err != nil {
		s.internalError(w, "confirm game", err)
		return
	}
	// Exactly one caller wins the flip, so XP pays out once per game.
	if flipped > 0 {
		s.runBackground("award game xp", func() { s.awardGameXP(gameID) })
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "confirmed"})
}

// awardGameXP grants every participant of a newly confirmed game their
// share. Dedup-keyed per game per user, so the phase 20 ledger absorbs
// any retry, and subject to the same daily cap as everything else.
func (s *Server) awardGameXP(gameID uuid.UUID) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	participants, err := s.store.Queries.ListGameParticipants(ctx, []uuid.UUID{gameID})
	if err != nil {
		s.log.Error("game xp participants", "game", gameID, "err", err)
		return
	}
	for _, p := range participants {
		s.awardXP(ctx, p.UserID, "game_played", "game:"+gameID.String(), xpGamePlayed)
	}
}

type gamePlayer struct {
	UserID      uuid.UUID `json:"user_id"`
	DisplayName string    `json:"display_name"`
	AvatarURL   *string   `json:"avatar_url"`
	Team        int16     `json:"team"`
}

// handleListCourtGames serves a court's recent confirmed games. Public:
// a confirmed result is a fact about a public court, the same as its
// crowd reports and planned runs.
func (s *Server) handleListCourtGames(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	games, err := s.store.Queries.ListCourtGames(r.Context(), gen.ListCourtGamesParams{
		CourtID: courtID, MaxGames: maxCourtGame,
	})
	if err != nil {
		s.internalError(w, "list court games", err)
		return
	}
	ids := make([]uuid.UUID, 0, len(games))
	for _, g := range games {
		ids = append(ids, g.ID)
	}
	byGame := map[uuid.UUID][]gamePlayer{}
	if len(ids) > 0 {
		participants, err := s.store.Queries.ListGameParticipants(r.Context(), ids)
		if err != nil {
			s.internalError(w, "list game participants", err)
			return
		}
		for _, p := range participants {
			byGame[p.GameID] = append(byGame[p.GameID], gamePlayer{
				UserID: p.UserID, DisplayName: p.DisplayName,
				AvatarURL: p.AvatarUrl, Team: p.Team,
			})
		}
	}
	out := make([]map[string]any, 0, len(games))
	for _, g := range games {
		players := byGame[g.ID]
		if players == nil {
			players = []gamePlayer{}
		}
		out = append(out, map[string]any{
			"id": g.ID, "court_id": g.CourtID, "recorded_by": g.RecordedBy,
			"winning_team": g.WinningTeam, "score_win": g.ScoreWin, "score_lose": g.ScoreLose,
			"played_at": g.PlayedAt, "players": players,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"games": out})
}

// handleListPendingGames serves the games waiting on the caller's word.
func (s *Server) handleListPendingGames(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.Queries.ListPendingGameConfirmations(r.Context(), userID(r))
	if err != nil {
		s.internalError(w, "list pending games", err)
		return
	}
	if rows == nil {
		rows = []gen.ListPendingGameConfirmationsRow{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"games": rows})
}
