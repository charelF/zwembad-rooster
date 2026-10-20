import type { CalendarEvent } from "../calendar";
import { addDays } from "../schedule";
import type { FetchLike } from "./zwembaden-api-amsterdam";

interface SportfondsenActivity {
  id: string;
  title: string;
  url: string;
}

interface SportfondsenTimeSlot {
  dayValue: string;
  startTime: string;
  endTime: string;
  unusualOpeningTimes: boolean;
  alternateStartTime: string | null;
  alternateEndTime: string | null;
  occupationDisplay: string | null;
  activity: SportfondsenActivity;
}

const SOURCE_PAGE = "https://amsterdamoost.sportfondsen.nl/tijden-en-tarieven/";
const LOCATION = "Sportfondsenbad Amsterdam-Oost, Land van Cocagneplein 44, Amsterdam";
const EVENT_FILTER = "banenzwemmen";
const TITLE_SUFFIX = /[\s\u00a0]+sportief\s*&\s*ontspannen\s*$/iu;

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export function getSportfondsenSource(): string {
  return SOURCE_PAGE;
}

function fail(path: string, expectation: string): never {
  throw new Error(`Invalid Sportfondsen timetable: ${path} must be ${expectation}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(path, "an object");
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") {
    return fail(path, "a string");
  }
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) {
    return null;
  }
  return string(value, path);
}

function parseTime(value: string, path: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    return fail(path, "a valid HH:MM time");
  }
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function parseActivity(value: unknown, path: string): SportfondsenActivity {
  const candidate = record(value, path);
  return {
    id: string(candidate.id, `${path}.id`).trim(),
    title: string(candidate.title, `${path}.title`).trim(),
    url: string(candidate.url, `${path}.url`).trim(),
  };
}

function parseTimeSlot(value: unknown, index: number): SportfondsenTimeSlot {
  const path = `scheduleData.timeSlots[${index}]`;
  const candidate = record(value, path);
  const activitySchedule = record(candidate.activitySchedule, `${path}.activitySchedule`);
  const dayValue = string(candidate.dayValue, `${path}.dayValue`).trim().toLowerCase();
  if (!(WEEKDAYS as readonly string[]).includes(dayValue)) {
    return fail(`${path}.dayValue`, "a recognized weekday");
  }
  if (typeof candidate.unusualOpeningTimes !== "boolean") {
    return fail(`${path}.unusualOpeningTimes`, "a boolean");
  }

  const occupation = candidate.occupationDisplay;
  if (occupation !== null && typeof occupation !== "string") {
    return fail(`${path}.occupationDisplay`, "a string or null");
  }

  return {
    dayValue,
    startTime: parseTime(string(candidate.startTime, `${path}.startTime`), `${path}.startTime`),
    endTime: parseTime(string(candidate.endTime, `${path}.endTime`), `${path}.endTime`),
    unusualOpeningTimes: candidate.unusualOpeningTimes,
    alternateStartTime: nullableString(candidate.alternateStartTime, `${path}.alternateStartTime`),
    alternateEndTime: nullableString(candidate.alternateEndTime, `${path}.alternateEndTime`),
    occupationDisplay: occupation,
    activity: parseActivity(activitySchedule.activity, `${path}.activitySchedule.activity`),
  };
}

function extractTimeSlots(html: string): SportfondsenTimeSlot[] {
  const match = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/iu.exec(html);
  if (!match) {
    throw new Error("Invalid Sportfondsen timetable: __NEXT_DATA__ was not found");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch (error) {
    throw new Error("Invalid Sportfondsen timetable: __NEXT_DATA__ is not valid JSON", {
      cause: error,
    });
  }

  const root = record(parsed, "__NEXT_DATA__");
  const props = record(root.props, "props");
  const pageProps = record(props.pageProps, "props.pageProps");
  const extraPageProps = record(pageProps.extraPageProps, "props.pageProps.extraPageProps");
  const scheduleData = record(extraPageProps.scheduleData, "scheduleData");
  if (!Array.isArray(scheduleData.timeSlots)) {
    return fail("scheduleData.timeSlots", "an array");
  }
  return scheduleData.timeSlots.map(parseTimeSlot);
}

function weekday(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${date}`);
  }
  return WEEKDAYS[parsed.getUTCDay()];
}

function eventTimes(slot: SportfondsenTimeSlot): { start: string; end: string } | null {
  if (!slot.unusualOpeningTimes) {
    return { start: slot.startTime, end: slot.endTime };
  }
  if (slot.alternateStartTime === null || slot.alternateEndTime === null) {
    return null;
  }
  return {
    start: parseTime(slot.alternateStartTime, "alternateStartTime"),
    end: parseTime(slot.alternateEndTime, "alternateEndTime"),
  };
}

function absoluteActivityUrl(path: string): string {
  return new URL(path || SOURCE_PAGE, SOURCE_PAGE).toString();
}

function toEvents(dates: string[], slots: SportfondsenTimeSlot[]): CalendarEvent[] {
  const filteredSlots = slots.filter((slot) =>
    slot.activity.title.toLocaleLowerCase("nl-NL").includes(EVENT_FILTER)
  );

  return dates.flatMap((date) => filteredSlots.flatMap((slot, slotIndex) => {
    if (slot.dayValue !== weekday(date)) {
      return [];
    }
    const times = eventTimes(slot);
    if (times === null) {
      return [];
    }

    const endDate = times.end <= times.start ? addDays(date, 1) : date;
    return [{
      id: `sportfondsen-${date}-${slot.activity.id}-${slot.dayValue}-${slotIndex + 1}`,
      title: slot.activity.title.replace(TITLE_SUFFIX, "").trim(),
      description: slot.occupationDisplay ?? undefined,
      location: LOCATION,
      url: absoluteActivityUrl(slot.activity.url),
      start: { date, time: times.start },
      end: { date: endDate, time: times.end },
    }];
  }));
}

export async function fetchSportfondsenEvents(
  dates: string[],
  fetcher: FetchLike = fetch,
): Promise<CalendarEvent[]> {
  const response = await fetcher(SOURCE_PAGE, {
    headers: { Accept: "text/html" },
  });
  if (!response.ok) {
    throw new Error(`Sportfondsen timetable returned ${response.status}`);
  }

  return toEvents(dates, extractTimeSlots(await response.text()));
}
