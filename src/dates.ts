/** Day keys are local-time `YYYY-MM-DD` strings — never UTC ISO strings, so a
 *  card dropped on Monday stays on Monday regardless of timezone. */

const pad = (n: number) => String(n).padStart(2, '0');

export function toKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey(): string {
  return toKey(new Date());
}

export function addDays(key: string, days: number): string {
  const date = fromKey(key);
  date.setDate(date.getDate() + days);
  return toKey(date);
}

/** Monday of the week containing `key`. */
export function startOfWeek(key: string): string {
  const date = fromKey(key);
  const offset = (date.getDay() + 6) % 7; // 0 = Monday
  date.setDate(date.getDate() - offset);
  return toKey(date);
}

export function weekKeys(mondayKey: string, includeWeekend: boolean): string[] {
  const length = includeWeekend ? 7 : 5;
  return Array.from({ length }, (_, i) => addDays(mondayKey, i));
}

export function isToday(key: string): boolean {
  return key === todayKey();
}

export function isPast(key: string): boolean {
  return key < todayKey();
}

export function isWeekend(key: string): boolean {
  const day = fromKey(key).getDay();
  return day === 0 || day === 6;
}

const dayName = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const dayNumber = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const fullDay = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

export const formatDayName = (key: string) => dayName.format(fromKey(key));
export const formatDayNumber = (key: string) => dayNumber.format(fromKey(key));
export const formatFullDay = (key: string) => fullDay.format(fromKey(key));

/** "31 Aug – 4 Sep 2026", with the shared month or year collapsed by the locale. */
const rangeFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function formatWeekRange(keys: string[]): string {
  if (keys.length === 0) return '';
  return rangeFormat.formatRange(fromKey(keys[0]), fromKey(keys[keys.length - 1]));
}

/* ---------- months ---------- */

/** The first of the month containing `key`. */
export function startOfMonth(key: string): string {
  const date = fromKey(key);
  date.setDate(1);
  return toKey(date);
}

export function addMonths(key: string, months: number): string {
  const date = fromKey(key);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  // Clamp, so 31 Jan + 1 month is the last of February rather than 3 March.
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return toKey(date);
}

export function isSameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** Whole weeks covering the month containing `key`, Monday first — the grid an
 *  Outlook-style month view is drawn on, leading and trailing days included. */
export function monthGrid(key: string, includeWeekend: boolean): string[][] {
  const first = startOfMonth(key);
  const last = addDays(addMonths(first, 1), -1);
  const weeks: string[][] = [];
  for (let monday = startOfWeek(first); monday <= last; monday = addDays(monday, 7)) {
    weeks.push(weekKeys(monday, includeWeekend));
  }
  return weeks;
}

const monthName = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
export const formatMonth = (key: string) => monthName.format(fromKey(key));

/* ---------- times of day ---------- */

/** Minutes from local midnight -> "09:30", in the browser's own clock format. */
const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export function formatTime(minutes: number): string {
  const date = new Date(2000, 0, 1, 0, Math.max(0, Math.round(minutes)));
  return clock.format(date);
}

/** A day key and minutes-from-midnight, as the local `Date` they name. */
export function atMinutes(key: string, minutes: number): Date {
  const date = fromKey(key);
  date.setMinutes(minutes);
  return date;
}

/** The naive local `YYYY-MM-DDTHH:mm:ss` Graph wants alongside a timezone. */
export function graphDateTime(key: string, minutes: number): string {
  const date = atMinutes(key, minutes);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${toKey(date)}T${p(date.getHours())}:${p(date.getMinutes())}:00`;
}

/** Minutes from midnight for a `Date`, relative to its own local day. */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}
