-- Postgres init: idempotent CREATE DATABASE.
--
-- The `postgres` image only runs files in /docker-entrypoint-initdb.d on
-- first boot (empty volume). After that this is a no-op — the database
-- persists in the pg_data volume.
--
-- The compose service sets POSTGRES_DB=argus which already creates the
-- database; this file is a belt-and-braces guard so test environments that
-- bypass POSTGRES_DB still end up with the expected schema-less DB.

SELECT 'CREATE DATABASE argus'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'argus')\gexec
