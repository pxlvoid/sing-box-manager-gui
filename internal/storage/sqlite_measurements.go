package storage

import (
	"fmt"
	"time"
)

func (s *SQLiteStore) AddHealthMeasurements(measurements []HealthMeasurement) error {
	if len(measurements) == 0 {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`INSERT INTO health_measurements (server, server_port, node_tag, timestamp, alive, latency_ms, mode)
		VALUES (?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, m := range measurements {
		if m.Timestamp.IsZero() {
			m.Timestamp = time.Now()
		}
		alive := 0
		if m.Alive {
			alive = 1
		}
		if _, err := stmt.Exec(m.Server, m.ServerPort, m.NodeTag, m.Timestamp, alive, m.LatencyMs, m.Mode); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *SQLiteStore) GetHealthMeasurements(server string, port int, limit int) ([]HealthMeasurement, error) {
	if limit <= 0 {
		limit = 50
	}

	rows, err := s.db.Query(`SELECT id, server, server_port, node_tag, timestamp, alive, latency_ms, mode
		FROM health_measurements WHERE server = ? AND server_port = ?
		ORDER BY timestamp DESC LIMIT ?`, server, port, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var measurements []HealthMeasurement
	for rows.Next() {
		var m HealthMeasurement
		var alive int
		if err := rows.Scan(&m.ID, &m.Server, &m.ServerPort, &m.NodeTag, &m.Timestamp, &alive, &m.LatencyMs, &m.Mode); err != nil {
			return nil, fmt.Errorf("scanning health measurement row: %w", err)
		}
		m.Alive = alive != 0
		measurements = append(measurements, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating health measurement rows: %w", err)
	}
	return measurements, nil
}

func (s *SQLiteStore) GetHealthStats(server string, port int) (*HealthStats, error) {
	row := s.db.QueryRow(`SELECT
		COUNT(*) as total,
		SUM(CASE WHEN alive = 1 THEN 1 ELSE 0 END) as alive_count,
		COALESCE(AVG(CASE WHEN alive = 1 AND latency_ms > 0 THEN latency_ms END), 0) as avg_latency
		FROM health_measurements
		WHERE server = ? AND server_port = ?`, server, port)

	var stats HealthStats
	var avgLatency float64
	if err := row.Scan(&stats.TotalChecks, &stats.AliveChecks, &avgLatency); err != nil {
		return nil, err
	}
	stats.AvgLatencyMs = avgLatency
	if stats.TotalChecks > 0 {
		stats.UptimePercent = float64(stats.AliveChecks) / float64(stats.TotalChecks) * 100
	}
	return &stats, nil
}

func (s *SQLiteStore) GetBulkHealthStats(days int) ([]NodeStabilityStats, error) {
	if days <= 0 {
		days = 7
	}

	now := time.Now()
	cutoff := now.AddDate(0, 0, -days)
	midpoint := cutoff.Add(time.Duration(days) * 12 * time.Hour)

	rows, err := s.db.Query(`SELECT
		server, server_port,
		COUNT(*) as total,
		SUM(CASE WHEN alive = 1 THEN 1 ELSE 0 END) as alive_count,
		COALESCE(AVG(CASE WHEN alive = 1 AND latency_ms > 0 THEN latency_ms END), 0) as avg_lat,
		COALESCE(AVG(CASE WHEN alive = 1 AND latency_ms > 0 AND timestamp >= ? THEN latency_ms END), 0) as recent_avg,
		COALESCE(AVG(CASE WHEN alive = 1 AND latency_ms > 0 AND timestamp < ? THEN latency_ms END), 0) as older_avg
		FROM health_measurements
		WHERE timestamp >= ?
		GROUP BY server, server_port`, midpoint, midpoint, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []NodeStabilityStats
	for rows.Next() {
		var st NodeStabilityStats
		var recentAvg, olderAvg float64
		if err := rows.Scan(&st.Server, &st.ServerPort, &st.TotalChecks, &st.AliveChecks, &st.AvgLatencyMs, &recentAvg, &olderAvg); err != nil {
			return nil, fmt.Errorf("scanning health stats row: %w", err)
		}
		if st.TotalChecks > 0 {
			st.UptimePercent = float64(st.AliveChecks) / float64(st.TotalChecks) * 100
		}
		// Determine latency trend
		if olderAvg == 0 {
			st.LatencyTrend = "stable"
		} else if recentAvg > olderAvg*1.1 {
			st.LatencyTrend = "up"
		} else if recentAvg < olderAvg*0.9 {
			st.LatencyTrend = "down"
		} else {
			st.LatencyTrend = "stable"
		}
		results = append(results, st)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating health stats rows: %w", err)
	}
	return results, nil
}

func (s *SQLiteStore) AddSiteMeasurements(measurements []SiteMeasurement) error {
	if len(measurements) == 0 {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`INSERT INTO site_measurements (server, server_port, node_tag, timestamp, site, delay_ms, error_type, mode)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, m := range measurements {
		if m.Timestamp.IsZero() {
			m.Timestamp = time.Now()
		}
		if _, err := stmt.Exec(m.Server, m.ServerPort, m.NodeTag, m.Timestamp, m.Site, m.DelayMs, m.ErrorType, m.Mode); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *SQLiteStore) GetLatestHealthMeasurements() ([]HealthMeasurement, error) {
	rows, err := s.db.Query(`SELECT h.id, h.server, h.server_port, h.node_tag, h.timestamp, h.alive, h.latency_ms, h.mode
		FROM health_measurements h
		INNER JOIN (
			SELECT server, server_port, MAX(timestamp) as max_ts
			FROM health_measurements
			GROUP BY server, server_port
		) latest ON h.server = latest.server AND h.server_port = latest.server_port AND h.timestamp = latest.max_ts`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var measurements []HealthMeasurement
	for rows.Next() {
		var m HealthMeasurement
		var alive int
		if err := rows.Scan(&m.ID, &m.Server, &m.ServerPort, &m.NodeTag, &m.Timestamp, &alive, &m.LatencyMs, &m.Mode); err != nil {
			return nil, fmt.Errorf("scanning latest health measurement row: %w", err)
		}
		m.Alive = alive != 0
		measurements = append(measurements, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating latest health measurement rows: %w", err)
	}
	return measurements, nil
}

func (s *SQLiteStore) GetLatestSiteMeasurements() ([]SiteMeasurement, error) {
	rows, err := s.db.Query(`SELECT sm.id, sm.server, sm.server_port, sm.node_tag, sm.timestamp, sm.site, sm.delay_ms, sm.error_type, sm.mode
		FROM site_measurements sm
		INNER JOIN (
			SELECT server, server_port, MAX(timestamp) as max_ts
			FROM site_measurements
			GROUP BY server, server_port
		) latest ON sm.server = latest.server AND sm.server_port = latest.server_port AND sm.timestamp = latest.max_ts`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var measurements []SiteMeasurement
	for rows.Next() {
		var m SiteMeasurement
		if err := rows.Scan(&m.ID, &m.Server, &m.ServerPort, &m.NodeTag, &m.Timestamp, &m.Site, &m.DelayMs, &m.ErrorType, &m.Mode); err != nil {
			return nil, fmt.Errorf("scanning latest site measurement row: %w", err)
		}
		measurements = append(measurements, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating latest site measurement rows: %w", err)
	}
	return measurements, nil
}

func (s *SQLiteStore) GetSiteMeasurements(server string, port int, limit int) ([]SiteMeasurement, error) {
	if limit <= 0 {
		limit = 50
	}

	rows, err := s.db.Query(`SELECT id, server, server_port, node_tag, timestamp, site, delay_ms, error_type, mode
		FROM site_measurements WHERE server = ? AND server_port = ?
		ORDER BY timestamp DESC LIMIT ?`, server, port, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var measurements []SiteMeasurement
	for rows.Next() {
		var m SiteMeasurement
		if err := rows.Scan(&m.ID, &m.Server, &m.ServerPort, &m.NodeTag, &m.Timestamp, &m.Site, &m.DelayMs, &m.ErrorType, &m.Mode); err != nil {
			return nil, fmt.Errorf("scanning site measurement row: %w", err)
		}
		measurements = append(measurements, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating site measurement rows: %w", err)
	}
	return measurements, nil
}
