// Package osm maps Overpass API responses to court records.
package osm

import (
	"encoding/json"
	"strconv"
	"strings"
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
	Covered      *bool
	OpeningHours *string
	Website      *string
	Description  *string
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
			Fee:          parseYesNo(el.Tags["fee"]),
			Covered:      parseYesNo(el.Tags["covered"]),
			OpeningHours: nonEmpty(el.Tags["opening_hours"], 200),
			Website:      website(el.Tags),
			Description:  nonEmpty(el.Tags["description"], 500),
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
