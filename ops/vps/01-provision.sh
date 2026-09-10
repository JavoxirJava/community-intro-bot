#!/usr/bin/env bash
# Native community-intro layout. Does not touch Ziyo, MD Pro, Pretest, or flashcards DB.
set -euo pipefail
umask 022
if ! id -u community >/dev/null 2>&1; then
  adduser --system --group --home /home/community --shell /usr/sbin/nologin community
fi
usermod -aG community javohir 2>/dev/null || true
install -d -m 750 -o community -g community \
  /home/community /srv/community /srv/community/app \
  /srv/community/shared /srv/community/shared/logs
install -d -m 2770 -o javohir -g community \
  /srv/community/incoming /srv/community/incoming/app /srv/community/incoming/ops
install -d -m 750 -o root -g root /etc/community
install -d -m 700 -o root -g root /root/community-import
src="$(cd "$(dirname "$0")" && pwd)"
if [[ -f /srv/community/incoming/ops/vps/community-apply-release.sh ]]; then
  src=/srv/community/incoming/ops/vps
fi
install -m 700 "$src/community-apply-release.sh" /usr/local/sbin/community-apply-release
install -m 700 "$src/community-migrate.sh" /usr/local/sbin/community-migrate
install -m 644 "$src/systemd/community-intro-bot.service" /etc/systemd/system/community-intro-bot.service
if [[ -d "$src/nginx" ]]; then
  install -d -m 755 /etc/nginx/snippets
  install -m 644 "$src/nginx/community-intro-proxy.conf" /etc/nginx/snippets/community-intro-proxy.conf
  install -m 644 "$src/nginx/community-intro-webhook.conf" /etc/nginx/snippets/community-intro-webhook.conf
fi
printf 'javohir ALL=(root) NOPASSWD: /usr/local/sbin/community-apply-release\n' >/etc/sudoers.d/community-apply
chmod 440 /etc/sudoers.d/community-apply
visudo -cf /etc/sudoers.d/community-apply
systemctl daemon-reload
command -v /opt/node/bin/node >/dev/null
echo "COMMUNITY_PROVISION_OK"
