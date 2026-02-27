package storage

import (
	"testing"
	"time"
)

func TestGetTrafficLifetimeStats_AggregateTimestampString(t *testing.T) {
	store, err := NewSQLiteStore(t.TempDir())
	if err != nil {
		t.Fatalf("create sqlite store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	ts1 := "2026-02-27T08:11:36.386663074Z"
	ts2 := "2026-02-27T08:11:38.386855382Z"

	if _, err := store.db.Exec(`INSERT INTO traffic_samples (
		timestamp, up_bps, down_bps, upload_total, download_total,
		active_connections, client_count, memory_inuse, memory_oslimit
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, ts1, 0, 0, 100, 200, 1, 1, 0, 0); err != nil {
		t.Fatalf("insert first sample: %v", err)
	}
	if _, err := store.db.Exec(`INSERT INTO traffic_samples (
		timestamp, up_bps, down_bps, upload_total, download_total,
		active_connections, client_count, memory_inuse, memory_oslimit
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, ts2, 0, 0, 130, 260, 1, 1, 0, 0); err != nil {
		t.Fatalf("insert second sample: %v", err)
	}
	if _, err := store.db.Exec(`INSERT INTO traffic_clients (
		sample_id, timestamp, source_ip, active_connections, upload_bytes,
		download_bytes, duration_seconds, proxy_chain, host_count, top_host
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 1, ts1, "10.0.0.1", 1, 10, 20, 1, "direct", 1, "example.com"); err != nil {
		t.Fatalf("insert client sample: %v", err)
	}

	stats, err := store.GetTrafficLifetimeStats()
	if err != nil {
		t.Fatalf("get lifetime stats: %v", err)
	}

	if stats.SampleCount != 2 {
		t.Fatalf("sample count mismatch: got %d, want 2", stats.SampleCount)
	}
	if stats.TotalClients != 1 {
		t.Fatalf("total clients mismatch: got %d, want 1", stats.TotalClients)
	}
	if stats.TotalUploadBytes != 130 {
		t.Fatalf("total upload mismatch: got %d, want 130", stats.TotalUploadBytes)
	}
	if stats.TotalDownloadBytes != 260 {
		t.Fatalf("total download mismatch: got %d, want 260", stats.TotalDownloadBytes)
	}
	if stats.FirstSampleAt == nil || stats.LastSampleAt == nil {
		t.Fatalf("expected first/last sample timestamps to be set")
	}

	firstExpected, _ := time.Parse(time.RFC3339Nano, ts1)
	lastExpected, _ := time.Parse(time.RFC3339Nano, ts2)
	if !stats.FirstSampleAt.Equal(firstExpected) {
		t.Fatalf("first sample mismatch: got %s, want %s", stats.FirstSampleAt.UTC().Format(time.RFC3339Nano), firstExpected.UTC().Format(time.RFC3339Nano))
	}
	if !stats.LastSampleAt.Equal(lastExpected) {
		t.Fatalf("last sample mismatch: got %s, want %s", stats.LastSampleAt.UTC().Format(time.RFC3339Nano), lastExpected.UTC().Format(time.RFC3339Nano))
	}
}

func TestParseSQLiteTimestampString_UTCZoneFormat(t *testing.T) {
	input := "2026-02-27 08:10:36.386381756 +0000 UTC"
	got, ok, err := parseSQLiteTimestampString(input)
	if err != nil {
		t.Fatalf("parse timestamp: %v", err)
	}
	if !ok {
		t.Fatalf("expected timestamp to be parsed")
	}

	want := time.Date(2026, 2, 27, 8, 10, 36, 386381756, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("timestamp mismatch: got %s, want %s", got.UTC().Format(time.RFC3339Nano), want.UTC().Format(time.RFC3339Nano))
	}
}
