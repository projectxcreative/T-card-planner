import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Card, LaneId, Settings, Status } from '../types';
import { BACKLOG, STATUS_LABELS, cardLoggedHours, categoryLabel, totalUpdateMinutes } from '../types';
import { useCategories } from '../categories';
import { useLookups } from '../lookups';
import { ClientChips } from './TCard';
import { formatEstimate, formatMinutes } from '../cardText';
import { formatFullDay, formatTime, isPast, isToday, todayKey } from '../dates';
import { syncTimelineUpdates } from '../store';
import { useBoardActions, usePastUnfinishedCount } from '../store/boardStore';
import { startTimer, stopAndLogTimer, timerStore } from '../store/timerStore';
import type { CalendarEvent } from '../m365';

/** One minute of the day is one pixel tall, so an hour is a comfortable 60px
 *  and the maths between a pointer and a time is simply the identity. */
const PX_PER_MIN = 1;
/** Quarter-hour steps: fine enough to plan with, coarse enough to hit. */
const SNAP = 15;
const MIN_LENGTH = 15;
/** What an unsized card becomes when you drop it onto the timeline. */
const DEFAULT_LENGTH = 60;
/** Pointer travel in px before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;

interface Props {
  day: LaneId;
  cards: Card[];
  backlogCards: Card[];
  events: CalendarEvent[];
  settings: Settings;
  /** True when a calendar is connected, so the gutter can explain itself. */
  calendarReady: boolean;
  /** The server can't be reached: adding, moving and resizing cards is paused. */
  locked?: boolean;
  openCardId: string | null;
  matches: Set<string> | null;
  onOpen: (id: string) => void;
  onPatch: (id: string, patch: Partial<Card>) => void;
  onMove: (id: string, lane: LaneId) => void;
  onSnapshot: () => void;
  onQuickAdd: (lane: LaneId, title: string) => Card;
}

type DragMode = 'move' | 'resize-end' | 'resize-start' | 'tray';
type TrayTab = 'unplaced' | 'backlog' | 'all';

interface DragState {
  id: string;
  card: Card;
  fromLane: LaneId;
  mode: DragMode;
  originX: number;
  originY: number;
  clientX: number;
  clientY: number;
  moved: boolean;
  /** Minutes between the card's start and where the pointer took hold. */
  grabOffset: number;
  initialStart: number;
  initialLength: number;
  start: number | null;
  length: number;
  overTray: boolean;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const snap = (minutes: number) => Math.round(minutes / SNAP) * SNAP;

/** The length a card occupies on the timeline, in minutes.
 *  Driven by logged updates or card estimate so timeline height and logged time stay one figure. */
function lengthOf(card: Card): number {
  const loggedMins = totalUpdateMinutes(card.updates);
  if (loggedMins > 0) return Math.max(MIN_LENGTH, snap(loggedMins));
  if (card.estimate > 0) return Math.max(MIN_LENGTH, Math.round(card.estimate * 60));
  return DEFAULT_LENGTH;
}

interface Span {
  start: number;
  end: number;
  /** Sort order tie-breaker so calendar events sit to the left of overlapping cards. */
  order?: number;
}

/** Side-by-side columns for anything that overlaps on the unified timeline, so
 *  calendar meetings and cards share the same timeline without hiding one another. */
function packed<T extends Span>(items: T[]): { item: T; column: number; columns: number }[] {
  const sorted = [...items].sort(
    (a, b) => a.start - b.start || (a.order ?? 0) - (b.order ?? 0) || b.end - a.end,
  );
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

type UnifiedEntry =
  | (Span & { kind: 'event'; event: CalendarEvent })
  | (Span & { kind: 'card'; card: Card; isPreview?: boolean });

export default function DayView(props: Props) {
  const {
    day,
    cards,
    backlogCards,
    events,
    settings,
    calendarReady,
    locked,
    openCardId,
    matches,
    onOpen,
    onPatch,
    onMove,
    onSnapshot,
    onQuickAdd,
  } = props;

  const categories = useCategories();
  const { projects, updateCategoryOrder } = useLookups();
  const { rolloverPastCards } = useBoardActions();
  const pastUnfinishedCount = usePastUnfinishedCount();
  const activeTimerCardId = timerStore.useStore((s) => s.cardId);

  const gridRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [draft, setDraft] = useState('');
  const [trayTab, setTrayTab] = useState<TrayTab>('unplaced');

  const defaultUpdateCategoryId = updateCategoryOrder[0] ?? 'capture';

  const from = settings.dayStart * 60;
  const to = settings.dayEnd * 60;
  const height = Math.max(60, (to - from) * PX_PER_MIN);
  const hours = useMemo(
    () => Array.from({ length: settings.dayEnd - settings.dayStart + 1 }, (_, i) => settings.dayStart + i),
    [settings.dayStart, settings.dayEnd],
  );

  const placed = useMemo(
    () =>
      cards
        .filter((card) => card.start != null)
        .sort((a, b) => (a.start ?? 0) - (b.start ?? 0)),
    [cards],
  );
  const loose = useMemo(() => cards.filter((card) => card.start == null), [cards]);

  /** Live logged hours on this day, reflecting an in-flight resize or timeline drop immediately. */
  const logged = useMemo(() => {
    let total = 0;
    for (const card of cards) {
      if (drag?.moved && drag.id === card.id) {
        if (!drag.overTray && drag.start != null) {
          total += drag.length / 60;
        }
      } else {
        total += cardLoggedHours(card);
      }
    }
    if (drag?.moved && drag.fromLane !== day && drag.start != null && !drag.overTray) {
      total += drag.length / 60;
    }
    return Math.round(total * 100) / 100;
  }, [cards, day, drag]);

  const timelineHours = useMemo(() => {
    let mins = 0;
    for (const card of placed) {
      if (drag?.moved && drag.id === card.id) {
        if (!drag.overTray && drag.start != null) mins += drag.length;
      } else {
        mins += lengthOf(card);
      }
    }
    if (drag?.moved && drag.mode === 'tray' && drag.start != null) {
      mins += drag.length;
    }
    return Math.round((mins / 60) * 100) / 100;
  }, [placed, drag]);

  const timedEvents = useMemo(
    () => events.filter((event) => !event.allDay && event.start != null),
    [events],
  );
  const allDay = useMemo(() => events.filter((event) => event.allDay), [events]);

  const meetingHours = useMemo(() => {
    const mins = timedEvents.reduce(
      (sum, ev) => sum + Math.max(MIN_LENGTH, (ev.end ?? ev.start! + MIN_LENGTH) - ev.start!),
      0,
    );
    return Math.round((mins / 60) * 100) / 100;
  }, [timedEvents]);

  /** Where the pointer is, as a time of day in minutes from midnight. */
  const minutesAt = useCallback(
    (clientY: number) => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return from;
      return from + (clientY - rect.top) / PX_PER_MIN;
    },
    [from],
  );

  const commitPlacement = useCallback(
    (card: Card, fromLane: LaneId, start: number, lengthMins: number) => {
      const estimate = Number((lengthMins / 60).toFixed(2));
      const updates = syncTimelineUpdates(card, lengthMins, day, defaultUpdateCategoryId);
      onSnapshot();
      if (fromLane !== day) {
        onMove(card.id, day);
      }
      onPatch(card.id, {
        start,
        estimate,
        updates,
      });
    },
    [day, defaultUpdateCategoryId, onMove, onPatch, onSnapshot],
  );

  /* Window-level pointer listeners so dragging a card from the tray onto the
     timeline, moving it, or resizing its top/bottom edge tracks smoothly. */
  useEffect(() => {
    if (!drag) return;

    const onMovePointer = (event: PointerEvent) => {
      setDrag((current) => {
        if (!current) return current;
        const dist = Math.hypot(event.clientX - current.originX, event.clientY - current.originY);
        const moved = current.moved || dist > DRAG_THRESHOLD_PX;
        if (!moved) return current;

        const at = minutesAt(event.clientY);
        const gridRect = gridRef.current?.getBoundingClientRect();
        const trayRect = trayRef.current?.getBoundingClientRect();

        const isInsideTray = Boolean(
          trayRect &&
            event.clientX >= trayRect.left &&
            event.clientX <= trayRect.right &&
            event.clientY >= trayRect.top &&
            event.clientY <= trayRect.bottom,
        );

        const isOverTimeline = Boolean(
          gridRect &&
            event.clientX >= gridRect.left - 32 &&
            event.clientX <= gridRect.right + 32 &&
            event.clientY >= gridRect.top - 24 &&
            event.clientY <= gridRect.bottom + 24,
        );

        if (current.mode === 'move') {
          const start = clamp(snap(at - current.grabOffset), from, Math.max(from, to - current.length));
          return {
            ...current,
            moved: true,
            clientX: event.clientX,
            clientY: event.clientY,
            start,
            overTray: isInsideTray,
          };
        }

        if (current.mode === 'resize-end') {
          const baseStart = current.start ?? current.initialStart;
          const length = clamp(snap(at) - baseStart, MIN_LENGTH, Math.max(MIN_LENGTH, to - baseStart));
          return {
            ...current,
            moved: true,
            clientX: event.clientX,
            clientY: event.clientY,
            length,
          };
        }

        if (current.mode === 'resize-start') {
          const fixedEnd = current.initialStart + current.initialLength;
          const nextStart = clamp(snap(at), from, Math.max(from, fixedEnd - MIN_LENGTH));
          const nextLength = Math.max(MIN_LENGTH, fixedEnd - nextStart);
          return {
            ...current,
            moved: true,
            clientX: event.clientX,
            clientY: event.clientY,
            start: nextStart,
            length: nextLength,
          };
        }

        // mode === 'tray': dragging an unplaced or backlog card onto the timeline
        const nextStart = isOverTimeline
          ? clamp(snap(at - current.grabOffset), from, Math.max(from, to - current.length))
          : null;
        return {
          ...current,
          moved: true,
          clientX: event.clientX,
          clientY: event.clientY,
          start: nextStart,
          overTray: isInsideTray,
        };
      });
    };

    const onUpPointer = () => {
      setDrag((current) => {
        if (!current) return null;

        // A clean click without dragging opens the card in the right-hand panel.
        if (!current.moved) {
          if (current.mode === 'move' || current.mode === 'tray') {
            onOpen(current.id);
          }
          return null;
        }

        if (current.mode === 'move' && current.overTray) {
          onSnapshot();
          onPatch(current.id, { start: null });
          return null;
        }

        if (current.start != null) {
          commitPlacement(current.card, current.fromLane, current.start, current.length);
        }

        return null;
      });
    };

    window.addEventListener('pointermove', onMovePointer);
    window.addEventListener('pointerup', onUpPointer);
    window.addEventListener('pointercancel', onUpPointer);
    return () => {
      window.removeEventListener('pointermove', onMovePointer);
      window.removeEventListener('pointerup', onUpPointer);
      window.removeEventListener('pointercancel', onUpPointer);
    };
  }, [ drag !== null, commitPlacement, from, minutesAt, onOpen, onPatch, onSnapshot, to ]); // eslint-disable-line react-hooks/exhaustive-deps

  const beginCardPointer = (
    event: React.PointerEvent,
    card: Card,
    mode: DragMode,
    fromLane: LaneId = day,
  ) => {
    if (locked) {
      if (mode === 'move' || mode === 'tray') onOpen(card.id);
      return;
    }
    if (event.button !== 0) return;
    // Let nested action buttons handle their own clicks cleanly.
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();

    const len = lengthOf(card);
    const start = card.start ?? clamp(snap(minutesAt(event.clientY) - len / 2), from, Math.max(from, to - len));
    const grabOffset =
      mode === 'move'
        ? minutesAt(event.clientY) - (card.start ?? from)
        : mode === 'tray'
          ? Math.min(30, Math.round(len / 2))
          : 0;

    setDrag({
      id: card.id,
      card,
      fromLane,
      mode,
      originX: event.clientX,
      originY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      moved: false,
      grabOffset,
      initialStart: start,
      initialLength: len,
      start: mode === 'tray' ? null : start,
      length: len,
      overTray: false,
    });
  };

  /** Schedule a loose or backlog card at the first free slot on the timeline, logging its time. */
  const scheduleAuto = (card: Card, fromLane: LaneId = day) => {
    if (locked) return;
    const len = lengthOf(card);
    const busy = placed.map((item) => (item.start ?? from) + lengthOf(item));
    const after = busy.length > 0 ? Math.max(...busy) : from;
    const start = clamp(snap(after), from, Math.max(from, to - len));
    commitPlacement(card, fromLane, start, len);
    onOpen(card.id);
  };

  const unscheduleCard = (card: Card) => {
    if (locked) return;
    onSnapshot();
    onPatch(card.id, { start: null });
  };

  const toggleDone = (card: Card) => {
    if (locked) return;
    const nextStatus: Status = card.status === 'done' ? 'todo' : 'done';
    onPatch(card.id, { status: nextStatus });
  };

  // Build unified overlay items (Calendar events + Placed cards + Live tray drop preview)
  const unifiedItems = useMemo(() => {
    const items: UnifiedEntry[] = [];

    for (const event of timedEvents) {
      const start = event.start!;
      const end = Math.max(event.end ?? 0, start + MIN_LENGTH);
      items.push({
        kind: 'event',
        event,
        start,
        end,
        order: 0,
      });
    }

    for (const card of placed) {
      const active = drag?.moved && drag.id === card.id ? drag : null;
      if (active?.overTray) continue;
      const start = active && active.start != null ? active.start : card.start ?? from;
      const length = active ? active.length : lengthOf(card);
      items.push({
        kind: 'card',
        card,
        start,
        end: start + length,
        order: 1,
      });
    }

    // If dragging an unplaced or backlog card over the timeline, include its live preview block
    if (drag?.moved && drag.mode === 'tray' && drag.start != null) {
      items.push({
        kind: 'card',
        card: drag.card,
        start: drag.start,
        end: drag.start + drag.length,
        isPreview: true,
        order: 2,
      });
    }

    return packed(items);
  }, [timedEvents, placed, drag, from]);

  const top = (minutes: number) => (minutes - from) * PX_PER_MIN;
  const capacityPct = settings.capacity > 0 ? Math.min(100, Math.round((logged / settings.capacity) * 100)) : 0;
  const overCapacity = settings.capacity > 0 && logged > settings.capacity;

  const trayCards: { card: Card; lane: LaneId }[] = useMemo(() => {
    if (trayTab === 'backlog') {
      return backlogCards.map((card) => ({ card, lane: BACKLOG }));
    }
    if (trayTab === 'all') {
      return cards.map((card) => ({ card, lane: day }));
    }
    return loose.map((card) => ({ card, lane: day }));
  }, [trayTab, backlogCards, cards, loose, day]);

  return (
    <div className="dayview">
      {/* Control Panel Header */}
      <header className="dayview-head">
        <div className="dayview-title-group">
          <div className="dayview-title-row">
            <h2 className="dayview-title">{formatFullDay(day)}</h2>
            {isToday(day) && <span className="dayview-badge is-today">Today</span>}
            {isPast(day) && <span className="dayview-badge">Past</span>}
            {!locked && pastUnfinishedCount > 0 && isToday(day) && (
              <button
                type="button"
                className="lane-rollover-btn"
                onClick={() => rolloverPastCards()}
                title={`Roll ${pastUnfinishedCount} unfinished past card${pastUnfinishedCount === 1 ? '' : 's'} into Today`}
              >
                ↪ Roll {pastUnfinishedCount} unfinished to Today
              </button>
            )}
          </div>
          <p className="dayview-sub">
            Drag cards onto the timeline and resize them to log time · Click any card to inspect on the right
          </p>
        </div>

        {/* Working Control Panel KPI Strip */}
        <div className="dayview-kpis" aria-label="Day summary">
          <div className="dayview-kpi is-logged" title="Time logged on this day (adjust card height on the timeline to change)">
            <span className="dayview-kpi-label">Logged Time</span>
            <strong className="dayview-kpi-value">
              {formatEstimate(logged) || '0h'}
              {settings.capacity > 0 && (
                <span className="dayview-kpi-of"> / {formatEstimate(settings.capacity)}</span>
              )}
            </strong>
            {settings.capacity > 0 && (
              <div className={overCapacity ? 'dayview-kpi-bar is-over' : 'dayview-kpi-bar'} aria-hidden="true">
                <span style={{ width: `${capacityPct}%` }} />
              </div>
            )}
          </div>

          <div className="dayview-kpi" title="Cards placed on the timeline">
            <span className="dayview-kpi-label">On Timeline</span>
            <strong className="dayview-kpi-value">{formatEstimate(timelineHours) || '0h'}</strong>
            <span className="dayview-kpi-note">
              {placed.length} card{placed.length === 1 ? '' : 's'} placed
            </span>
          </div>

          <div className="dayview-kpi" title="Calendar meetings on this day">
            <span className="dayview-kpi-label">Calendar</span>
            <strong className="dayview-kpi-value">
              {timedEvents.length + allDay.length > 0 ? formatEstimate(meetingHours) || `${allDay.length} all-day` : '0h'}
            </strong>
            <span className="dayview-kpi-note">
              {!calendarReady
                ? 'Not connected'
                : `${timedEvents.length + allDay.length} event${timedEvents.length + allDay.length === 1 ? '' : 's'}`}
            </span>
          </div>

          <div className="dayview-kpi" title="Cards waiting to be dragged onto the timeline">
            <span className="dayview-kpi-label">Unscheduled</span>
            <strong className="dayview-kpi-value">{loose.length}</strong>
            <span className="dayview-kpi-note">{backlogCards.length} in backlog</span>
          </div>
        </div>

        <div className="dayview-add">
          <input
            className="lane-add-input"
            value={draft}
            placeholder="+ Quick-add card to this day (Enter)"
            disabled={locked}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              const value = draft.trim();
              if (!value) return;
              const created = onQuickAdd(day, value);
              setDraft('');
              onOpen(created.id);
            }}
          />
        </div>
      </header>

      {allDay.length > 0 && (
        <div className="dayview-allday">
          <span className="dayview-allday-label">All day</span>
          {allDay.map((event) => (
            <span key={event.id} className="calchip" title={event.location || event.subject}>
              📅 {event.subject}
            </span>
          ))}
        </div>
      )}

      {/* Main Control Panel Body: Left Tray + Unified Overlay Timeline */}
      <div className="dayview-body">
        {/* Left Card Tray: Drag cards onto the timeline or drop timeline cards back here */}
        <aside
          ref={trayRef}
          className={[
            'dayview-tray',
            drag?.moved && drag.mode === 'move' ? 'is-drop-ready' : '',
            drag?.moved && drag.mode === 'move' && drag.overTray ? 'is-drop-over' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-label="Card queue"
        >
          <div className="dayview-tray-head">
            <div className="viewtabs is-compact" role="tablist" aria-label="Card queue filter">
              <button
                type="button"
                role="tab"
                aria-selected={trayTab === 'unplaced'}
                className={trayTab === 'unplaced' ? 'viewtab is-on' : 'viewtab'}
                onClick={() => setTrayTab('unplaced')}
              >
                Unplaced ({loose.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={trayTab === 'backlog'}
                className={trayTab === 'backlog' ? 'viewtab is-on' : 'viewtab'}
                onClick={() => setTrayTab('backlog')}
              >
                Backlog ({backlogCards.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={trayTab === 'all'}
                className={trayTab === 'all' ? 'viewtab is-on' : 'viewtab'}
                onClick={() => setTrayTab('all')}
              >
                All ({cards.length})
              </button>
            </div>
          </div>

          {drag?.moved && drag.mode === 'move' && (
            <div className={drag.overTray ? 'dayview-unschedule-drop is-over' : 'dayview-unschedule-drop'}>
              Drop here to remove from timeline
            </div>
          )}

          <div className="loose-list">
            {trayCards.length === 0 && (
              <p className="timeline-hint is-static">
                {trayTab === 'unplaced'
                  ? 'Every card on this day is on the timeline. Switch to Backlog or add a card above.'
                  : trayTab === 'backlog'
                    ? 'No cards in Backlog.'
                    : 'No cards on this day yet.'}
              </p>
            )}

            {trayCards.map(({ card, lane }) => {
              const isSelected = openCardId === card.id;
              const isBeingDragged = drag?.moved && drag.id === card.id;
              const dimmed = matches ? !matches.has(card.id) : false;
              const project = card.projectId ? projects[card.projectId] : undefined;
              const cardHours = cardLoggedHours(card) || card.estimate;
              const isTiming = activeTimerCardId === card.id;

              const classes = ['loose-card', `c-${card.colour}`, `s-${card.status}`];
              if (isSelected) classes.push('is-selected');
              if (isBeingDragged) classes.push('is-dragging');
              if (dimmed) classes.push('is-dimmed');

              return (
                <div
                  key={card.id}
                  className={classes.join(' ')}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(event) =>
                    beginCardPointer(event, card, card.start != null && lane === day ? 'move' : 'tray', lane)
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onOpen(card.id);
                    }
                  }}
                >
                  <span className="loose-grip" aria-hidden="true" title="Drag onto timeline">
                    ⋮⋮
                  </span>
                  <div className="loose-open">
                    {project && <span className="loose-project">{project.title}</span>}
                    <strong>{card.title || 'Untitled card'}</strong>
                    <span className="loose-meta">
                      <span className={`pill p-${card.status}`}>{STATUS_LABELS[card.status]}</span>
                      {card.start != null && lane === day && (
                        <span className="pill">{formatTime(card.start)}</span>
                      )}
                      {cardHours > 0 && (
                        <span className="pill p-logged">⏱ {formatEstimate(cardHours)}</span>
                      )}
                      <ClientChips ids={card.clients} compact />
                    </span>
                  </div>
                  <div className="loose-actions">
                    {!locked && (
                      <button
                        type="button"
                        className={isTiming ? 'ghost accent is-compact' : 'ghost is-compact'}
                        onClick={() => (isTiming ? stopAndLogTimer() : startTimer(card.id, defaultUpdateCategoryId))}
                        title={isTiming ? 'Stop & log active timer' : 'Start live timer'}
                      >
                        {isTiming ? '■' : '▶'}
                      </button>
                    )}
                    {card.start == null || lane !== day ? (
                      <button
                        type="button"
                        className="ghost is-compact"
                        disabled={locked}
                        onClick={() => scheduleAuto(card, lane)}
                        title="Place on timeline and log time"
                      >
                        + Timeline
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ghost is-compact"
                        disabled={locked}
                        onClick={() => unscheduleCard(card)}
                        title="Remove from timeline"
                      >
                        Unplace
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Center Unified Timeline: Calendar & Cards Overlaid Together */}
        <section className="dayview-timeline-section" aria-label="Unified day timeline">
          <div className="timeline-head-bar">
            <h3 className="timeline-col-head">Timeline · Calendar &amp; Cards</h3>
            <div className="timeline-legend">
              <span className="timeline-legend-item">
                <span className="timeline-legend-swatch is-cal" aria-hidden="true" />
                Calendar {!calendarReady && '(connect in Settings)'}
              </span>
              <span className="timeline-legend-item">
                <span className="timeline-legend-swatch is-card" aria-hidden="true" />
                Cards (resize to log time)
              </span>
            </div>
          </div>

          <div className="timeline">
            <div className="timeline-hours" style={{ height }}>
              {hours.map((hour) => (
                <span key={hour} className="timeline-hour" style={{ top: top(hour * 60) }}>
                  {formatTime(hour * 60)}
                </span>
              ))}
            </div>

            <div className="timeline-col is-unified">
              <div
                className={
                  drag?.moved && drag.mode === 'tray' && drag.start != null
                    ? 'timeline-grid is-drop-target'
                    : 'timeline-grid'
                }
                ref={gridRef}
                style={{ height }}
              >
                {hours.map((hour) => (
                  <div key={hour}>
                    <span className="timeline-rule" style={{ top: top(hour * 60) }} />
                    {hour < settings.dayEnd && (
                      <span className="timeline-halfrule" style={{ top: top(hour * 60 + 30) }} />
                    )}
                  </div>
                ))}

                {day === todayKey() && <Now from={from} to={to} />}

                {unifiedItems.length === 0 && (
                  <p className="timeline-hint">
                    Drag a card from the left queue onto any time slot here, or click <strong>+ Timeline</strong> to place it.
                    {!calendarReady && ' Connect Microsoft 365 in Settings to overlay your calendar meetings.'}
                  </p>
                )}

                {unifiedItems.map((entry) => {
                  const { item, column, columns } = entry;

                  if (item.kind === 'event') {
                    const ev = item.event;
                    const duration = item.end - item.start;
                    const classes = [
                      'calentry',
                      ev.soft ? 'is-soft' : '',
                      duration < 45 ? 'is-short' : '',
                      drag?.moved ? 'is-passive' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');

                    return (
                      <a
                        key={`ev-${ev.id}`}
                        className={classes}
                        href={ev.webLink || undefined}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          top: top(item.start),
                          height: Math.max(18, duration * PX_PER_MIN - 2),
                          left: `${(column / columns) * 100}%`,
                          width: `${(1 / columns) * 100}%`,
                        }}
                        title={`${formatTime(item.start)}–${formatTime(item.end)} · ${ev.subject}${ev.location ? ` · ${ev.location}` : ''}`}
                      >
                        <div className="calentry-top">
                          <span className="calentry-badge">📅 {formatTime(item.start)}–{formatTime(item.end)}</span>
                          {ev.location && <span className="calentry-loc">{ev.location}</span>}
                        </div>
                        <strong>{ev.subject}</strong>
                      </a>
                    );
                  }

                  const card = item.card;
                  const dragging = Boolean(drag?.moved && drag.id === card.id);
                  const isSelected = openCardId === card.id;
                  const dimmed = matches ? !matches.has(card.id) : false;
                  const length = item.end - item.start;
                  const project = card.projectId ? projects[card.projectId] : undefined;
                  const isTiming = activeTimerCardId === card.id;

                  const classes = ['slot', `c-${card.colour}`, `s-${card.status}`];
                  if (length < 75) classes.push('is-short');
                  if (length < 50) classes.push('is-brief');
                  if (length < 35) classes.push('is-tiny');
                  if (dragging) classes.push('is-dragging');
                  if (item.isPreview) classes.push('is-preview');
                  if (isSelected) classes.push('is-selected');
                  if (dimmed) classes.push('is-dimmed');

                  return (
                    <div
                      key={`card-${card.id}`}
                      className={classes.join(' ')}
                      style={{
                        top: top(item.start),
                        height: Math.max(MIN_LENGTH * PX_PER_MIN, length * PX_PER_MIN - 2),
                        left: `${(column / columns) * 100}%`,
                        width: `${(1 / columns) * 100}%`,
                      }}
                      onPointerDown={(event) => beginCardPointer(event, card, 'move', day)}
                    >
                      {/* Top resize handle to adjust start time & logged time */}
                      <span
                        className="slot-grip is-top"
                        role="separator"
                        aria-label="Resize start time"
                        title="Drag to adjust start time and logged hours"
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          beginCardPointer(event, card, 'resize-start', day);
                        }}
                      />

                      <div className="slot-face">
                        <span className="slot-top">
                          <span className="slot-time">
                            {formatTime(item.start)}–{formatTime(item.end)}
                          </span>
                          <span className="slot-logged-pill" title="Logged duration from timeline size">
                            ⏱ {formatMinutes(length)}
                          </span>
                          <span className="slot-cat">{categoryLabel(categories, card.colour)}</span>
                        </span>
                        <strong className="slot-title">
                          {project ? `${project.title}: ` : ''}
                          {card.title || 'Untitled card'}
                        </strong>
                        <span className="slot-meta">
                          <ClientChips ids={card.clients} compact />
                        </span>
                      </div>

                      <div
                        className="slot-actions"
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        {!locked && (
                          <button
                            type="button"
                            className={isTiming ? 'slot-btn is-active' : 'slot-btn'}
                            title={isTiming ? 'Stop & log live timer' : 'Start live timer'}
                            aria-label={isTiming ? 'Stop timer' : 'Start timer'}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (isTiming) stopAndLogTimer();
                              else startTimer(card.id, defaultUpdateCategoryId);
                            }}
                          >
                            {isTiming ? '■' : '▶'}
                          </button>
                        )}
                        <button
                          type="button"
                          className={card.status === 'done' ? 'slot-btn is-done' : 'slot-btn'}
                          title={card.status === 'done' ? 'Mark as To do' : 'Mark as Done'}
                          aria-label={card.status === 'done' ? 'Mark as To do' : 'Mark as Done'}
                          disabled={locked}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleDone(card);
                          }}
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          className="slot-btn"
                          title="Remove from timeline"
                          aria-label="Remove from timeline"
                          disabled={locked}
                          onClick={(event) => {
                            event.stopPropagation();
                            unscheduleCard(card);
                          }}
                        >
                          ✕
                        </button>
                      </div>

                      {/* Bottom resize handle to adjust end time & logged time */}
                      <span
                        className="slot-grip is-bottom"
                        role="separator"
                        aria-label="Resize duration and logged time"
                        title="Drag to adjust duration and logged hours"
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          beginCardPointer(event, card, 'resize-end', day);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Floating ghost when dragging a card from the tray before it enters the timeline */}
      {drag?.moved && drag.mode === 'tray' && drag.start == null && (
        <div
          className={`dayview-drag-ghost c-${drag.card.colour}`}
          style={{ left: drag.clientX + 12, top: drag.clientY - 18 }}
          aria-hidden="true"
        >
          <strong>{drag.card.title || 'Untitled card'}</strong>
          <span>⏱ {formatMinutes(drag.length)} · Drop on timeline</span>
        </div>
      )}
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
