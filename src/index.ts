import { getCalendar } from "./calendar-store";
import { configFromEnv } from "./config";
import { refreshCalendar } from "./refresh-calendar";
import { shouldRefresh } from "./schedule";

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data, null, 2), { ...init, headers });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function calendarResponse(request: Request, env: Env): Promise<Response> {
  let cached = await getCalendar(env.CALENDAR_CACHE);

  if (cached.value === null) {
    console.log(JSON.stringify({ message: "calendar cache empty; initializing" }));
    await refreshCalendar(env, new Date());
    cached = await getCalendar(env.CALENDAR_CACHE);
  }

  if (cached.value === null || cached.metadata === null) {
    throw new Error("Calendar cache is unavailable after refresh");
  }

  const etag = `"${cached.metadata.version}"`;
  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  const headers = new Headers({
    "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    "Content-Type": "text/calendar; charset=utf-8",
    ETag: etag,
    "Last-Modified": new Date(cached.metadata.fetchedAt).toUTCString(),
    "X-Calendar-Last-Updated": cached.metadata.fetchedAt,
    "X-Content-Type-Options": "nosniff",
  });

  return new Response(request.method === "HEAD" ? null : cached.value, { headers });
}

async function handleFetch(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "GET, HEAD" } },
    );
  }

  const url = new URL(request.url);
  if (url.pathname === "/calendar.ics") {
    return calendarResponse(request, env);
  }

  if (url.pathname === "/health") {
    const cached = await getCalendar(env.CALENDAR_CACHE);
    return json({
      ready: cached.value !== null,
      metadata: cached.metadata,
    }, { status: cached.value === null ? 503 : 200 });
  }

  if (url.pathname === "/") {
    const config = configFromEnv(env);
    return json({
      name: config.calendar.calendarName,
      calendarUrl: new URL("/calendar.ics", url).toString(),
      healthUrl: new URL("/health", url).toString(),
      days: config.calendar.calendarDays,
      refreshTimes: ["08:00", "12:00", "18:00"],
      timeZone: config.calendar.timeZone,
    });
  }

  return json({ error: "Not found" }, { status: 404 });
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await handleFetch(request, env);
    } catch (error) {
      console.error(JSON.stringify({
        message: "request failed",
        error: errorMessage(error),
        method: request.method,
        path: new URL(request.url).pathname,
      }));
      return json({ error: "Calendar temporarily unavailable" }, { status: 503 });
    }
  },

  async scheduled(controller, env): Promise<void> {
    const scheduledAt = new Date(controller.scheduledTime);
    const config = configFromEnv(env);
    if (!shouldRefresh(scheduledAt, config.calendar.timeZone)) {
      console.log(JSON.stringify({
        message: "scheduled invocation skipped outside configured local hours",
        scheduledAt: scheduledAt.toISOString(),
        timeZone: config.calendar.timeZone,
      }));
      return;
    }

    try {
      const metadata = await refreshCalendar(env, scheduledAt);
      console.log(JSON.stringify({
        message: "calendar refreshed",
        ...metadata,
      }));
    } catch (error) {
      console.error(JSON.stringify({
        message: "scheduled refresh failed; previous calendar retained",
        error: errorMessage(error),
        scheduledAt: scheduledAt.toISOString(),
      }));
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;
