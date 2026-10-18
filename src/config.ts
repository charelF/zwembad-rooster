export interface CalendarConfig {
  calendarDays: number;
  calendarName: string;
  timeZone: string;
}

export interface ZwembadenApiAmsterdamConfig {
  apiBaseUrl: string;
  poolSlug: string;
}

export interface AppConfig {
  calendar: CalendarConfig;
  zwembadenApiAmsterdam: ZwembadenApiAmsterdamConfig;
}

export function configFromEnv(env: Env): AppConfig {
  const calendarDays = Number.parseInt(env.CALENDAR_DAYS, 10);
  if (!Number.isInteger(calendarDays) || calendarDays < 1 || calendarDays > 60) {
    throw new Error("CALENDAR_DAYS must be an integer between 1 and 60");
  }

  return {
    calendar: {
      calendarDays,
      calendarName: env.CALENDAR_NAME,
      timeZone: env.TIME_ZONE,
    },
    zwembadenApiAmsterdam: {
      apiBaseUrl: env.API_BASE_URL.replace(/\/$/, ""),
      poolSlug: env.POOL_SLUG,
    },
  };
}
