import type { CalendarEvent } from "../calendar";
import { addDays } from "../schedule";

interface ScheduleItem {
  activity: string;
  extra: string;
  start: string;
  end: string;
  dow: string;
}

interface DatedSchedule {
  title: string;
  pool: string;
  schedule: ScheduleItem[];
}

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const API_BASE_URL = "https://zwembaden.api-amsterdam.nl/nl/api";
const DEFAULT_POOL_SLUG = "de-mirandabad";
const SOURCE_PAGE = "https://www.amsterdam.nl/demirandabad/rooster/";
const LOCATION = "De Mirandabad, De Mirandalaan 9, Amsterdam";
const EVENT_FILTER = "banen";

export function getZwembadenApiAmsterdamSource(
  poolSlug: string = DEFAULT_POOL_SLUG,
): string {
  return `${API_BASE_URL}/${poolSlug}/date/{date}/`;
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`Invalid Amsterdam swimming API response: ${path} must be a string`);
  }
}

function parseTime(value: string): { hours: number; minutes: number } {
  const match = /^(\d{1,2})[.:](\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Invalid Amsterdam swimming API time: ${value}`);
  }

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours > 23 || minutes > 59) {
    throw new Error(`Invalid Amsterdam swimming API time: ${value}`);
  }
  return { hours, minutes };
}

function parseSchedule(value: unknown, date: string): DatedSchedule {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Invalid Amsterdam swimming API response for ${date}: expected an object`);
  }

  const candidate = value as Record<string, unknown>;
  assertString(candidate.title, `${date}.title`);
  assertString(candidate.pool, `${date}.pool`);

  if (!Array.isArray(candidate.schedule)) {
    throw new Error(`Invalid Amsterdam swimming API response: ${date}.schedule must be an array`);
  }

  const schedule = candidate.schedule.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`Invalid Amsterdam swimming API response: ${date}.schedule[${index}] must be an object`);
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

async function fetchDatedSchedule(
  date: string,
  poolSlug: string,
  fetcher: FetchLike,
): Promise<DatedSchedule> {
  const url = `${API_BASE_URL}/${poolSlug}/date/${date}/`;
  const response = await fetcher(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Amsterdam swimming API returned ${response.status} for ${date}`);
  }

  const body: unknown = await response.json();
  return parseSchedule(body, date);
}

function uidPart(value: string): string {
  return encodeURIComponent(value.trim().toLocaleLowerCase("nl-NL")).replaceAll("%", "_");
}

function matchesEventFilter(item: ScheduleItem): boolean {
  return [item.activity, item.extra].some((value) =>
    value.toLocaleLowerCase("nl-NL").includes(EVENT_FILTER)
  );
}

function toEvents(
  date: string,
  schedule: DatedSchedule,
): CalendarEvent[] {
  const occurrences = new Map<string, number>();

  return schedule.schedule.filter(matchesEventFilter).map((item) => {
    const occurrenceKey = `${item.activity}\u0000${item.extra}`;
    const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
    occurrences.set(occurrenceKey, occurrence);

    const start = parseTime(item.start);
    const end = parseTime(item.end);
    const endDate = end.hours * 60 + end.minutes <= start.hours * 60 + start.minutes
      ? addDays(date, 1)
      : date;

    return {
      id: [
        date,
        uidPart(item.activity),
        uidPart(item.extra || "geen-detail"),
        occurrence,
      ].join("-"),
      title: item.activity,
      description: item.extra || item.dow,
      location: LOCATION,
      url: SOURCE_PAGE,
      start: { date, time: item.start },
      end: { date: endDate, time: item.end },
    };
  });
}

export async function fetchZwembadenApiAmsterdamEvents(
  dates: string[],
  fetcher: FetchLike = fetch,
  poolSlug: string = DEFAULT_POOL_SLUG,
): Promise<CalendarEvent[]> {
  const schedules = await Promise.all(
    dates.map(async (date) => ({
      date,
      schedule: await fetchDatedSchedule(date, poolSlug, fetcher),
    })),
  );

  return schedules.flatMap(({ date, schedule }) => toEvents(date, schedule));
}
