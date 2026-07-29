// Package moderation screens user-submitted text with Llama Guard on
// Cloudflare Workers AI.
//
// TEXT ONLY. Photo uploads are not covered here, nor by Cloudflare's CSAM
// Scanning Tool (court photos are served `private, no-store` and never enter
// the cache it hashes from). Photo moderation is the court_photos
// pending/flagged/removed state machine plus human review.
package moderation

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Model is the Workers AI content-safety classifier. Llama Guard emits
// "safe", or "unsafe" followed by the violated category codes.
const Model = "@cf/meta/llama-guard-3-8b"

// requestTimeout bounds how long a poster waits on the classifier.
const requestTimeout = 3 * time.Second

// maxTextBytes caps what is sent for classification; every guarded surface is
// already length-limited in the schema, so this only bounds a bad caller.
const maxTextBytes = 4000

// Verdict is the classifier's answer. Categories carries Llama Guard's
// violated-category codes (S1…S13) when Safe is false and is informational —
// the block decision is Safe alone.
type Verdict struct {
	Safe       bool
	Categories []string
}

// Client screens text. A zero Client (or one built with an empty token) is
// disabled and passes everything, so local dev and tests run without
// Cloudflare credentials.
type Client struct {
	accountID string
	token     string
	endpoint  string
	http      *http.Client
}

func New(accountID, token string) *Client {
	return &Client{
		accountID: accountID,
		token:     token,
		http:      &http.Client{Timeout: requestTimeout},
	}
}

// WithEndpoint overrides the API base, for tests.
func (c *Client) WithEndpoint(endpoint string) *Client {
	c.endpoint = endpoint
	return c
}

// Enabled reports whether the client will actually classify anything.
func (c *Client) Enabled() bool {
	return c != nil && c.accountID != "" && c.token != ""
}

type aiRequest struct {
	Messages []aiMessage `json:"messages"`
}

type aiMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type aiResponse struct {
	Success bool `json:"success"`
	Result  struct {
		Response string `json:"response"`
	} `json:"result"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

// Check classifies text.
//
// FAIL-OPEN: any transport error, timeout, or unparseable response returns a
// safe verdict together with the error, so callers can log it. A disabled
// client returns safe with no error.
func (c *Client) Check(ctx context.Context, text string) (Verdict, error) {
	if !c.Enabled() {
		return Verdict{Safe: true}, nil
	}
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return Verdict{Safe: true}, nil
	}
	if len(trimmed) > maxTextBytes {
		trimmed = trimmed[:maxTextBytes]
	}

	body, err := json.Marshal(aiRequest{Messages: []aiMessage{{Role: "user", Content: trimmed}}})
	if err != nil {
		return Verdict{Safe: true}, err
	}

	endpoint := c.endpoint
	if endpoint == "" {
		endpoint = fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/ai/run/%s", c.accountID, Model)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return Verdict{Safe: true}, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return Verdict{Safe: true}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Verdict{Safe: true}, fmt.Errorf("workers ai returned %s", resp.Status)
	}
	var parsed aiResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return Verdict{Safe: true}, err
	}
	if !parsed.Success {
		msg := "unknown error"
		if len(parsed.Errors) > 0 {
			msg = parsed.Errors[0].Message
		}
		return Verdict{Safe: true}, fmt.Errorf("workers ai: %s", msg)
	}
	return parseVerdict(parsed.Result.Response), nil
}

// parseVerdict reads Llama Guard's output: "safe", or "unsafe" on the first
// line followed by comma-separated category codes on the next. Anything
// unrecognised is treated as SAFE, per the fail-open stance.
func parseVerdict(raw string) Verdict {
	lines := strings.Split(strings.TrimSpace(strings.ToLower(raw)), "\n")
	if len(lines) == 0 {
		return Verdict{Safe: true}
	}
	switch strings.TrimSpace(lines[0]) {
	case "unsafe":
		var categories []string
		if len(lines) > 1 {
			for _, code := range strings.Split(lines[1], ",") {
				if code = strings.TrimSpace(strings.ToUpper(code)); code != "" {
					categories = append(categories, code)
				}
			}
		}
		return Verdict{Safe: false, Categories: categories}
	default:
		return Verdict{Safe: true}
	}
}
