package storage

import (
	"database/sql"
	"encoding/json"
	"time"
)

func (s *SQLiteStore) GetManualNodesBySourceSubscription(subscriptionID string) ([]ManualNode, error) {
	rows, err := s.db.Query(`SELECT id, tag, type, server, server_port, country, country_emoji, extra_json, enabled, group_tag, source_subscription_id
		FROM manual_nodes WHERE source_subscription_id = ?`, subscriptionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var nodes []ManualNode
	for rows.Next() {
		var mn ManualNode
		var extraJSON sql.NullString
		var enabled int
		if err := rows.Scan(&mn.ID, &mn.Node.Tag, &mn.Node.Type, &mn.Node.Server, &mn.Node.ServerPort,
			&mn.Node.Country, &mn.Node.CountryEmoji, &extraJSON, &enabled, &mn.GroupTag, &mn.SourceSubscriptionID); err != nil {
			continue
		}
		mn.Enabled = enabled != 0
		if extraJSON.Valid && extraJSON.String != "" {
			json.Unmarshal([]byte(extraJSON.String), &mn.Node.Extra)
		}
		nodes = append(nodes, mn)
	}
	if nodes == nil {
		nodes = []ManualNode{}
	}
	return nodes, nil
}

func (s *SQLiteStore) GetPipelineLogs(subscriptionID string, limit int) ([]PipelineLog, error) {
	rows, err := s.db.Query(`SELECT id, subscription_id, timestamp, total_nodes, checked_nodes, alive_nodes,
		copied_nodes, skipped_nodes, removed_stale, error, duration_ms
		FROM pipeline_logs WHERE subscription_id = ? ORDER BY timestamp DESC LIMIT ?`, subscriptionID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []PipelineLog
	for rows.Next() {
		var l PipelineLog
		var ts time.Time
		if err := rows.Scan(&l.ID, &l.SubscriptionID, &ts,
			&l.TotalNodes, &l.CheckedNodes, &l.AliveNodes,
			&l.CopiedNodes, &l.SkippedNodes, &l.RemovedStale,
			&l.Error, &l.DurationMs); err != nil {
			continue
		}
		l.Timestamp = ts
		logs = append(logs, l)
	}
	if logs == nil {
		logs = []PipelineLog{}
	}
	return logs, nil
}

func (s *SQLiteStore) AddPipelineLog(log PipelineLog) error {
	_, err := s.db.Exec(`INSERT INTO pipeline_logs (subscription_id, timestamp, total_nodes, checked_nodes, alive_nodes,
		copied_nodes, skipped_nodes, removed_stale, error, duration_ms)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		log.SubscriptionID, log.Timestamp, log.TotalNodes, log.CheckedNodes, log.AliveNodes,
		log.CopiedNodes, log.SkippedNodes, log.RemovedStale, log.Error, log.DurationMs)
	return err
}

func (s *SQLiteStore) GetConsecutiveFailures(server string, port int, maxCount int) (int, error) {
	rows, err := s.db.Query(`SELECT alive FROM health_measurements
		WHERE server = ? AND server_port = ? ORDER BY timestamp DESC LIMIT ?`, server, port, maxCount)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var alive int
		if err := rows.Scan(&alive); err != nil {
			break
		}
		if alive != 0 {
			break
		}
		count++
	}
	return count, nil
}
