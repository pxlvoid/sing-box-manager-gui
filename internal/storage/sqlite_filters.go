package storage

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

func (s *SQLiteStore) GetFilters() []Filter {
	rows, err := s.db.Query(`SELECT id, name, mode, urltest_config_json, all_nodes, enabled,
		include_json, exclude_json, include_countries_json, exclude_countries_json, subscriptions_json
		FROM filters`)
	if err != nil {
		return []Filter{}
	}
	defer rows.Close()

	var filters []Filter
	for rows.Next() {
		f, err := scanFilter(rows)
		if err != nil {
			continue
		}
		filters = append(filters, f)
	}
	if filters == nil {
		filters = []Filter{}
	}
	return filters
}

func (s *SQLiteStore) GetFilter(id string) *Filter {
	rows, err := s.db.Query(`SELECT id, name, mode, urltest_config_json, all_nodes, enabled,
		include_json, exclude_json, include_countries_json, exclude_countries_json, subscriptions_json
		FROM filters WHERE id = ?`, id)
	if err != nil {
		return nil
	}
	defer rows.Close()

	if !rows.Next() {
		return nil
	}
	f, err := scanFilter(rows)
	if err != nil {
		return nil
	}
	return &f
}

func (s *SQLiteStore) AddFilter(filter Filter) error {
	return s.upsertFilter(filter, false)
}

func (s *SQLiteStore) UpdateFilter(filter Filter) error {
	return s.upsertFilter(filter, true)
}

func (s *SQLiteStore) upsertFilter(f Filter, mustExist bool) error {
	if mustExist {
		var count int
		s.db.QueryRow("SELECT COUNT(*) FROM filters WHERE id = ?", f.ID).Scan(&count)
		if count == 0 {
			return fmt.Errorf("filter not found: %s", f.ID)
		}
	}

	_, err := s.db.Exec(`INSERT OR REPLACE INTO filters
		(id, name, mode, urltest_config_json, all_nodes, enabled,
		 include_json, exclude_json, include_countries_json, exclude_countries_json, subscriptions_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		f.ID, f.Name, f.Mode,
		marshalJSON(f.URLTestConfig),
		boolToInt(f.AllNodes), boolToInt(f.Enabled),
		marshalJSON(f.Include), marshalJSON(f.Exclude),
		marshalJSON(f.IncludeCountries), marshalJSON(f.ExcludeCountries),
		marshalJSON(f.Subscriptions))
	return err
}

func (s *SQLiteStore) DeleteFilter(id string) error {
	res, err := s.db.Exec("DELETE FROM filters WHERE id = ?", id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("filter not found: %s", id)
	}
	return nil
}

func scanFilter(rows *sql.Rows) (Filter, error) {
	var f Filter
	var urltestJSON, includeJSON, excludeJSON, includeCountriesJSON, excludeCountriesJSON, subscriptionsJSON sql.NullString
	var allNodes, enabled int

	err := rows.Scan(&f.ID, &f.Name, &f.Mode, &urltestJSON, &allNodes, &enabled,
		&includeJSON, &excludeJSON, &includeCountriesJSON, &excludeCountriesJSON, &subscriptionsJSON)
	if err != nil {
		return f, err
	}

	f.AllNodes = allNodes != 0
	f.Enabled = enabled != 0

	if urltestJSON.Valid && urltestJSON.String != "" {
		var cfg URLTestConfig
		if json.Unmarshal([]byte(urltestJSON.String), &cfg) == nil {
			f.URLTestConfig = &cfg
		}
	}
	unmarshalStringSlice(includeJSON, &f.Include)
	unmarshalStringSlice(excludeJSON, &f.Exclude)
	unmarshalStringSlice(includeCountriesJSON, &f.IncludeCountries)
	unmarshalStringSlice(excludeCountriesJSON, &f.ExcludeCountries)
	unmarshalStringSlice(subscriptionsJSON, &f.Subscriptions)

	// Ensure slices are not nil
	if f.Include == nil {
		f.Include = []string{}
	}
	if f.Exclude == nil {
		f.Exclude = []string{}
	}
	if f.IncludeCountries == nil {
		f.IncludeCountries = []string{}
	}
	if f.ExcludeCountries == nil {
		f.ExcludeCountries = []string{}
	}
	if f.Subscriptions == nil {
		f.Subscriptions = []string{}
	}

	return f, nil
}

func unmarshalStringSlice(ns sql.NullString, target *[]string) {
	if ns.Valid && ns.String != "" {
		json.Unmarshal([]byte(ns.String), target)
	}
}
