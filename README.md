# Event Ticketing — Backend

Express + TypeScript API for event ticketing (organizers, events, ticket tiers, orders, Fonepay payments, QR check-in).

## Stack

- Express 4, TypeScript
- Prisma 5 (PostgreSQL)
- Zod for validation
- Vitest + Supertest for tests
- Fonepay integration (`@arbyte-solutions/fonepay-service`)
- Mail sending (`@arbyte-solutions/mail-service`)

## Prerequisites

- Node.js 20+
- Yarn 4 (via Corepack — `corepack enable`)
- PostgreSQL running locally (or reachable via `DATABASE_URL`)

## Setup

```bash
corepack enable   # uses the Yarn version pinned in package.json
export GITHUB_TOKEN=...   # read:packages token; needed for @arbyte-solutions/* (see .yarnrc.yml)
yarn install
cp .env.example .env
# fill in real values in .env
yarn prisma migrate dev
yarn dev
```

Server starts on `PORT` from `.env` (default `3000`).

## Environment variables

Copy `.env.example` to `.env` and set:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `NODE_ENV` | `development` / `production` / `test` |
| `PORT` | HTTP port |
| `ORGANIZER_JWT_SECRET` | signs organizer auth tokens |
| `BUYER_JWT_SECRET` | signs buyer auth tokens |
| `TICKET_SECRET` | signs/derives ticket QR codes |
| `APP_BASE_URL` | frontend origin (used for CORS / links) |
| `BACKEND_BASE_URL` | this API's own public URL |
| `FONEPAY_*` | Fonepay merchant/API credentials (redirect + dynamic QR) |
| `SMTP_*` | outgoing mail (order confirmations, tickets) |
| `ORDER_EXPIRY_MINUTES` | pending-order expiry window |
| `CRON_SECRET` | shared secret for scheduled/cron-triggered endpoints |

`.env.test` holds the equivalent config used by the test suite.

## Scripts

| Command | Description |
|---|---|
| `yarn dev` | run with hot reload (`tsx watch`) |
| `yarn build` | compile TypeScript to `dist/` |
| `yarn start` | run compiled `dist/server.js` |
| `yarn test` | run Vitest suite against `.env.test` |
| `yarn typecheck` | typecheck source, tests and the seed script |
| `yarn typecheck:test` | typecheck test sources only |
| `yarn typecheck:seed` | typecheck `prisma/seed.ts` only |
| `yarn db:seed` | load manual-QA seed data (see below) |
| `yarn prisma:generate` | regenerate Prisma client |
| `yarn prisma:migrate` | create/apply a dev migration |
| `yarn prisma:migrate:test` | apply migrations to the test database |

## Seed data

`yarn db:seed` loads dummy organizers, a buyer, events and orders in every status
for manual QA (see `docs/qa/manual-test-plan.md` in the umbrella repo). It is
idempotent: each run first removes data owned by the seed accounts
(`organizer@test.local`, `other-organizer@test.local`, `buyer@test.local`), then
re-creates it. It reads `.env`, so it targets whatever `DATABASE_URL` points at,
and requires `TICKET_SECRET` so seeded ticket codes verify at check-in.

## Scheduled jobs

Pending orders hold ticket stock until they are settled or expire. Nothing inside
the server schedules the sweep — an external scheduler (cron, a platform cron job,
etc.) must call it periodically, e.g. every minute:

```bash
curl -X POST "$BACKEND_BASE_URL/internal/orders/expire" -H "X-Cron-Secret: $CRON_SECRET"
```

Without this, abandoned orders never release their stock.

## Data model

Defined in `prisma/schema.prisma`: `Organizer`, `Buyer`, `Event`, `TicketTier`, `Order`, `OrderItem`, `Ticket`. Orders carry a `PaymentMethod` (`redirect` or `dynamic_qr`) and move through `pending → paid → fulfilled` (or `failed` / `refunded`). Tickets move `valid → used` / `void` on check-in.

## Testing

```bash
yarn prisma:migrate:test   # once, to prepare the test DB
yarn test
```
