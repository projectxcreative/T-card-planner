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
