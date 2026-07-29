// Package osm maps Overpass API responses to court records.
package osm

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"unicode"
)

type Court struct {
	OSMType      string
	OSMID        int64
	Name         string
	Lat          float64
	Lng          float64
	HoopCount    *int16
	Indoor       bool
	Surface      *string
	Lighting     *bool
	Access       *string
	Fee          *bool
	FeeAmount    *int32 // minor units (cents), paired with FeeCurrency
	FeeCurrency  *string
	Covered      *bool
	OpeningHours *string
	Website      *string
	Description  *string
	Fenced       *bool
}

type overpassResponse struct {
	Elements []overpassElement `json:"elements"`
}

type overpassElement struct {
	Type   string            `json:"type"`
	ID     int64             `json:"id"`
	Lat    float64           `json:"lat"`
	Lon    float64           `json:"lon"`
	Center *struct {
		Lat float64 `json:"lat"`
		Lon float64 `json:"lon"`
	} `json:"center"`
	Tags map[string]string `json:"tags"`
}

// ParseCourts converts an Overpass JSON response ("out center tags" form)
// into court records. Elements without usable coordinates are skipped.
func ParseCourts(body []byte) ([]Court, error) {
	var resp overpassResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, err
	}
	courts := make([]Court, 0, len(resp.Elements))
	for _, el := range resp.Elements {
		lat, lng := el.Lat, el.Lon
		if el.Center != nil {
			lat, lng = el.Center.Lat, el.Center.Lon
		}
		if lat == 0 && lng == 0 {
			continue
		}
		feeAmount, feeCurrency := parseCharge(el.Tags)
		fee := parseYesNo(el.Tags["fee"])
		// A parseable price is itself proof of a fee, even where the fee=* tag
		// is missing — which it often is on courts that carry charge=*.
		if fee == nil && feeAmount != nil {
			charged := true
			fee = &charged
		}
		courts = append(courts, Court{
			OSMType:      el.Type,
			OSMID:        el.ID,
			Name:         courtName(el.Tags),
			Lat:          lat,
			Lng:          lng,
			HoopCount:    parseHoops(el.Tags["hoops"]),
			Indoor:       el.Tags["indoor"] == "yes" || el.Tags["covered"] == "yes",
			Surface:      mapSurface(el.Tags["surface"]),
			Lighting:     parseLit(el.Tags["lit"]),
			Access:       mapAccess(el.Tags["access"]),
			Fee:          fee,
			FeeAmount:    feeAmount,
			FeeCurrency:  feeCurrency,
			Covered:      parseYesNo(el.Tags["covered"]),
			OpeningHours: nonEmpty(el.Tags["opening_hours"], 200),
			Website:      website(el.Tags),
			Description:  nonEmpty(el.Tags["description"], 500),
			Fenced:       parseFenced(el.Tags),
		})
	}
	return courts, nil
}

func courtName(tags map[string]string) string {
	if name := strings.TrimSpace(tags["name"]); name != "" {
		return name
	}
	return "Basketball Court"
}

func parseHoops(v string) *int16 {
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || n < 1 || n > 50 {
		return nil
	}
	h := int16(n)
	return &h
}

// mapSurface maps OSM surface=* values onto our surface enum. Unknown
// surfaces map to nil rather than 'other' so crowd edits can fill them in.
func mapSurface(v string) *string {
	var s string
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "asphalt":
		s = "asphalt"
	case "concrete", "concrete:plates", "paved":
		s = "concrete"
	case "wood", "hardwood":
		s = "hardwood"
	case "rubber", "tartan", "acrylic":
		s = "rubber"
	case "":
		return nil
	default:
		return nil
	}
	return &s
}

// mapAccess collapses OSM access=* onto public/private/customers; uncommon
// values (permit, unknown, …) map to nil rather than guessing.
func mapAccess(v string) *string {
	var s string
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "yes", "public", "permissive":
		s = "public"
	case "private", "no":
		s = "private"
	case "customers", "members":
		s = "customers"
	default:
		return nil
	}
	return &s
}

func parseYesNo(v string) *bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "yes":
		b := true
		return &b
	case "no":
		b := false
		return &b
	default:
		return nil
	}
}

func nonEmpty(v string, maxLen int) *string {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	if len(v) > maxLen {
		v = v[:maxLen]
	}
	return &v
}

func website(tags map[string]string) *string {
	for _, key := range []string{"website", "contact:website", "url"} {
		if w := nonEmpty(tags[key], 300); w != nil &&
			(strings.HasPrefix(*w, "http://") || strings.HasPrefix(*w, "https://")) {
			return w
		}
	}
	return nil
}

// parseFenced reads either fenced=yes/no or barrier=fence on the pitch.
func parseFenced(tags map[string]string) *bool {
	if v := parseYesNo(tags["fenced"]); v != nil {
		return v
	}
	if tags["barrier"] == "fence" {
		b := true
		return &b
	}
	return nil
}

// zeroDecimalCurrencies have no minor unit, so their charge value is already
// in the smallest denomination and must not be multiplied by 100.
var zeroDecimalCurrencies = map[string]bool{
	"BIF": true, "CLP": true, "DJF": true, "GNF": true, "ISK": true,
	"JPY": true, "KMF": true, "KRW": true, "PYG": true, "RWF": true,
	"UGX": true, "UYI": true, "VND": true, "VUV": true, "XAF": true,
	"XOF": true, "XPF": true,
}

// symbolCurrencies maps the few symbols common in OSM charge=* values. Only
// unambiguous ones: "$" is deliberately absent, since it is as likely CAD or
// AUD as USD and a wrong currency is worse than no price at all.
var symbolCurrencies = map[string]string{
	"€":  "EUR",
	"£":  "GBP",
	"¥":  "JPY",
	"₩":  "KRW",
	"₹":  "INR",
	"₪":  "ILS",
	"zł": "PLN",
}

// parseCharge reads OSM's charge=* / fee:amount=* free-text price into minor
// units plus an ISO 4217 code — "5 USD", "2.50 EUR", "€3", "1000 JPY".
//
// Returns (nil, nil) unless BOTH an amount and a currency are recognized: an
// amount with no currency is unformattable, and the courts table rejects that
// pair anyway. Rates ("5 EUR/hour") keep the amount and lose the period, which
// the fee_note field carries separately when a player types one in.
func parseCharge(tags map[string]string) (*int32, *string) {
	for _, key := range []string{"charge", "fee:amount"} {
		raw := strings.TrimSpace(tags[key])
		if raw == "" {
			continue
		}
		// Drop any rate suffix so "5 EUR/hour" parses as "5 EUR".
		if i := strings.IndexByte(raw, '/'); i >= 0 {
			raw = strings.TrimSpace(raw[:i])
		}
		code := chargeCurrency(raw)
		if code == "" {
			continue
		}
		amount := chargeAmount(raw)
		if amount == nil {
			continue
		}
		// Zero-decimal currencies are already in their smallest unit.
		cents := *amount
		if !zeroDecimalCurrencies[code] {
			cents *= 100
		}
		rounded := math.Round(cents)
		if rounded < 0 || rounded > 1_000_000 {
			continue
		}
		c := int32(rounded)
		return &c, &code
	}
	return nil, nil
}

// chargeCurrency finds an ISO 4217 code or a known symbol in a charge value.
func chargeCurrency(raw string) string {
	for symbol, code := range symbolCurrencies {
		if strings.Contains(raw, symbol) {
			return code
		}
	}
	for _, field := range strings.FieldsFunc(raw, func(r rune) bool {
		return !unicode.IsLetter(r)
	}) {
		if len(field) == 3 {
			upper := strings.ToUpper(field)
			if isISOCurrencyCode(upper) {
				return upper
			}
		}
	}
	return ""
}

// isISOCurrencyCode accepts any three ASCII letters. The column's CHECK is the
// same shape: validating against the full ISO table would reject nothing OSM
// realistically carries while going stale every revision.
func isISOCurrencyCode(v string) bool {
	if len(v) != 3 {
		return false
	}
	for _, r := range v {
		if r < 'A' || r > 'Z' {
			return false
		}
	}
	return true
}

// chargeAmount pulls the first decimal number out of a charge value, in whole
// currency units ("2.50 EUR" -> 2.5). The caller applies the currency's
// exponent to reach minor units.
func chargeAmount(raw string) *float64 {
	start, end := -1, -1
	for i, r := range raw {
		if r >= '0' && r <= '9' || (r == '.' || r == ',') && start >= 0 {
			if start < 0 {
				start = i
			}
			end = i + 1
			continue
		}
		if start >= 0 {
			break
		}
	}
	if start < 0 {
		return nil
	}
	// Normalize a decimal comma ("2,50") to a point; a thousands separator
	// ("1,000") would misparse, so only a 1-2 digit tail counts as decimals.
	num := strings.TrimRight(raw[start:end], ".,")
	if i := strings.LastIndexAny(num, ".,"); i >= 0 {
		if tail := len(num) - i - 1; tail >= 1 && tail <= 2 {
			num = strings.ReplaceAll(num[:i], ",", "") + "." + num[i+1:]
		} else {
			num = strings.ReplaceAll(strings.ReplaceAll(num, ",", ""), ".", "")
		}
	}
	f, err := strconv.ParseFloat(num, 64)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) || f < 0 {
		return nil
	}
	return &f
}

func parseLit(v string) *bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "yes":
		b := true
		return &b
	case "no":
		b := false
		return &b
	default:
		return nil
	}
}
