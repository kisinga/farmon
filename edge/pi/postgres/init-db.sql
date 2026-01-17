-- Initialize databases for ChirpStack and ThingsBoard
-- Note: PostgreSQL 15+ requires explicit schema grants

-- ChirpStack database
CREATE DATABASE chirpstack;
CREATE USER chirpstack WITH PASSWORD 'chirpstack';
GRANT ALL PRIVILEGES ON DATABASE chirpstack TO chirpstack;
\c chirpstack
CREATE EXTENSION IF NOT EXISTS pg_trgm;
GRANT ALL ON SCHEMA public TO chirpstack;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO chirpstack;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO chirpstack;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO chirpstack;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO chirpstack;

-- ThingsBoard database
\c postgres
CREATE DATABASE thingsboard;
CREATE USER thingsboard WITH PASSWORD 'thingsboard';
GRANT ALL PRIVILEGES ON DATABASE thingsboard TO thingsboard;
\c thingsboard
GRANT ALL ON SCHEMA public TO thingsboard;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO thingsboard;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO thingsboard;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO thingsboard;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO thingsboard;
