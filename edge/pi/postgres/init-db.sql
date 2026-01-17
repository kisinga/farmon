-- Initialize databases for ChirpStack, Node-RED (FarmMon), and ThingsBoard
-- Note: PostgreSQL 15+ requires explicit schema ownership transfer

-- ChirpStack database
CREATE DATABASE chirpstack;
CREATE USER chirpstack WITH PASSWORD 'chirpstack';
GRANT ALL PRIVILEGES ON DATABASE chirpstack TO chirpstack;
\c chirpstack
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER SCHEMA public OWNER TO chirpstack;

-- FarmMon database (for Node-RED telemetry storage)
\c postgres
CREATE DATABASE farmmon;
CREATE USER farmmon WITH PASSWORD 'farmmon';
GRANT ALL PRIVILEGES ON DATABASE farmmon TO farmmon;
\c farmmon
ALTER SCHEMA public OWNER TO farmmon;

-- Readings table for sensor telemetry
CREATE TABLE readings (
    id SERIAL PRIMARY KEY,
    device_eui VARCHAR(16) NOT NULL,
    data JSONB NOT NULL,
    ts TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_readings_device_eui ON readings(device_eui);
CREATE INDEX idx_readings_ts ON readings(ts DESC);

-- Alerts table for threshold violations
CREATE TABLE alerts (
    id SERIAL PRIMARY KEY,
    device_eui VARCHAR(16) NOT NULL,
    alert_type VARCHAR(50) NOT NULL,
    message TEXT,
    acknowledged BOOLEAN DEFAULT FALSE,
    ts TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_alerts_device_eui ON alerts(device_eui);
CREATE INDEX idx_alerts_ts ON alerts(ts DESC);

-- ThingsBoard database (optional, for future use)
\c postgres
CREATE DATABASE thingsboard;
CREATE USER thingsboard WITH PASSWORD 'thingsboard';
GRANT ALL PRIVILEGES ON DATABASE thingsboard TO thingsboard;
\c thingsboard
ALTER SCHEMA public OWNER TO thingsboard;