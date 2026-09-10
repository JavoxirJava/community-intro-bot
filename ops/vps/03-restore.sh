#!/usr/bin/env bash
# Restore a plain SQL dump into community_db only.
set -euo pipefail
dump=${1:-/root/community-import/community.sql}
[[ -f "$dump" ]] || { echo "missing dump: $dump" >&2; exit 1; }
readable=$(mktemp /var/tmp/community.dump.XXXXXX)
cp -- "$dump" "$readable"
# PG18 dumps SET transaction_timeout; VPS is PostgreSQL 16.
grep -v -E '^(SET transaction_timeout|SET transaction_timeout =)' "$readable" > "${readable}.pg16"
mv "${readable}.pg16" "$readable"
chown postgres:postgres "$readable"
chmod 600 "$readable"
cleanup() { rm -f -- "$readable"; }
trap cleanup EXIT
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d community_db -f "$readable"
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d community_db <<'SQL'
ALTER DATABASE community_db OWNER TO community_migrator;
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname
    FROM pg_namespace n
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg\_%'
  LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO community_migrator', r.nspname);
  END LOOP;
  FOR r IN
    SELECT n.nspname, c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg\_%'
  LOOP
    IF r.relkind IN ('r', 'p', 'v', 'm', 'f') THEN
      EXECUTE format('ALTER TABLE %I.%I OWNER TO community_migrator', r.nspname, r.relname);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON DATABASE community_db FROM PUBLIC;
GRANT CONNECT ON DATABASE community_db TO community_app, community_migrator;
GRANT USAGE ON SCHEMA public TO community_app, community_migrator;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO community_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO community_app;
ALTER DEFAULT PRIVILEGES FOR ROLE community_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO community_app;
ALTER DEFAULT PRIVILEGES FOR ROLE community_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO community_app;
SQL
users=$(runuser -u postgres -- psql -d community_db -Atc 'SELECT count(*) FROM "User"')
[[ "$users" =~ ^[0-9]+$ ]] && (( users >= 1 )) || {
  echo "restore check failed: User" >&2
  exit 1
}
echo "COMMUNITY_RESTORE_OK"
