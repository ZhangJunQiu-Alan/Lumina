const ROUTINE_DAY_RESET_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  const key = `${locale}:${timeZone}:${JSON.stringify(options)}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone });
  formatterCache.set(key, formatter);
  return formatter;
}

export function resolveTimeZone(timeZone: string | null | undefined, fallback = 'UTC') {
  if (!timeZone) return fallback;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return fallback;
  }
}

export function toCalendarDateKey(date: Date, timeZone: string) {
  const parts = getFormatter('en-CA', timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export function toRoutineDateKey(
  date: Date,
  timeZone: string,
  resetHour = ROUTINE_DAY_RESET_HOUR,
) {
  return toCalendarDateKey(new Date(date.getTime() - resetHour * HOUR_MS), timeZone);
}

export function routineDateKeyFromIso(
  iso: string | null | undefined,
  timeZone: string,
  resetHour = ROUTINE_DAY_RESET_HOUR,
) {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return toRoutineDateKey(parsed, timeZone, resetHour);
}

export function getRoutineDayResetHour() {
  return ROUTINE_DAY_RESET_HOUR;
}
