#!/usr/bin/env bash
# Prisma migrate as community_migrator. Runtime env is not used.
set -euo pipefail
APP=/srv/community/app
NODE=/opt/node/bin/node
[[ -f "$APP/package.json" ]] || { echo "missing $APP" >&2; exit 1; }
[[ -f /etc/community/migrator.env ]] || { echo "missing migrator.env" >&2; exit 1; }
set -a
# shellcheck disable=SC1091
source /etc/community/migrator.env
set +a
export HOME=/tmp/community-prisma
install -d -m 700 "$HOME"
cd "$APP"
exec "$NODE" ./node_modules/prisma/build/index.js migrate deploy --schema "$APP/prisma/schema.prisma"
