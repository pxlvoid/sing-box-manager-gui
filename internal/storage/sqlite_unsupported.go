package storage

import "time"

func (s *SQLiteStore) GetUnsupportedNodes() []UnsupportedNode {
	rows, err := s.db.Query("SELECT server, server_port, node_tag, error, detected_at FROM unsupported_nodes")
	if err != nil {
		return nil
	}
	defer rows.Close()

	var nodes []UnsupportedNode
	for rows.Next() {
		var n UnsupportedNode
		if err := rows.Scan(&n.Server, &n.ServerPort, &n.NodeTag, &n.Error, &n.DetectedAt); err != nil {
			continue
		}
		nodes = append(nodes, n)
	}
	return nodes
}

func (s *SQLiteStore) AddUnsupportedNode(node UnsupportedNode) error {
	if node.DetectedAt.IsZero() {
		node.DetectedAt = time.Now()
	}
	_, err := s.db.Exec(`INSERT OR REPLACE INTO unsupported_nodes (server, server_port, node_tag, error, detected_at)
		VALUES (?, ?, ?, ?, ?)`,
		node.Server, node.ServerPort, node.NodeTag, node.Error, node.DetectedAt)
	return err
}

func (s *SQLiteStore) ClearUnsupportedNodes() error {
	_, err := s.db.Exec("DELETE FROM unsupported_nodes")
	return err
}

func (s *SQLiteStore) DeleteUnsupportedNodesByTags(tags []string) error {
	if len(tags) == 0 {
		return nil
	}
	for _, tag := range tags {
		if _, err := s.db.Exec("DELETE FROM unsupported_nodes WHERE node_tag = ?", tag); err != nil {
			return err
		}
	}
	return nil
}
