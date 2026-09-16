/**
 * The board, rendered as a calendar feed anyone holding the link can subscribe
 * to.
 *
 * This is the other direction from the in-browser Microsoft 365 connection. That
 * one signs in as you and writes entries into your calendar, which means a
 * sign-in that has to be kept alive — and a browser sign-in is exactly the thing
 * that keeps running out. A feed has no sign-in at all: Outlook fetches a URL on
 * its own schedule, reads whatever the board says now, and shows it as one more
 * calendar beside your own. Nothing can write back, which is why it is read-only
 * by construction rather than by permission.
 *
 * The output is RFC 5545 iCalendar: CRLF line endings, 75-octet folding, and
 * escaped TEXT values. Outlook is not forgiving about any of the three.
 */

const CRLF = '\r\n';

/** The window of days the feed covers, and what it puts in them. */
export interface FeedOptions {
  /** What the calendar calls itself, before whatever you name it on subscribing. */
  name: string;
  /** IANA zone the board's clock times mean, e.g. `Europe/London`. */
  timeZone: string;
  /** Every scheduled card, or only the ones ticked for the calendar. */
  scope: 'all' | 'published';
  includeDone: boolean;
  /** Minutes before the start to remind, or null for no reminder. */
  alarmMinutes: number | null;
  /** How many days of finished weeks to keep in the feed; null for all of them. */
  pastDays: number | null;
}

export const DEFAULT_FEED_OPTIONS: FeedOptions = {
  name: 'T-Card Planner',
  timeZone: 'UTC',
  scope: 'all',
  includeDone: true,
  alarmMinutes: null,
  pastDays: 90,
};

/** A card with no length is an hour, the same as publishing one gives it. */
const DEFAULT_LENGTH_MINUTES = 60;
const MINUTES_IN_DAY = 24 * 60;

/** Day keys are `YYYY-MM-DD`; the backlog is the one lane that isn't a day. */
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- options ---------- */

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads whatever the app sent, falling back field by field.
 *
 * Field by field rather than all or nothing: a POST that only wants to change
 * the reminder shouldn't have to resend the timezone it never touched.
 */
export function normaliseOptions(input: unknown, base: FeedOptions = DEFAULT_FEED_OPTIONS): FeedOptions {
  const raw = (input ?? {}) as Partial<FeedOptions>;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 60) : base.name;
  const timeZone =
    typeof raw.timeZone === 'string' && isValidTimeZone(raw.timeZone.trim()) ? raw.timeZone.trim() : base.timeZone;

  let pastDays = base.pastDays;
  if (raw.pastDays === null) pastDays = null;
  else if (Number.isFinite(raw.pastDays)) pastDays = Math.min(3650, Math.max(0, Math.round(Number(raw.pastDays))));

  let alarmMinutes = base.alarmMinutes;
  if (raw.alarmMinutes === null) alarmMinutes = null;
  else if (Number.isFinite(raw.alarmMinutes)) {
    alarmMinutes = Math.min(7 * MINUTES_IN_DAY, Math.max(0, Math.round(Number(raw.alarmMinutes))));
  }

  return {
    name,
    timeZone,
    scope: raw.scope === 'published' || raw.scope === 'all' ? raw.scope : base.scope,
    includeDone: typeof raw.includeDone === 'boolean' ? raw.includeDone : base.includeDone,
    alarmMinutes,
    pastDays,
  };
}

/* ---------- time ---------- */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let held = formatters.get(timeZone);
  if (!held) {
    held = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, held);
  }
  return held;
}

function readParts(instant: number, timeZone: string): Record<string, number> {
  const read: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== 'literal') read[part.type] = Number(part.value);
  }
  return read;
}

/** How far ahead of UTC the zone is at that instant, in ms. */
function offsetMs(instant: number, timeZone: string): number {
  const p = readParts(instant, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant;
}

/**
 * The instant a wall-clock reading names in a zone.
 *
 * `wallMs` is the reading pretending to be UTC — `Date.UTC(…)` of the numbers on
 * the clock. Applying the offset once lands in the right region, and applying it
 * again settles the days either side of a DST change, where the first guess sits
 * on the wrong side of the jump.
 */
export function zonedToUtc(wallMs: number, timeZone: string): number {
  const guess = wallMs - offsetMs(wallMs, timeZone);
  return wallMs - offsetMs(guess, timeZone);
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** Today's day key in the feed's own zone, which is rarely the Worker's. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const p = readParts(now.getTime(), timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** `2026-09-16` moved by n days, staying a day key. */
function shiftKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/** `20260916T083000Z` — the only form of absolute time every client agrees on. */
function utcStamp(ms: number): string {
  const at = new Date(ms);
  return (
    `${pad(at.getUTCFullYear(), 4)}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`
  );
}

/** `20260916`, for an all-day entry, which carries no zone at all. */
function dateStamp(key: string): string {
  return key.replace(/-/g, '');
}

function stampOf(value: unknown, fallback: number): string {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  return utcStamp(Number.isFinite(ms) ? ms : fallback);
}

/* ---------- text ---------- */

function escapeText(value: string): string {
  return (
    value
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n')
      // A TEXT value has no way to carry these, and a stray one ends the line.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  );
}

const encoder = new TextEncoder();

/**
 * Folds a content line to 75 octets, continuations indented by one space.
 *
 * Octets, not characters: a line broken in the middle of a multi-byte character
 * is not valid UTF-8 and shows up as mojibake in whatever read it, so the break
 * is measured in bytes but only ever taken between characters.
 */
function fold(line: string): string {
  const chunks: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      chunks.push(current);
      current = '';
      bytes = 0;
      // A continuation spends one of its 75 octets on the leading space.
      limit = 74;
    }
    current += char;
    bytes += size;
  }
  chunks.push(current);
  return chunks.join(`${CRLF} `);
}

/** Rich text as the plain lines a calendar entry can show. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|hr)\s*\/?\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n- ')
    // `li` is not in the list: its opening tag already started the line, and
    // closing it as well would leave a blank line between every bullet.
    .replace(/<\s*\/\s*(p|div|h[1-6]|ul|ol|blockquote|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    // Last, so an escaped `&amp;lt;` doesn't decode twice into a tag.
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 90 -> "1h 30m", so a size reads the way it was typed. */
function formatMinutes(minutes: number): string {
  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours && rest) return `${hours}h ${rest}m`;
  if (hours) return `${hours}h`;
  return `${rest}m`;
}

/* ---------- the board, as much of it as a feed needs ---------- */

interface Board {
  cards: Record<string, RawCard>;
  lanes: Record<string, unknown>;
  categories: Record<string, unknown>;
  projects: Record<string, unknown>;
  clients: Record<string, unknown>;
}

interface RawCard {
  title?: unknown;
  description?: unknown;
  colour?: unknown;
  status?: unknown;
  estimate?: unknown;
  start?: unknown;
  projectId?: unknown;
  clients?: unknown;
  publish?: unknown;
  updates?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

const STATUS_LABELS: Record<string, string> = {
  todo: 'To do',
  doing: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readBoard(input: unknown): Board {
  const raw = record(input);
  return {
    cards: record(raw.cards) as Record<string, RawCard>,
    lanes: record(raw.lanes),
    categories: record(raw.categories),
    projects: record(raw.projects),
    clients: record(raw.clients),
  };
}

/* ---------- rendering ---------- */

export interface CalendarContext {
  /** The board's own address — the UID domain, and the link back on each entry. */
  origin: string;
  now?: Date;
}

/**
 * The whole board as one iCalendar document.
 *
 * Every card sitting on a day becomes an entry: at its time if it has one, and
 * as an all-day item if it doesn't, because "sometime on Thursday" is exactly
 * what an all-day item means and pinning it to an invented 9am would be a claim
 * the board never made.
 */
export function renderCalendar(input: unknown, options: FeedOptions, context: CalendarContext): string {
  const board = readBoard(input);
  const now = context.now ?? new Date();
  const stamp = utcStamp(now.getTime());
  const host = hostOf(context.origin);
  const from = options.pastDays === null ? null : shiftKey(todayIn(options.timeZone, now), -options.pastDays);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//T-Card Planner//Board feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(options.name)}`,
    `X-WR-CALDESC:${escapeText('Cards planned on the T-Card Planner board.')}`,
    `X-WR-TIMEZONE:${escapeText(options.timeZone)}`,
    // Both spellings: the standard one, and the one Outlook and Google read.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];

  // Lanes are the source of truth for which day a card is on, so the feed is
  // built from them rather than from the cards — a card in no lane is on no day.
  for (const day of Object.keys(board.lanes).sort()) {
    if (!DAY_KEY.test(day)) continue;
    if (from && day < from) continue;
    const ids = board.lanes[day];
    if (!Array.isArray(ids)) continue;

    for (const id of ids) {
      if (typeof id !== 'string') continue;
      const card = board.cards[id];
      if (!card || typeof card.title !== 'string') continue;
      const status = text(card.status) || 'todo';
      if (options.scope === 'published' && card.publish !== true) continue;
      if (!options.includeDone && status === 'done') continue;
      lines.push(...renderEvent(id, card, day, status, board, options, { stamp, host, origin: context.origin }));
    }
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join(CRLF)}${CRLF}`;
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host || 't-card-planner';
  } catch {
    return 't-card-planner';
  }
}

function renderEvent(
  id: string,
  card: RawCard,
  day: string,
  status: string,
  board: Board,
  options: FeedOptions,
  meta: { stamp: string; host: string; origin: string },
): string[] {
  const start = Number.isFinite(card.start) ? Math.max(0, Math.round(Number(card.start))) : null;
  const estimate = Number.isFinite(card.estimate) ? Number(card.estimate) : 0;
  const done = status === 'done';
  const title = text(card.title).trim() || 'Untitled card';

  const lines = ['BEGIN:VEVENT', `UID:${escapeText(`tcard-${id}@${meta.host}`)}`, `DTSTAMP:${meta.stamp}`];

  if (start === null) {
    // Whole-day values carry no zone, so nothing here needs converting.
    lines.push(`DTSTART;VALUE=DATE:${dateStamp(day)}`, `DTEND;VALUE=DATE:${dateStamp(shiftKey(day, 1))}`);
    lines.push('X-MICROSOFT-CDO-ALLDAYEVENT:TRUE');
  } else {
    const length = estimate > 0 ? Math.round(estimate * 60) : DEFAULT_LENGTH_MINUTES;
    // Clamped to the end of its own day, the same as a published card, and
    // never to nothing: a zero-length entry is one some clients won't draw.
    const end = Math.max(Math.min(start + length, MINUTES_IN_DAY), start + 1);
    const [y, m, d] = day.split('-').map(Number);
    const midnight = Date.UTC(y, m - 1, d);
    lines.push(
      `DTSTART:${utcStamp(zonedToUtc(midnight + start * 60_000, options.timeZone))}`,
      `DTEND:${utcStamp(zonedToUtc(midnight + end * 60_000, options.timeZone))}`,
    );
  }

  lines.push(`SUMMARY:${escapeText(title)}`);

  const description = describe(card, status, board, meta.origin);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);

  const category = text(record(board.categories[text(card.colour)]).label).trim();
  if (category) lines.push(`CATEGORIES:${escapeText(category)}`);

  lines.push(`URL:${escapeText(meta.origin)}`);
  // Finished work shouldn't go on blocking your diary, and something you are
  // blocked on isn't a commitment you can keep either.
  lines.push(done ? 'TRANSP:TRANSPARENT' : 'TRANSP:OPAQUE');
  lines.push(`X-MICROSOFT-CDO-BUSYSTATUS:${done ? 'FREE' : status === 'blocked' ? 'TENTATIVE' : 'BUSY'}`);
  lines.push(`CREATED:${stampOf(card.createdAt, Date.now())}`);
  lines.push(`LAST-MODIFIED:${stampOf(card.updatedAt, Date.now())}`);

  // No reminder on something already finished — it would fire for nothing.
  if (options.alarmMinutes !== null && !done) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(title)}`,
      `TRIGGER:-PT${options.alarmMinutes}M`,
      'END:VALARM',
    );
  }

  lines.push('END:VEVENT');
  return lines;
}

/** What the card says, as the body of the entry. */
function describe(card: RawCard, status: string, board: Board, origin: string): string {
  const parts: string[] = [];
  const facts: string[] = [STATUS_LABELS[status] ?? 'To do'];

  const estimate = Number.isFinite(card.estimate) ? Number(card.estimate) : 0;
  if (estimate > 0) facts.push(`planned ${formatMinutes(estimate * 60)}`);

  const logged = Array.isArray(card.updates)
    ? card.updates.reduce((sum: number, update: unknown) => {
        const minutes = Number(record(update).minutes);
        return Number.isFinite(minutes) ? sum + minutes : sum;
      }, 0)
    : 0;
  if (logged > 0) facts.push(`logged ${formatMinutes(logged)}`);
  parts.push(facts.join(' - '));

  const project = record(board.projects[text(card.projectId)]);
  const projectTitle = text(project.title).trim();
  if (projectTitle) parts.push(`Project: ${projectTitle}`);

  const names = (Array.isArray(card.clients) ? card.clients : [])
    .map((clientId: unknown) => text(record(board.clients[text(clientId)]).name).trim())
    .filter(Boolean);
  // A card that names no client of its own still belongs to whoever is paying
  // for its project, which is the answer you actually wanted.
  if (names.length === 0 && projectTitle) {
    const owner = text(record(board.clients[text(project.clientId)]).name).trim();
    if (owner) names.push(owner);
  }
  if (names.length > 0) parts.push(`${names.length === 1 ? 'Client' : 'Clients'}: ${names.join(', ')}`);

  const body = htmlToText(text(card.description));
  if (body) parts.push('', body);

  parts.push('', origin);
  return parts.join('\n');
}
