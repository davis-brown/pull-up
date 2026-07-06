// Package enrich lazily augments courts with data from free services:
// a reverse-geocoded address from Nominatim and openly-licensed photos
// from Wikimedia Commons. Both are shared community services, so a single
// worker processes courts one at a time with courtesy delays, and each
// court is attempted exactly once (courts.enriched_at is the claim).
package enrich

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

const (
	userAgent      = "pull-up/0.1 (basketball court finder; github.com/davis-brown/pull-up)"
	courtesyDelay  = 1200 * time.Millisecond
	requestTimeout = 15 * time.Second
	maxPhotos      = 4
	// Commons geosearch radius: tight enough that photos are plausibly of
	// the court or its park, not the block over.
	photoRadiusM = 120
)

type Enricher struct {
	queries *gen.Queries
	log     *slog.Logger
	client  *http.Client
	queue   chan uuid.UUID
}

func New(queries *gen.Queries, log *slog.Logger) *Enricher {
	return &Enricher{
		queries: queries,
		log:     log,
		client:  &http.Client{Timeout: requestTimeout},
		queue:   make(chan uuid.UUID, 256),
	}
}

// Request enqueues a court for enrichment. Non-blocking: when the queue is
// full the request is dropped — the next detail view will re-enqueue it.
func (e *Enricher) Request(id uuid.UUID) {
	select {
	case e.queue <- id:
	default:
	}
}

func (e *Enricher) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case id := <-e.queue:
			e.enrich(ctx, id)
		}
	}
}

func (e *Enricher) enrich(ctx context.Context, id uuid.UUID) {
	claim, err := e.queries.ClaimCourtEnrichment(ctx, id)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			e.log.Error("claim enrichment", "court", id, "err", err)
		}
		return // already enriched or gone
	}

	if claim.NeedsAddress {
		if addr := e.reverseGeocode(ctx, claim.Lat, claim.Lng); addr != "" {
			if err := e.queries.SetCourtAddressIfNull(ctx, gen.SetCourtAddressIfNullParams{
				ID: id, Address: &addr,
			}); err != nil {
				e.log.Error("set address", "court", id, "err", err)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(courtesyDelay):
		}
	}

	photos := e.commonsPhotos(ctx, claim.Lat, claim.Lng)
	for _, p := range photos {
		if err := e.queries.InsertExternalPhoto(ctx, gen.InsertExternalPhotoParams{
			CourtID: id, Source: "commons", SourceID: p.sourceID,
			ImageUrl: p.imageURL, PageUrl: p.pageURL, Attribution: p.attribution,
		}); err != nil {
			e.log.Error("insert external photo", "court", id, "err", err)
		}
	}
	e.log.Info("enriched court", "court", id, "needed_address", claim.NeedsAddress, "photos", len(photos))

	select {
	case <-ctx.Done():
	case <-time.After(courtesyDelay):
	}
}

func (e *Enricher) getJSON(ctx context.Context, rawURL string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := e.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 200))
		return fmt.Errorf("%s: %s", resp.Status, snippet)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(dst)
}

// --- Nominatim ------------------------------------------------------------

type nominatimResponse struct {
	Address map[string]string `json:"address"`
}

// reverseGeocode returns a short "street, locality" address, or "".
func (e *Enricher) reverseGeocode(ctx context.Context, lat, lng float64) string {
	u := fmt.Sprintf(
		"https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=%f&lon=%f&zoom=17&addressdetails=1",
		lat, lng)
	var resp nominatimResponse
	if err := e.getJSON(ctx, u, &resp); err != nil {
		e.log.Warn("nominatim reverse", "err", err)
		return ""
	}
	a := resp.Address
	first := func(keys ...string) string {
		for _, k := range keys {
			if v := strings.TrimSpace(a[k]); v != "" {
				return v
			}
		}
		return ""
	}
	street := first("road", "pedestrian", "footway", "path")
	if house := first("house_number"); house != "" && street != "" {
		street = house + " " + street
	}
	locality := first("neighbourhood", "suburb", "city_district", "city", "town", "village", "hamlet")
	switch {
	case street != "" && locality != "":
		return street + ", " + locality
	case street != "":
		return street
	default:
		return locality
	}
}

// --- Wikimedia Commons ----------------------------------------------------

type commonsPhoto struct {
	sourceID    string
	imageURL    string
	pageURL     string
	attribution *string
}

type commonsResponse struct {
	Query struct {
		Pages map[string]struct {
			PageID    int64  `json:"pageid"`
			Title     string `json:"title"`
			ImageInfo []struct {
				ThumbURL       string `json:"thumburl"`
				DescriptionURL string `json:"descriptionurl"`
				Mime           string `json:"mime"`
				ExtMetadata    map[string]struct {
					Value string `json:"value"`
				} `json:"extmetadata"`
			} `json:"imageinfo"`
		} `json:"pages"`
	} `json:"query"`
}

var htmlTags = regexp.MustCompile(`<[^>]*>`)

func (e *Enricher) commonsPhotos(ctx context.Context, lat, lng float64) []commonsPhoto {
	params := url.Values{
		"action":       {"query"},
		"format":       {"json"},
		"generator":    {"geosearch"},
		"ggscoord":     {fmt.Sprintf("%f|%f", lat, lng)},
		"ggsradius":    {fmt.Sprintf("%d", photoRadiusM)},
		"ggslimit":     {"10"},
		"ggsnamespace": {"6"}, // File:
		"prop":         {"imageinfo"},
		"iiprop":       {"url|mime|extmetadata"},
		"iiurlwidth":   {"800"},
	}
	var resp commonsResponse
	if err := e.getJSON(ctx, "https://commons.wikimedia.org/w/api.php?"+params.Encode(), &resp); err != nil {
		e.log.Warn("commons geosearch", "err", err)
		return nil
	}
	out := make([]commonsPhoto, 0, maxPhotos)
	for _, page := range resp.Query.Pages {
		if len(out) >= maxPhotos || len(page.ImageInfo) == 0 {
			continue
		}
		info := page.ImageInfo[0]
		if info.ThumbURL == "" || !strings.HasPrefix(info.Mime, "image/") {
			continue
		}
		var attribution *string
		artist := strings.TrimSpace(htmlTags.ReplaceAllString(info.ExtMetadata["Artist"].Value, ""))
		license := strings.TrimSpace(info.ExtMetadata["LicenseShortName"].Value)
		if artist != "" || license != "" {
			s := strings.TrimSpace(strings.Trim(artist+" · "+license, " ·"))
			if len(s) > 200 {
				s = s[:200]
			}
			attribution = &s
		}
		out = append(out, commonsPhoto{
			sourceID:    fmt.Sprintf("%d", page.PageID),
			imageURL:    info.ThumbURL,
			pageURL:     info.DescriptionURL,
			attribution: attribution,
		})
	}
	return out
}
