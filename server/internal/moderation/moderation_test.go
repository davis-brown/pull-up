package moderation

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParseVerdict(t *testing.T) {
	cases := []struct {
		name           string
		raw            string
		wantSafe       bool
		wantCategories []string
	}{
		{name: "plain safe", raw: "safe", wantSafe: true},
		{name: "safe with whitespace", raw: "\n safe \n", wantSafe: true},
		{
			name: "unsafe carries its categories",
			raw:  "unsafe\nS1,S10",
			// Codes are upper-cased back out so they match Llama Guard's
			// published taxonomy in logs.
			wantSafe: false, wantCategories: []string{"S1", "S10"},
		},
		{name: "unsafe without categories still blocks", raw: "unsafe", wantSafe: false},
		{name: "unsafe with spaced categories", raw: "unsafe\n S3 , S4 ", wantSafe: false, wantCategories: []string{"S3", "S4"}},
		// Fail-open: an unrecognised completion is a broken classifier, not
		// evidence against the user.
		{name: "garbage is treated as safe", raw: "I'm sorry, I can't help with that", wantSafe: true},
		{name: "empty is treated as safe", raw: "", wantSafe: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseVerdict(tc.raw)
			if got.Safe != tc.wantSafe {
				t.Errorf("Safe = %v, want %v (raw %q)", got.Safe, tc.wantSafe, tc.raw)
			}
			if len(got.Categories) != len(tc.wantCategories) {
				t.Fatalf("Categories = %v, want %v", got.Categories, tc.wantCategories)
			}
			for i := range tc.wantCategories {
				if got.Categories[i] != tc.wantCategories[i] {
					t.Errorf("Categories[%d] = %q, want %q", i, got.Categories[i], tc.wantCategories[i])
				}
			}
		})
	}
}

func TestDisabledClientPassesEverything(t *testing.T) {
	var c *Client
	v, err := c.Check(context.Background(), "anything at all")
	if err != nil || !v.Safe {
		t.Errorf("nil client: verdict %+v err %v, want safe and no error", v, err)
	}
	if New("", "").Enabled() {
		t.Error("a client with no credentials reports Enabled")
	}
}

func TestCheckBlocksUnsafe(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer tok" {
			t.Errorf("Authorization = %q, want bearer token", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"result":{"response":"unsafe\nS1"}}`))
	}))
	defer srv.Close()

	v, err := New("acct", "tok").WithEndpoint(srv.URL).Check(context.Background(), "something vile")
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if v.Safe {
		t.Error("verdict is safe, want blocked")
	}
	if len(v.Categories) != 1 || v.Categories[0] != "S1" {
		t.Errorf("Categories = %v, want [S1]", v.Categories)
	}
}

// The whole point of fail-open: a classifier outage must not stop people
// posting. Each of these returns an error AND a safe verdict.
func TestCheckFailsOpen(t *testing.T) {
	cases := []struct {
		name    string
		handler http.HandlerFunc
	}{
		{"upstream 500", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusInternalServerError) }},
		{"success false", func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(`{"success":false,"errors":[{"message":"quota"}]}`))
		}},
		{"unparseable body", func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(`not json`))
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(tc.handler)
			defer srv.Close()
			v, err := New("acct", "tok").WithEndpoint(srv.URL).Check(context.Background(), "hello")
			if err == nil {
				t.Error("want an error so the caller logs the outage")
			}
			if !v.Safe {
				t.Error("verdict blocks on an outage; moderation must fail open")
			}
		})
	}
}

func TestCheckSkipsEmptyText(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("classifier called for whitespace-only text")
	}))
	defer srv.Close()
	v, err := New("acct", "tok").WithEndpoint(srv.URL).Check(context.Background(), "   \n ")
	if err != nil || !v.Safe {
		t.Errorf("verdict %+v err %v, want safe with no call", v, err)
	}
}
