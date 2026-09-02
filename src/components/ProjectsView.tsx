import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { Card, CategoryId, LaneId, Project, ProjectStage, StageGroup } from '../types';
import {
  BACKLOG,
  CATEGORY_IDS,
  PROJECT_STAGES,
  STAGE_GROUP,
  STAGE_GROUP_LABELS,
  STAGE_LABELS,
  STATUS_LABELS,
  categoryLabel,
  formatMoney,
} from '../types';
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

function ProjectDescription({ project, onPatch }: { project: Project; onPatch: Props['onPatch'] }) {
  const [html, setHtml] = useState(project.description);
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
      <RichText value={html} onChange={setHtml} />
    </Suspense>
  );
}

export default function ProjectsView(props: Props) {
  const { projects, cardsOf, selected, onSelect, onCreate, onPatch, onDelete, onOpenCard, onAddCard, onMoveCard } = props;
  const categories = useCategories();
  const { clients, clientOrder } = useLookups();
  const [newTitle, setNewTitle] = useState('');
  const [cardTitle, setCardTitle] = useState('');
  const [cardDay, setCardDay] = useState(todayKey());

  const active = selected ? projects.find((project) => project.id === selected) ?? null : null;
  const activeClient = active?.clientId ? clients[active.clientId] : undefined;
  const cards = useMemo(() => (active ? cardsOf(active.id) : []), [active, cardsOf]);

  const done = cards.filter((entry) => entry.card.status === 'done').length;
  const hours = cards.reduce((sum, entry) => sum + entry.card.estimate, 0);

  /** The pipeline, in money: what might come in, what is committed, what has
   *  been billed and not paid, and what has landed. Archived projects are out
   *  of it — putting one away is saying you have stopped counting it. */
  const pipeline = useMemo(() => {
    const sums = { prospect: 0, committed: 0, owed: 0, banked: 0, lost: 0 } as Record<StageGroup, number>;
    for (const project of projects) {
      if (project.archived) continue;
      sums[STAGE_GROUP[project.stage]] += project.value;
    }
    return sums;
  }, [projects]);

  const create = () => {
    const title = newTitle.trim();
    if (!title) return;
    onCreate(title);
    setNewTitle('');
  };

  return (
    <div className="split">
      <aside className="split-list">
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
        </ul>

        <div className="split-new">
          <input
            className="lane-add-input"
            value={newTitle}
            placeholder="New project, then Enter"
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                create();
              }
            }}
          />
        </div>

        <ul className="split-items">
          {projects.length === 0 && <li className="split-empty">No projects yet.</li>}
          {projects.map((project, index) => {
            const own = cardsOf(project.id);
            const client = project.clientId ? clients[project.clientId] : undefined;
            const classes = ['split-item', `c-${project.colour}`];
            if (project.id === selected) classes.push('is-on');
            if (project.archived) classes.push('is-archived');
            // The list arrives in pipeline order, so a heading goes wherever the
            // stage changes — which turns the list into the funnel itself.
            const previous = projects[index - 1];
            const heading =
              !previous || previous.stage !== project.stage || previous.archived !== project.archived
                ? project.archived
                  ? 'Archived'
                  : STAGE_LABELS[project.stage]
                : null;
            return (
              <li key={project.id}>
                {heading && <p className="split-group">{heading}</p>}
                <button type="button" className={classes.join(' ')} onClick={() => onSelect(project.id)}>
                  <span className="split-item-title">{project.title || 'Untitled project'}</span>
                  <span className="split-item-meta">
                    {formatMoney(project.value)} · {own.length} card{own.length === 1 ? '' : 's'}
                    {project.archived ? ' · archived' : ''}
                  </span>
                  <span className="split-item-clients">
                    <span className={`stage s-stage-${STAGE_GROUP[project.stage]}`}>{STAGE_LABELS[project.stage]}</span>
                    {client && (
                      <span className="chip is-compact" style={{ '--chip': client.colour } as React.CSSProperties}>
                        {client.name}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="split-detail">
        {!active ? (
          <div className="split-blank">
            <h3>Pick a project</h3>
            <p>
              A project gathers the cards for one piece of work, carries what it is worth and who it is for, and
              moves down the pipeline from enquiry to paid. Cards keep their own day, so a project is a plan rather
              than a second board.
            </p>
          </div>
        ) : (
          <>
            <header className="split-detail-head">
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
              </div>
            </header>

            <div className="split-detail-body">
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
                      {CATEGORY_IDS.map((id) => (
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

              <div className="field">
                <span className="field-label">Description</span>
                <ProjectDescription key={active.id} project={active} onPatch={onPatch} />
              </div>

              <div className="field">
                <span className="field-label">
                  Cards · {cards.length} · {done} done{hours > 0 ? ` · ${formatEstimate(hours)}` : ''}
                </span>

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
          </>
        )}
      </section>
    </div>
  );
}
