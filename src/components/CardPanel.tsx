import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Attachment, Card, CardSurface, CardUpdate, CategoryId, LaneId, Status } from '../types';
import {
  BACKLOG,
  STATUSES,
  STATUS_LABELS,
  UPDATE_NOTE_MAX,
  categoryLabel,
  isClosedStage,
  totalUpdateMinutes,
  updateCategoryLabel,
} from '../types';
import Attachments, { useAttachmentActions } from './Attachments';
import { useCategories } from '../categories';
import { useLookups } from '../lookups';
import { formatMinutes } from '../cardText';
import { addDays, formatFullDay, formatTime, todayKey } from '../dates';

// The editor pulls in ProseMirror; keep it out of the first paint.
const RichText = lazy(() => import('./RichText'));

const ESTIMATES = [0, 0.25, 0.5, 1, 2, 3, 4, 6, 8];

/** Four corner brackets implying a square — reads as "expand" at a glance,
 *  where the diagonal-arrow glyph it replaced didn't. */
function ExpandIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="8 3 3 3 3 8" />
      <polyline points="21 8 21 3 16 3" />
      <polyline points="3 16 3 21 8 21" />
      <polyline points="16 21 21 21 21 16" />
    </svg>
  );
}

/** The same brackets, turned to point inward — "put this back". */
function CollapseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 8 8 8 8 3" />
      <polyline points="16 3 16 8 21 8" />
      <polyline points="21 16 16 16 16 21" />
      <polyline points="8 21 8 16 3 16" />
    </svg>
  );
}
const DESCRIPTION_DEBOUNCE_MS = 300;

export interface CardPanelProps {
  card: Card;
  lane: LaneId;
  /** Where this opens: beside the board, or over it. A Settings choice. */
  surface: CardSurface;
  /** True once a Microsoft 365 calendar is connected on this device. */
  calendarReady: boolean;
  /** The server can't be reached: the card still opens to look at, but
   *  nothing in it can be changed until sync is back. */
  locked?: boolean;
  onPatch: (id: string, patch: Partial<Card>) => void;
  onMove: (id: string, lane: LaneId) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onAddUpdate: (cardId: string, categoryId: string, minutes: number, note: string) => void;
  onPatchUpdate: (cardId: string, updateId: string, patch: Partial<CardUpdate>) => void;
  onDeleteUpdate: (cardId: string, updateId: string) => void;
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

/**
 * Discrete logged work: what kind it was, and how long it took, kept apart
 * from the card's own rough `estimate` — a shoot's capture, its edit and its
 * export can each get their own line rather than one blurred number.
 */
function UpdatesSection({
  card,
  locked,
  onAddUpdate,
  onPatchUpdate,
  onDeleteUpdate,
}: {
  card: Card;
  locked?: boolean;
  onAddUpdate: (cardId: string, categoryId: string, minutes: number, note: string) => void;
  onPatchUpdate: (cardId: string, updateId: string, patch: Partial<CardUpdate>) => void;
  onDeleteUpdate: (cardId: string, updateId: string) => void;
}) {
  const { updateCategories, updateCategoryOrder } = useLookups();
  const [categoryId, setCategoryId] = useState(updateCategoryOrder[0] ?? '');
  const [minutes, setMinutes] = useState(30);
  const [note, setNote] = useState('');

  // The list can change out from under an open card — a category deleted in
  // Settings on another device — so the draft is never left pointing at one
  // that no longer exists.
  useEffect(() => {
    if (categoryId && !updateCategories[categoryId]) setCategoryId(updateCategoryOrder[0] ?? '');
  }, [categoryId, updateCategories, updateCategoryOrder]);

  const total = totalUpdateMinutes(card.updates);
  const sorted = [...card.updates].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  const add = () => {
    if (!categoryId || minutes <= 0) return;
    onAddUpdate(card.id, categoryId, minutes, note.trim());
    setNote('');
  };

  return (
    <div className="field">
      <span className="field-label">
        Updates
        {total > 0 && <span className="field-total">{formatMinutes(total)} logged</span>}
      </span>

      {sorted.length > 0 && (
        <ul className="upd-list">
          {sorted.map((update) => (
            <li key={update.id} className="upd-row">
              <span
                className="upd-dot"
                style={{ '--chip': updateCategories[update.categoryId]?.colour ?? '#8b98a9' } as React.CSSProperties}
                aria-hidden="true"
              />
              <select
                className="upd-category"
                aria-label="Update category"
                value={update.categoryId}
                disabled={locked}
                onChange={(event) => onPatchUpdate(card.id, update.id, { categoryId: event.target.value })}
              >
                {updateCategoryOrder.map((id) => (
                  <option key={id} value={id}>
                    {updateCategoryLabel(updateCategories, id)}
                  </option>
                ))}
              </select>
              <input
                type="number"
                className="upd-minutes"
                aria-label="Minutes"
                min={0}
                step={5}
                value={update.minutes}
                disabled={locked}
                onChange={(event) =>
                  onPatchUpdate(card.id, update.id, { minutes: Math.max(0, Math.round(Number(event.target.value) || 0)) })
                }
              />
              <input
                type="text"
                className="upd-note"
                aria-label="What was done"
                value={update.note}
                placeholder="What did you do?"
                maxLength={UPDATE_NOTE_MAX}
                disabled={locked}
                onChange={(event) => onPatchUpdate(card.id, update.id, { note: event.target.value })}
              />
              <button
                type="button"
                className="ghost danger upd-remove"
                disabled={locked}
                title="Remove update"
                aria-label="Remove update"
                onClick={() => onDeleteUpdate(card.id, update.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {updateCategoryOrder.length === 0 ? (
        <p className="field-note">No update categories yet — add them under Settings › Cards &amp; updates.</p>
      ) : (
        <div className="upd-add">
          <select
            aria-label="New update's category"
            value={categoryId}
            disabled={locked}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            {updateCategoryOrder.map((id) => (
              <option key={id} value={id}>
                {updateCategoryLabel(updateCategories, id)}
              </option>
            ))}
          </select>
          <input
            type="number"
            className="upd-minutes"
            aria-label="New update's minutes"
            min={0}
            step={5}
            value={minutes}
            disabled={locked}
            onChange={(event) => setMinutes(Math.max(0, Math.round(Number(event.target.value) || 0)))}
          />
          <input
            type="text"
            className="upd-note"
            aria-label="What did you do"
            placeholder="What did you do? (optional)"
            maxLength={UPDATE_NOTE_MAX}
            value={note}
            disabled={locked}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
          />
          <button type="button" className="ghost" disabled={locked || minutes <= 0} onClick={add}>
            Log
          </button>
        </div>
      )}
    </div>
  );
}

function CardBody(props: CardPanelProps) {
  const { card, lane, calendarReady, locked, onPatch, onMove, onAddUpdate, onPatchUpdate, onDeleteUpdate } = props;
  const categories = useCategories();
  const { projects, clients, clientOrder, categoryOrder } = useLookups();
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

  const setAttachments = (next: Attachment[]) => onPatch(card.id, { attachments: next });
  // The same adder the list uses, so a file dropped into the description that
  // isn't an image lands on the list rather than being turned away.
  const { add: attach } = useAttachmentActions(card.attachments, setAttachments);

  const toggleClient = (id: string) => {
    const next = card.clients.includes(id) ? card.clients.filter((x) => x !== id) : [...card.clients, id];
    onPatch(card.id, { clients: next });
  };

  return (
    <div className="drawer-body" inert={locked || undefined}>
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
            {categoryOrder.map((id) => (
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

      <UpdatesSection
        card={card}
        locked={locked}
        onAddUpdate={onAddUpdate}
        onPatchUpdate={onPatchUpdate}
        onDeleteUpdate={onDeleteUpdate}
      />

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
          <RichText value={html} onChange={setHtml} onAttach={(files) => void attach(files)} />
        </Suspense>
      </div>

      <div className="field">
        <span className="field-label">Files</span>
        <Attachments attachments={card.attachments} onChange={setAttachments} locked={locked} />
      </div>
    </div>
  );
}

function CardHead({
  card,
  lane,
  locked,
  fullScreen,
  onToggleFullScreen,
  onDuplicate,
  onDelete,
  onClose,
}: CardPanelProps & { fullScreen: boolean; onToggleFullScreen: () => void }) {
  return (
    <header className="drawer-head">
      <span className={`drawer-swatch c-${card.colour}`} aria-hidden="true" />
      <span className="drawer-where">{lane === BACKLOG ? 'Backlog' : formatFullDay(lane)}</span>
      <div className="drawer-head-actions">
        <button type="button" className="ghost" disabled={locked} onClick={() => onDuplicate(card.id)} title="Duplicate card">
          Duplicate
        </button>
        <button
          type="button"
          className="ghost danger"
          disabled={locked}
          onClick={() => {
            if (window.confirm(`Delete “${card.title || 'Untitled card'}”?`)) onDelete(card.id);
          }}
          title="Delete card"
        >
          Delete
        </button>
        <button
          type="button"
          className="ghost icon"
          onClick={onToggleFullScreen}
          title={fullScreen ? 'Exit full screen' : 'Full screen'}
          aria-label={fullScreen ? 'Exit full screen' : 'Full screen'}
          aria-pressed={fullScreen}
        >
          {fullScreen ? <CollapseIcon /> : <ExpandIcon />}
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
  const [fullScreen, setFullScreen] = useState(false);
  const onToggleFullScreen = () => setFullScreen((value) => !value);

  const stopEscape = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    // Full screen is a step back toward the normal view, not a reason to
    // close the card outright.
    if (fullScreen) setFullScreen(false);
    else onClose();
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
        <section
          className={fullScreen ? 'modal is-card is-full' : 'modal is-card'}
          role="dialog"
          aria-modal="true"
          aria-label="Card details"
          onKeyDown={stopEscape}
        >
          <CardHead {...props} fullScreen={fullScreen} onToggleFullScreen={onToggleFullScreen} />
          <CardBody {...props} />
        </section>
      </div>
    );
  }

  const drawer = (
    <aside
      className={fullScreen ? 'drawer is-full' : 'drawer'}
      aria-label="Card details"
      onKeyDown={stopEscape}
    >
      <CardHead {...props} fullScreen={fullScreen} onToggleFullScreen={onToggleFullScreen} />
      <CardBody {...props} />
    </aside>
  );

  // Full screen floats the drawer over the board rather than covering it
  // edge to edge, so — same as the modal — it gets a backdrop behind it.
  // Clicking that backdrop steps back out of full screen, not out of the card.
  if (!fullScreen) return drawer;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setFullScreen(false);
      }}
    >
      {drawer}
    </div>
  );
}
