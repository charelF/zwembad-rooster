# 🏊‍♂️ Zwembad rooster 🐓


A Cloudflare Worker that publishes the next 14 days of the De Mirandabad swimming schedule as a subscribable iCalendar feed: https://zwembad-rooster.c-c24.workers.dev/calendar.ics


The Worker fetches Amsterdam's dated schedule [endpoints](https://zwembaden.api-amsterdam.nl/nl/api/) at 08:00, 12:00, and
18:00 in `Europe/Amsterdam`. It generates one complete `.ics` document and
overwrites a single Workers KV value. No relational database is used.

## Endpoints

- `GET /calendar.ics` — the calendar subscription feed
- `HEAD /calendar.ics` — feed metadata without the body
- `GET /health` — last refresh time, covered date range, and event count
- `GET /` — service information and the absolute subscription URL
- `POST /refresh` — authenticated manual source fetch and KV replacement

If the KV value is still empty immediately after the first deployment, the
first request to `/calendar.ics` initializes it synchronously.

## Refresh token setup

`POST /refresh` requires a bearer token because every call fetches 14 upstream dates and replaces the production KV value.

Generate a random token once and copy its output somewhere safe, such as a
password manager:

```sh
openssl rand -hex 32
```

Store that value as an encrypted secret on the production Worker. Wrangler
prompts for the value, so it does not appear in the command or repository:

```sh
pnpm exec wrangler secret put REFRESH_TOKEN
```

The secret name is declared in `wrangler.jsonc`, but its value is stored only
by Cloudflare. Setting a secret creates and deploys a Worker version; run the
normal deployment command afterwards to publish the current application code.

For local development, copy the example file and put the same token—or a
different local-only token—in `.dev.vars`:

```sh
cp .dev.vars.example .dev.vars
```

```ini
REFRESH_TOKEN=your-token-here
```

`.dev.vars` is gitignored and is not uploaded to Cloudflare. If the production
token is exposed, generate a new value and run `wrangler secret put` again.

## Development

Requirements: Node.js 22 or newer and pnpm.

```sh
pnpm install
pnpm check
pnpm dev
```

`pnpm dev` enables Wrangler's local scheduled-event test route. Local KV data
is kept separate from production.

To trigger a scheduled refresh locally:

```sh
curl "http://localhost:8787/cdn-cgi/local/scheduled?format=json&cron=0+6,7,10,11,16,17+*+*+*&time=<epoch-milliseconds>"
```

To test a manual refresh locally, use the value from `.dev.vars`:

```sh
curl -X POST \
  -H "Authorization: Bearer <your-token>" \
  http://localhost:8787/refresh
```

The handler checks the corresponding Amsterdam local time and only refreshes
at 08:00, 12:00, or 18:00. The six UTC trigger hours cover both CET and CEST.

## Deployment

After configuring `REFRESH_TOKEN` as described above, deploy the Worker:

```sh
pnpm run deploy:worker
```

Wrangler automatically provisions the `CALENDAR_CACHE` KV namespace on the
first deployment and writes its generated identifier back to `wrangler.jsonc`.
After deployment, subscribe your calendar application to:

```text
https://<worker-name>.<account-subdomain>.workers.dev/calendar.ics
```

The feed is read-only. Calendar clients decide how frequently they refresh
subscriptions, so upstream changes may not appear on a phone immediately.

To refresh the deployed calendar immediately:

```sh
curl -X POST \
  -H "Authorization: Bearer $ZWEMBAD_REFRESH_TOKEN" \
  https://zwembad-rooster.c-c24.workers.dev/refresh
```

Set `ZWEMBAD_REFRESH_TOKEN` in your local shell or password manager to the same
value stored as Cloudflare's `REFRESH_TOKEN` secret. A successful response
includes the new fetch time, date range, and event count.

## Code structure

- `src/sources/zwembaden-api-amsterdam.ts` fetches and validates only the
  Amsterdam swimming API, then returns generic calendar events.
- `src/refresh-calendar.ts` coordinates sources, calendar generation, and KV
  publication.
- `src/calendar.ts` renders generic events as iCalendar.
- `src/calendar-store.ts` reads and writes the generated calendar in KV.
- `src/schedule.ts` owns refresh-time and date-range calculations.
- `src/config.ts` validates Worker configuration.
- `src/index.ts` contains the HTTP and scheduled Worker handlers.

## Reliability behavior

- All 14 dated endpoints must succeed and validate before KV is overwritten.
- A failed refresh leaves the previous calendar intact.
- Event UIDs exclude start/end time, allowing time changes to update existing
  events instead of creating duplicates.
- Calendar timestamps use `TZID=Europe/Amsterdam` and include a `VTIMEZONE`.
- Workers Logs and Traces are enabled in `wrangler.jsonc`.

Amsterdam public pool API: https://zwembaden.api-amsterdam.nl/nl/api/

The schedule backend is used by Amsterdam's official pool pages but is not a
documented, versioned public API. Schema validation and structured logs make a
future upstream change visible without replacing the last good feed.
