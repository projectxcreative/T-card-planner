import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { Card, Colour, LaneId, Status } from '../types';
import { BACKLOG, COLOURS, COLOUR_LABELS, STATUSES, STATUS_LABELS } from '../types';
import { addDays, formatFullDay, todayKey } from '../dates';

// The editor pulls in ProseMirror; keep it out of the first paint.
const RichText = lazy(() => import('./RichText'));

const ESTIMATES = [0, 0.25, 0.5, 1, 2, 3, 4, 6, 8];
const DESCRIPTION_DEBOUNCE_MS = 300;

interface Props {
  card: Card;
  lane: LaneId;
  onPatch: (id: string, patch: Partial<Card>) => void;
  onMove: (id: string, lane: LaneId) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export default function CardDrawer({ card, lane, onPatch, onMove, onDuplicate, onDelete, onClose }: Props) {
  const [html, setHtml] = useState(card.description);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // Keep the newest edit reachable from cleanups without re-running effects.
  const pending = useRef({ id: card.id, html: card.description });
  const patchRef = useRef(onPatch);
  patchRef.current = onPatch;

  useEffect(() => {
    setHtml(card.description);
    pending.current = { id: card.id, html: card.description };
  }, [card.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    pending.current = { id: card.id, html };
    if (html === card.description) return;
    const timer = setTimeout(() => patchRef.current(card.id, { description: html }), DESCRIPTION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [html, card.id, card.description]);

  // Closing mid-keystroke must not drop the last few characters.
  useEffect(
    () => () => {
      const { id, html: latest } = pending.current;
      patchRef.current(id, { description: latest });
    },
    [],
  );

  useEffect(() => {
    if (!card.title) titleRef.current?.focus();
  }, [card.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduled = lane !== BACKLOG ? lane : '';

  return (
    <aside
      className="drawer"
      aria-label="Card details"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="drawer-head">
        <span className={`drawer-swatch c-${card.colour}`} aria-hidden="true" />
        <span className="drawer-where">{lane === BACKLOG ? 'Backlog' : formatFullDay(lane)}</span>
        <div className="drawer-head-actions">
          <button type="button" className="ghost" onClick={() => onDuplicate(card.id)} title="Duplicate card">
            Duplicate
          </button>
          <button
            type="button"
            className="ghost danger"
            onClick={() => {
              if (window.confirm(`Delete “${card.title || 'Untitled card'}”?`)) onDelete(card.id);
            }}
            title="Delete card"
          >
            Delete
          </button>
          <button type="button" className="ghost" onClick={onClose} title="Close (Esc)" aria-label="Close">
            ✕
          </button>
        </div>
      </header>

      <div className="drawer-body">
        <textarea
          ref={titleRef}
          className="drawer-title"
          value={card.title}
          rows={1}
          placeholder="Card title"
          onChange={(event) => onPatch(card.id, { title: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault();
          }}
        />

        <div className="field">
          <span className="field-label">Status</span>
          <div className="segmented">
            {STATUSES.map((status: Status) => (
              <button
                key={status}
                type="button"
                aria-pressed={card.status === status}
                className={card.status === status ? `seg is-on p-${status}` : 'seg'}
                onClick={() => onPatch(card.id, { status })}
              >
                {STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Category</span>
          <div className="swatches">
            {COLOURS.map((colour: Colour) => (
              <button
                key={colour}
                type="button"
                className={card.colour === colour ? `swatch c-${colour} is-on` : `swatch c-${colour}`}
                title={COLOUR_LABELS[colour]}
                aria-label={COLOUR_LABELS[colour]}
                aria-pressed={card.colour === colour}
                onClick={() => onPatch(card.id, { colour })}
              />
            ))}
          </div>
          <span className="field-hint">{COLOUR_LABELS[card.colour]}</span>
        </div>

        <div className="field-row">
          <label className="field">
            <span className="field-label">Size</span>
            <select
              value={card.estimate}
              onChange={(event) => onPatch(card.id, { estimate: Number(event.target.value) })}
            >
              {ESTIMATES.map((hours) => (
                <option key={hours} value={hours}>
                  {hours === 0 ? 'Unsized' : hours < 1 ? `${hours * 60} min` : `${hours} h`}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">Day</span>
            <input
              type="date"
              value={scheduled}
              onChange={(event) => onMove(card.id, event.target.value || BACKLOG)}
            />
          </label>
        </div>

        <div className="quick-days">
          <button type="button" className="ghost" onClick={() => onMove(card.id, todayKey())}>
            Today
          </button>
          <button type="button" className="ghost" onClick={() => onMove(card.id, addDays(todayKey(), 1))}>
            Tomorrow
          </button>
          <button type="button" className="ghost" onClick={() => onMove(card.id, BACKLOG)} disabled={lane === BACKLOG}>
            Backlog
          </button>
        </div>

        <div className="field">
          <span className="field-label">Description</span>
          <Suspense fallback={<div className="rt rt-loading" />}>
            <RichText value={html} onChange={setHtml} />
          </Suspense>
        </div>
      </div>
    </aside>
  );
}
