package main

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// CronExpr is a parsed 5-field cron expression.
// Fields: minute hour day-of-month month day-of-week
// Supported syntax per field: *, */n, comma-separated values (e.g. "1,3,5").
type CronExpr struct {
	minute []int // 0-59
	hour   []int // 0-23
	dom    []int // 1-31 (day of month)
	month  []int // 1-12
	dow    []int // 0-6 (0=Sunday)
}

// ParseCron parses a standard 5-field cron string.
// Examples: "0 6 * * *" (daily at 6am), "30 8 * * 1" (Monday 8:30am), "*/15 * * * *" (every 15 min).
func ParseCron(s string) (*CronExpr, error) {
	fields := strings.Fields(s)
	if len(fields) != 5 {
		return nil, fmt.Errorf("cron: expected 5 fields, got %d in %q", len(fields), s)
	}
	c := &CronExpr{}
	var err error
	if c.minute, err = parseCronField(fields[0], 0, 59); err != nil {
		return nil, fmt.Errorf("cron minute: %w", err)
	}
	if c.hour, err = parseCronField(fields[1], 0, 23); err != nil {
		return nil, fmt.Errorf("cron hour: %w", err)
	}
	if c.dom, err = parseCronField(fields[2], 1, 31); err != nil {
		return nil, fmt.Errorf("cron dom: %w", err)
	}
	if c.month, err = parseCronField(fields[3], 1, 12); err != nil {
		return nil, fmt.Errorf("cron month: %w", err)
	}
	if c.dow, err = parseCronField(fields[4], 0, 6); err != nil {
		return nil, fmt.Errorf("cron dow: %w", err)
	}
	return c, nil
}

// Matches returns true if the given time matches this cron expression.
func (c *CronExpr) Matches(t time.Time) bool {
	return intIn(t.Minute(), c.minute) &&
		intIn(t.Hour(), c.hour) &&
		intIn(t.Day(), c.dom) &&
		intIn(int(t.Month()), c.month) &&
		intIn(int(t.Weekday()), c.dow)
}

// parseCronField expands a single cron field string into a sorted list of matching integers.
func parseCronField(field string, min, max int) ([]int, error) {
	if field == "*" {
		vals := make([]int, max-min+1)
		for i := range vals {
			vals[i] = min + i
		}
		return vals, nil
	}
	// */n step syntax
	if strings.HasPrefix(field, "*/") {
		n, err := strconv.Atoi(field[2:])
		if err != nil || n <= 0 {
			return nil, fmt.Errorf("invalid step %q", field)
		}
		var vals []int
		for v := min; v <= max; v += n {
			vals = append(vals, v)
		}
		return vals, nil
	}
	// Comma-separated list
	var vals []int
	for _, part := range strings.Split(field, ",") {
		v, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil {
			return nil, fmt.Errorf("invalid value %q", part)
		}
		if v < min || v > max {
			return nil, fmt.Errorf("value %d out of range [%d, %d]", v, min, max)
		}
		vals = append(vals, v)
	}
	return vals, nil
}

func intIn(v int, vals []int) bool {
	for _, x := range vals {
		if x == v {
			return true
		}
	}
	return false
}
