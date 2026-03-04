package api

import (
	"testing"
	"time"
)

func TestApplyCumulativeTraffic_TracksResourceTotalsAcrossConnectionDrops(t *testing.T) {
	s := &Server{}

	conns1 := []clashConnection{
		{
			ID: "c1",
			Metadata: clashConnectionMetadata{
				SourceIP: "10.0.0.1",
				Host:     "example.com",
			},
			Upload:   60,
			Download: 120,
		},
		{
			ID: "c2",
			Metadata: clashConnectionMetadata{
				SourceIP: "10.0.0.1",
				Host:     "example.com",
			},
			Upload:   40,
			Download: 80,
		},
	}

	clients1, resources1 := aggregateConnections(conns1, mustUTC("2026-03-04T06:00:00Z"))
	s.applyCumulativeTraffic(conns1, clients1, resources1)

	if len(resources1) != 1 {
		t.Fatalf("resources1 length mismatch: got %d, want 1", len(resources1))
	}
	if resources1[0].UploadTotal != 100 || resources1[0].DownloadTotal != 200 {
		t.Fatalf("first totals mismatch: got %d/%d, want 100/200", resources1[0].UploadTotal, resources1[0].DownloadTotal)
	}

	conns2 := []clashConnection{
		{
			ID: "c1",
			Metadata: clashConnectionMetadata{
				SourceIP: "10.0.0.1",
				Host:     "example.com",
			},
			Upload:   80,
			Download: 160,
		},
	}

	clients2, resources2 := aggregateConnections(conns2, mustUTC("2026-03-04T06:00:02Z"))
	s.applyCumulativeTraffic(conns2, clients2, resources2)

	if len(resources2) != 1 {
		t.Fatalf("resources2 length mismatch: got %d, want 1", len(resources2))
	}
	if resources2[0].UploadTotal != 120 || resources2[0].DownloadTotal != 240 {
		t.Fatalf("second totals mismatch: got %d/%d, want 120/240", resources2[0].UploadTotal, resources2[0].DownloadTotal)
	}
	if clients2[0].UploadBytes != 120 || clients2[0].DownloadBytes != 240 {
		t.Fatalf("client totals mismatch: got %d/%d, want 120/240", clients2[0].UploadBytes, clients2[0].DownloadBytes)
	}
}

func mustUTC(raw string) time.Time {
	ts, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		panic(err)
	}
	return ts.UTC()
}
