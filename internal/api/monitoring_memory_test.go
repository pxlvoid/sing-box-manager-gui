package api

import (
	"encoding/json"
	"testing"
)

func TestClashConnectionsSnapshotMemoryObject(t *testing.T) {
	payload := []byte(`{
		"downloadTotal": 100,
		"uploadTotal": 200,
		"memory": { "inuse": 12345, "oslimit": 67890 },
		"connections": []
	}`)

	var snapshot clashConnectionsSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}

	if snapshot.Memory.Inuse != 12345 {
		t.Fatalf("unexpected inuse: got %d, want 12345", snapshot.Memory.Inuse)
	}
	if snapshot.Memory.OSLimit != 67890 {
		t.Fatalf("unexpected oslimit: got %d, want 67890", snapshot.Memory.OSLimit)
	}
}

func TestClashConnectionsSnapshotMemoryNumber(t *testing.T) {
	payload := []byte(`{
		"downloadTotal": 100,
		"uploadTotal": 200,
		"memory": 54321,
		"connections": []
	}`)

	var snapshot clashConnectionsSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}

	if snapshot.Memory.Inuse != 54321 {
		t.Fatalf("unexpected inuse: got %d, want 54321", snapshot.Memory.Inuse)
	}
	if snapshot.Memory.OSLimit != 0 {
		t.Fatalf("unexpected oslimit: got %d, want 0", snapshot.Memory.OSLimit)
	}
}

func TestClashConnectionsSnapshotMemoryStringNumber(t *testing.T) {
	payload := []byte(`{
		"downloadTotal": 100,
		"uploadTotal": 200,
		"memory": { "inuse": "777", "oslimit": "0" },
		"connections": []
	}`)

	var snapshot clashConnectionsSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}

	if snapshot.Memory.Inuse != 777 {
		t.Fatalf("unexpected inuse: got %d, want 777", snapshot.Memory.Inuse)
	}
	if snapshot.Memory.OSLimit != 0 {
		t.Fatalf("unexpected oslimit: got %d, want 0", snapshot.Memory.OSLimit)
	}
}
