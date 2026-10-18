export const CALENDAR_KEY = "de-mirandabad.ics";

export interface ScheduleItem {
  activity: string;
  extra: string;
  start: string;
  end: string;
  dow: string;
}

export interface DatedSchedule {
  title: string;
  pool: string;
  schedule: ScheduleItem[];
}

export interface CalendarMetadata {
  fetchedAt: string;
  periodStart: string;
  periodEnd: string;
  eventCount: number;
  source: string;
  version: string;
}

export interface CalendarConfig {
  apiBaseUrl: string;
  poolSlug: string;
  calendarDays: number;
  calendarName: string;
  timeZone: string;
}

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const SOURCE_PAGE = "https://www.amsterdam.nl/demirandabad/rooster/";
const LOCATION = "De Mirandabad, De Mirandalaan 9, Amsterdam";
const REFRESH_HOURS = new Set([8, 12, 18]);

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`Invalid API response: ${path} must be a string`);
  }
}

export function parseSchedule(value: unknown, date: string): DatedSchedule {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Invalid API response for ${date}: expected an object`);
  }

  const candidate = value as Record<string, unknown>;
  assertString(candidate.title, `${date}.title`);
  assertString(candidate.pool, `${date}.pool`);

  if (!Array.isArray(candidate.schedule)) {
    throw new Error(`Invalid API response: ${date}.schedule must be an array`);
  }

  const schedule = candidate.schedule.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`Invalid API response: ${date}.schedule[${index}] must be an object`);
    }

    const row = item as Record<string, unknown>;
    assertString(row.activity, `${date}.schedule[${index}].activity`);
    assertString(row.extra, `${date}.schedule[${index}].extra`);
    assertString(row.start, `${date}.schedule[${index}].start`);
    assertString(row.end, `${date}.schedule[${index}].end`);
    assertString(row.dow, `${date}.schedule[${index}].dow`);
    parseTime(row.start);
    parseTime(row.end);

    return {
      activity: row.activity.trim(),
      extra: row.extra.trim(),
      start: row.start,
      end: row.end,
      dow: row.dow.trim(),
    };
  });

  return {
    title: candidate.title,
    pool: candidate.pool,
    schedule,
  };
}

export function getLocalDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getLocalHour(date: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return Number.parseInt(hour, 10);
}

export function shouldRefresh(date: Date, timeZone: string): boolean {
  return REFRESH_HOURS.has(getLocalHour(date, timeZone));
}

export function addDays(date: string, amount: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${date}`);
  }
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

export function listDates(startDate: string, count: number): string[] {
  if (!Number.isInteger(count) || count < 1 || count > 60) {
    throw new Error("calendarDays must be an integer between 1 and 60");
  }
  return Array.from({ length: count }, (_, index) => addDays(startDate, index));
}

export async function fetchDatedSchedule(
  date: string,
  config: CalendarConfig,
  fetcher: FetchLike = fetch,
): Promise<DatedSchedule> {
  const url = `${config.apiBaseUrl}/${config.poolSlug}/date/${date}/`;
  const response = await fetcher(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Schedule API returned ${response.status} for ${date}`);
  }

  const body: unknown = await response.json();
  return parseSchedule(body, date);
}

function parseTime(value: string): { hours: number; minutes: number } {
  const match = /^(\d{1,2})[.:](\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Invalid schedule time: ${value}`);
  }

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours > 23 || minutes > 59) {
    throw new Error(`Invalid schedule time: ${value}`);
  }
  return { hours, minutes };
}

function formatLocalDateTime(date: string, time: string): string {
  const { hours, minutes } = parseTime(time);
  return `${date.replaceAll("-", "")}T${String(hours).padStart(2, "0")}${String(minutes).padStart(2, "0")}00`;
}

function formatUtcDateTime(date: Date): string {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
}

function escapeText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}

function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let chunk = "";
  let bytes = 0;

  for (const character of line) {
    const characterBytes = encoder.encode(character).byteLength;
    const limit = chunks.length === 0 ? 75 : 74;
    if (bytes + characterBytes > limit && chunk.length > 0) {
      chunks.push(chunk);
      chunk = "";
      bytes = 0;
    }
    chunk += character;
    bytes += characterBytes;
  }
  chunks.push(chunk);
  return chunks.join("\r\n ");
}

function uidPart(value: string): string {
  return encodeURIComponent(value.trim().toLocaleLowerCase("nl-NL")).replaceAll("%", "_");
}

function makeUid(
  date: string,
  item: ScheduleItem,
  occurrence: number,
): string {
  return [date, uidPart(item.activity), uidPart(item.extra || "geen-detail"), occurrence].join("-") +
    "@zwembad-rooster";
}

export function buildCalendar(
  schedules: Array<{ date: string; data: DatedSchedule }>,
  config: CalendarConfig,
  generatedAt: Date,
): { ics: string; eventCount: number } {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//zwembad-rooster//De Mirandabad//NL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(config.calendarName)}`,
    `X-WR-TIMEZONE:${config.timeZone}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
    "BEGIN:VTIMEZONE",
    `TZID:${config.timeZone}`,
    `X-LIC-LOCATION:${config.timeZone}`,
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "TZNAME:CEST",
    "DTSTART:19700329T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "TZNAME:CET",
    "DTSTART:19701025T030000",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];

  const stamp = formatUtcDateTime(generatedAt);
  let eventCount = 0;

  for (const { date, data } of schedules) {
    const occurrences = new Map<string, number>();
    for (const item of data.schedule) {
      const occurrenceKey = `${item.activity}\u0000${item.extra}`;
      const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
      occurrences.set(occurrenceKey, occurrence);

      const start = parseTime(item.start);
      const end = parseTime(item.end);
      const endDate = end.hours * 60 + end.minutes <= start.hours * 60 + start.minutes
        ? addDays(date, 1)
        : date;

      lines.push(
        "BEGIN:VEVENT",
        `UID:${makeUid(date, item, occurrence)}`,
        `DTSTAMP:${stamp}`,
        `LAST-MODIFIED:${stamp}`,
        `DTSTART;TZID=${config.timeZone}:${formatLocalDateTime(date, item.start)}`,
        `DTEND;TZID=${config.timeZone}:${formatLocalDateTime(endDate, item.end)}`,
        `SUMMARY:${escapeText(item.activity)}`,
        `DESCRIPTION:${escapeText(item.extra || item.dow)}`,
        `LOCATION:${escapeText(LOCATION)}`,
        `URL:${SOURCE_PAGE}`,
        "STATUS:CONFIRMED",
        "TRANSP:TRANSPARENT",
        "END:VEVENT",
      );
      eventCount += 1;
    }
  }

  lines.push("END:VCALENDAR");
  return {
    ics: `${lines.map(foldLine).join("\r\n")}\r\n`,
    eventCount,
  };
}

export function configFromEnv(env: Env): CalendarConfig {
  const calendarDays = Number.parseInt(env.CALENDAR_DAYS, 10);
  if (!Number.isInteger(calendarDays) || calendarDays < 1 || calendarDays > 60) {
    throw new Error("CALENDAR_DAYS must be an integer between 1 and 60");
  }

  return {
    apiBaseUrl: env.API_BASE_URL.replace(/\/$/, ""),
    poolSlug: env.POOL_SLUG,
    calendarDays,
    calendarName: env.CALENDAR_NAME,
    timeZone: env.TIME_ZONE,
  };
}

export async function refreshCalendar(
  env: Env,
  generatedAt: Date,
  fetcher: FetchLike = fetch,
): Promise<CalendarMetadata> {
  const config = configFromEnv(env);
  const periodStart = getLocalDate(generatedAt, config.timeZone);
  const dates = listDates(periodStart, config.calendarDays);
  const results = await Promise.all(
    dates.map(async (date) => ({
      date,
      data: await fetchDatedSchedule(date, config, fetcher),
    })),
  );

  const { ics, eventCount } = buildCalendar(results, config, generatedAt);
  const fetchedAt = generatedAt.toISOString();
  const metadata: CalendarMetadata = {
    fetchedAt,
    periodStart,
    periodEnd: dates.at(-1)!,
    eventCount,
    source: `${config.apiBaseUrl}/${config.poolSlug}/date/{date}/`,
    version: `${formatUtcDateTime(generatedAt)}-${eventCount}`,
  };

  await env.CALENDAR_CACHE.put(CALENDAR_KEY, ics, { metadata });
  return metadata;
}
