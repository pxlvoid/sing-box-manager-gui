package storage

import (
	"fmt"
	"strings"
	"time"
)

// UpsertGeoData inserts or replaces a single geo data record (keyed by server:port).
func (s *SQLiteStore) UpsertGeoData(data GeoData) error {
	_, err := s.db.Exec(`INSERT INTO geo_data (server, server_port, node_tag, timestamp, status, country, country_code,
		region, region_name, city, zip, lat, lon, timezone, isp, org, as_info, query_ip)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(server, server_port) DO UPDATE SET
			node_tag=excluded.node_tag, timestamp=excluded.timestamp, status=excluded.status,
			country=excluded.country, country_code=excluded.country_code,
			region=excluded.region, region_name=excluded.region_name,
			city=excluded.city, zip=excluded.zip, lat=excluded.lat, lon=excluded.lon,
			timezone=excluded.timezone, isp=excluded.isp, org=excluded.org,
			as_info=excluded.as_info, query_ip=excluded.query_ip`,
		data.Server, data.ServerPort, data.NodeTag, data.Timestamp, data.Status,
		data.Country, data.CountryCode, data.Region, data.RegionName,
		data.City, data.Zip, data.Lat, data.Lon,
		data.Timezone, data.ISP, data.Org, data.AS, data.QueryIP)
	return err
}

// UpsertGeoDataBulk inserts or replaces multiple geo data records in a transaction.
func (s *SQLiteStore) UpsertGeoDataBulk(data []GeoData) error {
	if len(data) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`INSERT INTO geo_data (server, server_port, node_tag, timestamp, status, country, country_code,
		region, region_name, city, zip, lat, lon, timezone, isp, org, as_info, query_ip)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(server, server_port) DO UPDATE SET
			node_tag=excluded.node_tag, timestamp=excluded.timestamp, status=excluded.status,
			country=excluded.country, country_code=excluded.country_code,
			region=excluded.region, region_name=excluded.region_name,
			city=excluded.city, zip=excluded.zip, lat=excluded.lat, lon=excluded.lon,
			timezone=excluded.timezone, isp=excluded.isp, org=excluded.org,
			as_info=excluded.as_info, query_ip=excluded.query_ip`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, d := range data {
		_, err := stmt.Exec(d.Server, d.ServerPort, d.NodeTag, d.Timestamp, d.Status,
			d.Country, d.CountryCode, d.Region, d.RegionName,
			d.City, d.Zip, d.Lat, d.Lon,
			d.Timezone, d.ISP, d.Org, d.AS, d.QueryIP)
		if err != nil {
			return fmt.Errorf("upsert geo %s:%d: %w", d.Server, d.ServerPort, err)
		}
	}

	return tx.Commit()
}

// GetGeoData returns geo data for a specific node by server:port.
func (s *SQLiteStore) GetGeoData(server string, port int) (*GeoData, error) {
	row := s.db.QueryRow(`SELECT id, server, server_port, node_tag, timestamp, status, country, country_code,
		region, region_name, city, zip, lat, lon, timezone, isp, org, as_info, query_ip
		FROM geo_data WHERE server = ? AND server_port = ?`, server, port)
	var g GeoData
	err := row.Scan(&g.ID, &g.Server, &g.ServerPort, &g.NodeTag, &g.Timestamp, &g.Status,
		&g.Country, &g.CountryCode, &g.Region, &g.RegionName,
		&g.City, &g.Zip, &g.Lat, &g.Lon,
		&g.Timezone, &g.ISP, &g.Org, &g.AS, &g.QueryIP)
	if err != nil {
		return nil, err
	}
	return &g, nil
}

// GetAllGeoData returns all geo data records.
func (s *SQLiteStore) GetAllGeoData() ([]GeoData, error) {
	rows, err := s.db.Query(`SELECT id, server, server_port, node_tag, timestamp, status, country, country_code,
		region, region_name, city, zip, lat, lon, timezone, isp, org, as_info, query_ip
		FROM geo_data ORDER BY timestamp DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []GeoData
	for rows.Next() {
		var g GeoData
		if err := rows.Scan(&g.ID, &g.Server, &g.ServerPort, &g.NodeTag, &g.Timestamp, &g.Status,
			&g.Country, &g.CountryCode, &g.Region, &g.RegionName,
			&g.City, &g.Zip, &g.Lat, &g.Lon,
			&g.Timezone, &g.ISP, &g.Org, &g.AS, &g.QueryIP); err != nil {
			return nil, err
		}
		results = append(results, g)
	}
	if results == nil {
		results = []GeoData{}
	}
	return results, nil
}

// GetStaleGeoNodes returns geo data records older than maxAge.
func (s *SQLiteStore) GetStaleGeoNodes(maxAge time.Duration) ([]GeoData, error) {
	cutoff := time.Now().Add(-maxAge)
	rows, err := s.db.Query(`SELECT id, server, server_port, node_tag, timestamp, status, country, country_code,
		region, region_name, city, zip, lat, lon, timezone, isp, org, as_info, query_ip
		FROM geo_data WHERE timestamp < ?`, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []GeoData
	for rows.Next() {
		var g GeoData
		if err := rows.Scan(&g.ID, &g.Server, &g.ServerPort, &g.NodeTag, &g.Timestamp, &g.Status,
			&g.Country, &g.CountryCode, &g.Region, &g.RegionName,
			&g.City, &g.Zip, &g.Lat, &g.Lon,
			&g.Timezone, &g.ISP, &g.Org, &g.AS, &g.QueryIP); err != nil {
			return nil, err
		}
		results = append(results, g)
	}
	if results == nil {
		results = []GeoData{}
	}
	return results, nil
}

// GetGeoDataBulk returns geo data for multiple nodes keyed by "server:port".
func (s *SQLiteStore) GetGeoDataBulk(keys []string) (map[string]*GeoData, error) {
	if len(keys) == 0 {
		return map[string]*GeoData{}, nil
	}

	// Build IN clause
	placeholders := make([]string, len(keys))
	args := make([]interface{}, 0, len(keys)*2)
	for i, k := range keys {
		parts := strings.SplitN(k, ":", 2)
		if len(parts) != 2 {
			continue
		}
		placeholders[i] = "(?, ?)"
		args = append(args, parts[0], parts[1])
	}

	// Filter out empty placeholders
	var validPlaceholders []string
	for _, p := range placeholders {
		if p != "" {
			validPlaceholders = append(validPlaceholders, p)
		}
	}
	if len(validPlaceholders) == 0 {
		return map[string]*GeoData{}, nil
	}

	query := fmt.Sprintf(`SELECT id, server, server_port, node_tag, timestamp, status, country, country_code,
		region, region_name, city, zip, lat, lon, timezone, isp, org, as_info, query_ip
		FROM geo_data WHERE (server, server_port) IN (%s)`, strings.Join(validPlaceholders, ","))

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]*GeoData)
	for rows.Next() {
		var g GeoData
		if err := rows.Scan(&g.ID, &g.Server, &g.ServerPort, &g.NodeTag, &g.Timestamp, &g.Status,
			&g.Country, &g.CountryCode, &g.Region, &g.RegionName,
			&g.City, &g.Zip, &g.Lat, &g.Lon,
			&g.Timezone, &g.ISP, &g.Org, &g.AS, &g.QueryIP); err != nil {
			return nil, err
		}
		key := fmt.Sprintf("%s:%d", g.Server, g.ServerPort)
		result[key] = &g
	}
	return result, nil
}

// UpdateNodeCountry updates the country and country_emoji fields for a node by server:port.
func (s *SQLiteStore) UpdateNodeCountry(server string, port int, countryCode, countryEmoji string) error {
	_, err := s.db.Exec(`UPDATE nodes SET country = ?, country_emoji = ? WHERE server = ? AND server_port = ?`,
		countryCode, countryEmoji, server, port)
	return err
}
