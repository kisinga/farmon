package api

import (
	"encoding/json"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// SiteCatalogEntry is the lean site list payload returned by GET /api/farmon/sites.
// It carries everything the overview cards and the alert bell need, without the
// full draft_topology JSON blob.
type SiteCatalogEntry struct {
	ID                string   `json:"id"`
	FriendlyName      string   `json:"friendlyName"`
	Owners            []string `json:"owners"`
	ControllerCount   int      `json:"controllerCount"`
	NodeCount         int      `json:"nodeCount"`
	Mode              string   `json:"mode"`
	DeviceCount       int      `json:"deviceCount"`
	LiveCount         int      `json:"liveCount"`
	CommenceDate      string   `json:"commenceDate"`
	TankLowPct        float64  `json:"tankLowPct"`
	TankHighPct       float64  `json:"tankHighPct"`
	OfflineTimeoutS   float64  `json:"offlineTimeoutS"`
}

// ListSites returns the site catalog visible to the authenticated user, with
// designed controller/node counts extracted in the database and provisioned
// device/live counts aggregated in a single grouped query.
func ListSites(app core.App, auth *core.Record) ([]SiteCatalogEntry, error) {
	if auth == nil {
		return nil, nil
	}

	params := dbx.Params{}
	where := ""
	if !IsAdmin(auth) {
		where = "AND EXISTS (SELECT 1 FROM json_each(s.owner) WHERE value = {:user})"
		params["user"] = auth.Id
	}

	// One query joins sites with their controllers and uses SQLite JSON1 to count
	// the topology arrays without sending the JSON blob over the wire.
	sql := strings.Join([]string{
		"SELECT",
		"  s.id,",
		"  s.name,",
		"  s.owner,",
		"  s.mode,",
		"  s.commence_date,",
		"  COALESCE(json_array_length(json_extract(s.draft_topology, '$.controllers')), 0) AS controller_count,",
		"  COALESCE(json_array_length(json_extract(s.draft_topology, '$.nodes')), 0) AS node_count,",
		"  s.tank_low_pct,",
		"  s.tank_high_pct,",
		"  s.offline_timeout_s,",
		"  COUNT(c.id) AS device_count,",
		"  SUM(CASE WHEN COALESCE(c.active, 0) != 0 THEN 1 ELSE 0 END) AS active_count,",
		"  SUM(CASE WHEN COALESCE(c.last_seen, '') != '' THEN 1 ELSE 0 END) AS live_count",
		"FROM sites s",
		"LEFT JOIN controllers c ON c.site = s.id",
		"WHERE 1=1", // placeholder so the optional owner filter always appends cleanly
		where,
		"GROUP BY s.id",
		"ORDER BY s.name",
	}, " ")

	var rows []siteCatalogRow
	if err := app.DB().NewQuery(sql).Bind(params).All(&rows); err != nil {
		return nil, err
	}

	out := make([]SiteCatalogEntry, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.toEntry())
	}
	return out, nil
}

// siteCatalogRow mirrors the SELECT list so dbx can scan it.
type siteCatalogRow struct {
	ID              string  `db:"id"`
	Name            string  `db:"name"`
	OwnerRaw        string  `db:"owner"`
	Mode            string  `db:"mode"`
	CommenceDate    *string `db:"commence_date"`
	ControllerCount int     `db:"controller_count"`
	NodeCount       int     `db:"node_count"`
	TankLowPct      *float64 `db:"tank_low_pct"`
	TankHighPct     *float64 `db:"tank_high_pct"`
	OfflineTimeoutS *float64 `db:"offline_timeout_s"`
	DeviceCount     int     `db:"device_count"`
	ActiveCount     *int    `db:"active_count"`
	LiveCount       *int    `db:"live_count"`
}

func (r siteCatalogRow) toEntry() SiteCatalogEntry {
	owners := []string{}
	if r.OwnerRaw != "" {
		_ = json.Unmarshal([]byte(r.OwnerRaw), &owners)
	}

	commence := ""
	if r.CommenceDate != nil {
		commence = *r.CommenceDate
	}

	deviceCount := r.DeviceCount
	if r.ActiveCount != nil {
		deviceCount = *r.ActiveCount
	}
	liveCount := 0
	if r.LiveCount != nil {
		liveCount = *r.LiveCount
	}

	tankLow := 0.0
	if r.TankLowPct != nil {
		tankLow = *r.TankLowPct
	}
	tankHigh := 0.0
	if r.TankHighPct != nil {
		tankHigh = *r.TankHighPct
	}
	offlineS := 0.0
	if r.OfflineTimeoutS != nil {
		offlineS = *r.OfflineTimeoutS
	}

	return SiteCatalogEntry{
		ID:              r.ID,
		FriendlyName:    r.Name,
		Owners:          owners,
		ControllerCount: r.ControllerCount,
		NodeCount:       r.NodeCount,
		Mode:            r.Mode,
		DeviceCount:     deviceCount,
		LiveCount:       liveCount,
		CommenceDate:    commence,
		TankLowPct:      tankLow,
		TankHighPct:     tankHigh,
		OfflineTimeoutS: offlineS,
	}
}
