export const CALENDAR_KEY = "de-mirandabad.ics";

export interface CalendarMetadata {
  fetchedAt: string;
  periodStart: string;
  periodEnd: string;
  eventCount: number;
  source: string;
  version: string;
}

export interface StoredCalendar {
  value: string | null;
  metadata: CalendarMetadata | null;
}

export function getCalendar(store: KVNamespace): Promise<StoredCalendar> {
  return store.getWithMetadata<CalendarMetadata>(CALENDAR_KEY, "text");
}

export function putCalendar(
  store: KVNamespace,
  value: string,
  metadata: CalendarMetadata,
): Promise<void> {
  return store.put(CALENDAR_KEY, value, { metadata });
}
