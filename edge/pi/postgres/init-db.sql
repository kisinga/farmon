-- Initialize databases for ChirpStack and ThingsBoard
-- Note: PostgreSQL 15+ requires explicit schema ownership transfer

-- ChirpStack database
CREATE DATABASE chirpstack;
CREATE USER chirpstack WITH PASSWORD 'chirpstack';
GRANT ALL PRIVILEGES ON DATABASE chirpstack TO chirpstack;
\c chirpstack
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER SCHEMA public OWNER TO chirpstack;

-- ThingsBoard database
\c postgres
CREATE DATABASE thingsboard;
CREATE USER thingsboard WITH PASSWORD 'thingsboard';
GRANT ALL PRIVILEGES ON DATABASE thingsboard TO thingsboard;
\c thingsboard
ALTER SCHEMA public OWNER TO thingsboard;
