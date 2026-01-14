-- ChirpStack database initialization
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create chirpstack database if not exists
SELECT 'CREATE DATABASE chirpstack'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'chirpstack')\gexec
