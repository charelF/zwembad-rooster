const REFRESH_HOURS = new Set([8, 12, 18]);

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
