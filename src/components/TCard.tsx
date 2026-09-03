import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card, LaneId, Status } from '../types';
import { STATUSES, STATUS_LABELS, categoryLabel } from '../types';
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

interface MenuPos {
  x: number;
  y: number;
}

/**
 * The right-click menu for a card: a shortcut to start the next card for the
 * same project, and every status one click away without opening the card.
 *
 * Rendered through a portal because a dragged ancestor carries a CSS
 * `transform`, which would otherwise become the containing block for this
 * menu's `position: fixed` and pin it to the card instead of the viewport.
 */
function CardMenu({
  card,
  pos,
  onClose,
  onNewFromProject,
  onSetStatus,
}: {
  card: Card;
  pos: MenuPos;
  onClose: () => void;
  onNewFromProject: () => void;
  onSetStatus: (status: Status) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState(pos);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // The board scrolls under the menu rather than the menu tracking it.
    document.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  // A menu opened near an edge is nudged back onto the screen once its real
  // size is known, rather than being measured for up front.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPlaced({
      x: Math.min(pos.x, window.innerWidth - rect.width - 8),
      y: Math.min(pos.y, window.innerHeight - rect.height - 8),
    });
  }, [pos]);

  return createPortal(
    <div
      ref={ref}
      className="cardmenu"
      role="menu"
      style={{ left: placed.x, top: placed.y }}
      // Portalled content still bubbles through the *React* tree, not just the
      // DOM one — left unstopped, a click here would go on to reach the
      // card's own onClick and reopen the wrong one.
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        className="cardmenu-item"
        disabled={!card.projectId}
        title={card.projectId ? undefined : "This card isn't on a project"}
        onClick={() => {
          onNewFromProject();
          onClose();
        }}
      >
        New card from this project
      </button>

      <div className="cardmenu-sep" role="separator" />
      <span className="cardmenu-label">Status</span>
      {STATUSES.map((status) => (
        <button
          key={status}
          type="button"
          role="menuitemradio"
          aria-checked={card.status === status}
          className={card.status === status ? 'cardmenu-item is-on' : 'cardmenu-item'}
          onClick={() => {
            onSetStatus(status);
            onClose();
          }}
        >
          <span className={`cardmenu-dot p-${status}`} aria-hidden="true" />
          {STATUS_LABELS[status]}
        </button>
      ))}
    </div>,
    document.body,
  );
}

interface SortableProps {
  card: Card;
  lane: LaneId;
  dimmed?: boolean;
  onOpen: (id: string) => void;
  /** Start a fresh card carrying this one's project and clients. */
  onNewFromProject: (id: string) => void;
  onPatch: (id: string, patch: Partial<Card>) => void;
}

export default function SortableCard({ card, lane, dimmed, onOpen, onNewFromProject, onPatch }: SortableProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', lane },
  });
  const [menu, setMenu] = useState<MenuPos | null>(null);

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
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <CardFace card={card} dimmed={dimmed} />
      {menu && (
        <CardMenu
          card={card}
          pos={menu}
          onClose={() => setMenu(null)}
          onNewFromProject={() => onNewFromProject(card.id)}
          onSetStatus={(status) => onPatch(card.id, { status })}
        />
      )}
    </div>
  );
}
