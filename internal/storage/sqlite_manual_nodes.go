package storage

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

func (s *SQLiteStore) GetManualNodes() []ManualNode {
	rows, err := s.db.Query(`SELECT id, tag, type, server, server_port, country, country_emoji, extra_json,
		enabled, group_tag, source_subscription_id FROM manual_nodes`)
	if err != nil {
		return []ManualNode{}
	}
	defer rows.Close()

	var nodes []ManualNode
	for rows.Next() {
		mn, err := scanManualNode(rows)
		if err != nil {
			continue
		}
		nodes = append(nodes, mn)
	}
	if nodes == nil {
		nodes = []ManualNode{}
	}
	return nodes
}

func (s *SQLiteStore) AddManualNode(node ManualNode) error {
	extraJSON := marshalJSON(node.Node.Extra)
	_, err := s.db.Exec(`INSERT INTO manual_nodes (id, tag, type, server, server_port, country, country_emoji, extra_json, enabled, group_tag, source_subscription_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		node.ID, node.Node.Tag, node.Node.Type, node.Node.Server, node.Node.ServerPort,
		node.Node.Country, node.Node.CountryEmoji, extraJSON,
		boolToInt(node.Enabled), node.GroupTag, node.SourceSubscriptionID)
	return err
}

func (s *SQLiteStore) UpdateManualNode(node ManualNode) error {
	extraJSON := marshalJSON(node.Node.Extra)
	res, err := s.db.Exec(`UPDATE manual_nodes SET tag=?, type=?, server=?, server_port=?, country=?, country_emoji=?,
		extra_json=?, enabled=?, group_tag=?, source_subscription_id=? WHERE id=?`,
		node.Node.Tag, node.Node.Type, node.Node.Server, node.Node.ServerPort,
		node.Node.Country, node.Node.CountryEmoji, extraJSON,
		boolToInt(node.Enabled), node.GroupTag, node.SourceSubscriptionID, node.ID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("manual node not found: %s", node.ID)
	}
	return nil
}

func (s *SQLiteStore) DeleteManualNode(id string) error {
	res, err := s.db.Exec("DELETE FROM manual_nodes WHERE id = ?", id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("manual node not found: %s", id)
	}
	return nil
}

func (s *SQLiteStore) FindManualNodeByServerPort(server string, port int) *ManualNode {
	rows, err := s.db.Query(`SELECT id, tag, type, server, server_port, country, country_emoji, extra_json,
		enabled, group_tag, source_subscription_id FROM manual_nodes WHERE server = ? AND server_port = ? LIMIT 1`,
		server, port)
	if err != nil {
		return nil
	}
	defer rows.Close()

	if !rows.Next() {
		return nil
	}
	mn, err := scanManualNode(rows)
	if err != nil {
		return nil
	}
	return &mn
}

func scanManualNode(rows *sql.Rows) (ManualNode, error) {
	var mn ManualNode
	var extraJSON sql.NullString
	var enabled int

	err := rows.Scan(&mn.ID, &mn.Node.Tag, &mn.Node.Type, &mn.Node.Server, &mn.Node.ServerPort,
		&mn.Node.Country, &mn.Node.CountryEmoji, &extraJSON,
		&enabled, &mn.GroupTag, &mn.SourceSubscriptionID)
	if err != nil {
		return mn, err
	}
	mn.Enabled = enabled != 0
	if extraJSON.Valid && extraJSON.String != "" {
		json.Unmarshal([]byte(extraJSON.String), &mn.Node.Extra)
	}
	return mn, nil
}
