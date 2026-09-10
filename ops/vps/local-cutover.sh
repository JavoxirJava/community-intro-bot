#!/usr/bin/env bash
# PC -> VPS dump + secrets copy. Never prints secrets.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
KEY="${COMMUNITY_SSH_KEY:-$HOME/.ssh/ziyo_server_30d_20260909_071817}"
HOST="${COMMUNITY_VPS:-204.13.232.140}"
python3 - "$ROOT" <<'PY'
import os, subprocess, sys
from pathlib import Path
from urllib.parse import urlparse, urlunparse

root = Path(sys.argv[1])
env_path = root / ".env"
keys = {}
for line in env_path.read_text().splitlines():
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, _, v = line.partition("=")
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        v = v[1:-1]
    keys[k] = v
url = keys.get("DATABASE_URL") or ""
if not url.startswith("postgresql://"):
    raise SystemExit("DATABASE_URL missing")
parsed = urlparse(url)
host = "127.0.0.1" if parsed.hostname in ("host.containers.internal", "localhost") else parsed.hostname
local = parsed._replace(
    netloc=f"{parsed.username}:{parsed.password}@{host}:{parsed.port or 5432}",
    query="",
)
dump = Path.home() / ".local/share/community-intro-pc-backup-20260910.sql"
dump.parent.mkdir(parents=True, exist_ok=True)
subprocess.run(
    ["pg_dump", "-Fp", "--no-owner", "--no-acl", urlunparse(local), "-f", str(dump)],
    check=True,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
secrets = Path("/tmp/community-app.secrets")
wanted = ("BOT_TOKEN", "BOT_OWNER_IDS")
secrets.write_text("".join(f"{k}={keys.get(k, '')}\n" for k in wanted))
os.chmod(secrets, 0o600)
print(f"DUMP_OK {dump.stat().st_size}")
print("SECRETS_OK")
PY
scp -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes \
  "$HOME/.local/share/community-intro-pc-backup-20260910.sql" \
  root@"$HOST":/root/community-import/community.sql
scp -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes \
  /tmp/community-app.secrets root@"$HOST":/root/community-import/app.secrets
ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes root@"$HOST" \
  'chmod 600 /root/community-import/app.secrets /root/community-import/community.sql; echo COPY_OK'
rm -f /tmp/community-app.secrets
echo CUTOVER_COPY_OK
