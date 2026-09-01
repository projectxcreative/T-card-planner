import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { Card, LaneId } from '../types';
import { STATUS_LABELS } from '../types';
import { formatEstimate } from '../cardText';
import { formatDayName, formatDayNumber, fromKey, isSameMonth, isToday, isWeekend } from '../dates';
import type { CalendarEvent } from '../m365';

/** Past this many, the cell says how much more there is rather than growing. */
const CHIP_LIMIT = 4;

interface Props {
  anchor: string;
  weeks: string[][];
  cardsFor: (day: LaneId) => Card[];
  events: Map<string, CalendarEvent[]>;
  matches: Set<string> | null;
  onOpen: (id: string) => void;
  onOpenDay: (day: LaneId) => void;
}

function Chip({ card, dimmed, onOpen }: { card: Card; dimmed: boolean; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
    data: { type: 'card' },
  });

  const classes = ['monthchip', `c-${card.colour}`, `s-${card.status}`];
  if (dimmed) classes.push('is-dimmed');

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={classes.join(' ')}
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.35 : 1 }}
      title={`${card.title || 'Untitled card'} — ${STATUS_LABELS[card.status]}`}
      onClick={() => onOpen(card.id)}
      {...attributes}
      {...listeners}
    >
      <span className="monthchip-dot" aria-hidden="true" />
      <span className="monthchip-title">{card.title || 'Untitled card'}</span>
    </button>
  );
}

function DayCell(props: {
  day: string;
  anchor: string;
  cards: Card[];
  events: CalendarEvent[];
  matches: Set<string> | null;
  onOpen: (id: string) => void;
  onOpenDay: (day: LaneId) => void;
}) {
  const { day, anchor, cards, events, matches, onOpen, onOpenDay } = props;
  const { setNodeRef, isOver } = useDroppable({ id: `lane:${day}`, data: { type: 'lane', lane: day } });

  const logged = cards.reduce((sum, card) => sum + (card.status === 'done' ? card.estimate : 0), 0);
  const shown = cards.slice(0, CHIP_LIMIT);
  const hidden = cards.length - shown.length;

  const classes = ['monthcell'];
  if (isToday(day)) classes.push('is-today');
  if (isWeekend(day)) classes.push('is-weekend');
  if (!isSameMonth(day, anchor)) classes.push('is-outside');
  if (isOver) classes.push('is-over');

  return (
    <div ref={setNodeRef} className={classes.join(' ')}>
      <header className="monthcell-head">
        <button type="button" className="monthcell-day" onClick={() => onOpenDay(day)} title="Open this day on a timeline">
          {fromKey(day).getDate()}
        </button>
        {logged > 0 && (
          <span className="monthcell-logged" title={`${formatEstimate(logged)} logged`}>
            {formatEstimate(logged)}
          </span>
        )}
      </header>

      <div className="monthcell-body">
        {events.slice(0, 2).map((event) => (
          <span key={event.id} className="monthchip is-event" title={`Calendar: ${event.subject}`}>
            <span className="monthchip-dot" aria-hidden="true" />
            <span className="monthchip-title">{event.subject}</span>
          </span>
        ))}
        {shown.map((card) => (
          <Chip key={card.id} card={card} dimmed={matches ? !matches.has(card.id) : false} onOpen={onOpen} />
        ))}
        {hidden > 0 && (
          <button type="button" className="monthcell-more" onClick={() => onOpenDay(day)}>
            +{hidden} more
          </button>
        )}
      </div>
    </div>
  );
}

export default function MonthView({ anchor, weeks, cardsFor, events, matches, onOpen, onOpenDay }: Props) {
  const columns = weeks[0]?.length ?? 7;

  return (
    <div className="monthview" style={{ '--month-cols': columns } as React.CSSProperties}>
      <div className="monthhead">
        {(weeks[0] ?? []).map((day) => (
          <span key={day} className="monthhead-cell">
            {formatDayName(day)}
          </span>
        ))}
      </div>

      <div className="monthgrid">
        {weeks.flat().map((day) => (
          <DayCell
            key={day}
            day={day}
            anchor={anchor}
            cards={cardsFor(day)}
            events={events.get(day) ?? []}
            matches={matches}
            onOpen={onOpen}
            onOpenDay={onOpenDay}
          />
        ))}
      </div>

      <p className="monthfoot">
        Drag a card to another day, or click a date to open it on a timeline. Dates show the hours logged on them.
        {weeks.length > 0 && ` · ${formatDayNumber(weeks[0][0])} onwards`}
      </p>
    </div>
  );
}
