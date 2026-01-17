-- Initialize databases for ChirpStack and Farm Monitoring
-- Note: PostgreSQL 15+ requires explicit schema ownership transfer

-- ChirpStack database
CREATE DATABASE chirpstack;
CREATE USER chirpstack WITH PASSWORD 'chirpstack';
GRANT ALL PRIVILEGES ON DATABASE chirpstack TO chirpstack;
\c chirpstack
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER SCHEMA public OWNER TO chirpstack;

-- Farm monitoring database (for Node-RED telemetry storage)
\c postgres
CREATE DATABASE farmmon;
CREATE USER farmmon WITH PASSWORD 'farmmon';
GRANT ALL PRIVILEGES ON DATABASE farmmon TO farmmon;
\c farmmon
ALTER SCHEMA public OWNER TO farmmon;

-- Readings table for time-series sensor data
CREATE TABLE readings (
    id SERIAL PRIMARY KEY,
    device_eui VARCHAR(16) NOT NULL,
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data JSONB NOT NULL
);

-- Index for efficient queries by device and time
CREATE INDEX idx_readings_device_ts ON readings(device_eui, ts DESC);

-- Alerts table for tracking triggered alerts
CREATE TABLE alerts (
    id SERIAL PRIMARY KEY,
    device_eui VARCHAR(16) NOT NULL,
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    alert_type VARCHAR(50) NOT NULL,
    message TEXT,
    acknowledged BOOLEAN DEFAULT FALSE,
    ack_ts TIMESTAMPTZ
);

CREATE INDEX idx_alerts_device_ts ON alerts(device_eui, ts DESC);
CREATE INDEX idx_alerts_unack ON alerts(acknowledged) WHERE NOT acknowledged;
