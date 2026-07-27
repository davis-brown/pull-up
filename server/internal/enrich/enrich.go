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
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/davisbrown/pull-up/server/internal/geocode"
	"github.com/davisbrown/pull-up/server/internal/osm"
	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

const (
	userAgent      = "pull-up/0.1 (basketball court finder; github.com/davis-brown/pull-up)"
	courtesyDelay  = 1200 * time.Millisecond
	requestTimeout = 15 * time.Second
	maxPhotos      = 6
	// Commons geosearch radius: tight enough that photos are plausibly of
	// the court or its park, not the block over.
	photoRadiusM = 200

	// Mapillary: street-level imagery (CC BY-SA), queried by a bounding box
	// around the court. Kept to a handful so a busy street doesn't bury the
	// court's own photos.
	mapillaryAttribution = "© Mapillary contributors (CC BY-SA)"
	maxMapillaryPhotos   = 4
	// Half-width of the query box. bbox() spans ±this, so ~80m yields a ~160m
	// box — the largest that stays under Mapillary's per-query data limit even
	// in the densest cities (a 300m box is refused there). Sparser areas just
	// find fewer images in the smaller box.
	mapillaryRadiusM = 80
	// Error code Mapillary returns when a bbox would scan too many images
	// ("reduce the amount of data"); a smaller box can still succeed.
	mapillaryDataLimit = 1
	// Throttle for the "Mapillary is down" alert: a bad token rejects every
	// court, so paging on each would burn Sentry quota to say one thing.
	mapillaryOutageInterval = 15 * time.Minute
)

// Overridable in tests. Mapillary reports failures as an error object inside a
// 200 body, so the response must be inspected explicitly.
var mapillaryBaseURL = "https://graph.mapillary.com/images"

// Overridable in tests. Overpass endpoint for the per-court attribute backfill.
var overpassEndpoint = osm.DefaultOverpassEndpoint

const idlePoll = 30 * time.Second

type Enricher struct {
	queries *gen.Queries
	log     *slog.Logger
	client  *http.Client
	// mapillaryToken enables the Mapillary photo source; empty leaves it off.
	mapillaryToken string
	// mapillaryOutage throttles the Sentry alert for a rejecting Mapillary API.
	mapillaryOutage throttle
	// mu serializes enrichment so the in-process Run loop and a concurrent
	// /internal/drain call never hit Nominatim/Commons/Overpass at once —
	// the courtesy delays only space calls within a single serialized run.
	mu sync.Mutex
}

// throttle rate-limits a repeated alert. The zero value is ready to use and
// allows the first occurrence immediately.
type throttle struct {
	mu   sync.Mutex
	last time.Time
}

func (t *throttle) allow(now time.Time, every time.Duration) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.last.IsZero() && now.Sub(t.last) < every {
		return false
	}
	t.last = now
	return true
}

// mapillaryAPIError is an explicit rejection from the Graph API (bad/expired
// token, quota, bad params) — distinct from a network blip or the data-limit
// code, so callers can page on a persistent auth/quota problem while staying
// quiet on transient failures.
type mapillaryAPIError struct {
	code    int
	message string
}

func (e *mapillaryAPIError) Error() string {
	return fmt.Sprintf("mapillary api error %d: %s", e.code, e.message)
}

// reportMapillaryOutage pages when Mapillary is configured but rejecting
// requests (the same silent-failure class that once left the feature quietly
// off). Throttled and fingerprinted so repeated rejections group into one
// Sentry issue. No-op unless SENTRY_DSN was set at startup.
func (e *Enricher) reportMapillaryOutage(cause error) {
	if !e.mapillaryOutage.allow(time.Now(), mapillaryOutageInterval) {
		return
	}
	sentry.WithScope(func(scope *sentry.Scope) {
		scope.SetLevel(sentry.LevelError)
		scope.SetTag("subsystem", "court-enrichment")
		scope.SetTag("source", "mapillary")
		scope.SetContext("mapillary", sentry.Context{"cause": cause.Error()})
		scope.SetFingerprint([]string{"mapillary-unavailable"})
		sentry.CaptureMessage("mapillary photo enrichment rejected — check MAPILLARY_TOKEN")
	})
}

func New(queries *gen.Queries, log *slog.Logger, mapillaryToken string) *Enricher {
	return &Enricher{
		queries:        queries,
		log:            log,
		client:         &http.Client{Timeout: requestTimeout},
		mapillaryToken: mapillaryToken,
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
		addr, err := geocode.Default().Reverse(ctx, claim.Lat, claim.Lng)
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

	mapillary := 0
	if e.mapillaryToken != "" {
		select {
		case <-ctx.Done():
			return
		case <-time.After(courtesyDelay):
		}
		mphotos, err := e.mapillaryPhotos(ctx, claim.Lat, claim.Lng)
		if err != nil {
			// Best-effort: a Mapillary failure must not fail the court, or it
			// retries forever re-hitting Nominatim/Commons/Overpass. Commons
			// still carries the primary photo source.
			e.log.Warn("mapillary search", "court", claim.ID, "err", err)
			// A hard API rejection (bad/expired token, quota) is a silent
			// outage — page on it, throttled. Transient network blips fall
			// through as a plain warn.
			var apiErr *mapillaryAPIError
			if errors.As(err, &apiErr) {
				e.reportMapillaryOutage(err)
			}
		} else {
			mapillary = len(mphotos)
			for _, p := range mphotos {
				if err := e.queries.InsertExternalPhoto(ctx, gen.InsertExternalPhotoParams{
					CourtID: claim.ID, Source: "mapillary", SourceID: p.sourceID,
					ImageUrl: p.imageURL, PageUrl: p.pageURL, Attribution: p.attribution,
				}); err != nil {
					e.log.Error("insert external photo", "court", claim.ID, "err", err)
					succeeded = false
				}
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

	// Backfill court attributes (surface, lighting, hoops, …) from the court's
	// own OSM tags, for OSM-sourced courts that have an element to look up.
	// Best-effort like the photo sources: a transient Overpass failure logs but
	// must not fail the court, or a nice-to-have would trap it in retry.
	attrsFilled := false
	if claim.OsmType != nil && claim.OsmID != nil {
		select {
		case <-ctx.Done():
			return
		case <-time.After(courtesyDelay):
		}
		attrs, err := osm.FetchCourtElement(ctx, overpassEndpoint, *claim.OsmType, *claim.OsmID)
		if err != nil {
			e.log.Warn("overpass court attributes", "court", claim.ID, "err", err)
		} else if params, ok := attributeParams(claim.ID, attrs); ok {
			if err := e.queries.SetCourtAttributesIfNull(ctx, params); err != nil {
				e.log.Error("set court attributes", "court", claim.ID, "err", err)
				succeeded = false
			} else {
				attrsFilled = true
			}
		}
	}

	if ctx.Err() != nil || !succeeded {
		return
	}
	if err := e.queries.MarkCourtEnrichmentComplete(ctx, claim.ID); err != nil {
		e.log.Error("complete enrichment", "court", claim.ID, "err", err)
		return
	}
	e.log.Info("enriched court", "court", claim.ID, "needed_address", claim.NeedsAddress,
		"commons_photos", len(photos), "mapillary_photos", mapillary, "attributes", attrsFilled)

	select {
	case <-ctx.Done():
	case <-time.After(courtesyDelay):
	}
}

// attributeParams maps a court's parsed OSM tags onto the SetIfNull params,
// reporting whether any attribute is actually present. When nothing is set it
// returns ok=false so the caller skips a no-op UPDATE. indoor is only ever
// pushed as true (additive); a false OSM signal is left for ingest/crowd input.
func attributeParams(id uuid.UUID, c *osm.Court) (gen.SetCourtAttributesIfNullParams, bool) {
	if c == nil {
		return gen.SetCourtAttributesIfNullParams{}, false
	}
	p := gen.SetCourtAttributesIfNullParams{
		ID:           id,
		Surface:      c.Surface,
		Lighting:     c.Lighting,
		HoopCount:    c.HoopCount,
		Covered:      c.Covered,
		Access:       c.Access,
		Fee:          c.Fee,
		OpeningHours: c.OpeningHours,
		Fenced:       c.Fenced,
		Website:      c.Website,
		Description:  c.Description,
	}
	if c.Indoor {
		t := true
		p.Indoor = &t
	}
	has := p.Surface != nil || p.Lighting != nil || p.HoopCount != nil || p.Covered != nil ||
		p.Access != nil || p.Fee != nil || p.OpeningHours != nil || p.Fenced != nil ||
		p.Website != nil || p.Description != nil || p.Indoor != nil
	return p, has
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
	return e.doJSON(req, dst)
}

// doJSON executes an already-built request and decodes a JSON body, sharing
// the status check and response-size cap across all providers.
func (e *Enricher) doJSON(req *http.Request, dst any) error {
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

type mapillaryImage struct {
	sourceID    string
	imageURL    string
	pageURL     string
	attribution *string
}

type mapillaryResponse struct {
	Data []struct {
		ID           string `json:"id"`
		Thumb1024URL string `json:"thumb_1024_url"`
	} `json:"data"`
	Error *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// mapillaryPhotos returns up to maxMapillaryPhotos street-level images near the
// court. Requires a configured token. Dense cities exceed Mapillary's per-query
// data limit at the full radius, so it shrinks the box and retries once; if the
// smaller box is still refused it returns no photos rather than an error, since
// retrying will not help.
func (e *Enricher) mapillaryPhotos(ctx context.Context, lat, lng float64) ([]mapillaryImage, error) {
	for _, r := range []float64{mapillaryRadiusM, mapillaryRadiusM / 2} {
		resp, err := e.mapillaryQuery(ctx, lat, lng, r)
		if err != nil {
			return nil, err
		}
		if resp.Error != nil {
			if resp.Error.Code == mapillaryDataLimit {
				continue // box still too big; try the smaller one
			}
			return nil, &mapillaryAPIError{code: resp.Error.Code, message: resp.Error.Message}
		}
		return parseMapillary(resp), nil
	}
	return nil, nil
}

// mapillaryQuery performs one bounding-box image search of the given half-width.
func (e *Enricher) mapillaryQuery(ctx context.Context, lat, lng, radiusM float64) (mapillaryResponse, error) {
	minLng, minLat, maxLng, maxLat := bbox(lat, lng, radiusM)
	params := url.Values{
		"fields": {"id,thumb_1024_url"},
		"bbox":   {fmt.Sprintf("%f,%f,%f,%f", minLng, minLat, maxLng, maxLat)},
		"limit":  {fmt.Sprintf("%d", maxMapillaryPhotos)},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, mapillaryBaseURL+"?"+params.Encode(), nil)
	if err != nil {
		return mapillaryResponse{}, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Authorization", "OAuth "+e.mapillaryToken)

	var resp mapillaryResponse
	if err := e.doJSON(req, &resp); err != nil {
		return mapillaryResponse{}, err
	}
	return resp, nil
}

// parseMapillary maps a Graph API response to storable photos, dropping
// entries missing an id or thumbnail.
func parseMapillary(resp mapillaryResponse) []mapillaryImage {
	out := make([]mapillaryImage, 0, len(resp.Data))
	for _, img := range resp.Data {
		if img.ID == "" || img.Thumb1024URL == "" {
			continue
		}
		attr := mapillaryAttribution
		out = append(out, mapillaryImage{
			sourceID:    img.ID,
			imageURL:    img.Thumb1024URL,
			pageURL:     "https://www.mapillary.com/app/?pKey=" + img.ID,
			attribution: &attr,
		})
	}
	return out
}

// bbox returns a lon/lat bounding box of roughly radiusM metres around a point.
func bbox(lat, lng, radiusM float64) (minLng, minLat, maxLng, maxLat float64) {
	latDelta := radiusM / 111320.0
	lngDelta := radiusM / (111320.0 * math.Cos(lat*math.Pi/180))
	return lng - lngDelta, lat - latDelta, lng + lngDelta, lat + latDelta
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
