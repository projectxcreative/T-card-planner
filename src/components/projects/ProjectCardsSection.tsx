import { useEffect, useMemo, useRef, useState } from 'react';
import { BACKLOG, STATUS_LABELS, type Card, type LaneId, type Project } from '../../types';
import { formatEstimate } from '../../cardText';
import { formatDayNumber } from '../../dates';

const ATTACH_LIMIT = 8;

interface AttachCardProps {
  project: Project;
  options: { card: Card; lane: LaneId }[];
  projects: Record<string, Project>;
  onAttach: (cardId: string, projectId: string) => void;
}

export function AttachCard({ project, options, projects, onAttach }: AttachCardProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      options
        .filter(({ card }) => !needle || (card.title || 'Untitled card').toLowerCase().includes(needle))
        .slice(0, ATTACH_LIMIT),
    [options, needle],
  );

  const attach = (id: string) => {
    onAttach(id, project.id);
    setQuery('');
    setCursor(0);
    setOpen(false);
  };

  if (options.length === 0) return null;

  return (
    <div className="split-attach" ref={box}>
      <input
        className="lane-add-input"
        value={query}
        placeholder="…or attach a card already on the board"
        aria-label="Attach an existing card to this project"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setCursor(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setCursor((current) => Math.min(current + 1, matches.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setCursor((current) => Math.max(current - 1, 0));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            if (matches[cursor]) attach(matches[cursor].card.id);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
          }
        }}
      />

      {open && (
        <ul className="split-attach-pop" role="listbox" aria-label="Cards you can attach">
          {matches.length === 0 && <li className="split-attach-empty">No card matches “{query.trim()}”.</li>}
          {matches.map(({ card, lane }, index) => {
            const owner = card.projectId ? projects[card.projectId] : undefined;
            return (
              <li key={card.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === cursor}
                  className={index === cursor ? 'split-attach-row is-on' : 'split-attach-row'}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => attach(card.id)}
                  title={owner ? `Move this card from ${owner.title || 'Untitled project'}` : undefined}
                >
                  <span className={`split-attach-dot c-${card.colour}`} aria-hidden="true" />
                  <span className="split-attach-title">{card.title || 'Untitled card'}</span>
                  {owner && <span className="split-attach-owner">{owner.title || 'Untitled project'}</span>}
                  <span className="split-attach-day">{lane === BACKLOG ? 'Backlog' : formatDayNumber(lane)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface ProjectCardsSectionProps {
  project: Project;
  cards: { card: Card; lane: LaneId }[];
  spare: { card: Card; lane: LaneId }[];
  projectsById: Record<string, Project>;
  onOpenCard: (id: string) => void;
  onAddCard: (projectId: string, title: string, day: LaneId) => void;
  onMoveCard: (id: string, lane: LaneId) => void;
  onAttachCard: (cardId: string, projectId: string) => void;
}

export default function ProjectCardsSection({
  project,
  cards,
  spare,
  projectsById,
  onOpenCard,
  onAddCard,
  onMoveCard,
  onAttachCard,
}: ProjectCardsSectionProps) {
  const [cardTitle, setCardTitle] = useState('');
  const [cardDay, setCardDay] = useState('');

  return (
    <div className="field">
      <span className="field-label">Cards</span>

      <div className="split-addcard">
        <input
          className="lane-add-input"
          value={cardTitle}
          placeholder="Add a card to this project"
          onChange={(event) => setCardTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const title = cardTitle.trim();
            if (!title) return;
            onAddCard(project.id, title, cardDay || BACKLOG);
            setCardTitle('');
          }}
        />
        <input
          type="date"
          value={cardDay}
          title="The day the new card lands on — clear it to send the card to the backlog"
          onChange={(event) => setCardDay(event.target.value)}
        />
      </div>

      <AttachCard
        key={project.id}
        project={project}
        options={spare}
        projects={projectsById}
        onAttach={onAttachCard}
      />

      <ul className="split-cards">
        {cards.length === 0 && <li className="split-empty">No cards on this project yet.</li>}
        {cards.map(({ card, lane }) => (
          <li key={card.id} className={`split-card c-${card.colour} s-${card.status}`}>
            <button type="button" className="split-card-open" onClick={() => onOpenCard(card.id)}>
              <span className="split-card-title">{card.title || 'Untitled card'}</span>
              <span className={`pill p-${card.status}`}>{STATUS_LABELS[card.status]}</span>
              {card.estimate > 0 && <span className="split-card-est">{formatEstimate(card.estimate)}</span>}
            </button>
            <input
              type="date"
              className="split-card-day"
              value={lane === BACKLOG ? '' : lane}
              title={lane === BACKLOG ? 'In the backlog' : formatDayNumber(lane)}
              onChange={(event) => onMoveCard(card.id, event.target.value || BACKLOG)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
