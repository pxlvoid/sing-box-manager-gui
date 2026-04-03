package storage

import "time"

// AddSpeedMeasurements inserts speed test results in batch.
func (s *SQLiteStore) AddSpeedMeasurements(measurements []SpeedMeasurement) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO speed_measurements (server, server_port, node_tag, timestamp, download_bps, download_bytes, duration_ms, error)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, m := range measurements {
		_, err := stmt.Exec(m.Server, m.ServerPort, m.NodeTag, m.Timestamp, m.DownloadBps, m.DownloadBytes, m.DurationMs, m.Error)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

// GetLatestSpeedMeasurements returns the most recent speed measurement per unique server:port.
func (s *SQLiteStore) GetLatestSpeedMeasurements() ([]SpeedMeasurement, error) {
	rows, err := s.db.Query(`
		SELECT sm.id, sm.server, sm.server_port, sm.node_tag, sm.timestamp, sm.download_bps, sm.download_bytes, sm.duration_ms, sm.error
		FROM speed_measurements sm
		INNER JOIN (
			SELECT server, server_port, MAX(timestamp) as max_ts
			FROM speed_measurements
			GROUP BY server, server_port
		) latest ON sm.server = latest.server AND sm.server_port = latest.server_port AND sm.timestamp = latest.max_ts
		ORDER BY sm.download_bps DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []SpeedMeasurement
	for rows.Next() {
		var m SpeedMeasurement
		var ts string
		if err := rows.Scan(&m.ID, &m.Server, &m.ServerPort, &m.NodeTag, &ts, &m.DownloadBps, &m.DownloadBytes, &m.DurationMs, &m.Error); err != nil {
			return nil, err
		}
		m.Timestamp, _ = time.Parse(time.RFC3339Nano, ts)
		if m.Timestamp.IsZero() {
			m.Timestamp, _ = time.Parse("2006-01-02 15:04:05", ts)
		}
		result = append(result, m)
	}
	return result, nil
}

// GetSpeedMeasurements returns speed measurements for a specific node.
func (s *SQLiteStore) GetSpeedMeasurements(server string, port int, limit int) ([]SpeedMeasurement, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := s.db.Query(`
		SELECT id, server, server_port, node_tag, timestamp, download_bps, download_bytes, duration_ms, error
		FROM speed_measurements
		WHERE server = ? AND server_port = ?
		ORDER BY timestamp DESC
		LIMIT ?
	`, server, port, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []SpeedMeasurement
	for rows.Next() {
		var m SpeedMeasurement
		var ts string
		if err := rows.Scan(&m.ID, &m.Server, &m.ServerPort, &m.NodeTag, &ts, &m.DownloadBps, &m.DownloadBytes, &m.DurationMs, &m.Error); err != nil {
			return nil, err
		}
		m.Timestamp, _ = time.Parse(time.RFC3339Nano, ts)
		if m.Timestamp.IsZero() {
			m.Timestamp, _ = time.Parse("2006-01-02 15:04:05", ts)
		}
		result = append(result, m)
	}
	return result, nil
}
