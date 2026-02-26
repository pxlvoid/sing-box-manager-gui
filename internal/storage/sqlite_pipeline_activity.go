package storage

func (s *SQLiteStore) AddPipelineActivityLog(log PipelineActivityLog) error {
	_, err := s.db.Exec(`INSERT INTO pipeline_activity_logs (event_type, message, timestamp) VALUES (?, ?, ?)`,
		log.Type, log.Message, log.Timestamp)
	return err
}

func (s *SQLiteStore) GetPipelineActivityLogs(limit int) []PipelineActivityLog {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Query(`SELECT id, event_type, message, timestamp
		FROM pipeline_activity_logs ORDER BY timestamp DESC LIMIT ?`, limit)
	if err != nil {
		return []PipelineActivityLog{}
	}
	defer rows.Close()

	logs := make([]PipelineActivityLog, 0, limit)
	for rows.Next() {
		var l PipelineActivityLog
		if err := rows.Scan(&l.ID, &l.Type, &l.Message, &l.Timestamp); err != nil {
			continue
		}
		logs = append(logs, l)
	}
	return logs
}
