package storage

import (
	"database/sql"
	"fmt"
	"time"
)

func (s *SQLiteStore) AddTrafficSample(sample TrafficSample, clients []ClientTrafficSnapshot, resources []ClientResourceSnapshot) (int64, error) {
	if sample.Timestamp.IsZero() {
		sample.Timestamp = time.Now()
	}

	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	res, err := tx.Exec(`INSERT INTO traffic_samples (
		timestamp, up_bps, down_bps, upload_total, download_total,
		active_connections, client_count, memory_inuse, memory_oslimit
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		sample.Timestamp,
		sample.UpBps,
		sample.DownBps,
		sample.UploadTotal,
		sample.DownloadTotal,
		sample.ActiveConnections,
		sample.ClientCount,
		sample.MemoryInuse,
		sample.MemoryOSLimit,
	)
	if err != nil {
		return 0, err
	}

	sampleID, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}

	if len(clients) > 0 {
		stmt, err := tx.Prepare(`INSERT INTO traffic_clients (
			sample_id, timestamp, source_ip, active_connections, upload_bytes,
			download_bytes, duration_seconds, proxy_chain, host_count, top_host
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
		if err != nil {
			return 0, err
		}
		defer stmt.Close()

		for _, client := range clients {
			ts := client.Timestamp
			if ts.IsZero() {
				ts = sample.Timestamp
			}
			if _, err := stmt.Exec(
				sampleID,
				ts,
				client.SourceIP,
				client.ActiveConnections,
				client.UploadBytes,
				client.DownloadBytes,
				client.DurationSeconds,
				client.ProxyChain,
				client.HostCount,
				client.TopHost,
			); err != nil {
				return 0, err
			}
		}
	}

	if len(resources) > 0 {
		stmt, err := tx.Prepare(`INSERT INTO traffic_resources (
			sample_id, timestamp, source_ip, host, active_connections,
			upload_bytes, download_bytes, proxy_chain
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
		if err != nil {
			return 0, err
		}
		defer stmt.Close()

		for _, resource := range resources {
			ts := resource.Timestamp
			if ts.IsZero() {
				ts = sample.Timestamp
			}
			if _, err := stmt.Exec(
				sampleID,
				ts,
				resource.SourceIP,
				resource.Host,
				resource.ActiveConnections,
				resource.UploadBytes,
				resource.DownloadBytes,
				resource.ProxyChain,
			); err != nil {
				return 0, err
			}
		}
	}

	return sampleID, tx.Commit()
}

func (s *SQLiteStore) GetTrafficSamples(limit int) ([]TrafficSample, error) {
	if limit <= 0 {
		limit = 120
	}
	if limit > 5000 {
		limit = 5000
	}

	rows, err := s.db.Query(`SELECT
		id, timestamp, up_bps, down_bps, upload_total, download_total,
		active_connections, client_count, memory_inuse, memory_oslimit
		FROM traffic_samples
		ORDER BY timestamp DESC
		LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	samples := make([]TrafficSample, 0, limit)
	for rows.Next() {
		var sample TrafficSample
		if err := rows.Scan(
			&sample.ID,
			&sample.Timestamp,
			&sample.UpBps,
			&sample.DownBps,
			&sample.UploadTotal,
			&sample.DownloadTotal,
			&sample.ActiveConnections,
			&sample.ClientCount,
			&sample.MemoryInuse,
			&sample.MemoryOSLimit,
		); err != nil {
			return nil, fmt.Errorf("scan traffic sample row: %w", err)
		}
		samples = append(samples, sample)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate traffic sample rows: %w", err)
	}

	// Convert to ascending order for charting.
	for i, j := 0, len(samples)-1; i < j; i, j = i+1, j-1 {
		samples[i], samples[j] = samples[j], samples[i]
	}

	return samples, nil
}

func (s *SQLiteStore) GetLatestTrafficSample() (*TrafficSample, error) {
	var sample TrafficSample
	err := s.db.QueryRow(`SELECT
		id, timestamp, up_bps, down_bps, upload_total, download_total,
		active_connections, client_count, memory_inuse, memory_oslimit
		FROM traffic_samples
		ORDER BY timestamp DESC
		LIMIT 1`).Scan(
		&sample.ID,
		&sample.Timestamp,
		&sample.UpBps,
		&sample.DownBps,
		&sample.UploadTotal,
		&sample.DownloadTotal,
		&sample.ActiveConnections,
		&sample.ClientCount,
		&sample.MemoryInuse,
		&sample.MemoryOSLimit,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &sample, nil
}

func (s *SQLiteStore) GetLatestTrafficClients(limit int) ([]ClientTrafficSnapshot, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 2000 {
		limit = 2000
	}

	sampleID, err := s.latestTrafficSampleID()
	if err != nil {
		return nil, err
	}
	if sampleID == 0 {
		return []ClientTrafficSnapshot{}, nil
	}

	rows, err := s.db.Query(`SELECT
		id, sample_id, timestamp, source_ip, active_connections,
		upload_bytes, download_bytes, duration_seconds, proxy_chain, host_count, top_host
		FROM traffic_clients
		WHERE sample_id = ?
		ORDER BY (upload_bytes + download_bytes) DESC, active_connections DESC
		LIMIT ?`, sampleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	clients := make([]ClientTrafficSnapshot, 0, limit)
	for rows.Next() {
		var client ClientTrafficSnapshot
		if err := rows.Scan(
			&client.ID,
			&client.SampleID,
			&client.Timestamp,
			&client.SourceIP,
			&client.ActiveConnections,
			&client.UploadBytes,
			&client.DownloadBytes,
			&client.DurationSeconds,
			&client.ProxyChain,
			&client.HostCount,
			&client.TopHost,
		); err != nil {
			return nil, fmt.Errorf("scan traffic client row: %w", err)
		}
		clients = append(clients, client)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate traffic client rows: %w", err)
	}

	return clients, nil
}

func (s *SQLiteStore) GetLatestTrafficResources(limit int, sourceIP string) ([]ClientResourceSnapshot, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 5000 {
		limit = 5000
	}

	sampleID, err := s.latestTrafficSampleID()
	if err != nil {
		return nil, err
	}
	if sampleID == 0 {
		return []ClientResourceSnapshot{}, nil
	}

	query := `SELECT
		id, sample_id, timestamp, source_ip, host, active_connections,
		upload_bytes, download_bytes, proxy_chain
		FROM traffic_resources
		WHERE sample_id = ?`
	args := []interface{}{sampleID}
	if sourceIP != "" {
		query += " AND source_ip = ?"
		args = append(args, sourceIP)
	}
	query += " ORDER BY (upload_bytes + download_bytes) DESC, active_connections DESC LIMIT ?"
	args = append(args, limit)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	resources := make([]ClientResourceSnapshot, 0, limit)
	for rows.Next() {
		var resource ClientResourceSnapshot
		if err := rows.Scan(
			&resource.ID,
			&resource.SampleID,
			&resource.Timestamp,
			&resource.SourceIP,
			&resource.Host,
			&resource.ActiveConnections,
			&resource.UploadBytes,
			&resource.DownloadBytes,
			&resource.ProxyChain,
		); err != nil {
			return nil, fmt.Errorf("scan traffic resource row: %w", err)
		}
		resources = append(resources, resource)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate traffic resource rows: %w", err)
	}

	return resources, nil
}

func (s *SQLiteStore) latestTrafficSampleID() (int64, error) {
	var sampleID int64
	err := s.db.QueryRow(`SELECT id FROM traffic_samples ORDER BY timestamp DESC LIMIT 1`).Scan(&sampleID)
	if err != nil {
		if err == sql.ErrNoRows {
			return 0, nil
		}
		return 0, err
	}
	return sampleID, nil
}
