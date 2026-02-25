package storage

import "time"

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
			continue
		}
		m.Alive = alive != 0
		measurements = append(measurements, m)
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

func (s *SQLiteStore) AddSiteMeasurements(measurements []SiteMeasurement) error {
	if len(measurements) == 0 {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`INSERT INTO site_measurements (server, server_port, node_tag, timestamp, site, delay_ms, mode)
		VALUES (?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, m := range measurements {
		if m.Timestamp.IsZero() {
			m.Timestamp = time.Now()
		}
		if _, err := stmt.Exec(m.Server, m.ServerPort, m.NodeTag, m.Timestamp, m.Site, m.DelayMs, m.Mode); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *SQLiteStore) GetSiteMeasurements(server string, port int, limit int) ([]SiteMeasurement, error) {
	if limit <= 0 {
		limit = 50
	}

	rows, err := s.db.Query(`SELECT id, server, server_port, node_tag, timestamp, site, delay_ms, mode
		FROM site_measurements WHERE server = ? AND server_port = ?
		ORDER BY timestamp DESC LIMIT ?`, server, port, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var measurements []SiteMeasurement
	for rows.Next() {
		var m SiteMeasurement
		if err := rows.Scan(&m.ID, &m.Server, &m.ServerPort, &m.NodeTag, &m.Timestamp, &m.Site, &m.DelayMs, &m.Mode); err != nil {
			continue
		}
		measurements = append(measurements, m)
	}
	return measurements, nil
}
