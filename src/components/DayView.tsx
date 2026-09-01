import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Card, LaneId, Settings } from '../types';
import { STATUS_LABELS, categoryLabel } from '../types';
import { useCategories } from '../categories';
import { ClientChips } from './TCard';
import { formatEstimate } from '../cardText';
import { formatFullDay, formatTime, todayKey } from '../dates';
import type { CalendarEvent } from '../m365';

/** One minute of the day is one pixel tall, so an hour is a comfortable 60px
 *  and the maths between a pointer and a time is simply the identity. */
const PX_PER_MIN = 1;
/** Quarter-hour steps: fine enough to plan with, coarse enough to hit. */
const SNAP = 15;
const MIN_LENGTH = 15;
/** What an unsized card becomes when you drop it onto the timeline. */
const DEFAULT_LENGTH = 60;

interface Props {
  day: LaneId;
  cards: Card[];
  events: CalendarEvent[];
  settings: Settings;
  /** True when a calendar is connected, so the gutter can explain itself. */
  calendarReady: boolean;
  onOpen: (id: string) => void;
  onPatch: (id: string, patch: Partial<Card>) => void;
  onQuickAdd: (lane: LaneId, title: string) => void;
}

type Mode = 'move' | 'resize';

interface Drag {
  id: string;
  mode: Mode;
  /** Minutes between the card's start and where the pointer took hold. */
  grab: number;
  start: number;
  length: number;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const snap = (minutes: number) => Math.round(minutes / SNAP) * SNAP;

/** The length a card occupies on the timeline, in minutes. */
const lengthOf = (card: Card) => (card.estimate > 0 ? Math.round(card.estimate * 60) : DEFAULT_LENGTH);

interface Span {
  start: number;
  end: number;
}

/** Side-by-side columns for anything that overlaps, so nothing is hidden
 *  behind anything else. Cards that don't overlap keep the full width. */
function packed<T extends Span>(items: T[]): { item: T; column: number; columns: number }[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: { item: T; column: number; columns: number }[] = [];
  let cluster: { item: T; column: number }[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const columns = cluster.reduce((most, entry) => Math.max(most, entry.column + 1), 1);
    for (const entry of cluster) out.push({ ...entry, columns });
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    if (item.start >= clusterEnd && cluster.length > 0) flush();
    const taken = new Set(cluster.filter((entry) => entry.item.end > item.start).map((entry) => entry.column));
    let column = 0;
    while (taken.has(column)) column++;
    cluster.push({ item, column });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  if (cluster.length > 0) flush();
  return out;
}

export default function DayView(props: Props) {
  const { day, cards, events, settings, calendarReady, onOpen, onPatch, onQuickAdd } = props;
  const categories = useCategories();
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [draft, setDraft] = useState('');

  const from = settings.dayStart * 60;
  const to = settings.dayEnd * 60;
  const height = Math.max(60, (to - from) * PX_PER_MIN);
  const hours = useMemo(
    () => Array.from({ length: settings.dayEnd - settings.dayStart + 1 }, (_, i) => settings.dayStart + i),
    [settings.dayStart, settings.dayEnd],
  );

  const placed = cards.filter((card) => card.start != null);
  const loose = cards.filter((card) => card.start == null);

  const logged = cards.reduce((sum, card) => sum + (card.status === 'done' ? card.estimate : 0), 0);
  const planned = cards.reduce((sum, card) => sum + (card.status === 'done' ? 0 : card.estimate), 0);

  /** Where the pointer is, as a time of day. */
  const minutesAt = useCallback(
    (clientY: number) => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return from;
      return from + (clientY - rect.top) / PX_PER_MIN;
    },
    [from],
  );

  /* The drag runs on the window rather than on the card, so a fast pointer
     that outruns the element keeps moving it, and a release anywhere lands. */
  useEffect(() => {
    if (!drag) return;

    const onMove = (event: PointerEvent) => {
      const at = minutesAt(event.clientY);
      setDrag((current) => {
        if (!current) return current;
        if (current.mode === 'move') {
          const start = clamp(snap(at - current.grab), from, to - current.length);
          return start === current.start ? current : { ...current, start };
        }
        const length = clamp(snap(at) - current.start, MIN_LENGTH, to - current.start);
        return length === current.length ? current : { ...current, length };
      });
    };

    const onUp = () => {
      setDrag((current) => {
        if (current) {
          const card = cards.find((item) => item.id === current.id);
          const patch: Partial<Card> = {};
          if (card?.start !== current.start) patch.start = current.start;
          const estimate = Number((current.length / 60).toFixed(2));
          if (card && Math.abs(card.estimate - estimate) > 0.001) patch.estimate = estimate;
          if (Object.keys(patch).length > 0) onPatch(current.id, patch);
        }
        return null;
      });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [cards, drag, from, minutesAt, onPatch, to]);

  const begin = (event: React.PointerEvent, card: Card, mode: Mode) => {
    // Left button only, and never from the keyboard-focus path.
    if (event.button !== 0) return;
    event.preventDefault();
    const start = card.start ?? from;
    setDrag({
      id: card.id,
      mode,
      grab: mode === 'move' ? minutesAt(event.clientY) - start : 0,
      start,
      length: lengthOf(card),
    });
  };

  /** A loose card gets a time by being sent to the timeline, at the first
   *  quarter-hour that is free after the last thing already on it. */
  const schedule = (card: Card) => {
    const busy = placed.map((item) => (item.start ?? from) + lengthOf(item));
    const after = busy.length > 0 ? Math.max(...busy) : from;
    onPatch(card.id, { start: clamp(snap(after), from, Math.max(from, to - lengthOf(card))) });
  };

  const live = (card: Card): Span & { card: Card } => {
    const active = drag?.id === card.id ? drag : null;
    const start = active ? active.start : card.start ?? from;
    return { card, start, end: start + (active ? active.length : lengthOf(card)) };
  };

  const laidOut = packed(placed.map(live));
  const eventRows = packed(
    events
      .filter((event) => !event.allDay && event.start != null)
      .map((event) => ({ event, start: event.start!, end: Math.max(event.end ?? 0, event.start! + MIN_LENGTH) })),
  );
  const allDay = events.filter((event) => event.allDay);

  const top = (minutes: number) => (minutes - from) * PX_PER_MIN;

  return (
    <div className="dayview">
      <header className="dayview-head">
        <div>
          <h2 className="dayview-title">{formatFullDay(day)}</h2>
          <p className="dayview-sub">
            {planned > 0 ? `${formatEstimate(planned)} planned` : 'Nothing planned'}
            {logged > 0 ? ` · ${formatEstimate(logged)} logged` : ''}
            {cards.length === 0 ? '' : ` · ${cards.length} card${cards.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="dayview-add">
          <input
            className="lane-add-input"
            value={draft}
            placeholder="Add a card to this day"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              const value = draft.trim();
              if (value) onQuickAdd(day, value);
              setDraft('');
            }}
          />
        </div>
      </header>

      {allDay.length > 0 && (
        <div className="dayview-allday">
          <span className="dayview-allday-label">All day</span>
          {allDay.map((event) => (
            <span key={event.id} className="calchip" title={event.location || event.subject}>
              {event.subject}
            </span>
          ))}
        </div>
      )}

      <div className="timeline">
        <div className="timeline-hours" style={{ height }}>
          {hours.map((hour) => (
            <span key={hour} className="timeline-hour" style={{ top: top(hour * 60) }}>
              {formatTime(hour * 60)}
            </span>
          ))}
        </div>

        {/* The calendar sits in its own column rather than behind the cards:
            it is there to plan around, not to be edited. */}
        <div className="timeline-col is-calendar">
          <h3 className="timeline-col-head">Calendar</h3>
          <div className="timeline-grid" style={{ height }}>
            {hours.map((hour) => (
              <span key={hour} className="timeline-rule" style={{ top: top(hour * 60) }} />
            ))}
            {!calendarReady && <p className="timeline-hint">Connect Microsoft 365 in Settings to see your meetings here.</p>}
            {calendarReady && eventRows.length === 0 && allDay.length === 0 && (
              <p className="timeline-hint">Nothing in your calendar.</p>
            )}
            {eventRows.map(({ item, column, columns }) => (
              <a
                key={item.event.id}
                // A half-hour meeting has one line to give: subject and time
                // share it rather than the subject falling off the bottom.
                className={
                  ['calentry', item.event.soft ? 'is-soft' : '', item.end - item.start < 45 ? 'is-short' : '']
                    .filter(Boolean)
                    .join(' ')
                }
                href={item.event.webLink || undefined}
                target="_blank"
                rel="noreferrer"
                style={{
                  top: top(item.start),
                  height: Math.max(18, (item.end - item.start) * PX_PER_MIN - 2),
                  left: `${(column / columns) * 100}%`,
                  width: `${(1 / columns) * 100}%`,
                }}
                title={`${formatTime(item.start)}–${formatTime(item.end)} ${item.event.subject}${item.event.location ? ` · ${item.event.location}` : ''}`}
              >
                <strong>{item.event.subject}</strong>
                <span>{formatTime(item.start)}</span>
              </a>
            ))}
          </div>
        </div>

        <div className="timeline-col is-cards">
          <h3 className="timeline-col-head">Cards</h3>
          <div className="timeline-grid" ref={gridRef} style={{ height }}>
            {hours.map((hour) => (
              <span key={hour} className="timeline-rule" style={{ top: top(hour * 60) }} />
            ))}
            {day === todayKey() && <Now from={from} to={to} />}

            {laidOut.map(({ item, column, columns }) => {
              const dragging = drag?.id === item.card.id;
              // The shorter the card, the less of it fits: the chips go first,
              // then the title's second line, and at half an hour the title
              // shares a line with the time.
              const length = item.end - item.start;
              const classes = ['slot', `c-${item.card.colour}`, `s-${item.card.status}`];
              if (length < 75) classes.push('is-short');
              if (length < 50) classes.push('is-brief');
              if (length < 35) classes.push('is-tiny');
              if (dragging) classes.push('is-dragging');
              return (
                <div
                  key={item.card.id}
                  className={classes.join(' ')}
                  style={{
                    top: top(item.start),
                    height: Math.max(MIN_LENGTH * PX_PER_MIN, (item.end - item.start) * PX_PER_MIN - 2),
                    left: `${(column / columns) * 100}%`,
                    width: `${(1 / columns) * 100}%`,
                  }}
                  onPointerDown={(event) => begin(event, item.card, 'move')}
                  onDoubleClick={() => onOpen(item.card.id)}
                >
                  <div className="slot-face">
                    {/* The time and the category share a line: on an hour-long
                        card that is the difference between the title fitting
                        and being cut off halfway down its second line. */}
                    <span className="slot-top">
                      <span className="slot-time">
                        {formatTime(item.start)}–{formatTime(item.end)}
                      </span>
                      <span className="slot-cat">{categoryLabel(categories, item.card.colour)}</span>
                    </span>
                    <strong className="slot-title">{item.card.title || 'Untitled card'}</strong>
                    <span className="slot-meta">
                      <ClientChips ids={item.card.clients} compact />
                    </span>
                  </div>
                  <button
                    type="button"
                    className="slot-open"
                    title="Open this card"
                    aria-label={`Open ${item.card.title || 'card'}`}
                    // The drag listener is on the parent, so keep the click from
                    // starting one before it can be a click at all.
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => onOpen(item.card.id)}
                  >
                    ⋯
                  </button>
                  <span
                    className="slot-grip"
                    role="separator"
                    aria-label="Resize"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      begin(event, item.card, 'resize');
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="timeline-col is-loose">
          <h3 className="timeline-col-head">No time yet</h3>
          <div className="loose-list">
            {loose.length === 0 && <p className="timeline-hint is-static">Everything on this day has a time.</p>}
            {loose.map((card) => (
              <div key={card.id} className={`loose-card c-${card.colour} s-${card.status}`}>
                <button type="button" className="loose-open" onClick={() => onOpen(card.id)}>
                  <strong>{card.title || 'Untitled card'}</strong>
                  <span className="loose-meta">
                    {STATUS_LABELS[card.status]}
                    {card.estimate > 0 ? ` · ${formatEstimate(card.estimate)}` : ''}
                  </span>
                </button>
                <button type="button" className="ghost" onClick={() => schedule(card)} title="Give this card a time">
                  Schedule
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The line across now, on today only. It ticks itself over the minute. */
function Now({ from, to }: { from: number; to: number }) {
  const [minutes, setMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  if (minutes < from || minutes > to) return null;
  return <span className="timeline-now" style={{ top: (minutes - from) * PX_PER_MIN }} aria-hidden="true" />;
}
