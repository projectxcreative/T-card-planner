import { useEffect, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import SortableCard from './TCard';
import type { Card, LaneId } from '../types';
import { formatEstimate } from '../cardText';

export interface LaneProps {
  id: LaneId;
  title: string;
  subtitle?: string;
  cards: Card[];
  /** Card ids that match the current search; others render dimmed. */
  matches: Set<string> | null;
  isToday?: boolean;
  isPast?: boolean;
  isWeekend?: boolean;
  isBacklog?: boolean;
  /** Hours per day at which the load bar reads as over-committed. */
  capacity: number;
  onOpen: (id: string) => void;
  onQuickAdd: (lane: LaneId, title: string) => void;
}

export default function Lane(props: LaneProps) {
  const { id, title, subtitle, cards, matches, isToday, isPast, isWeekend, isBacklog, capacity, onOpen, onQuickAdd } = props;
  const { setNodeRef, isOver } = useDroppable({ id: `lane:${id}`, data: { type: 'lane', lane: id } });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const commit = (keepOpen: boolean) => {
    const value = draft.trim();
    if (value) onQuickAdd(id, value);
    setDraft('');
    if (!keepOpen) setAdding(false);
  };

  const planned = cards.reduce((sum, card) => sum + (card.status === 'done' ? 0 : card.estimate), 0);
  const remaining = cards.filter((card) => card.status !== 'done').length;
  const load = capacity > 0 ? Math.min(planned / capacity, 1) : 0;

  const classes = ['lane'];
  if (isToday) classes.push('is-today');
  if (isPast) classes.push('is-past');
  if (isWeekend) classes.push('is-weekend');
  if (isBacklog) classes.push('is-backlog');
  if (isOver) classes.push('is-over');

  return (
    <section className={classes.join(' ')} aria-label={title}>
      <header className="lane-head">
        <div className="lane-titles">
          <h2 className="lane-title">{title}</h2>
          {subtitle && <span className="lane-sub">{subtitle}</span>}
        </div>
        <div className="lane-stats" title={`${remaining} open card${remaining === 1 ? '' : 's'}${planned ? `, ${formatEstimate(planned)} planned` : ''}`}>
          {planned > 0 && <span className="lane-hours">{formatEstimate(planned)}</span>}
          <span className="lane-count">{remaining}</span>
        </div>
      </header>

      {!isBacklog && (
        <div className={planned > capacity ? 'lane-load is-over-capacity' : 'lane-load'} aria-hidden="true">
          <span style={{ width: `${load * 100}%` }} />
        </div>
      )}

      <div ref={setNodeRef} className="lane-drop">
        <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <SortableCard
              key={card.id}
              card={card}
              lane={id}
              dimmed={matches ? !matches.has(card.id) : false}
              onOpen={onOpen}
            />
          ))}
        </SortableContext>

        {cards.length === 0 && !adding && <p className="lane-empty">Drop a card here</p>}

        {adding ? (
          <input
            ref={inputRef}
            className="lane-add-input"
            value={draft}
            placeholder="Card title, then Enter"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => commit(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commit(true);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setDraft('');
                setAdding(false);
              }
            }}
          />
        ) : (
          <button type="button" className="lane-add" onClick={() => setAdding(true)}>
            + Add card
          </button>
        )}
      </div>
    </section>
  );
}
