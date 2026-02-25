package storage

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

const subscriptionColumns = `id, name, url, node_count, updated_at, expire_at, enabled, traffic_json,
	auto_pipeline, pipeline_group_tag, pipeline_min_stability, pipeline_remove_dead, pipeline_last_run, pipeline_last_result_json`

func (s *SQLiteStore) GetSubscriptions() []Subscription {
	rows, err := s.db.Query("SELECT " + subscriptionColumns + " FROM subscriptions")
	if err != nil {
		return nil
	}
	defer rows.Close()

	var subs []Subscription
	for rows.Next() {
		sub, err := scanSubscription(rows)
		if err != nil {
			continue
		}
		sub.Nodes = s.getSubscriptionNodes(sub.ID)
		subs = append(subs, sub)
	}
	if subs == nil {
		subs = []Subscription{}
	}
	return subs
}

func (s *SQLiteStore) GetSubscription(id string) *Subscription {
	row := s.db.QueryRow("SELECT "+subscriptionColumns+" FROM subscriptions WHERE id = ?", id)
	sub, err := scanSubscriptionRow(row)
	if err != nil {
		return nil
	}
	sub.Nodes = s.getSubscriptionNodes(sub.ID)
	return &sub
}

func (s *SQLiteStore) AddSubscription(sub Subscription) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	trafficJSON := marshalJSON(sub.Traffic)
	var expireAt *time.Time
	if sub.ExpireAt != nil {
		expireAt = sub.ExpireAt
	}

	pipelineResultJSON := marshalJSON(sub.PipelineLastResult)

	_, err = tx.Exec(`INSERT INTO subscriptions (id, name, url, node_count, updated_at, expire_at, enabled, traffic_json,
		auto_pipeline, pipeline_group_tag, pipeline_min_stability, pipeline_remove_dead, pipeline_last_run, pipeline_last_result_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		sub.ID, sub.Name, sub.URL, sub.NodeCount, sub.UpdatedAt, expireAt, boolToInt(sub.Enabled), trafficJSON,
		boolToInt(sub.AutoPipeline), sub.PipelineGroupTag, sub.PipelineMinStability, boolToInt(sub.PipelineRemoveDead),
		sub.PipelineLastRun, pipelineResultJSON)
	if err != nil {
		return err
	}

	if err := insertNodesTx(tx, sub.ID, sub.Nodes); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *SQLiteStore) UpdateSubscription(sub Subscription) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	trafficJSON := marshalJSON(sub.Traffic)
	var expireAt *time.Time
	if sub.ExpireAt != nil {
		expireAt = sub.ExpireAt
	}

	pipelineResultJSON := marshalJSON(sub.PipelineLastResult)

	res, err := tx.Exec(`UPDATE subscriptions SET name=?, url=?, node_count=?, updated_at=?, expire_at=?, enabled=?, traffic_json=?,
		auto_pipeline=?, pipeline_group_tag=?, pipeline_min_stability=?, pipeline_remove_dead=?, pipeline_last_run=?, pipeline_last_result_json=?
		WHERE id=?`,
		sub.Name, sub.URL, sub.NodeCount, sub.UpdatedAt, expireAt, boolToInt(sub.Enabled), trafficJSON,
		boolToInt(sub.AutoPipeline), sub.PipelineGroupTag, sub.PipelineMinStability, boolToInt(sub.PipelineRemoveDead),
		sub.PipelineLastRun, pipelineResultJSON, sub.ID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("subscription not found: %s", sub.ID)
	}

	// Replace nodes: DELETE + INSERT
	if _, err := tx.Exec("DELETE FROM subscription_nodes WHERE subscription_id = ?", sub.ID); err != nil {
		return err
	}
	if err := insertNodesTx(tx, sub.ID, sub.Nodes); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *SQLiteStore) DeleteSubscription(id string) error {
	res, err := s.db.Exec("DELETE FROM subscriptions WHERE id = ?", id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("subscription not found: %s", id)
	}
	return nil
}

// getSubscriptionNodes loads nodes for a subscription.
func (s *SQLiteStore) getSubscriptionNodes(subID string) []Node {
	rows, err := s.db.Query("SELECT tag, type, server, server_port, country, country_emoji, extra_json FROM subscription_nodes WHERE subscription_id = ?", subID)
	if err != nil {
		return []Node{}
	}
	defer rows.Close()

	var nodes []Node
	for rows.Next() {
		var n Node
		var extraJSON sql.NullString
		if err := rows.Scan(&n.Tag, &n.Type, &n.Server, &n.ServerPort, &n.Country, &n.CountryEmoji, &extraJSON); err != nil {
			continue
		}
		if extraJSON.Valid && extraJSON.String != "" {
			json.Unmarshal([]byte(extraJSON.String), &n.Extra)
		}
		nodes = append(nodes, n)
	}
	if nodes == nil {
		nodes = []Node{}
	}
	return nodes
}

// insertNodesTx batch-inserts subscription nodes inside a transaction.
func insertNodesTx(tx *sql.Tx, subID string, nodes []Node) error {
	if len(nodes) == 0 {
		return nil
	}
	stmt, err := tx.Prepare(`INSERT INTO subscription_nodes (subscription_id, tag, type, server, server_port, country, country_emoji, extra_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, n := range nodes {
		extraJSON := marshalJSON(n.Extra)
		if _, err := stmt.Exec(subID, n.Tag, n.Type, n.Server, n.ServerPort, n.Country, n.CountryEmoji, extraJSON); err != nil {
			return err
		}
	}
	return nil
}

// scanSubscriptionFields applies common fields from scan results to a Subscription.
func applySubscriptionFields(sub *Subscription, updatedAt, expireAt, pipelineLastRun sql.NullTime,
	enabled, autoPipeline, pipelineRemoveDead int,
	trafficJSON, pipelineResultJSON sql.NullString,
	pipelineGroupTag string, pipelineMinStability float64) {
	if updatedAt.Valid {
		sub.UpdatedAt = updatedAt.Time
	}
	if expireAt.Valid {
		sub.ExpireAt = &expireAt.Time
	}
	sub.Enabled = enabled != 0
	if trafficJSON.Valid && trafficJSON.String != "" {
		var t Traffic
		if json.Unmarshal([]byte(trafficJSON.String), &t) == nil {
			sub.Traffic = &t
		}
	}
	sub.AutoPipeline = autoPipeline != 0
	sub.PipelineGroupTag = pipelineGroupTag
	sub.PipelineMinStability = pipelineMinStability
	sub.PipelineRemoveDead = pipelineRemoveDead != 0
	if pipelineLastRun.Valid {
		sub.PipelineLastRun = &pipelineLastRun.Time
	}
	if pipelineResultJSON.Valid && pipelineResultJSON.String != "" {
		var pr PipelineResult
		if json.Unmarshal([]byte(pipelineResultJSON.String), &pr) == nil {
			sub.PipelineLastResult = &pr
		}
	}
}

// scanSubscription scans a subscription from rows.
func scanSubscription(rows *sql.Rows) (Subscription, error) {
	var sub Subscription
	var updatedAt, expireAt, pipelineLastRun sql.NullTime
	var enabled, autoPipeline, pipelineRemoveDead int
	var trafficJSON, pipelineResultJSON sql.NullString
	var pipelineGroupTag string
	var pipelineMinStability float64

	err := rows.Scan(&sub.ID, &sub.Name, &sub.URL, &sub.NodeCount, &updatedAt, &expireAt, &enabled, &trafficJSON,
		&autoPipeline, &pipelineGroupTag, &pipelineMinStability, &pipelineRemoveDead, &pipelineLastRun, &pipelineResultJSON)
	if err != nil {
		return sub, err
	}
	applySubscriptionFields(&sub, updatedAt, expireAt, pipelineLastRun, enabled, autoPipeline, pipelineRemoveDead,
		trafficJSON, pipelineResultJSON, pipelineGroupTag, pipelineMinStability)
	return sub, nil
}

// scanSubscriptionRow scans a subscription from a single row.
func scanSubscriptionRow(row *sql.Row) (Subscription, error) {
	var sub Subscription
	var updatedAt, expireAt, pipelineLastRun sql.NullTime
	var enabled, autoPipeline, pipelineRemoveDead int
	var trafficJSON, pipelineResultJSON sql.NullString
	var pipelineGroupTag string
	var pipelineMinStability float64

	err := row.Scan(&sub.ID, &sub.Name, &sub.URL, &sub.NodeCount, &updatedAt, &expireAt, &enabled, &trafficJSON,
		&autoPipeline, &pipelineGroupTag, &pipelineMinStability, &pipelineRemoveDead, &pipelineLastRun, &pipelineResultJSON)
	if err != nil {
		return sub, err
	}
	applySubscriptionFields(&sub, updatedAt, expireAt, pipelineLastRun, enabled, autoPipeline, pipelineRemoveDead,
		trafficJSON, pipelineResultJSON, pipelineGroupTag, pipelineMinStability)
	return sub, nil
}

// Helper functions

func marshalJSON(v interface{}) string {
	if v == nil {
		return ""
	}
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
