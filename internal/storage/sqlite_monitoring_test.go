package storage

import (
	"testing"
	"time"
)

func mustUnix(t *testing.T, raw string) int64 {
	t.Helper()
	ts, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		t.Fatalf("parse timestamp %q: %v", raw, err)
	}
	return ts.UnixNano()
}

func TestGetTrafficLifetimeStats_AggregateTimestampString(t *testing.T) {
	store, err := NewSQLiteStore(t.TempDir())
	if err != nil {
		t.Fatalf("create sqlite store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	ts1 := "2026-02-27T08:11:36.386663074Z"
	ts2 := "2026-02-27T08:11:38.386855382Z"

	if _, err := store.db.Exec(`INSERT INTO traffic_samples (
		timestamp, timestamp_unix, up_bps, down_bps, upload_total, download_total,
		active_connections, client_count, memory_inuse, memory_oslimit
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ts1, mustUnix(t, ts1), 0, 0, 100, 200, 1, 1, 0, 0); err != nil {
		t.Fatalf("insert first sample: %v", err)
	}
	if _, err := store.db.Exec(`INSERT INTO traffic_samples (
		timestamp, timestamp_unix, up_bps, down_bps, upload_total, download_total,
		active_connections, client_count, memory_inuse, memory_oslimit
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ts2, mustUnix(t, ts2), 0, 0, 130, 260, 1, 1, 0, 0); err != nil {
		t.Fatalf("insert second sample: %v", err)
	}
	if _, err := store.db.Exec(`INSERT INTO traffic_clients (
		sample_id, timestamp, timestamp_unix, source_ip, active_connections, upload_bytes,
		download_bytes, duration_seconds, proxy_chain, host_count, top_host
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 1, ts1, mustUnix(t, ts1), "10.0.0.1", 1, 10, 20, 1, "direct", 1, "example.com"); err != nil {
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

func TestGetTrafficChainStats_AggregateTimestampString(t *testing.T) {
	store, err := NewSQLiteStore(t.TempDir())
	if err != nil {
		t.Fatalf("create sqlite store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	ts1 := "2026-02-27T08:11:36.386663074Z"
	ts2 := "2026-02-27T08:11:38.386855382Z"

	if _, err := store.db.Exec(`INSERT INTO traffic_samples (
		timestamp, timestamp_unix, up_bps, down_bps, upload_total, download_total,
		active_connections, client_count, memory_inuse, memory_oslimit
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ts1, mustUnix(t, ts1), 0, 0, 100, 200, 1, 1, 0, 0); err != nil {
		t.Fatalf("insert sample: %v", err)
	}

	if _, err := store.db.Exec(`INSERT INTO traffic_clients (
		sample_id, timestamp, timestamp_unix, source_ip, active_connections, upload_bytes,
		download_bytes, duration_seconds, proxy_chain, host_count, top_host
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 1, ts1, mustUnix(t, ts1), "10.0.0.1", 1, 100, 200, 1, "node_1", 1, "example.com"); err != nil {
		t.Fatalf("insert first client row: %v", err)
	}
	if _, err := store.db.Exec(`INSERT INTO traffic_clients (
		sample_id, timestamp, timestamp_unix, source_ip, active_connections, upload_bytes,
		download_bytes, duration_seconds, proxy_chain, host_count, top_host
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 1, ts2, mustUnix(t, ts2), "10.0.0.1", 1, 130, 260, 1, "node_1", 1, "example.com"); err != nil {
		t.Fatalf("insert second client row: %v", err)
	}

	stats, err := store.GetTrafficChainStats(10, 0)
	if err != nil {
		t.Fatalf("get traffic chain stats: %v", err)
	}
	if len(stats) != 1 {
		t.Fatalf("stats length mismatch: got %d, want 1", len(stats))
	}

	item := stats[0]
	if item.ProxyChain != "node_1" {
		t.Fatalf("proxy chain mismatch: got %q, want %q", item.ProxyChain, "node_1")
	}
	if item.UploadBytes != 130 {
		t.Fatalf("upload bytes mismatch: got %d, want 130", item.UploadBytes)
	}
	if item.DownloadBytes != 260 {
		t.Fatalf("download bytes mismatch: got %d, want 260", item.DownloadBytes)
	}
	wantLastSeen, _ := time.Parse(time.RFC3339Nano, ts2)
	if !item.LastSeen.Equal(wantLastSeen) {
		t.Fatalf("last seen mismatch: got %s, want %s", item.LastSeen.UTC().Format(time.RFC3339Nano), wantLastSeen.UTC().Format(time.RFC3339Nano))
	}
}

func TestGetTrafficSamplesByTimeRange_UsesUnixBuckets(t *testing.T) {
	store, err := NewSQLiteStore(t.TempDir())
	if err != nil {
		t.Fatalf("create sqlite store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	base := time.Now().UTC().Truncate(time.Second).Add(-3 * time.Second)
	ts1 := base.Format(time.RFC3339)
	ts2 := base.Add(1 * time.Second).Format(time.RFC3339)
	ts3 := base.Add(2 * time.Second).Format(time.RFC3339)

	for _, tc := range []struct {
		ts            string
		upBps         int64
		downBps       int64
		uploadTotal   int64
		downloadTotal int64
	}{
		{ts1, 100, 200, 1000, 2000},
		{ts2, 300, 400, 1300, 2400},
		{ts3, 500, 600, 1800, 3000},
	} {
		if _, err := store.db.Exec(`INSERT INTO traffic_samples (
			timestamp, timestamp_unix, up_bps, down_bps, upload_total, download_total,
			active_connections, client_count, memory_inuse, memory_oslimit
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			tc.ts,
			mustUnix(t, tc.ts),
			tc.upBps,
			tc.downBps,
			tc.uploadTotal,
			tc.downloadTotal,
			1,
			1,
			0,
			0,
		); err != nil {
			t.Fatalf("insert sample %s: %v", tc.ts, err)
		}
	}

	since := base

	samples, err := store.GetTrafficSamplesByTimeRange(since, 100)
	if err != nil {
		t.Fatalf("get traffic samples by time range: %v", err)
	}
	if len(samples) != 3 {
		t.Fatalf("samples length mismatch: got %d, want 3", len(samples))
	}
	if samples[0].UploadTotal != 1000 || samples[1].UploadTotal != 1300 || samples[2].UploadTotal != 1800 {
		t.Fatalf("unexpected upload totals: got [%d %d %d]", samples[0].UploadTotal, samples[1].UploadTotal, samples[2].UploadTotal)
	}
}

func TestGetTrafficSamplesByTimeRange_UsesPeakCountsPerBucket(t *testing.T) {
	store, err := NewSQLiteStore(t.TempDir())
	if err != nil {
		t.Fatalf("create sqlite store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	base := time.Now().UTC().Truncate(time.Second).Add(-2 * time.Second)
	rows := []struct {
		ts                string
		activeConnections int
		clientCount       int
	}{
		{base.Format(time.RFC3339Nano), 0, 0},
		{base.Add(400 * time.Millisecond).Format(time.RFC3339Nano), 3, 1},
	}

	for _, row := range rows {
		if _, err := store.db.Exec(`INSERT INTO traffic_samples (
			timestamp, timestamp_unix, up_bps, down_bps, upload_total, download_total,
			active_connections, client_count, memory_inuse, memory_oslimit
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			row.ts,
			mustUnix(t, row.ts),
			0,
			0,
			0,
			0,
			row.activeConnections,
			row.clientCount,
			0,
			0,
		); err != nil {
			t.Fatalf("insert sample %s: %v", row.ts, err)
		}
	}

	items, err := store.GetTrafficSamplesByTimeRange(base, 1)
	if err != nil {
		t.Fatalf("get traffic samples by time range: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("items length mismatch: got %d, want 1", len(items))
	}
	if items[0].ActiveConnections != 3 {
		t.Fatalf("active connections mismatch: got %d, want 3", items[0].ActiveConnections)
	}
	if items[0].ClientCount != 1 {
		t.Fatalf("client count mismatch: got %d, want 1", items[0].ClientCount)
	}
}

func TestGetClientResourcesHistory_AggregateUnixTimestamps(t *testing.T) {
	store, err := NewSQLiteStore(t.TempDir())
	if err != nil {
		t.Fatalf("create sqlite store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	ts1 := "2026-03-03T23:12:56Z"
	ts2 := "2026-03-03T23:13:08Z"

	for idx, ts := range []string{ts1, ts2} {
		if _, err := store.db.Exec(`INSERT INTO traffic_samples (
			id, timestamp, timestamp_unix, up_bps, down_bps, upload_total, download_total,
			active_connections, client_count, memory_inuse, memory_oslimit
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			idx+1,
			ts,
			mustUnix(t, ts),
			0,
			0,
			0,
			0,
			1,
			1,
			0,
			0,
		); err != nil {
			t.Fatalf("insert sample %d: %v", idx+1, err)
		}
	}

	for idx, tc := range []struct {
		ts            string
		uploadBytes   int64
		downloadBytes int64
	}{
		{ts1, 100, 200},
		{ts2, 130, 260},
	} {
		if _, err := store.db.Exec(`INSERT INTO traffic_resources (
			sample_id, timestamp, timestamp_unix, source_ip, host, active_connections,
			upload_bytes, download_bytes, proxy_chain
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			idx+1,
			tc.ts,
			mustUnix(t, tc.ts),
			"10.0.0.1",
			"example.com",
			1,
			tc.uploadBytes,
			tc.downloadBytes,
			"node_1",
		); err != nil {
			t.Fatalf("insert resource row %s: %v", tc.ts, err)
		}
	}

	items, err := store.GetClientResourcesHistory("10.0.0.1", 10)
	if err != nil {
		t.Fatalf("get client resources history: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("items length mismatch: got %d, want 1", len(items))
	}
	if items[0].FirstSeen.UnixNano() != mustUnix(t, ts1) {
		t.Fatalf("first seen mismatch: got %d, want %d", items[0].FirstSeen.UnixNano(), mustUnix(t, ts1))
	}
	if items[0].LastSeen.UnixNano() != mustUnix(t, ts2) {
		t.Fatalf("last seen mismatch: got %d, want %d", items[0].LastSeen.UnixNano(), mustUnix(t, ts2))
	}
}

func TestGetClientResourcesHistory_DoesNotDoubleCountHostDrops(t *testing.T) {
	store, err := NewSQLiteStore(t.TempDir())
	if err != nil {
		t.Fatalf("create sqlite store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	base := time.Now().UTC().Truncate(time.Second)
	ts1 := base.Add(-6 * time.Second).Format(time.RFC3339Nano)
	ts2 := base.Add(-4 * time.Second).Format(time.RFC3339Nano)
	ts3 := base.Add(-2 * time.Second).Format(time.RFC3339Nano)

	for idx, ts := range []string{ts1, ts2, ts3} {
		if _, err := store.db.Exec(`INSERT INTO traffic_samples (
			id, timestamp, timestamp_unix, up_bps, down_bps, upload_total, download_total,
			active_connections, client_count, memory_inuse, memory_oslimit
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			idx+1,
			ts,
			mustUnix(t, ts),
			0,
			0,
			0,
			0,
			1,
			1,
			0,
			0,
		); err != nil {
			t.Fatalf("insert sample %d: %v", idx+1, err)
		}
	}

	for idx, row := range []struct {
		ts                string
		activeConnections int
		uploadBytes       int64
		downloadBytes     int64
	}{
		{ts1, 2, 100, 200},
		{ts2, 1, 60, 120},
		{ts3, 1, 80, 160},
	} {
		if _, err := store.db.Exec(`INSERT INTO traffic_resources (
			sample_id, timestamp, timestamp_unix, source_ip, host, active_connections,
			upload_bytes, download_bytes, proxy_chain
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			idx+1,
			row.ts,
			mustUnix(t, row.ts),
			"10.0.0.1",
			"example.com",
			row.activeConnections,
			row.uploadBytes,
			row.downloadBytes,
			"node_1",
		); err != nil {
			t.Fatalf("insert resource row %s: %v", row.ts, err)
		}
	}

	items, err := store.GetClientResourcesHistory("10.0.0.1", 10)
	if err != nil {
		t.Fatalf("get client resources history: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("items length mismatch: got %d, want 1", len(items))
	}
	if items[0].TotalUpload != 120 {
		t.Fatalf("total upload mismatch: got %d, want 120", items[0].TotalUpload)
	}
	if items[0].TotalDownload != 240 {
		t.Fatalf("total download mismatch: got %d, want 240", items[0].TotalDownload)
	}
}

func TestGetClientResourcesHistory_StartsPreciseSegmentAfterLegacyRows(t *testing.T) {
	store, err := NewSQLiteStore(t.TempDir())
	if err != nil {
		t.Fatalf("create sqlite store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	base := time.Now().UTC().Truncate(time.Second)
	ts1 := base.Add(-6 * time.Second).Format(time.RFC3339Nano)
	ts2 := base.Add(-4 * time.Second).Format(time.RFC3339Nano)
	ts3 := base.Add(-2 * time.Second).Format(time.RFC3339Nano)

	for idx, ts := range []string{ts1, ts2, ts3} {
		if _, err := store.db.Exec(`INSERT INTO traffic_samples (
			id, timestamp, timestamp_unix, up_bps, down_bps, upload_total, download_total,
			active_connections, client_count, memory_inuse, memory_oslimit
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			idx+1,
			ts,
			mustUnix(t, ts),
			0,
			0,
			0,
			0,
			1,
			1,
			0,
			0,
		); err != nil {
			t.Fatalf("insert sample %d: %v", idx+1, err)
		}
	}

	if _, err := store.db.Exec(`INSERT INTO traffic_resources (
		sample_id, timestamp, timestamp_unix, source_ip, host, active_connections,
		upload_bytes, download_bytes, proxy_chain
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		1,
		ts1,
		mustUnix(t, ts1),
		"10.0.0.1",
		"example.com",
		1,
		100,
		200,
		"node_1",
	); err != nil {
		t.Fatalf("insert legacy resource row 1: %v", err)
	}
	if _, err := store.db.Exec(`INSERT INTO traffic_resources (
		sample_id, timestamp, timestamp_unix, source_ip, host, active_connections,
		upload_bytes, download_bytes, proxy_chain
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		2,
		ts2,
		mustUnix(t, ts2),
		"10.0.0.1",
		"example.com",
		1,
		60,
		120,
		"node_1",
	); err != nil {
		t.Fatalf("insert legacy resource row 2: %v", err)
	}
	if _, err := store.db.Exec(`INSERT INTO traffic_resources (
		sample_id, timestamp, timestamp_unix, source_ip, host, active_connections,
		upload_bytes, download_bytes, upload_total, download_total, proxy_chain
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		3,
		ts3,
		mustUnix(t, ts3),
		"10.0.0.1",
		"example.com",
		1,
		20,
		40,
		25,
		50,
		"node_1",
	); err != nil {
		t.Fatalf("insert precise resource row: %v", err)
	}

	items, err := store.GetClientResourcesHistory("10.0.0.1", 10)
	if err != nil {
		t.Fatalf("get client resources history: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("items length mismatch: got %d, want 1", len(items))
	}
	if items[0].TotalUpload != 125 {
		t.Fatalf("total upload mismatch: got %d, want 125", items[0].TotalUpload)
	}
	if items[0].TotalDownload != 250 {
		t.Fatalf("total download mismatch: got %d, want 250", items[0].TotalDownload)
	}
}

func TestGetClientTrafficHistoryByTimeRange_UsesRequestedWindow(t *testing.T) {
	store, err := NewSQLiteStore(t.TempDir())
	if err != nil {
		t.Fatalf("create sqlite store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	base := time.Now().UTC().Truncate(time.Second).Add(-3 * time.Second)
	rows := []struct {
		ts            string
		uploadBytes   int64
		downloadBytes int64
	}{
		{base.Format(time.RFC3339), 100, 200},
		{base.Add(1 * time.Second).Format(time.RFC3339), 160, 260},
		{base.Add(2 * time.Second).Format(time.RFC3339), 240, 340},
	}

	for idx, row := range rows {
		if _, err := store.db.Exec(`INSERT INTO traffic_samples (
			id, timestamp, timestamp_unix, up_bps, down_bps, upload_total, download_total,
			active_connections, client_count, memory_inuse, memory_oslimit
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			idx+1,
			row.ts,
			mustUnix(t, row.ts),
			0,
			0,
			0,
			0,
			1,
			1,
			0,
			0,
		); err != nil {
			t.Fatalf("insert traffic sample %s: %v", row.ts, err)
		}
	}

	for idx, row := range rows {
		if _, err := store.db.Exec(`INSERT INTO traffic_clients (
			sample_id, timestamp, timestamp_unix, source_ip, active_connections, upload_bytes,
			download_bytes, duration_seconds, proxy_chain, host_count, top_host
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			idx+1,
			row.ts,
			mustUnix(t, row.ts),
			"10.0.0.1",
			1,
			row.uploadBytes,
			row.downloadBytes,
			10,
			"node_1",
			1,
			"example.com",
		); err != nil {
			t.Fatalf("insert client row %s: %v", row.ts, err)
		}
	}

	items, err := store.GetClientTrafficHistoryByTimeRange("10.0.0.1", base, 100)
	if err != nil {
		t.Fatalf("get client traffic history by time range: %v", err)
	}
	if len(items) != 3 {
		t.Fatalf("items length mismatch: got %d, want 3", len(items))
	}
	if items[0].UploadBytes != 100 || items[1].UploadBytes != 160 || items[2].UploadBytes != 240 {
		t.Fatalf("unexpected upload bytes: got [%d %d %d]", items[0].UploadBytes, items[1].UploadBytes, items[2].UploadBytes)
	}
}

func TestGetRecentTrafficClients_OfflineConnectionsAreZero(t *testing.T) {
	store, err := NewSQLiteStore(t.TempDir())
	if err != nil {
		t.Fatalf("create sqlite store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	oldTs := time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339Nano)
	newTs := time.Now().UTC().Add(-1 * time.Minute).Format(time.RFC3339Nano)

	for idx, ts := range []string{oldTs, newTs} {
		if _, err := store.db.Exec(`INSERT INTO traffic_samples (
			id, timestamp, timestamp_unix, up_bps, down_bps, upload_total, download_total,
			active_connections, client_count, memory_inuse, memory_oslimit
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			idx+1,
			ts,
			mustUnix(t, ts),
			0,
			0,
			0,
			0,
			1,
			1,
			0,
			0,
		); err != nil {
			t.Fatalf("insert sample %d: %v", idx+1, err)
		}
	}

	if _, err := store.db.Exec(`INSERT INTO traffic_clients (
		sample_id, timestamp, timestamp_unix, source_ip, active_connections, upload_bytes,
		download_bytes, duration_seconds, proxy_chain, host_count, top_host
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		1,
		oldTs,
		mustUnix(t, oldTs),
		"10.0.0.1",
		5,
		100,
		200,
		10,
		"node_1",
		1,
		"example.com",
	); err != nil {
		t.Fatalf("insert offline client row: %v", err)
	}

	if _, err := store.db.Exec(`INSERT INTO traffic_clients (
		sample_id, timestamp, timestamp_unix, source_ip, active_connections, upload_bytes,
		download_bytes, duration_seconds, proxy_chain, host_count, top_host
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		2,
		newTs,
		mustUnix(t, newTs),
		"10.0.0.2",
		1,
		10,
		20,
		5,
		"node_2",
		1,
		"example.org",
	); err != nil {
		t.Fatalf("insert online client row: %v", err)
	}

	items, err := store.GetRecentTrafficClients(10, 24*time.Hour)
	if err != nil {
		t.Fatalf("get recent traffic clients: %v", err)
	}

	foundOffline := false
	for _, item := range items {
		if item.SourceIP != "10.0.0.1" {
			continue
		}
		foundOffline = true
		if item.Online {
			t.Fatalf("expected 10.0.0.1 to be offline")
		}
		if item.ActiveConnections != 0 {
			t.Fatalf("offline active connections mismatch: got %d, want 0", item.ActiveConnections)
		}
	}
	if !foundOffline {
		t.Fatalf("expected offline client to be present")
	}
}
