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

	sampleID := int64(0)
	var err error
	if sourceIP != "" {
		sampleID, err = s.latestTrafficSampleIDForSource(sourceIP)
	} else {
		sampleID, err = s.latestTrafficSampleID()
	}
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

func (s *SQLiteStore) GetRecentTrafficClients(limit int, lookback time.Duration) ([]TrafficClientRecent, error) {
	if limit <= 0 {
		limit = 200
	}
	if limit > 5000 {
		limit = 5000
	}
	if lookback <= 0 {
		lookback = 24 * time.Hour
	}

	cutoff := time.Now().Add(-lookback)
	rows, err := s.db.Query(`
		WITH latest_sample AS (
			SELECT id AS sample_id FROM traffic_samples ORDER BY timestamp DESC LIMIT 1
		),
		ranked AS (
			SELECT
				tc.source_ip,
				tc.sample_id,
				tc.timestamp,
				tc.active_connections,
				tc.upload_bytes,
				tc.download_bytes,
				tc.duration_seconds,
				tc.proxy_chain,
				tc.host_count,
				tc.top_host,
				ROW_NUMBER() OVER (PARTITION BY tc.source_ip ORDER BY tc.timestamp DESC, tc.id DESC) AS rn
			FROM traffic_clients tc
			WHERE tc.timestamp >= ?
		)
		SELECT
			r.source_ip,
			r.timestamp,
			CASE WHEN r.sample_id = (SELECT sample_id FROM latest_sample) THEN 1 ELSE 0 END AS online,
			r.active_connections,
			r.upload_bytes,
			r.download_bytes,
			r.duration_seconds,
			r.proxy_chain,
			r.host_count,
			r.top_host
		FROM ranked r
		WHERE r.rn = 1
		ORDER BY online DESC, r.timestamp DESC
		LIMIT ?`, cutoff, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	clients := make([]TrafficClientRecent, 0, limit)
	for rows.Next() {
		var client TrafficClientRecent
		var online int
		if err := rows.Scan(
			&client.SourceIP,
			&client.LastSeen,
			&online,
			&client.ActiveConnections,
			&client.UploadBytes,
			&client.DownloadBytes,
			&client.DurationSeconds,
			&client.ProxyChain,
			&client.HostCount,
			&client.TopHost,
		); err != nil {
			return nil, fmt.Errorf("scan recent traffic client row: %w", err)
		}
		client.Online = online != 0
		clients = append(clients, client)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate recent traffic client rows: %w", err)
	}

	return clients, nil
}

func (s *SQLiteStore) GetTrafficLifetimeStats() (*TrafficLifetimeStats, error) {
	stats := &TrafficLifetimeStats{}

	var firstSample sql.NullTime
	var lastSample sql.NullTime
	if err := s.db.QueryRow(
		`SELECT COUNT(*) AS sample_count, MIN(timestamp), MAX(timestamp) FROM traffic_samples`,
	).Scan(&stats.SampleCount, &firstSample, &lastSample); err != nil {
		return nil, err
	}
	if firstSample.Valid {
		t := firstSample.Time
		stats.FirstSampleAt = &t
	}
	if lastSample.Valid {
		t := lastSample.Time
		stats.LastSampleAt = &t
	}

	if err := s.db.QueryRow(`SELECT COUNT(DISTINCT source_ip) FROM traffic_clients`).Scan(&stats.TotalClients); err != nil {
		return nil, err
	}

	var totalUpload sql.NullInt64
	var totalDownload sql.NullInt64
	if err := s.db.QueryRow(`
		WITH ordered AS (
			SELECT
				id,
				timestamp,
				upload_total,
				download_total,
				LAG(upload_total) OVER (ORDER BY timestamp, id) AS prev_upload_total,
				LAG(download_total) OVER (ORDER BY timestamp, id) AS prev_download_total
			FROM traffic_samples
		)
		SELECT
			COALESCE(SUM(
				CASE
					WHEN prev_upload_total IS NULL THEN upload_total
					WHEN upload_total >= prev_upload_total THEN upload_total - prev_upload_total
					ELSE upload_total
				END
			), 0) AS total_upload,
			COALESCE(SUM(
				CASE
					WHEN prev_download_total IS NULL THEN download_total
					WHEN download_total >= prev_download_total THEN download_total - prev_download_total
					ELSE download_total
				END
			), 0) AS total_download
		FROM ordered;
	`).Scan(&totalUpload, &totalDownload); err != nil {
		return nil, err
	}

	if totalUpload.Valid {
		stats.TotalUploadBytes = totalUpload.Int64
	}
	if totalDownload.Valid {
		stats.TotalDownloadBytes = totalDownload.Int64
	}

	return stats, nil
}

func (s *SQLiteStore) GetTrafficChainStats(limit int, lookback time.Duration) ([]TrafficChainStats, error) {
	if limit <= 0 {
		limit = 200
	}
	if limit > 5000 {
		limit = 5000
	}

	whereClause := ""
	args := make([]interface{}, 0, 2)
	if lookback > 0 {
		cutoff := time.Now().Add(-lookback)
		whereClause = "WHERE timestamp >= ?"
		args = append(args, cutoff)
	}
	args = append(args, limit)

	query := fmt.Sprintf(`
		WITH ranked AS (
			SELECT
				source_ip,
				COALESCE(NULLIF(TRIM(proxy_chain), ''), 'direct') AS proxy_chain,
				timestamp,
				id,
				upload_bytes,
				download_bytes,
				LAG(upload_bytes) OVER (
					PARTITION BY source_ip, COALESCE(NULLIF(TRIM(proxy_chain), ''), 'direct')
					ORDER BY timestamp, id
				) AS prev_upload,
				LAG(download_bytes) OVER (
					PARTITION BY source_ip, COALESCE(NULLIF(TRIM(proxy_chain), ''), 'direct')
					ORDER BY timestamp, id
				) AS prev_download
			FROM traffic_clients
			%s
		),
		deltas AS (
			SELECT
				proxy_chain,
				timestamp,
				CASE
					WHEN prev_upload IS NULL THEN CASE WHEN upload_bytes < 0 THEN 0 ELSE upload_bytes END
					WHEN upload_bytes >= prev_upload THEN upload_bytes - prev_upload
					ELSE upload_bytes
				END AS upload_delta,
				CASE
					WHEN prev_download IS NULL THEN CASE WHEN download_bytes < 0 THEN 0 ELSE download_bytes END
					WHEN download_bytes >= prev_download THEN download_bytes - prev_download
					ELSE download_bytes
				END AS download_delta
			FROM ranked
		)
		SELECT
			proxy_chain,
			MAX(timestamp) AS last_seen,
			COALESCE(SUM(upload_delta), 0) AS upload_bytes,
			COALESCE(SUM(download_delta), 0) AS download_bytes
		FROM deltas
		GROUP BY proxy_chain
		ORDER BY (COALESCE(SUM(upload_delta), 0) + COALESCE(SUM(download_delta), 0)) DESC, MAX(timestamp) DESC
		LIMIT ?`, whereClause)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	stats := make([]TrafficChainStats, 0, limit)
	for rows.Next() {
		var item TrafficChainStats
		var lastSeen sql.NullTime
		if err := rows.Scan(
			&item.ProxyChain,
			&lastSeen,
			&item.UploadBytes,
			&item.DownloadBytes,
		); err != nil {
			return nil, fmt.Errorf("scan traffic chain stats row: %w", err)
		}
		if lastSeen.Valid {
			item.LastSeen = lastSeen.Time
		}
		stats = append(stats, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate traffic chain stats rows: %w", err)
	}
	return stats, nil
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

func (s *SQLiteStore) latestTrafficSampleIDForSource(sourceIP string) (int64, error) {
	var sampleID int64
	err := s.db.QueryRow(
		`SELECT sample_id FROM traffic_clients WHERE source_ip = ? ORDER BY timestamp DESC, id DESC LIMIT 1`,
		sourceIP,
	).Scan(&sampleID)
	if err != nil {
		if err == sql.ErrNoRows {
			return 0, nil
		}
		return 0, err
	}
	return sampleID, nil
}
