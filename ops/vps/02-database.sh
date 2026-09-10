#!/usr/bin/env bash
# Create community_db / community_app / community_migrator. Never prints secrets.
set -euo pipefail
umask 077
python3 - <<'PY'
import grp, os, secrets, subprocess
from pathlib import Path
from urllib.parse import quote

runtime = Path("/etc/community/runtime.env")
migrator = Path("/etc/community/migrator.env")
imp = Path("/root/community-import/app.secrets")


def strip_value(raw: str) -> str:
    value = raw.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        value = value[1:-1]
    return value


def existing_pass(path: Path, key: str) -> str | None:
    if not path.exists():
        return None
    for line in path.read_text().splitlines():
        if line.startswith(key + "="):
            return strip_value(line.split("=", 1)[1]).replace("$$", "$")
    return None


def secret_file(key: str) -> str | None:
    if not imp.is_file():
        return None
    for line in imp.read_text().splitlines():
        if line.startswith(key + "="):
            return strip_value(line.split("=", 1)[1])
    return None


def required_secret(key: str) -> str:
    value = existing_pass(runtime, key) or secret_file(key)
    if not value:
        raise SystemExit(f"missing {key} in runtime.env or app.secrets")
    return value


def optional_secret(key: str) -> str:
    return existing_pass(runtime, key) or secret_file(key) or ""


def systemd_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("$", "$$")


app_pw = existing_pass(runtime, "COMMUNITY_APP_PASSWORD") or secrets.token_urlsafe(32)
mig_pw = existing_pass(migrator, "COMMUNITY_MIGRATOR_PASSWORD") or secrets.token_urlsafe(32)
bot = required_secret("BOT_TOKEN")
owners = optional_secret("BOT_OWNER_IDS")
webhook_secret = optional_secret("WEBHOOK_SECRET") or secrets.token_urlsafe(32)
webhook_domain = optional_secret("WEBHOOK_DOMAIN") or "https://flip-card-app.javohir-dev.uz"
webhook_path = optional_secret("WEBHOOK_PATH") or "/community-intro/webhook"

sql = r"""
SELECT 'CREATE ROLE community_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='community_app')\gexec
SELECT 'CREATE ROLE community_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='community_migrator')\gexec
SELECT 'CREATE DATABASE community_db OWNER community_migrator ENCODING $$UTF8$$ TEMPLATE template0'
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='community_db')\gexec
"""
subprocess.run(
    ["runuser", "-u", "postgres", "--", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-d", "postgres"],
    input=sql,
    text=True,
    check=True,
)
for role, pw in (("community_app", app_pw), ("community_migrator", mig_pw)):
    subprocess.run(
        ["runuser", "-u", "postgres", "--", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-d", "postgres"],
        input=f"ALTER ROLE {role} PASSWORD '{pw}';\n",
        text=True,
        check=True,
    )
grants = r"""
REVOKE ALL ON DATABASE community_db FROM PUBLIC;
ALTER DATABASE community_db OWNER TO community_migrator;
GRANT CONNECT ON DATABASE community_db TO community_app, community_migrator;
GRANT TEMPORARY ON DATABASE community_db TO community_migrator;
"""
subprocess.run(
    ["runuser", "-u", "postgres", "--", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-d", "community_db"],
    input=grants,
    text=True,
    check=True,
)

app_url = (
    f"postgresql://community_app:{quote(app_pw, safe='')}@127.0.0.1:5432/community_db?schema=public"
)
mig_url = (
    f"postgresql://community_migrator:{quote(mig_pw, safe='')}@127.0.0.1:5432/community_db?schema=public"
)
runtime.write_text(
    "\n".join(
        [
            f"BOT_TOKEN={systemd_escape(bot)}",
            f"BOT_OWNER_IDS={systemd_escape(owners)}",
            f"DATABASE_URL={systemd_escape(app_url)}",
            f"COMMUNITY_APP_PASSWORD={systemd_escape(app_pw)}",
            "APP_TIMEZONE=Asia/Tashkent",
            "TZ=Asia/Tashkent",
            "WEB_HOST=127.0.0.1",
            "WEB_PORT=8788",
            f"WEBHOOK_DOMAIN={systemd_escape(webhook_domain)}",
            f"WEBHOOK_PATH={systemd_escape(webhook_path)}",
            f"WEBHOOK_SECRET={systemd_escape(webhook_secret)}",
            "NODE_ENV=production",
            "",
        ]
    )
)
os.chmod(runtime, 0o640)
os.chown(runtime, 0, grp.getgrnam("community").gr_gid)
migrator.write_text(
    "\n".join(
        [
            f"DATABASE_URL={mig_url}",
            f"COMMUNITY_MIGRATOR_PASSWORD={mig_pw}",
            "",
        ]
    )
)
os.chmod(migrator, 0o600)
os.chown(migrator, 0, 0)
print("COMMUNITY_DATABASE_OK")
PY
