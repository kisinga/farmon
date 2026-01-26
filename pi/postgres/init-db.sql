-- PostgreSQL initialization for Farm Monitor stack
-- Runs once on first container start when data directory is empty

-- =============================================================================
-- ChirpStack (LoRaWAN Network Server)
-- =============================================================================
CREATE DATABASE chirpstack;
CREATE USER chirpstack WITH PASSWORD 'chirpstack';
GRANT ALL PRIVILEGES ON DATABASE chirpstack TO chirpstack;
\c chirpstack
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER SCHEMA public OWNER TO chirpstack;
GRANT ALL ON SCHEMA public TO chirpstack;

-- =============================================================================
-- FarmMon (Node-RED telemetry storage)
-- =============================================================================
\c postgres
CREATE DATABASE farmmon;
CREATE USER farmmon WITH PASSWORD 'farmmon';
GRANT ALL PRIVILEGES ON DATABASE farmmon TO farmmon;
\c farmmon
ALTER SCHEMA public OWNER TO farmmon;
GRANT ALL ON SCHEMA public TO farmmon;

-- Create tables as farmmon user
SET ROLE farmmon;

-- =============================================================================
-- DEVICES: Registered devices and their full registration payload
-- =============================================================================
CREATE TABLE devices (
    device_eui VARCHAR(16) PRIMARY KEY,
    device_name VARCHAR(100),
    device_type VARCHAR(50),
    firmware_version VARCHAR(20),
    registration JSONB NOT NULL,
    first_seen TIMESTAMPTZ DEFAULT NOW(),
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE
);

-- =============================================================================
-- DEVICE_FIELDS: Parsed field definitions from registration
-- =============================================================================
CREATE TABLE device_fields (
    id SERIAL PRIMARY KEY,
    device_eui VARCHAR(16) REFERENCES devices(device_eui) ON DELETE CASCADE,
    field_key VARCHAR(50) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    data_type VARCHAR(20) NOT NULL,
    unit VARCHAR(20),
    category VARCHAR(20) NOT NULL,
    min_value NUMERIC,
    max_value NUMERIC,
    enum_values JSONB,
    UNIQUE (device_eui, field_key)
);

-- =============================================================================
-- DEVICE_CONTROLS: Current state of controllable fields
-- =============================================================================
CREATE TABLE device_controls (
    id SERIAL PRIMARY KEY,
    device_eui VARCHAR(16) REFERENCES devices(device_eui) ON DELETE CASCADE,
    control_key VARCHAR(50) NOT NULL,
    current_state VARCHAR(50) NOT NULL,
    mode VARCHAR(20) DEFAULT 'auto',
    manual_until TIMESTAMPTZ,
    last_change_at TIMESTAMPTZ DEFAULT NOW(),
    last_change_by VARCHAR(100),
    UNIQUE (device_eui, control_key)
);

-- =============================================================================
-- DEVICE_TRIGGERS: Device-defined automation (from registration)
-- =============================================================================
CREATE TABLE device_triggers (
    id SERIAL PRIMARY KEY,
    device_eui VARCHAR(16) REFERENCES devices(device_eui) ON DELETE CASCADE,
    trigger_key VARCHAR(50) NOT NULL,
    display_name VARCHAR(100),
    field_key VARCHAR(50) NOT NULL,
    operator VARCHAR(10) NOT NULL,
    threshold NUMERIC NOT NULL,
    action_control VARCHAR(50) NOT NULL,
    action_state VARCHAR(50) NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    UNIQUE (device_eui, trigger_key)
);

-- =============================================================================
-- USER_RULES: User-defined automation
-- =============================================================================
CREATE TABLE user_rules (
    id SERIAL PRIMARY KEY,
    device_eui VARCHAR(16) REFERENCES devices(device_eui) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    condition JSONB NOT NULL,
    action_control VARCHAR(50) NOT NULL,
    action_state VARCHAR(50) NOT NULL,
    priority INTEGER DEFAULT 100,
    cooldown_seconds INTEGER DEFAULT 300,
    enabled BOOLEAN DEFAULT TRUE,
    last_triggered TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- TELEMETRY: Periodic sensor data (fPort 2)
-- =============================================================================
CREATE TABLE telemetry (
    id SERIAL PRIMARY KEY,
    device_eui VARCHAR(16) NOT NULL,
    data JSONB NOT NULL,
    rssi INTEGER,
    snr NUMERIC,
    ts TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- STATE_CHANGES: Control state change events (fPort 3)
-- =============================================================================
CREATE TABLE state_changes (
    id SERIAL PRIMARY KEY,
    device_eui VARCHAR(16) NOT NULL,
    control_key VARCHAR(50) NOT NULL,
    old_state VARCHAR(50),
    new_state VARCHAR(50) NOT NULL,
    reason VARCHAR(100),
    device_ts TIMESTAMPTZ,
    ts TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- COMMANDS: Downlink command audit log
-- =============================================================================
CREATE TABLE commands (
    id SERIAL PRIMARY KEY,
    device_eui VARCHAR(16) NOT NULL,
    command_key VARCHAR(50) NOT NULL,
    payload JSONB,
    initiated_by VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    sent_at TIMESTAMPTZ,
    acked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- SETTINGS: System-level configuration
-- =============================================================================
CREATE TABLE settings (
    category VARCHAR(50) NOT NULL,
    key VARCHAR(100) NOT NULL,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (category, key)
);

-- =============================================================================
-- VIZ_CONFIG: Visualization settings (backend-managed, user-customizable)
-- =============================================================================
CREATE TABLE viz_config (
    id SERIAL PRIMARY KEY,
    device_eui VARCHAR(16),
    field_key VARCHAR(50) NOT NULL,
    viz_type VARCHAR(20),
    gauge_style VARCHAR(20),
    chart_color VARCHAR(20),
    thresholds JSONB,
    is_visible BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 100,
    UNIQUE (device_eui, field_key)
);

-- =============================================================================
-- DEVICE_SCHEMAS: Schema version history for bidirectional sync
-- =============================================================================
-- Stores each schema version sent by a device, enabling:
-- - Schema change tracking over firmware updates
-- - Index validation for rules and telemetry
-- - Audit trail of device capabilities
CREATE TABLE device_schemas (
    id SERIAL PRIMARY KEY,
    device_eui VARCHAR(16) REFERENCES devices(device_eui) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    schema JSONB NOT NULL,          -- Full schema: {fields: [...], controls: [...]}
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (device_eui, version)
);

-- =============================================================================
-- EDGE_RULES: Rules stored on device (synced for UI visibility)
-- =============================================================================
-- Mirrors rules stored in device flash, enabling UI to display/edit rules
CREATE TABLE edge_rules (
    id SERIAL PRIMARY KEY,
    device_eui VARCHAR(16) REFERENCES devices(device_eui) ON DELETE CASCADE,
    rule_id INTEGER NOT NULL,       -- Device-assigned rule ID (0-254)
    field_idx INTEGER NOT NULL,     -- Schema field index
    operator VARCHAR(10) NOT NULL,  -- <, >, <=, >=, ==, !=
    threshold NUMERIC NOT NULL,
    control_idx INTEGER NOT NULL,   -- Schema control index
    action_state INTEGER NOT NULL,  -- Control state index
    priority INTEGER DEFAULT 128,   -- 0=highest
    cooldown_seconds INTEGER DEFAULT 300,
    enabled BOOLEAN DEFAULT TRUE,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (device_eui, rule_id)
);

-- =============================================================================
-- INDEXES
-- =============================================================================
CREATE INDEX idx_telemetry_device_ts ON telemetry(device_eui, ts DESC);
CREATE INDEX idx_state_changes_device_ts ON state_changes(device_eui, ts DESC);
CREATE INDEX idx_commands_pending ON commands(status) WHERE status = 'pending';
CREATE INDEX idx_device_triggers_enabled ON device_triggers(device_eui) WHERE enabled = TRUE;
CREATE INDEX idx_devices_active ON devices(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_device_schemas_device ON device_schemas(device_eui, version DESC);
CREATE INDEX idx_edge_rules_enabled ON edge_rules(device_eui) WHERE enabled = TRUE;

RESET ROLE;
