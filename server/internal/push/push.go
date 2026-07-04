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
	"time"
)

const endpoint = "https://exp.host/--/api/v2/push/send"
const chunkSize = 100

type message struct {
	To    []string          `json:"to"`
	Title string            `json:"title"`
	Body  string            `json:"body"`
	Data  map[string]string `json:"data,omitempty"`
}

// Send delivers a notification to the given Expo push tokens, chunked per
// Expo's API limits. Best-effort: returns the first error but attempts all
// chunks.
func Send(ctx context.Context, tokens []string, title, body string, data map[string]string) error {
	client := &http.Client{Timeout: 15 * time.Second}
	var firstErr error
	for start := 0; start < len(tokens); start += chunkSize {
		end := min(start+chunkSize, len(tokens))
		payload, err := json.Marshal(message{To: tokens[start:end], Title: title, Body: body, Data: data})
		if err != nil {
			return err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if resp.StatusCode >= 400 && firstErr == nil {
			snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 300))
			firstErr = fmt.Errorf("expo push returned %s: %s", resp.Status, snippet)
		}
		resp.Body.Close()
	}
	return firstErr
}
