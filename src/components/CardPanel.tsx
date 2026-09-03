import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Card, CardSurface, CategoryId, LaneId, Status } from '../types';
import { BACKLOG, CATEGORY_IDS, STATUSES, STATUS_LABELS, categoryLabel, isClosedStage } from '../types';
import { useCategories } from '../categories';
import { useLookups } from '../lookups';
import { addDays, formatFullDay, formatTime, todayKey } from '../dates';

// The editor pulls in ProseMirror; keep it out of the first paint.
const RichText = lazy(() => import('./RichText'));

const ESTIMATES = [0, 0.25, 0.5, 1, 2, 3, 4, 6, 8];
const DESCRIPTION_DEBOUNCE_MS = 300;

export interface CardPanelProps {
  card: Card;
  lane: LaneId;
  /** Where this opens: beside the board, or over it. A Settings choice. */
  surface: CardSurface;
  /** True once a Microsoft 365 calendar is connected on this device. */
  calendarReady: boolean;
  onPatch: (id: string, patch: Partial<Card>) => void;
  onMove: (id: string, lane: LaneId) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

/** `<input type="time">` speaks "HH:mm"; the card stores minutes past midnight. */
const toTimeValue = (minutes: number | null) =>
  minutes == null ? '' : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

function fromTimeValue(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Grows a one-line textarea to fit what has been typed into it.
 *
 * `field-sizing: content` is meant to do this in CSS and doesn't here: inside
 * the panel's column flex container it settles a line short of the text, so a
 * two-line title loses its second line. Measuring the box we actually got and
 * setting the height from it works wherever the panel ends up.
 */
function useGrowToFit(ref: React.RefObject<HTMLTextAreaElement | null>, value: string): void {
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;

    const fit = () => {
      field.style.height = 'auto';
      field.style.height = `${field.scrollHeight}px`;
    };
    fit();

    // A narrower panel wraps the same title onto more lines. Only a change of
    // width is worth re-measuring for — reacting to our own height change as
    // well would be a loop.
    let width = field.clientWidth;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0].contentRect.width;
      if (next === width) return;
      width = next;
      fit();
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [ref, value]);
}

function CardBody(props: CardPanelProps) {
  const { card, lane, calendarReady, onPatch, onMove } = props;
  const categories = useCategories();
  const { projects, clients, clientOrder } = useLookups();
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

  useGrowToFit(titleRef, card.title);

  const scheduled = lane !== BACKLOG ? lane : '';
  // Archived and finished projects drop out of the picker, so it stays the
  // list of things you could actually put work against. Whatever the card is
  // already on stays listed either way — a card must never quietly lose the
  // project it names just because that project moved on.
  const openProjects = Object.values(projects)
    .filter(
      (project) =>
        project.id === card.projectId || (!project.archived && !isClosedStage(project.stage)),
    )
    .sort((a, b) => a.title.localeCompare(b.title));

  const toggleClient = (id: string) => {
    const next = card.clients.includes(id) ? card.clients.filter((x) => x !== id) : [...card.clients, id];
    onPatch(card.id, { clients: next });
  };

  return (
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

      <label className="field">
        <span className="field-label">Category</span>
        {/* A named list beats eight unlabelled swatches: the colour is the
            shorthand, but you shouldn't have to remember which is which. */}
        <span className={`picker c-${card.colour}`}>
          <span className="picker-dot" aria-hidden="true" />
          <select
            className="picker-select"
            value={card.colour}
            onChange={(event) => onPatch(card.id, { colour: event.target.value as CategoryId })}
          >
            {CATEGORY_IDS.map((id) => (
              <option key={id} value={id}>
                {categoryLabel(categories, id)}
              </option>
            ))}
          </select>
        </span>
      </label>

      <label className="field">
        <span className="field-label">Project</span>
        <select
          value={card.projectId ?? ''}
          onChange={(event) => onPatch(card.id, { projectId: event.target.value || null })}
        >
          <option value="">No project</option>
          {openProjects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span className="field-label">Clients</span>
        {clientOrder.length === 0 ? (
          <p className="field-note">No clients yet — add them under Settings › Clients.</p>
        ) : (
          <div className="chip-picker">
            {clientOrder.map((id) => {
              const client = clients[id];
              const on = card.clients.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  className={on ? 'chip is-on' : 'chip'}
                  style={{ '--chip': client.colour } as React.CSSProperties}
                  aria-pressed={on}
                  onClick={() => toggleClient(id)}
                >
                  {client.name}
                </button>
              );
            })}
          </div>
        )}
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

        <label className="field">
          <span className="field-label">Start</span>
          <input
            type="time"
            step={900}
            value={toTimeValue(card.start)}
            disabled={lane === BACKLOG}
            title={lane === BACKLOG ? 'Put the card on a day first' : 'Where it sits on the day view'}
            onChange={(event) => onPatch(card.id, { start: fromTimeValue(event.target.value) })}
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

      {/* Publishing needs a day to publish to, so the box stays out of reach
          until the card has one — and says why rather than just greying out. */}
      <label className={card.publish ? 'settings-row is-on' : 'settings-row'}>
        <span>
          Publish to calendar
          <span className="settings-hint">
            {!calendarReady
              ? 'Connect Microsoft 365 under Settings first'
              : lane === BACKLOG
                ? 'Schedule the card on a day first'
                : `Adds an entry at ${formatTime(card.start ?? 9 * 60)}`}
          </span>
        </span>
        <input
          type="checkbox"
          checked={card.publish}
          disabled={!calendarReady || lane === BACKLOG}
          onChange={(event) => onPatch(card.id, { publish: event.target.checked })}
        />
      </label>

      <div className="field">
        <span className="field-label">Description</span>
        <Suspense fallback={<div className="rt rt-loading" />}>
          <RichText value={html} onChange={setHtml} />
        </Suspense>
      </div>
    </div>
  );
}

function CardHead({ card, lane, onDuplicate, onDelete, onClose }: CardPanelProps) {
  return (
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
  );
}

/**
 * One card, opened. The fields are the same either way; only the frame around
 * them changes — a panel alongside the board, or a window over it.
 */
export default function CardPanel(props: CardPanelProps) {
  const { surface, onClose } = props;

  const stopEscape = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  if (surface === 'modal') {
    return (
      <div
        className="modal-backdrop"
        // A click that starts inside and drifts out shouldn't close the window.
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <section className="modal is-card" role="dialog" aria-modal="true" aria-label="Card details" onKeyDown={stopEscape}>
          <CardHead {...props} />
          <CardBody {...props} />
        </section>
      </div>
    );
  }

  return (
    <aside className="drawer" aria-label="Card details" onKeyDown={stopEscape}>
      <CardHead {...props} />
      <CardBody {...props} />
    </aside>
  );
}
