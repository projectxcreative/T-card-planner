import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { Attachment, Card, CategoryId, Client, Expense, LaneId, Project, ProjectStage, StageGroup } from '../types';
import {
  BACKLOG,
  EXPENSE_LABEL_MAX,
  PROJECT_STAGES,
  STAGE_GROUP,
  STAGE_GROUP_LABELS,
  STAGE_LABELS,
  STATUS_LABELS,
  categoryLabel,
  chargeableExpenses,
  formatMoney,
  projectCosts,
  projectTotal,
} from '../types';
import { uid } from '../store';
import Attachments, { useAttachmentActions } from './Attachments';
import { useCategories } from '../categories';
import { useLookups } from '../lookups';
import { formatEstimate } from '../cardText';
import { formatDayNumber, formatMonthKey, monthChoices, todayKey } from '../dates';

/** A year either side is enough to bill late or bill ahead. */
const MONTH_CHOICES = monthChoices(12, 12);

const RichText = lazy(() => import('./RichText'));
const DESCRIPTION_DEBOUNCE_MS = 300;

interface Props {
  projects: Project[];
  /** Every card on a project, with the lane it sits in. */
  cardsOf: (projectId: string) => { card: Card; lane: LaneId }[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (title: string) => void;
  onPatch: (id: string, patch: Partial<Project>) => void;
  onDelete: (id: string) => void;
  onOpenCard: (id: string) => void;
  onAddCard: (projectId: string, title: string, day: LaneId) => void;
  onMoveCard: (id: string, lane: LaneId) => void;
  /** Every card that isn't already on this project, unattached ones first. */
  attachable: (projectId: string) => { card: Card; lane: LaneId }[];
  onAttachCard: (cardId: string, projectId: string) => void;
  /** The server can't be reached: creating, editing and deleting are paused,
   *  but picking a project from the list to look at still works. */
  locked?: boolean;
}

/** The money box is typed into, so it can't be driven straight off the number:
 *  clearing it to type a new figure would otherwise snap back to 0. */
function ValueField({ project, onPatch }: { project: Project; onPatch: Props['onPatch'] }) {
  const [draft, setDraft] = useState(String(project.value || ''));
  useEffect(() => setDraft(String(project.value || '')), [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <label className="field">
      <span className="field-label">Value</span>
      <span className="money">
        <span className="money-sign" aria-hidden="true">£</span>
        <input
          type="number"
          min={0}
          step={50}
          className="money-input"
          value={draft}
          placeholder="0"
          onChange={(event) => {
            setDraft(event.target.value);
            onPatch(project.id, { value: Math.max(0, Number(event.target.value) || 0) });
          }}
        />
      </span>
    </label>
  );
}

/** One expense, already on the project. Its label and amount are edited in
 *  place — a mistyped figure gets corrected, not deleted and retyped — the
 *  same as every other field on a project. */
function ExpenseRow({
  expense,
  onChange,
  onRemove,
}: {
  expense: Expense;
  onChange: (id: string, patch: Partial<Expense>) => void;
  onRemove: (id: string) => void;
}) {
  // Same reasoning as the project's own Value field: bound straight to the
  // number, clearing the box to type a new figure would snap back to 0.
  const [amountDraft, setAmountDraft] = useState(String(expense.amount || ''));
  useEffect(() => setAmountDraft(String(expense.amount || '')), [expense.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <li className="expense-row">
      <input
        className="expense-label-input"
        value={expense.label}
        placeholder="Expense"
        maxLength={EXPENSE_LABEL_MAX}
        aria-label="Expense label"
        onChange={(event) => onChange(expense.id, { label: event.target.value })}
      />
      <label className="expense-toggle" title="Billed on to the client and recovered in full">
        <input
          type="checkbox"
          checked={expense.chargeable}
          onChange={(event) => onChange(expense.id, { chargeable: event.target.checked })}
        />
        Chargeable
      </label>
      <span className="money expense-money">
        <span className="money-sign" aria-hidden="true">£</span>
        <input
          type="number"
          min={0}
          step={1}
          className="money-input"
          value={amountDraft}
          aria-label="Expense amount"
          onChange={(event) => {
            setAmountDraft(event.target.value);
            onChange(expense.id, { amount: Math.max(0, Number(event.target.value) || 0) });
          }}
        />
      </span>
      <button
        type="button"
        className="ghost icon"
        onClick={() => onRemove(expense.id)}
        title={`Remove ${expense.label || 'this expense'}`}
        aria-label={`Remove ${expense.label || 'this expense'}`}
      >
        ✕
      </button>
    </li>
  );
}

/** Costs against a project's value — a prop, a freelancer, travel — kept as a
 *  running list rather than one lump figure, so what each one was for stays on
 *  the record. */
function ExpensesField({ project, onPatch }: { project: Project; onPatch: Props['onPatch'] }) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [chargeable, setChargeable] = useState(false);

  const add = () => {
    const text = label.trim();
    const value = Math.max(0, Number(amount) || 0);
    if (!text || value <= 0) return;
    onPatch(project.id, { expenses: [...project.expenses, { id: uid(), label: text, amount: value, chargeable }] });
    setLabel('');
    setAmount('');
    setChargeable(false);
  };

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    add();
  };

  const update = (id: string, patch: Partial<Expense>) =>
    onPatch(project.id, {
      expenses: project.expenses.map((expense) => (expense.id === id ? { ...expense, ...patch } : expense)),
    });

  const remove = (id: string) => onPatch(project.id, { expenses: project.expenses.filter((expense) => expense.id !== id) });

  const costs = projectCosts(project);
  const chargeableTotal = chargeableExpenses(project);
  const summary = [
    costs > 0 && `${formatMoney(costs)} in project costs`,
    chargeableTotal > 0 && `${formatMoney(chargeableTotal)} chargeable to the client`,
    (costs > 0 || chargeableTotal > 0) && `${formatMoney(project.value - costs)} net`,
  ].filter(Boolean);

  return (
    <div className="field">
      <span className="field-label">Expenses</span>
      <p className="field-note">
        Tick “Chargeable” for a cost billed on to the client and recovered in full — leave it unticked for a project
        cost, which comes off the project's net.
      </p>

      <ul className="expense-list">
        {project.expenses.length === 0 && <li className="split-empty">No expenses on this project yet.</li>}
        {project.expenses.map((expense) => (
          <ExpenseRow key={expense.id} expense={expense} onChange={update} onRemove={remove} />
        ))}
      </ul>

      <div className="split-addcard">
        <input
          className="lane-add-input"
          value={label}
          placeholder="Expense, e.g. props, travel, freelancer"
          maxLength={EXPENSE_LABEL_MAX}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={onKey}
        />
        <label className="expense-toggle" title="Billed on to the client and recovered in full">
          <input type="checkbox" checked={chargeable} onChange={(event) => setChargeable(event.target.checked)} />
          Chargeable
        </label>
        <span className="money expense-money">
          <span className="money-sign" aria-hidden="true">£</span>
          <input
            type="number"
            min={0}
            step={1}
            className="money-input"
            value={amount}
            placeholder="0"
            onChange={(event) => setAmount(event.target.value)}
            onKeyDown={onKey}
          />
        </span>
        <button type="button" className="ghost" onClick={add}>
          Add
        </button>
      </div>

      {summary.length > 0 && <p className="field-note">{summary.join(' · ')}</p>}
    </div>
  );
}

function ProjectDescription({ project, onPatch }: { project: Project; onPatch: Props['onPatch'] }) {
  const [html, setHtml] = useState(project.description);
  // A file dropped into the text that isn't an image belongs on the list
  // below, not in the middle of a sentence.
  const { add } = useAttachmentActions(project.attachments, (next: Attachment[]) =>
    onPatch(project.id, { attachments: next }),
  );
  const patchRef = useRef(onPatch);
  patchRef.current = onPatch;

  useEffect(() => setHtml(project.description), [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (html === project.description) return;
    const timer = setTimeout(() => patchRef.current(project.id, { description: html }), DESCRIPTION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [html, project.id, project.description]);

  return (
    <Suspense fallback={<div className="rt rt-loading" />}>
      <RichText value={html} onChange={setHtml} onAttach={(files) => void add(files)} />
    </Suspense>
  );
}

/** A project's own files: the brief, the quote, the signed order. Same store
 *  and same rules as a card's — see `Attachments`. */
function ProjectFiles({ project, onPatch, locked }: { project: Project; onPatch: Props['onPatch']; locked?: boolean }) {
  return (
    <Attachments
      attachments={project.attachments}
      onChange={(next: Attachment[]) => onPatch(project.id, { attachments: next })}
      locked={locked}
    />
  );
}

/** What a set of cards adds up to. Hours are split the way the lanes split
 *  them: an estimate on an open card is time still owed, the same estimate on a
 *  finished one is time spent. */
interface Tally {
  cards: number;
  done: number;
  /** Hours still to do, hours already done, and the two together. */
  planned: number;
  logged: number;
  hours: number;
  /** Cards carrying no estimate. The hours above are only as good as this. */
  unsized: number;
  /** The first and last day the project has a card on, backlog aside. */
  first: LaneId | null;
  last: LaneId | null;
}

function tally(entries: { card: Card; lane: LaneId }[]): Tally {
  const sums: Tally = {
    cards: entries.length,
    done: 0,
    planned: 0,
    logged: 0,
    hours: 0,
    unsized: 0,
    first: null,
    last: null,
  };
  for (const { card, lane } of entries) {
    if (card.status === 'done') {
      sums.done += 1;
      sums.logged += card.estimate;
    } else {
      sums.planned += card.estimate;
    }
    sums.hours += card.estimate;
    if (card.estimate === 0) sums.unsized += 1;
    // Lane keys are YYYY-MM-DD, so they compare as dates do. The backlog has no
    // day and so belongs to neither end of the span.
    if (lane !== BACKLOG) {
      if (!sums.first || lane < sums.first) sums.first = lane;
      if (!sums.last || lane > sums.last) sums.last = lane;
    }
  }
  return sums;
}

/**
 * What the project comes to: its cards, its hours, and what those two make of
 * the money on it.
 *
 * The rate is the number worth having. A project's value on its own says
 * nothing about whether it is worth doing — value over the hours it will take
 * is the figure you compare one piece of work against another with, and it is
 * the one nobody works out by hand.
 */
function ProjectStats({ project, stats }: { project: Project; stats: Tally }) {
  const costs = projectCosts(project);
  const chargeable = chargeableExpenses(project);
  const rate = stats.hours > 0 && project.value > 0 ? project.value / stats.hours : null;
  // Hours are the honest measure of how far along something is; card counts
  // treat a ten-minute job and a two-day one as the same thing. Unsized cards
  // leave nothing to measure, so the count stands in.
  const progress =
    stats.hours > 0 ? stats.logged / stats.hours : stats.cards > 0 ? stats.done / stats.cards : 0;

  return (
    <div className="projstats">
      <ul className="projstats-grid">
        <li className="projstat" title={`${stats.done} of ${stats.cards} cards finished`}>
          <span className="projstat-label">Cards</span>
          <span className="projstat-value">
            {stats.done}<span className="projstat-of">/{stats.cards}</span>
          </span>
          <span className="projstat-note">done</span>
        </li>

        <li className="projstat" title="Hours on the cards still open">
          <span className="projstat-label">To do</span>
          <span className="projstat-value">{formatEstimate(stats.planned) || '—'}</span>
          <span className="projstat-note">{stats.cards - stats.done} open</span>
        </li>

        <li className="projstat" title="Hours on the cards already finished">
          <span className="projstat-label">Logged</span>
          <span className={stats.logged > 0 ? 'projstat-value is-on' : 'projstat-value'}>
            {formatEstimate(stats.logged) || '—'}
          </span>
          <span className="projstat-note">done</span>
        </li>

        <li className="projstat" title="Every hour on this project's cards, finished or not">
          <span className="projstat-label">Total</span>
          <span className="projstat-value">{formatEstimate(stats.hours) || '—'}</span>
          <span className="projstat-note">{stats.unsized > 0 ? `${stats.unsized} unsized` : 'estimated'}</span>
        </li>

        <li
          className="projstat"
          title={
            rate
              ? `${formatMoney(project.value)} over ${formatEstimate(stats.hours)} of work`
              : 'Give the project a value and its cards an estimate to see what it pays an hour'
          }
        >
          <span className="projstat-label">Rate</span>
          <span className="projstat-value">{rate ? `${formatMoney(Math.round(rate))}` : '—'}</span>
          <span className="projstat-note">per hour</span>
        </li>

        {costs > 0 && (
          <li className="projstat" title={`${formatMoney(project.value)} minus ${formatMoney(costs)} of project costs — chargeable expenses aren't counted, since they're recovered in full`}>
            <span className="projstat-label">Net</span>
            <span className="projstat-value">{formatMoney(project.value - costs)}</span>
            <span className="projstat-note">after {formatMoney(costs)} costs</span>
          </li>
        )}

        {chargeable > 0 && (
          <li
            className="projstat"
            title={`Expenses billed on to the client, recovered in full — the list totals this project at ${formatMoney(projectTotal(project))}`}
          >
            <span className="projstat-label">Billed on</span>
            <span className="projstat-value">{formatMoney(chargeable)}</span>
            <span className="projstat-note">{formatMoney(projectTotal(project))} total</span>
          </li>
        )}

        <li
          className="projstat"
          title={stats.first ? 'The first and last day this project has a card on' : 'Nothing scheduled yet'}
        >
          <span className="projstat-label">Runs</span>
          <span className="projstat-value is-small">
            {stats.first ? formatDayNumber(stats.first) : '—'}
            {stats.last && stats.last !== stats.first ? ` – ${formatDayNumber(stats.last)}` : ''}
          </span>
          <span className="projstat-note">{stats.first ? 'scheduled' : 'unscheduled'}</span>
        </li>
      </ul>

      <div className="projstats-bar" aria-hidden="true">
        <span style={{ width: `${Math.min(progress, 1) * 100}%` }} />
      </div>
    </div>
  );
}

/** How many matches the picker will show at once. Past this you are better off
 *  typing another word than reading a longer list. */
const ATTACH_LIMIT = 8;

/**
 * Pulls a card that already exists onto this project.
 *
 * Projects are usually named after the work has started, so the cards for one
 * are often already sitting on the board. Retyping them would leave the
 * originals behind; this claims them where they are, keeping their day, their
 * hours and whatever has already been written on them.
 */
function AttachCard({
  project,
  options,
  projects,
  onAttach,
}: {
  project: Project;
  options: { card: Card; lane: LaneId }[];
  projects: Record<string, Project>;
  onAttach: Props['onAttachCard'];
}) {
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

  // A fresh project starts empty on purpose: the list opens on focus, so the
  // first few cards are one click away without typing anything.
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
                  {/* A card already on another project can still be taken, but
                      it says whose it is first — a silent move is how work
                      goes missing from someone else's plan. */}
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

/* ---------- the project table ---------- */

/**
 * What the rows are grouped into.
 *
 * Stage reads top to bottom as the pipeline; client reads as the book of
 * business — the same projects, answering either "what is happening" or "who
 * it is for". Both are a drop target as well as a heading, so a project is
 * moved on by dragging it rather than by opening it.
 */
type GroupBy = 'stage' | 'client';

const GROUP_LABELS: Record<GroupBy, string> = { stage: 'stage', client: 'client' };

/** Two groups that are neither a stage nor a client: work nobody is paying for
 *  yet, and work you have stopped counting. Archived is a group in both
 *  groupings, so dragging a row into it puts a project away and dragging it
 *  back out brings it back — and so an archived project never quietly swells a
 *  subtotal. */
const NO_CLIENT = 'none';
const ARCHIVED = 'archived';

/** Which grouping you last used. Per device, like the other view preferences:
 *  it is about how you are reading the list, not about the board itself. */
const GROUP_KEY = 'tcard-planner.projects.groupby';

function readGroupBy(): GroupBy {
  try {
    return localStorage.getItem(GROUP_KEY) === 'client' ? 'client' : 'stage';
  } catch {
    return 'stage';
  }
}

/** What a run of rows adds up to — the figures under each group. */
interface GroupSums {
  count: number;
  value: number;
  /** How much of the value is expenses passed on to the client. */
  chargeable: number;
  cards: number;
  done: number;
  hours: number;
}

/** A run of the table: its heading, its rows, and what they come to. */
interface Group {
  key: string;
  label: string;
  /** A client group wears the client's own colour on its heading. */
  colour?: string;
  projects: Project[];
  sums: GroupSums;
}

/** Droppable ids carry the group so the drop can read it straight back off,
 *  rather than working it out from whatever it happened to land on. */
const dropId = (key: string) => `group:${key}`;

function GroupDrop({ group, children }: { group: Group; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId(group.key), data: { group: group.key } });
  const classes = ['proj-group'];
  if (group.key === ARCHIVED) classes.push('is-put-away');
  if (isOver) classes.push('is-over');
  return (
    <section ref={setNodeRef} className={classes.join(' ')}>
      {children}
    </section>
  );
}

/**
 * One project, as a row of columns.
 *
 * Stage and client are dropdowns rather than labels: they are the two fields
 * that actually change while you are looking at the list, and a list you can
 * only read is a list you keep opening things from. The drag does the same job
 * in one gesture; the dropdowns are what it falls back to on a phone, on a
 * keyboard, and when the row is already where you are looking.
 */
function ProjectRow({
  project,
  group,
  stats,
  clients,
  clientOrder,
  selected,
  locked,
  onSelect,
  onPatch,
}: {
  project: Project;
  group: string;
  stats: Tally;
  clients: Record<string, Client>;
  clientOrder: string[];
  selected: boolean;
  locked?: boolean;
  onSelect: Props['onSelect'];
  onPatch: Props['onPatch'];
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: project.id, data: { group } });
  const client = project.clientId ? clients[project.clientId] : undefined;
  const chargeable = chargeableExpenses(project);
  const total = projectTotal(project);
  const classes = ['proj-row', `c-${project.colour}`];
  if (selected) classes.push('is-on');

  return (
    <li ref={setNodeRef} className={classes.join(' ')} style={isDragging ? { opacity: 0.35 } : undefined}>
      {/* A grip rather than the whole row: the row carries two dropdowns, and a
          drag that starts on a dropdown is a dropdown that never opens. */}
      <span
        {...attributes}
        {...listeners}
        className="proj-grip"
        aria-label={`Move ${project.title || 'this project'} to another group`}
        title="Drag to another group"
      />

      <button
        type="button"
        className="proj-cell is-title"
        onClick={() => onSelect(project.id)}
        title={project.title || 'Untitled project'}
      >
        {project.title || 'Untitled project'}
      </button>

      <select
        className={`proj-cell is-stage stage-select s-stage-${STAGE_GROUP[project.stage]}`}
        value={project.stage}
        disabled={locked}
        aria-label={`Stage for ${project.title || 'this project'}`}
        onChange={(event) => onPatch(project.id, { stage: event.target.value as ProjectStage })}
      >
        {PROJECT_STAGES.map((stage) => (
          <option key={stage} value={stage}>
            {STAGE_LABELS[stage]}
          </option>
        ))}
      </select>

      <select
        className="proj-cell is-client"
        style={client ? ({ '--chip': client.colour } as React.CSSProperties) : undefined}
        value={project.clientId ?? ''}
        disabled={locked}
        aria-label={`Client for ${project.title || 'this project'}`}
        onChange={(event) => onPatch(project.id, { clientId: event.target.value || null })}
      >
        <option value="">No client</option>
        {clientOrder.map((id) => (
          <option key={id} value={id}>
            {clients[id].name}
          </option>
        ))}
        {/* A client since removed still has to show its own value, or the row
            would silently read as unassigned. */}
        {project.clientId && !client && <option value={project.clientId}>Unknown client</option>}
      </select>

      <span className="proj-cell is-cards proj-num" title={`${stats.done} of ${stats.cards} cards finished`}>
        {stats.cards > 0 ? (
          <>
            {stats.done}
            <span className="proj-of">/{stats.cards}</span>
          </>
        ) : (
          '—'
        )}
      </span>

      <span className="proj-cell is-hours proj-num" title="Every hour on this project's cards, finished or not">
        {formatEstimate(stats.hours) || '—'}
      </span>

      {/* The row's total is what the client is billed: the value plus anything
          chargeable on the project, since a passed-on cost still goes on the
          invoice. The breakdown lives in the title so the column stays a
          single figure. */}
      <span
        className="proj-cell is-value proj-num"
        title={
          chargeable > 0
            ? `${formatMoney(project.value)} value plus ${formatMoney(chargeable)} chargeable to the client`
            : undefined
        }
      >
        {formatMoney(total)}
      </span>
    </li>
  );
}

export default function ProjectsView(props: Props) {
  const { projects, cardsOf, selected, onSelect, onCreate, onPatch, onDelete, onOpenCard, onAddCard, onMoveCard, attachable, onAttachCard, locked } = props;
  const categories = useCategories();
  const { clients, clientOrder, categoryOrder } = useLookups();
  const [newTitle, setNewTitle] = useState('');
  const [cardTitle, setCardTitle] = useState('');
  const [cardDay, setCardDay] = useState(todayKey());
  const [groupBy, setGroupBy] = useState<GroupBy>(readGroupBy);
  const [dragging, setDragging] = useState<Project | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(GROUP_KEY, groupBy);
    } catch {
      // A device that won't keep preferences still shows the list.
    }
  }, [groupBy]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const active = selected ? projects.find((project) => project.id === selected) ?? null : null;
  const activeClient = active?.clientId ? clients[active.clientId] : undefined;
  const cards = useMemo(() => (active ? cardsOf(active.id) : []), [active, cardsOf]);
  const spare = useMemo(() => (active ? attachable(active.id) : []), [active, attachable]);
  const byId = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project])), [projects]);

  /** Every project's tally, worked out once: the list shows a project's hours
   *  on its row, the detail shows the whole breakdown, and the head sums them. */
  const tallies = useMemo(() => {
    const out: Record<string, Tally> = {};
    for (const project of projects) out[project.id] = tally(cardsOf(project.id));
    return out;
  }, [projects, cardsOf]);

  const stats = active ? tallies[active.id] ?? tally(cards) : null;

  /** Hours across everything still live, so the list head answers "how much
   *  work is actually on the books" beside what it is worth. Archived projects
   *  are out of it, exactly as they are out of the money above. */
  const workload = useMemo(() => {
    let logged = 0;
    let hours = 0;
    for (const project of projects) {
      if (project.archived) continue;
      const sums = tallies[project.id];
      if (!sums) continue;
      logged += sums.logged;
      hours += sums.hours;
    }
    return { logged, hours };
  }, [projects, tallies]);

  /** The pipeline, in money: what might come in, what is committed, what has
   *  been billed and not paid, and what has landed. Archived projects are out
   *  of it — putting one away is saying you have stopped counting it. */
  const pipeline = useMemo(() => {
    const sums = { prospect: 0, committed: 0, owed: 0, banked: 0, lost: 0 } as Record<StageGroup, number>;
    for (const project of projects) {
      if (project.archived) continue;
      sums[STAGE_GROUP[project.stage]] += projectTotal(project);
    }
    return sums;
  }, [projects]);

  /**
   * The table, in runs.
   *
   * Every group is listed whether or not anything is in it: an empty stage is
   * both a fact worth seeing — nothing quoted this month — and the only place a
   * project can be dragged to before it has company there.
   */
  const groups = useMemo<Group[]>(() => {
    const heads: { key: string; label: string; colour?: string }[] =
      groupBy === 'stage'
        ? PROJECT_STAGES.map((stage) => ({ key: stage, label: STAGE_LABELS[stage] }))
        : [
            ...clientOrder.map((id) => ({ key: id, label: clients[id].name, colour: clients[id].colour })),
            { key: NO_CLIENT, label: 'No client' },
          ];
    heads.push({ key: ARCHIVED, label: 'Archived' });

    const rows = new Map<string, Project[]>(heads.map((head) => [head.key, []]));
    for (const project of projects) {
      // Archived work is out of the groups proper for the same reason it is out
      // of the totals above: putting one away is saying you have stopped
      // counting it. A project on a client that has since been deleted falls
      // back to "No client" rather than vanishing.
      const key = project.archived
        ? ARCHIVED
        : groupBy === 'stage'
          ? project.stage
          : project.clientId && clients[project.clientId]
            ? project.clientId
            : NO_CLIENT;
      rows.get(key)?.push(project);
    }

    return heads.map((head) => {
      const own = rows.get(head.key) ?? [];
      const sums: GroupSums = { count: own.length, value: 0, chargeable: 0, cards: 0, done: 0, hours: 0 };
      for (const project of own) {
        sums.value += projectTotal(project);
        sums.chargeable += chargeableExpenses(project);
        const stats = tallies[project.id];
        if (!stats) continue;
        sums.cards += stats.cards;
        sums.done += stats.done;
        sums.hours += stats.hours;
      }
      return { ...head, projects: own, sums };
    });
  }, [projects, groupBy, clients, clientOrder, tallies]);

  /**
   * A row dropped on another group's heading.
   *
   * What the move means is whatever the list is grouped by: the stage in stage
   * order, the client in client order, and either way a project dragged out of
   * Archived comes back with it.
   */
  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const { active, over } = event;
    if (!over) return;
    const to = (over.data.current as { group?: string } | undefined)?.group;
    const from = (active.data.current as { group?: string } | undefined)?.group;
    // Dropping a project back where it already was is not an edit.
    if (!to || to === from) return;

    const id = String(active.id);
    const project = projects.find((row) => row.id === id);
    const patch: Partial<Project> =
      to === ARCHIVED
        ? { archived: true }
        : groupBy === 'stage'
          ? { stage: to as ProjectStage }
          : { clientId: to === NO_CLIENT ? null : to };
    if (to !== ARCHIVED && project?.archived) patch.archived = false;
    onPatch(id, patch);
  };

  const create = () => {
    const title = newTitle.trim();
    if (!title) return;
    onCreate(title);
    setNewTitle('');
  };

  return (
    <div className="proj-page">
      <section className="split-list is-full">
        <header className="split-list-head">
          <h2 className="split-heading">Projects</h2>
          <span className="split-total" title="Won, delivered and invoiced — everything you are owed or committed to">
            {formatMoney(pipeline.committed + pipeline.owed)}
          </span>
        </header>

        <ul className="totals is-tight">
          {(['prospect', 'committed', 'owed', 'banked'] as StageGroup[]).map((group) => (
            <li key={group}>
              <span className="totals-label">{STAGE_GROUP_LABELS[group]}</span>
              <span className={group === 'banked' ? 'totals-value is-done' : 'totals-value'}>
                {formatMoney(pipeline[group])}
              </span>
            </li>
          ))}
          <li className="is-hours" title="Hours logged, of every hour on a live project's cards">
            <span className="totals-label">Hours</span>
            <span className="totals-value">
              {formatEstimate(workload.logged) || '0h'}
              <span className="totals-of"> of {formatEstimate(workload.hours) || '0h'}</span>
            </span>
          </li>
        </ul>

        <div className="split-new">
          <input
            className="lane-add-input"
            value={newTitle}
            placeholder="New project, then Enter"
            disabled={locked}
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                create();
              }
            }}
          />
        </div>

        <div className="proj-toolbar">
          <span className="proj-toolbar-label" id="proj-groupby">Group by</span>
          <div className="segmented proj-groupby" role="group" aria-labelledby="proj-groupby">
            {(['stage', 'client'] as GroupBy[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={groupBy === mode ? 'seg is-on' : 'seg'}
                aria-pressed={groupBy === mode}
                onClick={() => setGroupBy(mode)}
              >
                {mode === 'stage' ? 'Stage' : 'Client'}
              </button>
            ))}
          </div>
          <span className="proj-toolbar-note">Drag a row by its grip to move it to another {GROUP_LABELS[groupBy]}.</span>
        </div>

        {projects.length === 0 && <p className="split-empty">No projects yet.</p>}

        {projects.length > 0 && (
          <DndContext
            sensors={locked ? [] : sensors}
            onDragStart={(event: DragStartEvent) =>
              setDragging(projects.find((project) => project.id === String(event.active.id)) ?? null)
            }
            onDragEnd={onDragEnd}
            onDragCancel={() => setDragging(null)}
          >
            <div className="proj-table">
              {/* One set of column labels for the whole table, not one per
                  group: the figures line up down the page, which is the point
                  of a table over a list of cards. */}
              <div className="proj-table-head" aria-hidden="true">
                <span className="proj-cell is-grip" />
                <span className="proj-cell is-title">Project</span>
                <span className="proj-cell is-stage">Stage</span>
                <span className="proj-cell is-client">Client</span>
                <span className="proj-cell is-cards">Cards</span>
                <span className="proj-cell is-hours">Hours</span>
                <span className="proj-cell is-value">Value</span>
              </div>

              {groups.map((group) => (
                <GroupDrop key={group.key} group={group}>
                  <header className="proj-group-head">
                    {group.colour && (
                      <span className="proj-group-dot" style={{ '--chip': group.colour } as React.CSSProperties} />
                    )}
                    <h3 className="proj-group-name">{group.label}</h3>
                    <span className="proj-group-count">
                      {group.sums.count} project{group.sums.count === 1 ? '' : 's'}
                    </span>
                  </header>

                  <ul className="proj-rows">
                    {group.sums.count === 0 && <li className="proj-drop-hint">Drop a project here</li>}
                    {group.projects.map((project) => (
                      <ProjectRow
                        key={project.id}
                        project={project}
                        group={group.key}
                        stats={tallies[project.id] ?? tally(cardsOf(project.id))}
                        clients={clients}
                        clientOrder={clientOrder}
                        selected={project.id === selected}
                        locked={locked}
                        onSelect={onSelect}
                        onPatch={onPatch}
                      />
                    ))}
                  </ul>

                  {/* The subtotal sits under its own rows and in their columns,
                      so what a stage or a client comes to is read straight down
                      the figures rather than added up by eye. */}
                  {group.sums.count > 0 && (
                    <div className="proj-group-foot">
                      <span className="proj-cell is-grip" />
                      <span className="proj-cell is-title">{group.label} subtotal</span>
                      <span className="proj-cell is-stage" />
                      <span className="proj-cell is-client" />
                      <span className="proj-cell is-cards proj-num" title={`${group.sums.done} of ${group.sums.cards} cards finished`}>
                        {group.sums.cards > 0 ? (
                          <>
                            {group.sums.done}
                            <span className="proj-of">/{group.sums.cards}</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </span>
                      <span className="proj-cell is-hours proj-num">{formatEstimate(group.sums.hours) || '—'}</span>
                      <span
                        className="proj-cell is-value proj-num"
                        title={
                          group.sums.chargeable > 0
                            ? `${formatMoney(group.sums.value - group.sums.chargeable)} of value plus ${formatMoney(group.sums.chargeable)} chargeable to the client`
                            : undefined
                        }
                      >
                        {formatMoney(group.sums.value)}
                      </span>
                    </div>
                  )}
                </GroupDrop>
              ))}
            </div>

            <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
              {dragging ? (
                <span className="proj-ghost">
                  {dragging.title || 'Untitled project'}
                  <strong>{formatMoney(projectTotal(dragging))}</strong>
                </span>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </section>

      {active && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onSelect(null);
          }}
        >
          <section
            className="modal is-project"
            role="dialog"
            aria-modal="true"
            aria-label="Project details"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.stopPropagation();
              onSelect(null);
            }}
          >
            <header className="split-detail-head" inert={locked || undefined}>
              <input
                className="drawer-title"
                value={active.title}
                placeholder="Project title"
                onChange={(event) => onPatch(active.id, { title: event.target.value })}
              />
              <div className="drawer-head-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => onPatch(active.id, { archived: !active.archived })}
                  title={active.archived ? 'Put this project back in the list' : 'Hide it from the card pickers'}
                >
                  {active.archived ? 'Unarchive' : 'Archive'}
                </button>
                <button
                  type="button"
                  className="ghost danger"
                  onClick={() => {
                    if (window.confirm(`Delete “${active.title || 'Untitled project'}”? Its cards stay on the board.`)) {
                      onDelete(active.id);
                      onSelect(null);
                    }
                  }}
                >
                  Delete
                </button>
                <button type="button" className="ghost" onClick={() => onSelect(null)} title="Close (Esc)" aria-label="Close">
                  ✕
                </button>
              </div>
            </header>

            <div className="split-detail-body" inert={locked || undefined}>
              {stats && <ProjectStats project={active} stats={stats} />}

              <div className="field-row">
                <label className="field">
                  <span className="field-label">Stage</span>
                  <select
                    className={`stage-select s-stage-${STAGE_GROUP[active.stage]}`}
                    value={active.stage}
                    onChange={(event) => onPatch(active.id, { stage: event.target.value as ProjectStage })}
                  >
                    {PROJECT_STAGES.map((stage) => (
                      <option key={stage} value={stage}>
                        {STAGE_LABELS[stage]}
                      </option>
                    ))}
                  </select>
                </label>

                <ValueField project={active} onPatch={onPatch} />

                <label className="field">
                  <span className="field-label">Invoice month</span>
                  <select
                    value={active.invoiceMonth ?? ''}
                    onChange={(event) => onPatch(active.id, { invoiceMonth: event.target.value || null })}
                  >
                    <option value="">Not yet</option>
                    {MONTH_CHOICES.map((key) => (
                      <option key={key} value={key}>
                        {formatMonthKey(key)}
                      </option>
                    ))}
                    {active.invoiceMonth && !MONTH_CHOICES.includes(active.invoiceMonth) && (
                      <option value={active.invoiceMonth}>{formatMonthKey(active.invoiceMonth)}</option>
                    )}
                  </select>
                </label>
              </div>

              <div className="field-row">
                <label className="field">
                  <span className="field-label">Category</span>
                  <span className={`picker c-${active.colour}`}>
                    <span className="picker-dot" aria-hidden="true" />
                    <select
                      className="picker-select"
                      value={active.colour}
                      onChange={(event) => onPatch(active.id, { colour: event.target.value as CategoryId })}
                    >
                      {categoryOrder.map((id) => (
                        <option key={id} value={id}>
                          {categoryLabel(categories, id)}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
              </div>

              <label className="field">
                <span className="field-label">Client</span>
                {clientOrder.length === 0 ? (
                  <p className="field-note">No clients yet — add them in the Clients view, or under Settings.</p>
                ) : (
                  <span className="picker" style={activeClient ? ({ '--c': activeClient.colour } as React.CSSProperties) : undefined}>
                    {activeClient && <span className="picker-dot" aria-hidden="true" />}
                    <select
                      className={activeClient ? 'picker-select' : undefined}
                      value={active.clientId ?? ''}
                      onChange={(event) => onPatch(active.id, { clientId: event.target.value || null })}
                    >
                      <option value="">No client</option>
                      {clientOrder.map((id) => (
                        <option key={id} value={id}>
                          {clients[id].name}
                        </option>
                      ))}
                    </select>
                  </span>
                )}
              </label>

              <ExpensesField project={active} onPatch={onPatch} />

              <div className="field">
                <span className="field-label">Description</span>
                <ProjectDescription key={active.id} project={active} onPatch={onPatch} />
              </div>

              <div className="field">
                <span className="field-label">Files</span>
                <ProjectFiles project={active} onPatch={onPatch} locked={locked} />
              </div>

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
                      onAddCard(active.id, title, cardDay || BACKLOG);
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

                <AttachCard key={active.id} project={active} options={spare} projects={byId} onAttach={onAttachCard} />

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
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
