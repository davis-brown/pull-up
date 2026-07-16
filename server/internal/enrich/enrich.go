// Package enrich lazily augments courts with data from free services:
// a reverse-geocoded address from Nominatim and openly-licensed photos
// from Wikimedia Commons. Both are shared community services, so a single
// worker processes courts one at a time with courtesy delays. Claims are
// leased so interrupted or transiently failed work can be retried.
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
	"sync"
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

const idlePoll = 30 * time.Second

type Enricher struct {
	queries *gen.Queries
	log     *slog.Logger
	client  *http.Client
	// mu serializes enrichment so the in-process Run loop and a concurrent
	// /internal/drain call never hit Nominatim/Commons/Overpass at once —
	// the courtesy delays only space calls within a single serialized run.
	mu sync.Mutex
}

func New(queries *gen.Queries, log *slog.Logger) *Enricher {
	return &Enricher{
		queries: queries,
		log:     log,
		client:  &http.Client{Timeout: requestTimeout},
	}
}

// Request durably (and lazily) marks a viewed court for enrichment. The short
// database write stays bound to the triggering HTTP request; no goroutine is
// created per public read.
func (e *Enricher) Request(ctx context.Context, id uuid.UUID) {
	if err := e.queries.RequestEnrichment(ctx, id); err != nil {
		e.log.Error("request enrichment", "court", id, "err", err)
	}
}

// DrainOnce claims and enriches the next requested court; reports if it worked.
func (e *Enricher) DrainOnce(ctx context.Context) bool {
	if !e.mu.TryLock() {
		return false
	}
	defer e.mu.Unlock()
	claim, err := e.queries.ClaimNextCourtEnrichment(ctx)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			e.log.Error("claim next enrichment", "err", err)
		}
		return false
	}
	e.enrichClaimed(ctx, claim)
	return true
}

func (e *Enricher) Run(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			return
		}
		if e.DrainOnce(ctx) {
			continue // enrichClaimed already spaces its own Overpass/Nominatim calls
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(idlePoll):
		}
	}
}

func (e *Enricher) enrichClaimed(ctx context.Context, claim gen.ClaimNextCourtEnrichmentRow) {
	succeeded := true
	if claim.NeedsAddress {
		addr, err := e.reverseGeocode(ctx, claim.Lat, claim.Lng)
		if err != nil {
			e.log.Warn("nominatim reverse", "court", claim.ID, "err", err)
			succeeded = false
		} else if addr != "" {
			if err := e.queries.SetCourtAddressIfNull(ctx, gen.SetCourtAddressIfNullParams{
				ID: claim.ID, Address: &addr,
			}); err != nil {
				e.log.Error("set address", "court", claim.ID, "err", err)
				succeeded = false
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(courtesyDelay):
		}
	}

	photos, err := e.commonsPhotos(ctx, claim.Lat, claim.Lng)
	if err != nil {
		e.log.Warn("commons geosearch", "court", claim.ID, "err", err)
		succeeded = false
	} else {
		for _, p := range photos {
			if err := e.queries.InsertExternalPhoto(ctx, gen.InsertExternalPhotoParams{
				CourtID: claim.ID, Source: "commons", SourceID: p.sourceID,
				ImageUrl: p.imageURL, PageUrl: p.pageURL, Attribution: p.attribution,
			}); err != nil {
				e.log.Error("insert external photo", "court", claim.ID, "err", err)
				succeeded = false
			}
		}
	}

	water, toilets, parking, err := e.nearbyAmenities(ctx, claim.Lat, claim.Lng)
	if err != nil {
		e.log.Warn("overpass amenities", "court", claim.ID, "err", err)
		succeeded = false
	} else if water || toilets || parking {
		wp, tp, pp := boolPtrIfTrue(water), boolPtrIfTrue(toilets), boolPtrIfTrue(parking)
		if err := e.queries.SetCourtAmenitiesIfNull(ctx, gen.SetCourtAmenitiesIfNullParams{
			ID: claim.ID, DrinkingWater: wp, Toilets: tp, Parking: pp,
		}); err != nil {
			e.log.Error("set amenities", "court", claim.ID, "err", err)
			succeeded = false
		}
	}
	if ctx.Err() != nil || !succeeded {
		return
	}
	if err := e.queries.MarkCourtEnrichmentComplete(ctx, claim.ID); err != nil {
		e.log.Error("complete enrichment", "court", claim.ID, "err", err)
		return
	}
	e.log.Info("enriched court", "court", claim.ID, "needed_address", claim.NeedsAddress, "photos", len(photos))

	select {
	case <-ctx.Done():
	case <-time.After(courtesyDelay):
	}
}

func boolPtrIfTrue(b bool) *bool {
	if b {
		return &b
	}
	return nil
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

type nominatimResponse struct {
	Address map[string]string `json:"address"`
}

// reverseGeocode returns a short "street, locality" address, or "" when the
// provider successfully reports no useful address.
func (e *Enricher) reverseGeocode(ctx context.Context, lat, lng float64) (string, error) {
	u := fmt.Sprintf(
		"https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=%f&lon=%f&zoom=17&addressdetails=1",
		lat, lng)
	var resp nominatimResponse
	if err := e.getJSON(ctx, u, &resp); err != nil {
		return "", err
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
		return street + ", " + locality, nil
	case street != "":
		return street, nil
	default:
		return locality, nil
	}
}

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
				// Values are usually strings but can be numbers — keep
				// the type loose or the whole response fails to decode.
				ExtMetadata map[string]struct {
					Value any `json:"value"`
				} `json:"extmetadata"`
			} `json:"imageinfo"`
		} `json:"pages"`
	} `json:"query"`
}

var htmlTags = regexp.MustCompile(`<[^>]*>`)

func (e *Enricher) commonsPhotos(ctx context.Context, lat, lng float64) ([]commonsPhoto, error) {
	params := url.Values{
		"action":              {"query"},
		"format":              {"json"},
		"generator":           {"geosearch"},
		"ggscoord":            {fmt.Sprintf("%f|%f", lat, lng)},
		"ggsradius":           {fmt.Sprintf("%d", photoRadiusM)},
		"ggslimit":            {"10"},
		"ggsnamespace":        {"6"}, // File:
		"prop":                {"imageinfo"},
		"iiprop":              {"url|mime|extmetadata"},
		"iiextmetadatafilter": {"Artist|LicenseShortName"},
		"iiurlwidth":          {"800"},
	}
	var resp commonsResponse
	if err := e.getJSON(ctx, "https://commons.wikimedia.org/w/api.php?"+params.Encode(), &resp); err != nil {
		return nil, err
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
		metaString := func(key string) string {
			s, _ := info.ExtMetadata[key].Value.(string)
			return s
		}
		var attribution *string
		artist := strings.TrimSpace(htmlTags.ReplaceAllString(metaString("Artist"), ""))
		license := strings.TrimSpace(metaString("LicenseShortName"))
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
	return out, nil
}

type overpassElement struct {
	Tags map[string]string `json:"tags"`
}
type overpassResponse struct {
	Elements []overpassElement `json:"elements"`
}

// parseOverpassAmenities reports which of water/toilets/parking appear.
func parseOverpassAmenities(els []overpassElement) (water, toilets, parking bool) {
	for _, e := range els {
		switch e.Tags["amenity"] {
		case "drinking_water":
			water = true
		case "toilets":
			toilets = true
		case "parking":
			parking = true
		}
	}
	return
}

// nearbyAmenities queries Overpass for water/toilets/parking within ~150 m.
func (e *Enricher) nearbyAmenities(ctx context.Context, lat, lng float64) (water, toilets, parking bool, err error) {
	q := fmt.Sprintf(
		`[out:json][timeout:20];(nwr[amenity=drinking_water](around:150,%f,%f);nwr[amenity=toilets](around:150,%f,%f);nwr[amenity=parking](around:150,%f,%f););out tags;`,
		lat, lng, lat, lng, lat, lng)
	var resp overpassResponse
	if err := e.getJSON(ctx, "https://overpass-api.de/api/interpreter?data="+url.QueryEscape(q), &resp); err != nil {
		return false, false, false, err
	}
	water, toilets, parking = parseOverpassAmenities(resp.Elements)
	return water, toilets, parking, nil
}
