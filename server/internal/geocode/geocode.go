// Package geocode provides courtesy-limited Nominatim forward and reverse
// geocoding. Explicit searches are cached in-process and never run per keystroke.
package geocode

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultBaseURL = "https://nominatim.openstreetmap.org"
	userAgent      = "pull-up/0.1 (basketball court finder; github.com/davis-brown/pull-up)"
	maxBody        = 4 << 20
	maxCacheItems  = 256
)

type Options struct {
	BaseURL string
	Client  *http.Client
	Delay   time.Duration
}

type Area struct {
	Name string     `json:"name"`
	Lat  float64    `json:"lat"`
	Lng  float64    `json:"lng"`
	BBox [4]float64 `json:"bbox"`
	Type string     `json:"type"`
}

type Client struct {
	baseURL string
	client  *http.Client
	delay   time.Duration

	mu      sync.Mutex
	last    time.Time
	cache   map[string][]Area
	cacheAt []string
}

func New(opts Options) *Client {
	baseURL := strings.TrimRight(opts.BaseURL, "/")
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	client := opts.Client
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	delay := opts.Delay
	if delay == 0 && baseURL == defaultBaseURL {
		delay = time.Second
	}
	return &Client{baseURL: baseURL, client: client, delay: delay, cache: make(map[string][]Area)}
}

var (
	defaultOnce   sync.Once
	defaultClient *Client
)

func Default() *Client {
	defaultOnce.Do(func() { defaultClient = New(Options{}) })
	return defaultClient
}

type searchResult struct {
	DisplayName string   `json:"display_name"`
	Lat         string   `json:"lat"`
	Lon         string   `json:"lon"`
	BoundingBox []string `json:"boundingbox"`
	Type        string   `json:"addresstype"`
}

func (c *Client) Search(ctx context.Context, query string, biasLat, biasLng *float64) ([]Area, error) {
	key := strings.ToLower(strings.Join(strings.Fields(query), " "))
	if biasLat != nil && biasLng != nil {
		key += fmt.Sprintf("|%.1f,%.1f", *biasLat, *biasLng)
	}
	// Explicit user searches should never pile up behind the one-request-per-
	// second provider limit. The API can still return local court matches.
	if !c.mu.TryLock() {
		return nil, fmt.Errorf("geocoder busy")
	}
	defer c.mu.Unlock()
	if cached, ok := c.cache[key]; ok {
		return append([]Area(nil), cached...), nil
	}
	if err := c.wait(ctx); err != nil {
		return nil, err
	}
	params := url.Values{"q": {query}, "format": {"jsonv2"}, "limit": {"5"}, "addressdetails": {"0"}}
	if biasLat != nil && biasLng != nil {
		// Bias results without disclosing a precise device/map center upstream.
		lat := math.Round(*biasLat*10) / 10
		lng := math.Round(*biasLng*10) / 10
		params.Set("viewbox", fmt.Sprintf("%f,%f,%f,%f", lng-2, lat+2, lng+2, lat-2))
	}
	var raw []searchResult
	if err := c.getJSON(ctx, c.baseURL+"/search?"+params.Encode(), &raw); err != nil {
		return nil, err
	}
	out := make([]Area, 0, len(raw))
	for _, result := range raw {
		lat, errLat := strconv.ParseFloat(result.Lat, 64)
		lng, errLng := strconv.ParseFloat(result.Lon, 64)
		if errLat != nil || errLng != nil || !validLatLng(lat, lng) || len(result.BoundingBox) != 4 {
			continue
		}
		south, e0 := strconv.ParseFloat(result.BoundingBox[0], 64)
		north, e1 := strconv.ParseFloat(result.BoundingBox[1], 64)
		west, e2 := strconv.ParseFloat(result.BoundingBox[2], 64)
		east, e3 := strconv.ParseFloat(result.BoundingBox[3], 64)
		if e0 != nil || e1 != nil || e2 != nil || e3 != nil || !validLatLng(south, west) ||
			!validLatLng(north, east) || west >= east || south >= north || strings.TrimSpace(result.DisplayName) == "" {
			continue
		}
		out = append(out, Area{Name: result.DisplayName, Lat: lat, Lng: lng, BBox: [4]float64{west, south, east, north}, Type: result.Type})
	}
	c.putCache(key, out)
	return append([]Area(nil), out...), nil
}

type reverseResult struct {
	Address map[string]string `json:"address"`
}

func (c *Client) Reverse(ctx context.Context, lat, lng float64) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.wait(ctx); err != nil {
		return "", err
	}
	params := url.Values{
		"format": {"jsonv2"}, "lat": {strconv.FormatFloat(lat, 'f', 6, 64)},
		"lon": {strconv.FormatFloat(lng, 'f', 6, 64)}, "zoom": {"17"}, "addressdetails": {"1"},
	}
	var result reverseResult
	if err := c.getJSON(ctx, c.baseURL+"/reverse?"+params.Encode(), &result); err != nil {
		return "", err
	}
	first := func(keys ...string) string {
		for _, key := range keys {
			if value := strings.TrimSpace(result.Address[key]); value != "" {
				return value
			}
		}
		return ""
	}
	street := first("road", "pedestrian", "footway", "path")
	if house := first("house_number"); house != "" && street != "" {
		street = house + " " + street
	}
	locality := first("neighbourhood", "suburb", "city_district", "city", "town", "village", "hamlet")
	if street != "" && locality != "" {
		return street + ", " + locality, nil
	}
	if street != "" {
		return street, nil
	}
	return locality, nil
}

func (c *Client) wait(ctx context.Context) error {
	if remaining := c.delay - time.Since(c.last); !c.last.IsZero() && remaining > 0 {
		timer := time.NewTimer(remaining)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
		}
	}
	c.last = time.Now()
	return nil
}

func (c *Client) getJSON(ctx context.Context, rawURL string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 200))
		return fmt.Errorf("%s: %s", resp.Status, snippet)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, maxBody)).Decode(dst)
}

func (c *Client) putCache(key string, areas []Area) {
	if len(c.cacheAt) == maxCacheItems {
		delete(c.cache, c.cacheAt[0])
		c.cacheAt = c.cacheAt[1:]
	}
	c.cache[key] = append([]Area(nil), areas...)
	c.cacheAt = append(c.cacheAt, key)
}

func validLatLng(lat, lng float64) bool {
	return !math.IsNaN(lat) && !math.IsInf(lat, 0) && !math.IsNaN(lng) && !math.IsInf(lng, 0) &&
		lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}
