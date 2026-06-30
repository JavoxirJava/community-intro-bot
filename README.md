# community-intro-bot

Production-oriented MVP for a multi-group Telegram networking bot. It uses NestJS,
Telegraf, PostgreSQL, Prisma, and long polling. Every group membership, visibility
setting, search, event, and callback is scoped to its Telegram group.

## Requirements

- Node.js 22+
- Docker and Docker Compose
- A bot token from [@BotFather](https://t.me/BotFather)

## Environment

Copy the example file and set the bot token:

```bash
cp .env.example .env
```

| Variable | Description |
| --- | --- |
| `BOT_TOKEN` | Telegram bot token from BotFather |
| `DATABASE_URL` | PostgreSQL connection URL |
| `APP_TIMEZONE` | Application timezone; defaults to `Asia/Tashkent` |
| `POSTGRES_PORT` | Dedicated localhost PostgreSQL port; defaults to `55432` |

Never commit `.env` or a real bot token.

## Local setup

Start PostgreSQL:

```bash
docker compose up -d postgres
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run start:dev
```

For later schema changes, create a development migration with
`npx prisma migrate dev --name <change-name>`. In a deployment, apply committed
migrations with `npm run prisma:deploy`.

## Run everything with Docker Compose

After creating `.env` and setting `BOT_TOKEN`:

```bash
docker compose up --build
```

The bot container waits for PostgreSQL, applies committed Prisma migrations, and
starts the compiled NestJS application. Stop it with `docker compose down`. Add
`-v` only when you intentionally want to delete local database data.

## Development commands

```bash
npm run build
npm test
npm run lint
npm run prisma:studio
```

## Telegram configuration

Add the bot to each group and grant it permission to read and send messages. Event
creation still checks the invoking user's live status with `getChatMember`; only
administrators and the group creator can use `/event`.

By default, BotFather privacy mode prevents bots from receiving ordinary group
messages. Disable it using `/setprivacy` in BotFather if standardized introductions
such as `Ism: ...` and `Soha: ...` must be parsed directly from normal group
messages. Commands, service messages, replies to the bot, and callback buttons have
different Telegram delivery rules.

## Profile format

Only `Ism` and `Soha` are required:

```text
Ism: Ali
Soha: Backend Developer
Yosh: 24
Kompaniya: EPAM
Texnologiyalar: Node.js, NestJS, PostgreSQL
Hobby: football
Description: Backend va networkingga qiziqaman.
```

The same format works in private chat and groups. Posting it in a group explicitly
makes that global profile visible in that group only. Creating or editing a profile
in private chat does not automatically expose it in any group.

## Privacy and lifecycle behavior

- Profiles are global, but visibility is stored on each `GroupMember`.
- Group search requires an active profile, active membership, and
  `profileVisible=true` in the current group.
- Private search only considers memberships in active groups shared by requester
  and target, and only where the target made the profile visible.
- Search-selection callbacks repeat the same authorization query, so stale or
  forged callback data cannot bypass privacy checks.
- Profile deletion, leaving groups, and events use soft-state fields rather than
  physical deletion.
- Reminder flags are claimed atomically before sending and released if Telegram
  delivery fails, preventing concurrent scheduler instances from duplicating a
  reminder.

## MVP limitations / production TODOs

- Conversation state is in process memory. Use Redis-backed state before running
  multiple bot replicas or requiring wizard recovery after restarts.
- Long polling permits one bot replica. Add a secured webhook transport for
  horizontally scaled production deployment.
- Add rate limiting, structured telemetry, alerting, backup/restore procedures,
  and broader integration tests against a disposable PostgreSQL database.
- Add event cancellation/completion commands and periodic completion of past
  events.
- Telegram messages have size and rate limits; very large communities should add
  paginated participant views and batched reminder mentions.
