import type { CalendarConfig } from "./config";

export interface LocalDateTime {
  date: string;
  time: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  location?: string;
  url?: string;
  start: LocalDateTime;
  end: LocalDateTime;
}

function parseTime(value: string): { hours: number; minutes: number } {
  const match = /^(\d{1,2})[.:](\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Invalid calendar event time: ${value}`);
  }

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours > 23 || minutes > 59) {
    throw new Error(`Invalid calendar event time: ${value}`);
  }
  return { hours, minutes };
}

function formatLocalDateTime(value: LocalDateTime): string {
  const { hours, minutes } = parseTime(value.time);
  return `${value.date.replaceAll("-", "")}T${String(hours).padStart(2, "0")}${String(minutes).padStart(2, "0")}00`;
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

export function buildCalendar(
  events: CalendarEvent[],
  config: CalendarConfig,
  generatedAt: Date,
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//zwembad-rooster//Calendar//NL",
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
  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id}@zwembad-rooster`,
      `DTSTAMP:${stamp}`,
      `LAST-MODIFIED:${stamp}`,
      `DTSTART;TZID=${config.timeZone}:${formatLocalDateTime(event.start)}`,
      `DTEND;TZID=${config.timeZone}:${formatLocalDateTime(event.end)}`,
      `SUMMARY:${escapeText(event.title)}`,
    );

    if (event.description) {
      lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    }
    if (event.location) {
      lines.push(`LOCATION:${escapeText(event.location)}`);
    }
    if (event.url) {
      lines.push(`URL:${event.url}`);
    }

    lines.push(
      "STATUS:CONFIRMED",
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
