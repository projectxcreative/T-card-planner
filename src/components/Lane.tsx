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
  /** Open this day on its own timeline. Absent on the backlog. */
  onOpenDay?: (day: LaneId) => void;
}

export default function Lane(props: LaneProps) {
  const { id, title, subtitle, cards, matches, isToday, isPast, isWeekend, isBacklog, capacity, onOpen, onQuickAdd, onOpenDay } = props;
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
  /** What the day actually cost: the sized cards that got finished. */
  const logged = cards.reduce((sum, card) => sum + (card.status === 'done' ? card.estimate : 0), 0);
  const done = cards.filter((card) => card.status === 'done');
  const remaining = cards.length - done.length;
  const load = capacity > 0 ? Math.min(planned / capacity, 1) : 0;

  // Finished cards have already sunk to the bottom of the lane, so the divider
  // is simply drawn where the done pile begins.
  const firstDone = cards.findIndex((card) => card.status === 'done');

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
          {onOpenDay ? (
            <button type="button" className="lane-title as-link" onClick={() => onOpenDay(id)} title="Open this day on a timeline">
              {title}
            </button>
          ) : (
            <h2 className="lane-title">{title}</h2>
          )}
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
          {cards.map((card, index) => (
            <div key={card.id} className="lane-item">
              {index === firstDone && (
                <p className="lane-divider" aria-hidden="true">
                  <span>
                    Done · {done.length}
                    {logged > 0 ? ` · ${formatEstimate(logged)}` : ''}
                  </span>
                </p>
              )}
              <SortableCard
                card={card}
                lane={id}
                dimmed={matches ? !matches.has(card.id) : false}
                onOpen={onOpen}
              />
            </div>
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

      {/* What the day came to. The header counts what is still ahead of you;
          this counts what is behind — which is the number you want when you
          look back at a week. */}
      {!isBacklog && (
        <footer className="lane-foot" title={`${formatEstimate(logged) || 'Nothing'} logged from ${done.length} finished card${done.length === 1 ? '' : 's'}`}>
          <span className="lane-foot-label">Logged</span>
          <span className={logged > 0 ? 'lane-foot-value is-on' : 'lane-foot-value'}>{formatEstimate(logged) || '—'}</span>
        </footer>
      )}
    </section>
  );
}
