package storage

import (
	"database/sql"
	"fmt"
	"strconv"
	"strings"
	"time"
)

func monitoringTimestampUnix(ts time.Time) int64 {
	if ts.IsZero() {
		return 0
	}
	return ts.UTC().UnixNano()
}

func (s *SQLiteStore) AddTrafficSample(sample TrafficSample, clients []ClientTrafficSnapshot, resources []ClientResourceSnapshot) (int64, error) {
	if sample.Timestamp.IsZero() {
		sample.Timestamp = time.Now().UTC()
	}
	sample.Timestamp = sample.Timestamp.UTC()
	sample.TimestampUnix = monitoringTimestampUnix(sample.Timestamp)

	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	res, err := tx.Exec(`INSERT INTO traffic_samples (
		timestamp, timestamp_unix, up_bps, down_bps, upload_total, download_total,
		active_connections, client_count, memory_inuse, memory_oslimit
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		sample.Timestamp,
		sample.TimestampUnix,
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
			sample_id, timestamp, timestamp_unix, source_ip, active_connections, upload_bytes,
			download_bytes, duration_seconds, proxy_chain, host_count, top_host
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
		if err != nil {
			return 0, err
		}
		defer stmt.Close()

		for _, client := range clients {
			ts := client.Timestamp
			if ts.IsZero() {
				ts = sample.Timestamp
			}
			ts = ts.UTC()
			if _, err := stmt.Exec(
				sampleID,
				ts,
				monitoringTimestampUnix(ts),
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
			sample_id, timestamp, timestamp_unix, source_ip, host, active_connections,
			upload_bytes, download_bytes, upload_total, download_total, proxy_chain
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
		if err != nil {
			return 0, err
		}
		defer stmt.Close()

		for _, resource := range resources {
			ts := resource.Timestamp
			if ts.IsZero() {
				ts = sample.Timestamp
			}
			ts = ts.UTC()
			if _, err := stmt.Exec(
				sampleID,
				ts,
				monitoringTimestampUnix(ts),
				resource.SourceIP,
				resource.Host,
				resource.ActiveConnections,
				resource.UploadBytes,
				resource.DownloadBytes,
				resource.UploadTotal,
				resource.DownloadTotal,
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
		ORDER BY timestamp_unix DESC, id DESC
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

// GetTrafficSamplesByTimeRange returns traffic samples within the given time range,
// downsampled to approximately maxPoints data points using time-bucket averaging.
func (s *SQLiteStore) GetTrafficSamplesByTimeRange(since time.Time, maxPoints int) ([]TrafficSample, error) {
	if maxPoints <= 0 {
		maxPoints = 500
	}
	if maxPoints > 5000 {
		maxPoints = 5000
	}

	sinceUnix := monitoringTimestampUnix(since)
	duration := time.Since(since)
	bucketSeconds := int(duration.Seconds()) / maxPoints
	if bucketSeconds < 1 {
		bucketSeconds = 1
	}
	bucketWidth := int64(bucketSeconds) * int64(time.Second)

	query := `WITH filtered AS (
		SELECT
			id,
			timestamp_unix,
			up_bps,
			down_bps,
			upload_total,
			download_total,
			active_connections,
			client_count,
			memory_inuse,
			memory_oslimit,
			timestamp_unix / ? AS bucket
		FROM traffic_samples
		WHERE timestamp_unix >= ?
	),
	ranked AS (
		SELECT
			id,
			timestamp_unix,
			upload_total,
			download_total,
			CAST(AVG(up_bps) OVER (PARTITION BY bucket) AS INTEGER) AS avg_up_bps,
			CAST(AVG(down_bps) OVER (PARTITION BY bucket) AS INTEGER) AS avg_down_bps,
			MAX(active_connections) OVER (PARTITION BY bucket) AS peak_active_connections,
			MAX(client_count) OVER (PARTITION BY bucket) AS peak_client_count,
			CAST(AVG(memory_inuse) OVER (PARTITION BY bucket) AS INTEGER) AS avg_memory_inuse,
			MAX(memory_oslimit) OVER (PARTITION BY bucket) AS max_memory_oslimit,
			ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY timestamp_unix DESC, id DESC) AS rn
		FROM filtered
	)
	SELECT
		id,
		timestamp_unix,
		avg_up_bps,
		avg_down_bps,
		upload_total,
		download_total,
		peak_active_connections,
		peak_client_count,
		avg_memory_inuse,
		max_memory_oslimit
	FROM ranked
	WHERE rn = 1
	ORDER BY timestamp_unix ASC`

	rows, err := s.db.Query(query, bucketWidth, sinceUnix)
	if err != nil {
		return nil, fmt.Errorf("query traffic samples by time range: %w", err)
	}
	defer rows.Close()

	samples := make([]TrafficSample, 0, maxPoints)
	for rows.Next() {
		var (
			sample     TrafficSample
			bucketUnix int64
		)
		if err := rows.Scan(
			&sample.ID,
			&bucketUnix,
			&sample.UpBps,
			&sample.DownBps,
			&sample.UploadTotal,
			&sample.DownloadTotal,
			&sample.ActiveConnections,
			&sample.ClientCount,
			&sample.MemoryInuse,
			&sample.MemoryOSLimit,
		); err != nil {
			return nil, fmt.Errorf("scan traffic sample bucket row: %w", err)
		}
		sample.TimestampUnix = bucketUnix
		sample.Timestamp = time.Unix(0, bucketUnix).UTC()
		samples = append(samples, sample)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate traffic sample bucket rows: %w", err)
	}

	return samples, nil
}

func (s *SQLiteStore) GetLatestTrafficSample() (*TrafficSample, error) {
	var sample TrafficSample
	err := s.db.QueryRow(`SELECT
		id, timestamp, up_bps, down_bps, upload_total, download_total,
		active_connections, client_count, memory_inuse, memory_oslimit
		FROM traffic_samples
		ORDER BY timestamp_unix DESC, id DESC
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

func (s *SQLiteStore) GetClientTrafficHistory(sourceIP string, limit int) ([]ClientTrafficSnapshot, error) {
	if limit <= 0 {
		limit = 120
	}
	if limit > 5000 {
		limit = 5000
	}

	rows, err := s.db.Query(`SELECT
		id, sample_id, timestamp, source_ip, active_connections,
		upload_bytes, download_bytes, duration_seconds, proxy_chain, host_count, top_host
		FROM traffic_clients
		WHERE source_ip = ?
		ORDER BY timestamp_unix DESC, id DESC
		LIMIT ?`, sourceIP, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	snapshots := make([]ClientTrafficSnapshot, 0, limit)
	for rows.Next() {
		var snap ClientTrafficSnapshot
		if err := rows.Scan(
			&snap.ID,
			&snap.SampleID,
			&snap.Timestamp,
			&snap.SourceIP,
			&snap.ActiveConnections,
			&snap.UploadBytes,
			&snap.DownloadBytes,
			&snap.DurationSeconds,
			&snap.ProxyChain,
			&snap.HostCount,
			&snap.TopHost,
		); err != nil {
			return nil, fmt.Errorf("scan client traffic history row: %w", err)
		}
		snapshots = append(snapshots, snap)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate client traffic history rows: %w", err)
	}

	// Reverse to ascending order for charting.
	for i, j := 0, len(snapshots)-1; i < j; i, j = i+1, j-1 {
		snapshots[i], snapshots[j] = snapshots[j], snapshots[i]
	}

	return snapshots, nil
}

func (s *SQLiteStore) GetClientTrafficHistoryByTimeRange(sourceIP string, since time.Time, maxPoints int) ([]ClientTrafficSnapshot, error) {
	if maxPoints <= 0 {
		maxPoints = 500
	}
	if maxPoints > 5000 {
		maxPoints = 5000
	}

	duration := time.Since(since)
	bucketSeconds := int(duration.Seconds()) / maxPoints
	if bucketSeconds < 1 {
		bucketSeconds = 1
	}
	bucketWidth := int64(bucketSeconds) * int64(time.Second)

	sinceUnix := monitoringTimestampUnix(since)
	rows, err := s.db.Query(`
		WITH filtered AS (
			SELECT
				id,
				sample_id,
				source_ip,
				timestamp_unix,
				active_connections,
				upload_bytes,
				download_bytes,
				duration_seconds,
				proxy_chain,
				host_count,
				top_host,
				timestamp_unix / ? AS bucket
			FROM traffic_clients
			WHERE source_ip = ? AND timestamp_unix >= ?
		),
		ranked AS (
			SELECT
				id,
				sample_id,
				source_ip,
				timestamp_unix,
				upload_bytes,
				download_bytes,
				duration_seconds,
				proxy_chain,
				host_count,
				top_host,
				MAX(active_connections) OVER (PARTITION BY bucket) AS peak_active_connections,
				ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY timestamp_unix DESC, id DESC) AS rn
			FROM filtered
		)
		SELECT
			id,
			sample_id,
			timestamp_unix,
			source_ip,
			peak_active_connections,
			upload_bytes,
			download_bytes,
			duration_seconds,
			proxy_chain,
			host_count,
			top_host
		FROM ranked
		WHERE rn = 1
		ORDER BY timestamp_unix ASC`,
		bucketWidth,
		sourceIP,
		sinceUnix,
	)
	if err != nil {
		return nil, fmt.Errorf("query client traffic history by time range: %w", err)
	}
	defer rows.Close()

	snapshots := make([]ClientTrafficSnapshot, 0, maxPoints)
	for rows.Next() {
		var (
			snap   ClientTrafficSnapshot
			tsUnix int64
		)
		if err := rows.Scan(
			&snap.ID,
			&snap.SampleID,
			&tsUnix,
			&snap.SourceIP,
			&snap.ActiveConnections,
			&snap.UploadBytes,
			&snap.DownloadBytes,
			&snap.DurationSeconds,
			&snap.ProxyChain,
			&snap.HostCount,
			&snap.TopHost,
		); err != nil {
			return nil, fmt.Errorf("scan client traffic history bucket row: %w", err)
		}
		snap.TimestampUnix = tsUnix
		snap.Timestamp = time.Unix(0, tsUnix).UTC()
		snapshots = append(snapshots, snap)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate client traffic history bucket rows: %w", err)
	}

	return snapshots, nil
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

	cutoffUnix := monitoringTimestampUnix(time.Now().Add(-lookback))
	rows, err := s.db.Query(`
		WITH latest_sample AS (
			SELECT id AS sample_id FROM traffic_samples ORDER BY timestamp_unix DESC, id DESC LIMIT 1
		),
		-- Compute per-client lifetime traffic using delta method.
		-- This correctly handles server restarts where cumulative counters reset.
		client_deltas AS (
			SELECT
				source_ip,
				upload_bytes,
				download_bytes,
				LAG(upload_bytes) OVER (PARTITION BY source_ip ORDER BY timestamp_unix ASC, id ASC) AS prev_upload,
				LAG(download_bytes) OVER (PARTITION BY source_ip ORDER BY timestamp_unix ASC, id ASC) AS prev_download
			FROM traffic_clients
		),
		lifetime_traffic AS (
			SELECT
				source_ip,
				SUM(
					CASE
						WHEN prev_upload IS NULL THEN upload_bytes
						WHEN upload_bytes >= prev_upload THEN upload_bytes - prev_upload
						ELSE upload_bytes
					END
				) AS total_upload,
				SUM(
					CASE
						WHEN prev_download IS NULL THEN download_bytes
						WHEN download_bytes >= prev_download THEN download_bytes - prev_download
						ELSE download_bytes
					END
				) AS total_download
			FROM client_deltas
			GROUP BY source_ip
		),
		ranked AS (
			SELECT
				tc.source_ip,
				tc.sample_id,
				tc.timestamp_unix,
				tc.active_connections,
				tc.upload_bytes,
				tc.download_bytes,
				tc.duration_seconds,
				tc.proxy_chain,
				tc.host_count,
				tc.top_host,
				ROW_NUMBER() OVER (PARTITION BY tc.source_ip ORDER BY tc.timestamp_unix DESC, tc.id DESC) AS rn
			FROM traffic_clients tc
			WHERE tc.timestamp_unix >= ?
		)
		SELECT
			r.source_ip,
			r.timestamp_unix,
			CASE WHEN r.sample_id = (SELECT sample_id FROM latest_sample) THEN 1 ELSE 0 END AS online,
			CASE WHEN r.sample_id = (SELECT sample_id FROM latest_sample) THEN r.active_connections ELSE 0 END AS active_connections,
			COALESCE(lt.total_upload, r.upload_bytes) AS upload_bytes,
			COALESCE(lt.total_download, r.download_bytes) AS download_bytes,
			r.duration_seconds,
			r.proxy_chain,
			r.host_count,
			r.top_host
		FROM ranked r
		LEFT JOIN lifetime_traffic lt ON lt.source_ip = r.source_ip
		WHERE r.rn = 1
		ORDER BY online DESC, r.timestamp_unix DESC
		LIMIT ?`, cutoffUnix, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	clients := make([]TrafficClientRecent, 0, limit)
	for rows.Next() {
		var (
			client       TrafficClientRecent
			lastSeenUnix int64
			online       int
		)
		if err := rows.Scan(
			&client.SourceIP,
			&lastSeenUnix,
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
		client.LastSeen = time.Unix(0, lastSeenUnix).UTC()
		client.Online = online != 0
		clients = append(clients, client)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate recent traffic client rows: %w", err)
	}

	return clients, nil
}

func (s *SQLiteStore) GetClientResourcesHistory(sourceIP string, limit int) ([]ClientResourceHistory, error) {
	if limit <= 0 {
		limit = 500
	}
	if limit > 5000 {
		limit = 5000
	}

	const resourceSegmentGap = int64(8 * time.Second)
	rows, err := s.db.Query(`
		WITH resource_rows AS (
			SELECT
				id,
				host,
				active_connections,
				COALESCE(upload_total, upload_bytes) AS upload_value,
				COALESCE(download_total, download_bytes) AS download_value,
				proxy_chain,
				timestamp_unix,
				CASE
					WHEN upload_total IS NOT NULL OR download_total IS NOT NULL THEN 1
					ELSE 0
				END AS has_precise_totals
			FROM traffic_resources
			WHERE source_ip = ?
		),
		resource_deltas AS (
			SELECT
				host,
				active_connections,
				upload_value,
				download_value,
				proxy_chain,
				timestamp_unix,
				has_precise_totals,
				LAG(active_connections) OVER (PARTITION BY host ORDER BY timestamp_unix ASC, id ASC) AS prev_active_connections,
				LAG(upload_value) OVER (PARTITION BY host ORDER BY timestamp_unix ASC, id ASC) AS prev_upload,
				LAG(download_value) OVER (PARTITION BY host ORDER BY timestamp_unix ASC, id ASC) AS prev_download,
				LAG(timestamp_unix) OVER (PARTITION BY host ORDER BY timestamp_unix ASC, id ASC) AS prev_timestamp_unix,
				LAG(has_precise_totals) OVER (PARTITION BY host ORDER BY timestamp_unix ASC, id ASC) AS prev_has_precise_totals
			FROM resource_rows
		)
		SELECT
			host,
			SUM(
				CASE
					WHEN prev_upload IS NULL THEN upload_value
					WHEN has_precise_totals = 1 AND prev_has_precise_totals = 1 AND upload_value >= prev_upload THEN upload_value - prev_upload
					WHEN has_precise_totals = 1 THEN upload_value
					WHEN upload_value >= prev_upload THEN upload_value - prev_upload
					WHEN (timestamp_unix - COALESCE(prev_timestamp_unix, 0)) > ? THEN upload_value
					WHEN active_connections > COALESCE(prev_active_connections, 0) AND upload_value > prev_upload THEN upload_value - prev_upload
					ELSE 0
				END
			) AS total_upload,
			SUM(
				CASE
					WHEN prev_download IS NULL THEN download_value
					WHEN has_precise_totals = 1 AND prev_has_precise_totals = 1 AND download_value >= prev_download THEN download_value - prev_download
					WHEN has_precise_totals = 1 THEN download_value
					WHEN download_value >= prev_download THEN download_value - prev_download
					WHEN (timestamp_unix - COALESCE(prev_timestamp_unix, 0)) > ? THEN download_value
					WHEN active_connections > COALESCE(prev_active_connections, 0) AND download_value > prev_download THEN download_value - prev_download
					ELSE 0
				END
			) AS total_download,
			MAX(proxy_chain) AS proxy_chain,
			MIN(timestamp_unix) AS first_seen_unix,
			MAX(timestamp_unix) AS last_seen_unix
		FROM resource_deltas
		GROUP BY host
		ORDER BY (total_upload + total_download) DESC
		LIMIT ?`, sourceIP, resourceSegmentGap, resourceSegmentGap, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make([]ClientResourceHistory, 0, limit)
	for rows.Next() {
		var (
			r             ClientResourceHistory
			firstSeenUnix int64
			lastSeenUnix  int64
		)
		if err := rows.Scan(
			&r.Host,
			&r.TotalUpload,
			&r.TotalDownload,
			&r.ProxyChain,
			&firstSeenUnix,
			&lastSeenUnix,
		); err != nil {
			return nil, fmt.Errorf("scan client resources history row: %w", err)
		}
		r.FirstSeen = time.Unix(0, firstSeenUnix).UTC()
		r.LastSeen = time.Unix(0, lastSeenUnix).UTC()
		results = append(results, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate client resources history rows: %w", err)
	}

	return results, nil
}

func (s *SQLiteStore) GetTrafficLifetimeStats() (*TrafficLifetimeStats, error) {
	stats := &TrafficLifetimeStats{}

	var firstSampleUnix sql.NullInt64
	var lastSampleUnix sql.NullInt64
	if err := s.db.QueryRow(
		`SELECT COUNT(*) AS sample_count, MIN(NULLIF(timestamp_unix, 0)), MAX(NULLIF(timestamp_unix, 0)) FROM traffic_samples`,
	).Scan(&stats.SampleCount, &firstSampleUnix, &lastSampleUnix); err != nil {
		return nil, err
	}

	if firstSampleUnix.Valid {
		t := time.Unix(0, firstSampleUnix.Int64).UTC()
		stats.FirstSampleAt = &t
	}

	if lastSampleUnix.Valid {
		t := time.Unix(0, lastSampleUnix.Int64).UTC()
		stats.LastSampleAt = &t
	}

	if err := s.db.QueryRow(`SELECT COUNT(DISTINCT source_ip) FROM traffic_clients`).Scan(&stats.TotalClients); err != nil {
		return nil, err
	}

	rows, err := s.db.Query(`
		SELECT upload_total, download_total
		FROM traffic_samples
		ORDER BY timestamp_unix ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var prevUpload int64
	var prevDownload int64
	hasPrev := false

	for rows.Next() {
		var uploadTotal sql.NullInt64
		var downloadTotal sql.NullInt64
		if err := rows.Scan(&uploadTotal, &downloadTotal); err != nil {
			return nil, fmt.Errorf("scan lifetime traffic row: %w", err)
		}

		currentUpload := int64(0)
		currentDownload := int64(0)
		if uploadTotal.Valid && uploadTotal.Int64 > 0 {
			currentUpload = uploadTotal.Int64
		}
		if downloadTotal.Valid && downloadTotal.Int64 > 0 {
			currentDownload = downloadTotal.Int64
		}

		if !hasPrev {
			stats.TotalUploadBytes += currentUpload
			stats.TotalDownloadBytes += currentDownload
			prevUpload = currentUpload
			prevDownload = currentDownload
			hasPrev = true
			continue
		}

		if currentUpload >= prevUpload {
			stats.TotalUploadBytes += currentUpload - prevUpload
		} else {
			// Counter reset (e.g. sing-box restart): start new segment from current total.
			stats.TotalUploadBytes += currentUpload
		}

		if currentDownload >= prevDownload {
			stats.TotalDownloadBytes += currentDownload - prevDownload
		} else {
			// Counter reset (e.g. sing-box restart): start new segment from current total.
			stats.TotalDownloadBytes += currentDownload
		}

		prevUpload = currentUpload
		prevDownload = currentDownload
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate lifetime traffic rows: %w", err)
	}

	return stats, nil
}

func parseSQLiteTimestampValue(raw interface{}) (time.Time, bool, error) {
	switch v := raw.(type) {
	case nil:
		return time.Time{}, false, nil
	case time.Time:
		return v, true, nil
	case string:
		return parseSQLiteTimestampString(v)
	case []byte:
		return parseSQLiteTimestampString(string(v))
	default:
		return time.Time{}, false, fmt.Errorf("unsupported timestamp type %T", raw)
	}
}

func parseSQLiteTimestampString(value string) (time.Time, bool, error) {
	s := strings.TrimSpace(value)
	if s == "" {
		return time.Time{}, false, nil
	}

	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05.999999999 -0700 MST",
		"2006-01-02 15:04:05 -0700 MST",
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05-07:00",
		"2006-01-02 15:04:05",
	}
	for _, layout := range layouts {
		if ts, err := time.Parse(layout, s); err == nil {
			return ts, true, nil
		}
	}

	// Be tolerant to unix timestamps that may appear from custom SQL conversions.
	if unix, err := strconv.ParseInt(s, 10, 64); err == nil {
		switch {
		case unix > 1_000_000_000_000_000_000:
			return time.Unix(0, unix), true, nil
		case unix > 1_000_000_000_000_000:
			return time.UnixMicro(unix), true, nil
		case unix > 1_000_000_000_000:
			return time.UnixMilli(unix), true, nil
		default:
			return time.Unix(unix, 0), true, nil
		}
	}

	return time.Time{}, false, fmt.Errorf("unsupported timestamp format %q", s)
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
		cutoffUnix := monitoringTimestampUnix(time.Now().Add(-lookback))
		whereClause = "WHERE timestamp_unix >= ?"
		args = append(args, cutoffUnix)
	}
	args = append(args, limit)

	query := fmt.Sprintf(`
		WITH client_deltas AS (
			SELECT
				source_ip,
				COALESCE(NULLIF(TRIM(proxy_chain), ''), 'direct') AS proxy_chain,
				timestamp_unix,
				id,
				upload_bytes,
				download_bytes,
				LAG(upload_bytes) OVER (
					PARTITION BY source_ip
					ORDER BY timestamp_unix, id
				) AS prev_upload,
				LAG(download_bytes) OVER (
					PARTITION BY source_ip
					ORDER BY timestamp_unix, id
				) AS prev_download
			FROM traffic_clients
			%s
		),
		sample_deltas AS (
			SELECT
				proxy_chain,
				timestamp_unix,
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
			FROM client_deltas
		)
		SELECT
			proxy_chain,
			MAX(timestamp_unix) AS last_seen_unix,
			COALESCE(SUM(upload_delta), 0) AS upload_bytes,
			COALESCE(SUM(download_delta), 0) AS download_bytes
		FROM sample_deltas
		GROUP BY proxy_chain
		ORDER BY (COALESCE(SUM(upload_delta), 0) + COALESCE(SUM(download_delta), 0)) DESC, MAX(timestamp_unix) DESC
		LIMIT ?`, whereClause)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	stats := make([]TrafficChainStats, 0, limit)
	for rows.Next() {
		var (
			item         TrafficChainStats
			lastSeenUnix int64
		)
		if err := rows.Scan(
			&item.ProxyChain,
			&lastSeenUnix,
			&item.UploadBytes,
			&item.DownloadBytes,
		); err != nil {
			return nil, fmt.Errorf("scan traffic chain stats row: %w", err)
		}
		item.LastSeen = time.Unix(0, lastSeenUnix).UTC()
		stats = append(stats, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate traffic chain stats rows: %w", err)
	}
	return stats, nil
}

func (s *SQLiteStore) latestTrafficSampleID() (int64, error) {
	var sampleID int64
	err := s.db.QueryRow(`SELECT id FROM traffic_samples ORDER BY timestamp_unix DESC, id DESC LIMIT 1`).Scan(&sampleID)
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
		`SELECT sample_id FROM traffic_clients WHERE source_ip = ? ORDER BY timestamp_unix DESC, id DESC LIMIT 1`,
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
