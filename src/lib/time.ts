// All business times are IST (UTC+5:30, no daylight saving). Stored values are UTC.
export const DEFAULT_OFFSET_MIN = 330;

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of the given instant in the local (IST) calendar. */
export function localDateStr(d: Date, off = DEFAULT_OFFSET_MIN): string {
  const t = new Date(d.getTime() + off * 60000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** "HH:MM" of the given instant in local (IST) time. */
export function localHM(d: Date, off = DEFAULT_OFFSET_MIN): string {
  const t = new Date(d.getTime() + off * 60000);
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

/** Convert a local calendar date + "HH:MM[:SS]" to the UTC instant. */
export function localToUtc(dateStr: string, timeStr: string, off = DEFAULT_OFFSET_MIN): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - off * 60000);
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export const addMinutes = (d: Date, min: number) => new Date(d.getTime() + min * 60000);

/** "08:00-16:00" from Postgres time strings such as "08:00:00". */
export function shiftLabel(start: string, end: string): string {
  return `${start.slice(0, 5)}-${end.slice(0, 5)}`;
}

/** "10 Oct, 08:30" in local time. */
export function fmtDateTime(d: Date | string, off = DEFAULT_OFFSET_MIN): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  const t = new Date(dt.getTime() + off * 60000);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${t.getUTCDate()} ${months[t.getUTCMonth()]}, ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

export const isDateStr = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
