import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card, LaneId } from '../types';
import { STATUS_LABELS, categoryLabel } from '../types';
import { useCategories } from '../categories';
import { formatEstimate, summarise } from '../cardText';

interface FaceProps {
  card: Card;
  dimmed?: boolean;
  dragging?: boolean;
}

/** The card itself: a coloured header strip over an inset body — the T. */
export const CardFace = memo(function CardFace({ card, dimmed, dragging }: FaceProps) {
  const categories = useCategories();
  const { excerpt, checked, total } = summarise(card.description);
  const estimate = formatEstimate(card.estimate);
  const classes = ['tcard', `c-${card.colour}`, `s-${card.status}`];
  if (dimmed) classes.push('is-dimmed');
  if (dragging) classes.push('is-dragging');

  return (
    <article className={classes.join(' ')}>
      <header className="tcard-head">
        <span className="tcard-cat">{categoryLabel(categories, card.colour)}</span>
        {estimate && <span className="tcard-est">{estimate}</span>}
      </header>
      <div className="tcard-body">
        <h3 className="tcard-title">{card.title || 'Untitled card'}</h3>
        {excerpt && <p className="tcard-excerpt">{excerpt}</p>}
        <div className="tcard-meta">
          <span className={`pill p-${card.status}`}>{STATUS_LABELS[card.status]}</span>
          {total > 0 && (
            <span className={checked === total ? 'pill p-tasks is-complete' : 'pill p-tasks'}>
              ☑ {checked}/{total}
            </span>
          )}
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
