/**
 * Checks on the calendar feed.
 *
 * Nothing here is eyeballable: whether an entry lands at the right hour depends
 * on a timezone conversion done by hand, and whether Outlook reads the file at
 * all depends on line endings, folding and escaping that look identical to the
 * wrong version in a terminal. Run with `npm test`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_FEED_OPTIONS, htmlToText, normaliseOptions, renderCalendar, todayIn, zonedToUtc } from './calendar.ts';

const options = (patch = {}) => ({ ...DEFAULT_FEED_OPTIONS, timeZone: 'Europe/London', pastDays: null, ...patch });
const context = { origin: 'https://board.example', now: new Date('2026-09-16T10:00:00Z') };

function card(patch = {}) {
  return {
    title: 'Edit the promo',
    description: '',
    colour: 'blue',
    status: 'todo',
    estimate: 0,
    start: null,
    projectId: null,
    clients: [],
    publish: false,
    updates: [],
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-02T09:00:00.000Z',
    ...patch,
  };
}

function board(cards, lanes, extra = {}) {
  return {
    cards,
    lanes,
    categories: { blue: { label: 'Client work', colour: '#2179c8' } },
    projects: {},
    clients: {},
    ...extra,
  };
}

/** The unfolded content lines, which is what every assertion here is about. */
function lines(ics) {
  assert.ok(ics.endsWith('\r\n'), 'the document ends with CRLF');
  return ics.split('\r\n').reduce((out, line) => {
    if (line.startsWith(' ') && out.length > 0) out[out.length - 1] += line.slice(1);
    else if (line !== '') out.push(line);
    return out;
  }, []);
}

const valueOf = (ics, name) =>
  lines(ics)
    .filter((line) => line === name || line.startsWith(`${name}:`) || line.startsWith(`${name};`))
    .map((line) => line.slice(line.indexOf(':') + 1));

test('a document is well formed even with nothing on the board', () => {
  const ics = renderCalendar(board({}, {}), options(), context);
  const out = lines(ics);
  assert.equal(out[0], 'BEGIN:VCALENDAR');
  assert.equal(out.at(-1), 'END:VCALENDAR');
  assert.ok(out.includes('VERSION:2.0'));
  assert.ok(!out.some((line) => line === 'BEGIN:VEVENT'));
  // Every line is CRLF-terminated, and none is bare-LF.
  assert.ok(!ics.replace(/\r\n/g, '').includes('\n'));
});

test('a card with a time becomes a timed entry, converted out of its own zone', () => {
  // 16 September is British Summer Time: 09:30 local is 08:30 UTC.
  const ics = renderCalendar(
    board({ a: card({ start: 9 * 60 + 30, estimate: 1.5 }) }, { '2026-09-16': ['a'] }),
    options(),
    context,
  );
  assert.deepEqual(valueOf(ics, 'DTSTART'), ['20260916T083000Z']);
  assert.deepEqual(valueOf(ics, 'DTEND'), ['20260916T100000Z']);
  assert.deepEqual(valueOf(ics, 'SUMMARY'), ['Edit the promo']);
  assert.deepEqual(valueOf(ics, 'CATEGORIES'), ['Client work']);
  assert.deepEqual(valueOf(ics, 'TRANSP'), ['OPAQUE']);
});

test('the same clock time in winter is an hour different in UTC', () => {
  const ics = renderCalendar(
    board({ a: card({ start: 9 * 60 + 30, estimate: 1 }) }, { '2026-12-16': ['a'] }),
    options(),
    context,
  );
  // GMT, so 09:30 local is 09:30 UTC — the conversion is per-entry, not fixed.
  assert.deepEqual(valueOf(ics, 'DTSTART'), ['20261216T093000Z']);
});

test('a card with no time becomes an all-day entry, not an invented 9am', () => {
  const ics = renderCalendar(board({ a: card() }, { '2026-09-16': ['a'] }), options(), context);
  const out = lines(ics);
  assert.ok(out.includes('DTSTART;VALUE=DATE:20260916'));
  assert.ok(out.includes('DTEND;VALUE=DATE:20260917'));
  assert.ok(out.includes('X-MICROSOFT-CDO-ALLDAYEVENT:TRUE'));
});

test('an entry never runs past the end of its day, nor to nothing at all', () => {
  const ics = renderCalendar(
    board({ a: card({ start: 23 * 60, estimate: 4 }), b: card({ start: 8 * 60, estimate: 0 }) }, { '2026-09-16': ['a', 'b'] }),
    options(),
    context,
  );
  // 23:00 + 4h is clamped to midnight, which in BST is 23:00 UTC.
  assert.deepEqual(valueOf(ics, 'DTEND'), ['20260916T230000Z', '20260916T080000Z']);
  // A card with no size gets the same hour publishing one would give it.
  assert.deepEqual(valueOf(ics, 'DTSTART'), ['20260916T220000Z', '20260916T070000Z']);
});

test('the backlog is not a day, so nothing in it reaches the calendar', () => {
  const ics = renderCalendar(board({ a: card() }, { backlog: ['a'] }), options(), context);
  assert.deepEqual(valueOf(ics, 'SUMMARY'), []);
});

test('a card whose lane points at nothing is skipped rather than thrown over', () => {
  const ics = renderCalendar(board({}, { '2026-09-16': ['gone'] }), options(), context);
  assert.deepEqual(valueOf(ics, 'SUMMARY'), []);
});

test('finished cards show as free, and blocked ones as tentative', () => {
  const ics = renderCalendar(
    board(
      { a: card({ status: 'done', start: 540 }), b: card({ status: 'blocked', start: 600 }) },
      { '2026-09-16': ['a', 'b'] },
    ),
    options(),
    context,
  );
  assert.deepEqual(valueOf(ics, 'TRANSP'), ['TRANSPARENT', 'OPAQUE']);
  assert.deepEqual(valueOf(ics, 'X-MICROSOFT-CDO-BUSYSTATUS'), ['FREE', 'TENTATIVE']);
});

test('done cards can be left out altogether', () => {
  const state = board({ a: card({ status: 'done' }), b: card({ title: 'Still going' }) }, { '2026-09-16': ['a', 'b'] });
  assert.deepEqual(valueOf(renderCalendar(state, options({ includeDone: false }), context), 'SUMMARY'), ['Still going']);
});

test('the published-only scope honours the tick on the card', () => {
  const state = board(
    { a: card({ title: 'Ticked', publish: true }), b: card({ title: 'Not ticked' }) },
    { '2026-09-16': ['a', 'b'] },
  );
  assert.deepEqual(valueOf(renderCalendar(state, options({ scope: 'published' }), context), 'SUMMARY'), ['Ticked']);
  assert.deepEqual(valueOf(renderCalendar(state, options(), context), 'SUMMARY').length, 2);
});

test('the past window is measured from today in the feed’s own zone', () => {
  const state = board(
    { old: card({ title: 'Old' }), recent: card({ title: 'Recent' }) },
    { '2026-06-01': ['old'], '2026-09-10': ['recent'] },
  );
  assert.deepEqual(valueOf(renderCalendar(state, options({ pastDays: 30 }), context), 'SUMMARY'), ['Recent']);
  assert.deepEqual(valueOf(renderCalendar(state, options({ pastDays: null }), context), 'SUMMARY'), ['Old', 'Recent']);
  // Zero keeps today itself, which is the day you are most likely to want.
  const today = board({ now: card({ title: 'Today' }) }, { '2026-09-16': ['now'] });
  assert.deepEqual(valueOf(renderCalendar(today, options({ pastDays: 0 }), context), 'SUMMARY'), ['Today']);
});

test('a reminder is attached only to work still to do', () => {
  const state = board({ a: card({ start: 540 }), b: card({ start: 600, status: 'done' }) }, { '2026-09-16': ['a', 'b'] });
  const out = lines(renderCalendar(state, options({ alarmMinutes: 15 }), context));
  assert.equal(out.filter((line) => line === 'BEGIN:VALARM').length, 1);
  assert.ok(out.includes('TRIGGER:-PT15M'));
});

test('the entry body carries the card, its project and its client', () => {
  const state = board(
    {
      a: card({
        description: '<p>Grade &amp; export</p><ul><li>Two versions</li></ul>',
        projectId: 'p1',
        estimate: 2,
        updates: [{ minutes: 45 }, { minutes: 30 }],
      }),
    },
    { '2026-09-16': ['a'] },
    { projects: { p1: { title: 'Autumn campaign', clientId: 'c1' } }, clients: { c1: { name: 'Northwind' } } },
  );
  const description = valueOf(renderCalendar(state, options(), context), 'DESCRIPTION')[0];
  assert.match(description, /To do - planned 2h - logged 1h 15m/);
  assert.match(description, /Project: Autumn campaign/);
  // No client on the card, so the one paying for its project is named instead.
  assert.match(description, /Client: Northwind/);
  assert.match(description, /Grade & export/);
  assert.match(description, /- Two versions/);
  assert.match(description, /https:\/\/board\.example/);
});

test('separators and newlines are escaped rather than ending the line', () => {
  const state = board({ a: card({ title: 'Shoot; grade, export \\ deliver' }) }, { '2026-09-16': ['a'] });
  const ics = renderCalendar(state, options(), context);
  assert.ok(lines(ics).includes('SUMMARY:Shoot\\; grade\\, export \\\\ deliver'));
  assert.deepEqual(valueOf(ics, 'SUMMARY'), ['Shoot\\; grade\\, export \\\\ deliver']);

  // A newline in a title would otherwise end the line and corrupt everything
  // after it; a control character would do the same without being visible.
  const messy = board({ a: card({ title: 'One\nTwo\u0007Three' }) }, { '2026-09-16': ['a'] });
  assert.deepEqual(valueOf(renderCalendar(messy, options(), context), 'SUMMARY'), ['One\\nTwoThree']);
});

test('long lines are folded to 75 octets and unfold to the original', () => {
  const title = 'A very long card title that will not fit on one line of an iCalendar file at all - twice over: '.repeat(2);
  const ics = renderCalendar(board({ a: card({ title }) }, { '2026-09-16': ['a'] }), options(), context);
  for (const line of ics.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line over 75 octets: ${line}`);
  }
  assert.deepEqual(valueOf(ics, 'SUMMARY'), [title.trim()]);
});

test('folding counts octets but never splits a character', () => {
  const title = 'é'.repeat(80);
  const ics = renderCalendar(board({ a: card({ title }) }, { '2026-09-16': ['a'] }), options(), context);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  assert.deepEqual(valueOf(ics, 'SUMMARY'), [title]);
});

test('every entry is uniquely and stably identified', () => {
  const state = board({ a: card(), b: card({ title: 'Second' }) }, { '2026-09-16': ['a', 'b'] });
  const uids = valueOf(renderCalendar(state, options(), context), 'UID');
  assert.deepEqual(uids, ['tcard-a@board.example', 'tcard-b@board.example']);
  assert.deepEqual(valueOf(renderCalendar(state, options(), context), 'UID'), uids);
});

test('an untitled card still gets a summary', () => {
  const ics = renderCalendar(board({ a: card({ title: '   ' }) }, { '2026-09-16': ['a'] }), options(), context);
  assert.deepEqual(valueOf(ics, 'SUMMARY'), ['Untitled card']);
});

test('a board that is not a board at all renders an empty calendar', () => {
  for (const input of [null, undefined, 'nonsense', 42, [], { cards: 'no', lanes: 7 }]) {
    const ics = renderCalendar(input, options(), context);
    assert.ok(lines(ics).includes('END:VCALENDAR'));
    assert.deepEqual(valueOf(ics, 'SUMMARY'), []);
  }
});

test('wall-clock times resolve either side of a daylight-saving change', () => {
  const noon = (y, m, d) => Date.UTC(y, m - 1, d, 12);
  assert.equal(new Date(zonedToUtc(noon(2026, 7, 1), 'Europe/London')).toISOString(), '2026-07-01T11:00:00.000Z');
  assert.equal(new Date(zonedToUtc(noon(2026, 1, 1), 'Europe/London')).toISOString(), '2026-01-01T12:00:00.000Z');
  assert.equal(new Date(zonedToUtc(noon(2026, 7, 1), 'America/New_York')).toISOString(), '2026-07-01T16:00:00.000Z');
  assert.equal(new Date(zonedToUtc(noon(2026, 7, 1), 'Asia/Kolkata')).toISOString(), '2026-07-01T06:30:00.000Z');
  assert.equal(new Date(zonedToUtc(noon(2026, 7, 1), 'UTC')).toISOString(), '2026-07-01T12:00:00.000Z');
});

test('today is read in the feed’s zone, not the Worker’s', () => {
  const lateEvening = new Date('2026-09-16T23:30:00Z');
  assert.equal(todayIn('Europe/London', lateEvening), '2026-09-17');
  assert.equal(todayIn('America/New_York', lateEvening), '2026-09-16');
});

test('options fall back field by field, and refuse nonsense', () => {
  const base = { ...DEFAULT_FEED_OPTIONS, timeZone: 'Europe/London', name: 'Studio' };
  assert.deepEqual(normaliseOptions({ alarmMinutes: 10 }, base), { ...base, alarmMinutes: 10 });
  assert.equal(normaliseOptions({ timeZone: 'Mars/Olympus' }, base).timeZone, 'Europe/London');
  assert.equal(normaliseOptions({ scope: 'whatever' }, base).scope, 'all');
  assert.equal(normaliseOptions({ pastDays: -5 }, base).pastDays, 0);
  assert.equal(normaliseOptions({ pastDays: null }, base).pastDays, null);
  assert.equal(normaliseOptions({ alarmMinutes: null }, base).alarmMinutes, null);
  assert.equal(normaliseOptions({ name: '   ' }, base).name, 'Studio');
  assert.equal(normaliseOptions(null, base).name, 'Studio');
});

test('rich text comes out as lines a calendar entry can show', () => {
  assert.equal(htmlToText('<p>One</p><p>Two</p>'), 'One\nTwo');
  assert.equal(htmlToText('<ul><li>A</li><li>B</li></ul>'), '- A\n- B');
  assert.equal(htmlToText('a<br>b'), 'a\nb');
  assert.equal(htmlToText('&amp;lt;not a tag&amp;gt;'), '&lt;not a tag&gt;');
  assert.equal(htmlToText('<p>  </p>'), '');
  // A description that is only a picture must not read as no description.
  assert.equal(htmlToText('<img data-file-id="abc123xyz" src="/api/files/abc123xyz">'), '[image]');
  assert.equal(htmlToText('<p>Before</p><img src="/api/files/abc123xyz"><p>After</p>'), 'Before\n\n[image]\n\nAfter');
});
