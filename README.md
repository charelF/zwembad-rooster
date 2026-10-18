# Zwembad rooster


A Cloudflare Worker that publishes the next 14 days of the De Mirandabad swimming schedule as a subscribable iCalendar feed: https://zwembad-rooster.c-c24.workers.dev/calendar.ics


The Worker fetches Amsterdam's dated schedule endpoints at 08:00, 12:00, and
18:00 in `Europe/Amsterdam`. It generates one complete `.ics` document and
overwrites a single Workers KV value. No relational database is used.

## Endpoints

- `GET /calendar.ics` — the calendar subscription feed
- `HEAD /calendar.ics` — feed metadata without the body
- `GET /health` — last refresh time, covered date range, and event count
- `GET /` — service information and the absolute subscription URL

If the KV value is still empty immediately after the first deployment, the
first request to `/calendar.ics` initializes it synchronously.

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
curl "http://localhost:8787/cdn-cgi/handler/scheduled?format=json&cron=0+6,7,10,11,16,17+*+*+*&time=<epoch-milliseconds>"
```

There is no endpoint currently to to trigger a manual refresh of the deployed production instance.

The handler checks the corresponding Amsterdam local time and only refreshes
at 08:00, 12:00, or 18:00. The six UTC trigger hours cover both CET and CEST.

## Deployment

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

The schedule backend is used by Amsterdam's official pool pages but is not a
documented, versioned public API. Schema validation and structured logs make a
future upstream change visible without replacing the last good feed.
