import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card, LaneId } from '../types';
import { STATUS_LABELS, categoryLabel } from '../types';
import { useCategories } from '../categories';
import { useClientList, useLookups } from '../lookups';
import { formatEstimate, summarise } from '../cardText';
import { formatTime } from '../dates';

/** The client tags a card or project carries, as a row of coloured chips. */
export function ClientChips({ ids, compact }: { ids: string[]; compact?: boolean }) {
  const clients = useClientList(ids);
  if (clients.length === 0) return null;
  return (
    <>
      {clients.map((client) => (
        <span
          key={client.id}
          className={compact ? 'chip is-compact' : 'chip'}
          style={{ '--chip': client.colour } as React.CSSProperties}
          title={`Client: ${client.name}`}
        >
          {client.name}
        </span>
      ))}
    </>
  );
}

interface FaceProps {
  card: Card;
  dimmed?: boolean;
  dragging?: boolean;
}

/** The card itself: a coloured header strip over an inset body — the T. */
export const CardFace = memo(function CardFace({ card, dimmed, dragging }: FaceProps) {
  const categories = useCategories();
  const { projects, showDescription } = useLookups();
  const { excerpt, checked, total } = summarise(card.description);
  const estimate = formatEstimate(card.estimate);
  const project = card.projectId ? projects[card.projectId] : undefined;
  const classes = ['tcard', `c-${card.colour}`, `s-${card.status}`];
  if (dimmed) classes.push('is-dimmed');
  if (dragging) classes.push('is-dragging');

  return (
    <article className={classes.join(' ')}>
      <header className="tcard-head">
        <span className="tcard-cat">{categoryLabel(categories, card.colour)}</span>
        {card.publish && (
          <span className="tcard-flag" title="Published to your Microsoft 365 calendar" aria-label="On the calendar">
            ◈
          </span>
        )}
        {card.start != null && <span className="tcard-time">{formatTime(card.start)}</span>}
        {estimate && <span className="tcard-est">{estimate}</span>}
      </header>
      <div className="tcard-body">
        {project && <p className="tcard-project" title={`Project: ${project.title}`}>{project.title}</p>}
        <h3 className="tcard-title">{card.title || 'Untitled card'}</h3>
        {showDescription && excerpt && <p className="tcard-excerpt">{excerpt}</p>}
        <div className="tcard-meta">
          <span className={`pill p-${card.status}`}>{STATUS_LABELS[card.status]}</span>
          {total > 0 && (
            <span className={checked === total ? 'pill p-tasks is-complete' : 'pill p-tasks'}>
              ☑ {checked}/{total}
            </span>
          )}
          <ClientChips ids={card.clients} compact />
        </div>
      </div>
    </article>
  );
});

interface SortableProps {
  card: Card;
  lane: LaneId;
  dimmed?: boolean;
  onOpen: (id: string) => void;
}

export default function SortableCard({ card, lane, dimmed, onOpen }: SortableProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', lane },
  });

  return (
    <div
      ref={setNodeRef}
      className="tcard-slot"
      style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={`${card.title || 'Untitled card'} — ${STATUS_LABELS[card.status]}`}
      onClick={() => onOpen(card.id)}
      onKeyDown={(event) => {
        // Space and arrows belong to dnd-kit's keyboard sensor; Enter opens.
        if (event.key === 'Enter') {
          event.preventDefault();
          onOpen(card.id);
        }
      }}
    >
      <CardFace card={card} dimmed={dimmed} />
    </div>
  );
}
