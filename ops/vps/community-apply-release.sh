#!/usr/bin/env bash
# Apply incoming artifacts. Does not touch Ziyo/MD Pro/Pretest/flashcards DB.
set -euo pipefail
umask 027
APP=/srv/community/app
INCOMING=/srv/community/incoming
NODE=/opt/node/bin/node
NPM=/opt/node/bin/npm
targets=${1:-full}
install -d -m 2770 -o javohir -g community "$INCOMING" "$INCOMING/app"
install -d -m 750 -o community -g community "$APP"
if [[ -f "$INCOMING/ops/vps/community-apply-release.sh" ]]; then
  install -m 700 "$INCOMING/ops/vps/community-apply-release.sh" /usr/local/sbin/community-apply-release
fi
if [[ -f "$INCOMING/ops/vps/community-migrate.sh" ]]; then
  install -m 700 "$INCOMING/ops/vps/community-migrate.sh" /usr/local/sbin/community-migrate
fi
if [[ -f "$INCOMING/ops/vps/systemd/community-intro-bot.service" ]]; then
  install -m 644 "$INCOMING/ops/vps/systemd/community-intro-bot.service" /etc/systemd/system/community-intro-bot.service
  systemctl daemon-reload
fi
if [[ -d "$INCOMING/app" && -f "$INCOMING/app/package.json" ]]; then
  rsync -a --delete \
    --exclude node_modules --exclude .env --exclude '*.env' \
    "$INCOMING/app/" "$APP/"
  chown -R community:community "$APP"
fi
need_install=0
need_migrate=0
restart_bot=0
reload_nginx=0
[[ "$targets" == *full* ]] && need_install=1 && need_migrate=1 && restart_bot=1 && reload_nginx=1
[[ "$targets" == *bot* ]] && need_install=1 && need_migrate=1 && restart_bot=1
[[ "$targets" == *nginx* ]] && reload_nginx=1
if [[ "$need_install" == 1 ]]; then
  cd "$APP"
  runuser -u community -- env HOME=/home/community PATH="/opt/node/bin:$PATH" \
    "$NPM" ci --prefix "$APP"
  runuser -u community -- env HOME=/home/community PATH="/opt/node/bin:$PATH" \
    DATABASE_URL='postgresql://community_app@127.0.0.1:5432/community_db' \
    "$NODE" "$APP/node_modules/prisma/build/index.js" generate --schema "$APP/prisma/schema.prisma"
fi
if [[ "$need_migrate" == 1 ]]; then
  /usr/local/sbin/community-migrate
fi
if [[ "$restart_bot" == 1 ]]; then
  systemctl enable community-intro-bot
  systemctl restart community-intro-bot
fi
if [[ "$reload_nginx" == 1 ]]; then
  if [[ -d "$INCOMING/ops/vps/nginx" ]]; then
    install -m 644 "$INCOMING/ops/vps/nginx/community-intro-proxy.conf" /etc/nginx/snippets/community-intro-proxy.conf
    install -m 644 "$INCOMING/ops/vps/nginx/community-intro-webhook.conf" /etc/nginx/snippets/community-intro-webhook.conf
  fi
  site=/etc/nginx/sites-available/flashcards
  if [[ -f "$site" ]] && ! grep -q 'location = /community-intro/webhook' "$site"; then
    python3 - "$site" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
text = path.read_text()
needle = "    location = /webhook {\n"
insert = (
    "    location = /community-intro/webhook {\n"
    "        include snippets/flashcards-proxy.conf;\n"
    "        proxy_pass http://127.0.0.1:8788;\n"
    "    }\n\n"
)
if needle in text and "location = /community-intro/webhook" not in text:
    path.write_text(text.replace(needle, insert + needle, 1))
PY
  fi
  nginx -t
  systemctl reload nginx
fi
echo "COMMUNITY_APPLY_OK $targets"
