import { buildCalendar } from "./calendar";
import {
  type CalendarMetadata,
  putCalendar,
} from "./calendar-store";
import { configFromEnv } from "./config";
import { getLocalDate, listDates } from "./schedule";
import {
  fetchZwembadenApiAmsterdamEvents,
  type FetchLike,
  getZwembadenApiAmsterdamSource,
} from "./sources/zwembaden-api-amsterdam";

function formatVersionDate(date: Date): string {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
}

export async function refreshCalendar(
  env: Env,
  generatedAt: Date,
  fetcher: FetchLike = fetch,
): Promise<CalendarMetadata> {
  const config = configFromEnv(env);
  const periodStart = getLocalDate(generatedAt, config.calendar.timeZone);
  const dates = listDates(periodStart, config.calendar.calendarDays);

  const events = await fetchZwembadenApiAmsterdamEvents(
    dates,
    fetcher,
  );
  const ics = buildCalendar(events, config.calendar, generatedAt);

  const metadata: CalendarMetadata = {
    fetchedAt: generatedAt.toISOString(),
    periodStart,
    periodEnd: dates.at(-1)!,
    eventCount: events.length,
    source: getZwembadenApiAmsterdamSource(),
    version: `${formatVersionDate(generatedAt)}-${events.length}`,
  };

  // Publish only after every source fetch and calendar generation succeeds.
  await putCalendar(env.CALENDAR_CACHE, ics, metadata);
  return metadata;
}
