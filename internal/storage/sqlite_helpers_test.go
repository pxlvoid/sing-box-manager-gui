package storage

import (
	"testing"
	"time"
)

func TestGetAllNodes_UsesSuccessfulGeoCountry(t *testing.T) {
	store, err := NewSQLiteStore(t.TempDir())
	if err != nil {
		t.Fatalf("create sqlite store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if _, err := store.AddNode(UnifiedNode{
		Tag:          "node-geo-success",
		InternalTag:  "node-geo-success",
		DisplayName:  "node-geo-success",
		SourceTag:    "node-geo-success",
		Type:         "vmess",
		Server:       "1.1.1.1",
		ServerPort:   443,
		Country:      "US",
		CountryEmoji: GetCountryEmoji("US"),
		Status:       NodeStatusVerified,
	}); err != nil {
		t.Fatalf("insert verified node: %v", err)
	}

	if err := store.UpsertGeoData(GeoData{
		Server:      "1.1.1.1",
		ServerPort:  443,
		NodeTag:     "node-geo-success",
		Timestamp:   time.Now(),
		Status:      "success",
		Country:     "Japan",
		CountryCode: "jp",
	}); err != nil {
		t.Fatalf("upsert geo data: %v", err)
	}

	nodes := store.GetAllNodes()
	if len(nodes) != 1 {
		t.Fatalf("expected 1 node, got %d", len(nodes))
	}
	if nodes[0].Country != "JP" {
		t.Fatalf("country mismatch: got %q, want %q", nodes[0].Country, "JP")
	}
	if nodes[0].CountryEmoji != GetCountryEmoji("JP") {
		t.Fatalf("country emoji mismatch: got %q, want %q", nodes[0].CountryEmoji, GetCountryEmoji("JP"))
	}
}

func TestGetAllNodes_IgnoresFailedGeoCountry(t *testing.T) {
	store, err := NewSQLiteStore(t.TempDir())
	if err != nil {
		t.Fatalf("create sqlite store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if _, err := store.AddNode(UnifiedNode{
		Tag:          "node-geo-fail",
		InternalTag:  "node-geo-fail",
		DisplayName:  "node-geo-fail",
		SourceTag:    "node-geo-fail",
		Type:         "vmess",
		Server:       "2.2.2.2",
		ServerPort:   443,
		Country:      "SG",
		CountryEmoji: GetCountryEmoji("SG"),
		Status:       NodeStatusVerified,
	}); err != nil {
		t.Fatalf("insert verified node: %v", err)
	}

	if err := store.UpsertGeoData(GeoData{
		Server:      "2.2.2.2",
		ServerPort:  443,
		NodeTag:     "node-geo-fail",
		Timestamp:   time.Now(),
		Status:      "fail",
		Country:     "Unknown",
		CountryCode: "UNKNOWN",
	}); err != nil {
		t.Fatalf("upsert geo data: %v", err)
	}

	nodes := store.GetAllNodes()
	if len(nodes) != 1 {
		t.Fatalf("expected 1 node, got %d", len(nodes))
	}
	if nodes[0].Country != "SG" {
		t.Fatalf("country mismatch: got %q, want %q", nodes[0].Country, "SG")
	}
	if nodes[0].CountryEmoji != GetCountryEmoji("SG") {
		t.Fatalf("country emoji mismatch: got %q, want %q", nodes[0].CountryEmoji, GetCountryEmoji("SG"))
	}
}

func TestGetNodesByCountry_UsesGeoCountry(t *testing.T) {
	store, err := NewSQLiteStore(t.TempDir())
	if err != nil {
		t.Fatalf("create sqlite store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if _, err := store.AddNode(UnifiedNode{
		Tag:          "node-country-filter",
		InternalTag:  "node-country-filter",
		DisplayName:  "node-country-filter",
		SourceTag:    "node-country-filter",
		Type:         "vmess",
		Server:       "3.3.3.3",
		ServerPort:   443,
		Country:      "US",
		CountryEmoji: GetCountryEmoji("US"),
		Status:       NodeStatusVerified,
	}); err != nil {
		t.Fatalf("insert verified node: %v", err)
	}

	if err := store.UpsertGeoData(GeoData{
		Server:      "3.3.3.3",
		ServerPort:  443,
		NodeTag:     "node-country-filter",
		Timestamp:   time.Now(),
		Status:      "success",
		Country:     "Germany",
		CountryCode: "DE",
	}); err != nil {
		t.Fatalf("upsert geo data: %v", err)
	}

	nodes := store.GetNodesByCountry("de")
	if len(nodes) != 1 {
		t.Fatalf("expected 1 node, got %d", len(nodes))
	}
	if nodes[0].Country != "DE" {
		t.Fatalf("country mismatch: got %q, want %q", nodes[0].Country, "DE")
	}
}

func TestGetCountryGroups_UsesGeoCountry(t *testing.T) {
	store, err := NewSQLiteStore(t.TempDir())
	if err != nil {
		t.Fatalf("create sqlite store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if _, err := store.AddNode(UnifiedNode{
		Tag:          "node-group-geo",
		InternalTag:  "node-group-geo",
		DisplayName:  "node-group-geo",
		SourceTag:    "node-group-geo",
		Type:         "vmess",
		Server:       "4.4.4.4",
		ServerPort:   443,
		Country:      "US",
		CountryEmoji: GetCountryEmoji("US"),
		Status:       NodeStatusVerified,
	}); err != nil {
		t.Fatalf("insert first verified node: %v", err)
	}

	if _, err := store.AddNode(UnifiedNode{
		Tag:          "node-group-fallback",
		InternalTag:  "node-group-fallback",
		DisplayName:  "node-group-fallback",
		SourceTag:    "node-group-fallback",
		Type:         "vmess",
		Server:       "5.5.5.5",
		ServerPort:   443,
		Country:      "FR",
		CountryEmoji: GetCountryEmoji("FR"),
		Status:       NodeStatusVerified,
	}); err != nil {
		t.Fatalf("insert second verified node: %v", err)
	}

	if err := store.UpsertGeoData(GeoData{
		Server:      "4.4.4.4",
		ServerPort:  443,
		NodeTag:     "node-group-geo",
		Timestamp:   time.Now(),
		Status:      "success",
		Country:     "Japan",
		CountryCode: "JP",
	}); err != nil {
		t.Fatalf("upsert geo data for JP: %v", err)
	}

	if err := store.UpsertGeoData(GeoData{
		Server:      "5.5.5.5",
		ServerPort:  443,
		NodeTag:     "node-group-fallback",
		Timestamp:   time.Now(),
		Status:      "success",
		Country:     "France",
		CountryCode: "FR",
	}); err != nil {
		t.Fatalf("upsert geo data for FR: %v", err)
	}

	groups := store.GetCountryGroups()
	counts := map[string]int{}
	for _, g := range groups {
		counts[g.Code] = g.NodeCount
	}

	if counts["JP"] != 1 {
		t.Fatalf("JP count mismatch: got %d, want 1", counts["JP"])
	}
	if counts["FR"] != 1 {
		t.Fatalf("FR count mismatch: got %d, want 1", counts["FR"])
	}
	if _, exists := counts["US"]; exists {
		t.Fatalf("unexpected US group — should count from geo_data, not nodes table")
	}
}
