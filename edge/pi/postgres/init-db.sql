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

-- Create tables as farmmon user by setting role
SET ROLE farmmon;

CREATE TABLE readings (
    id SERIAL PRIMARY KEY,
    device_eui VARCHAR(16) NOT NULL,
    data JSONB NOT NULL,
    ts TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE alerts (
    id SERIAL PRIMARY KEY,
    device_eui VARCHAR(16) NOT NULL,
    alert_type VARCHAR(50) NOT NULL,
    message TEXT,
    acknowledged BOOLEAN DEFAULT FALSE,
    ts TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_readings_device ON readings(device_eui);
CREATE INDEX idx_readings_ts ON readings(ts DESC);
CREATE INDEX idx_alerts_device ON alerts(device_eui);
CREATE INDEX idx_alerts_ts ON alerts(ts DESC);

RESET ROLE;