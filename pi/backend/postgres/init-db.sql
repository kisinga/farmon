-- PostgreSQL initialization for piv2 (ChirpStack only)
-- App data lives in PocketBase (SQLite). Idempotent.

\set ON_ERROR_STOP off

CREATE DATABASE chirpstack;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'chirpstack') THEN
    CREATE USER chirpstack WITH PASSWORD 'chirpstack';
  END IF;
END
$$;

GRANT ALL PRIVILEGES ON DATABASE chirpstack TO chirpstack;
\c chirpstack
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER SCHEMA public OWNER TO chirpstack;
GRANT ALL ON SCHEMA public TO chirpstack;

\set ON_ERROR_STOP on
