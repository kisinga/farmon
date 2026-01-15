-- Initialize databases for ChirpStack and ThingsBoard

-- ChirpStack database
CREATE DATABASE chirpstack;
CREATE USER chirpstack WITH PASSWORD 'chirpstack';
GRANT ALL PRIVILEGES ON DATABASE chirpstack TO chirpstack;
\c chirpstack
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ThingsBoard database
CREATE DATABASE thingsboard;
CREATE USER thingsboard WITH PASSWORD 'thingsboard';
GRANT ALL PRIVILEGES ON DATABASE thingsboard TO thingsboard;
