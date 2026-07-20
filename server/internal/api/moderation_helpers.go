package api

import (
	"net/http"
	"strings"
)

// screenText runs user-submitted text past the content classifier and, when
// it comes back unsafe, writes the rejection and reports false.
//
// Callers use it as a guard right after validation and before any write:
//
//	if !s.screenText(w, r, "court message", body) {
//	    return
//	}
//
// Moderation is best-effort by design. A classifier outage returns a safe
// verdict plus an error (see moderation.Check); this logs that and lets the
// post through, because taking chat down when Workers AI has a bad minute
// is a worse failure for a solo-run app than briefly missing a message. It
// is also a no-op when Workers AI credentials are unset, which is how local
// development and CI run.
//
// The rejection message deliberately does not name the violated category.
// Telling someone exactly which rule they tripped is a hill-climbing signal
// for anyone probing the filter.
func (s *Server) screenText(w http.ResponseWriter, r *http.Request, surface, text string) bool {
	if strings.TrimSpace(text) == "" || !s.moderator.Enabled() {
		return true
	}
	verdict, err := s.moderator.Check(r.Context(), text)
	if err != nil {
		s.log.Error("text moderation unavailable", "surface", surface, "err", err)
		return true
	}
	if !verdict.Safe {
		s.log.Info("text moderation blocked a post",
			"surface", surface, "user", userID(r), "categories", verdict.Categories)
		writeError(w, http.StatusUnprocessableEntity,
			"that message looks like it breaks the community rules — try rewording it")
		return false
	}
	return true
}
