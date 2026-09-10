# Community Intro Bot native VPS (204.13.232.140)

Docker yo‘q. Ziyo (`:4310`, `ziyo_test`), MD Pro, Pretest, flashcards DB ga
tegilmaydi. `javohir-dev.uz` apex Netlify portfolio — olinmaydi.

Webhook (mavjud TLS):
`https://flip-card-app.javohir-dev.uz/community-intro/webhook`
→ `127.0.0.1:8788`. Alohida subdomain shart emas.

Root tartib:

1. PC `.env` kalitlari `/root/community-import/app.secrets`
2. `bash ops/vps/01-provision.sh` va `bash ops/vps/02-database.sh`
3. Plain SQL dump → `/root/community-import/community.sql`
   va `bash ops/vps/03-restore.sh`
4. Artifact → `/srv/community/incoming/app/`
5. `community-apply-release full` (nginx snippet + bot)

CI: `.github/workflows/deploy-vps.yml` (`VPS_HOST` / `VPS_USER` / `VPS_SSH_KEY`).
PC konteynerni webhook yoqilgach to‘xtating (bir xil token).
