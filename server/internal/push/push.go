// Package push sends notifications through Expo's push service. Expo relays
// to APNs/FCM, so the server needs no Apple/Google push credentials.
package push

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

const chunkSize = 100

// endpoint resolves per call so tests can point sends at a local server
// (EXPO_PUSH_URL); production never sets it and uses Expo's service.
func endpoint() string {
	if v := os.Getenv("EXPO_PUSH_URL"); v != "" {
		return v
	}
	return "https://exp.host/--/api/v2/push/send"
}

type message struct {
	To    []string          `json:"to"`
	Title string            `json:"title"`
	Body  string            `json:"body"`
	Data  map[string]string `json:"data,omitempty"`
}

// ticket is Expo's per-message receipt. Expo answers 200 even when a
// device is gone, so a dead token only shows up here, as
// details.error == "DeviceNotRegistered", in the same order as `to`.
type ticket struct {
	Status  string `json:"status"`
	Details struct {
		Error string `json:"error"`
	} `json:"details"`
}

// Send delivers a notification to the given Expo push tokens, chunked per
// Expo's API limits. Best-effort: returns the first error but attempts all
// chunks. dead lists the tokens Expo reported as no longer registered
// (app uninstalled, or notifications revoked) so the caller can drop them.
func Send(ctx context.Context, tokens []string, title, body string, data map[string]string) (dead []string, err error) {
	client := &http.Client{Timeout: 15 * time.Second}
	var firstErr error
	for start := 0; start < len(tokens); start += chunkSize {
		end := min(start+chunkSize, len(tokens))
		chunk := tokens[start:end]
		payload, err := json.Marshal(message{To: chunk, Title: title, Body: body, Data: data})
		if err != nil {
			return dead, err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint(), bytes.NewReader(payload))
		if err != nil {
			return dead, err
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if resp.StatusCode >= 400 {
			if firstErr == nil {
				snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 300))
				firstErr = fmt.Errorf("expo push returned %s: %s", resp.Status, snippet)
			}
		} else {
			dead = append(dead, deadTokens(resp.Body, chunk)...)
		}
		resp.Body.Close()
	}
	return dead, firstErr
}

// deadTokens matches a chunk's tickets back to its tokens. A body that
// isn't the expected shape yields nothing: pruning is an optimisation,
// never a reason to fail a send.
func deadTokens(r io.Reader, chunk []string) []string {
	var out struct {
		Data []ticket `json:"data"`
	}
	if json.NewDecoder(io.LimitReader(r, 1<<20)).Decode(&out) != nil || len(out.Data) != len(chunk) {
		return nil
	}
	var dead []string
	for i, t := range out.Data {
		if t.Status == "error" && t.Details.Error == "DeviceNotRegistered" {
			dead = append(dead, chunk[i])
		}
	}
	return dead
}
