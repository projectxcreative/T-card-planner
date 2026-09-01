import { useMemo, useState } from 'react';
import type { Card, Client, LaneId, Project } from '../types';
import { BACKLOG, CLIENT_NAME_MAX, STATUS_LABELS, formatMoney } from '../types';
import { formatEstimate } from '../cardText';

export interface ClientTotals {
  value: number;
  projects: number;
  cards: number;
  done: number;
  planned: number;
  logged: number;
}

interface Props {
  clients: Client[];
  totals: (clientId: string) => ClientTotals;
  projectsOf: (clientId: string) => Project[];
  /** Cards tagged with the client, plus every card on their projects. */
  cardsOf: (clientId: string) => { card: Card; lane: LaneId }[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => void;
  onPatch: (id: string, patch: Partial<Client>) => void;
  onDelete: (id: string) => void;
  onOpenCard: (id: string) => void;
  /** Jump to the Projects view with this project open. */
  onOpenProject: (id: string) => void;
  onMoveCard: (id: string, lane: LaneId) => void;
}

export default function ClientsView(props: Props) {
  const { clients, totals, projectsOf, cardsOf, selected, onSelect, onCreate, onPatch, onDelete, onOpenCard, onOpenProject, onMoveCard } = props;
  const [draft, setDraft] = useState('');

  const active = selected ? clients.find((client) => client.id === selected) ?? null : null;
  const projects = useMemo(() => (active ? projectsOf(active.id) : []), [active, projectsOf]);
  const cards = useMemo(() => (active ? cardsOf(active.id) : []), [active, cardsOf]);
  const sums = active ? totals(active.id) : null;
  const book = clients.reduce((sum, client) => sum + totals(client.id).value, 0);

  const create = () => {
    const name = draft.trim();
    if (!name) return;
    onCreate(name.slice(0, CLIENT_NAME_MAX));
    setDraft('');
  };

  return (
    <div className="split">
      <aside className="split-list">
        <header className="split-list-head">
          <h2 className="split-heading">Clients</h2>
          <span className="split-total" title="Value of every open project across all clients">
            {formatMoney(book)}
          </span>
        </header>

        <div className="split-new">
          <input
            className="lane-add-input"
            value={draft}
            placeholder="New client, then Enter"
            maxLength={CLIENT_NAME_MAX}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                create();
              }
            }}
          />
        </div>

        <ul className="split-items">
          {clients.length === 0 && <li className="split-empty">No clients yet.</li>}
          {clients.map((client) => {
            const own = totals(client.id);
            return (
              <li key={client.id}>
                <button
                  type="button"
                  className={client.id === selected ? 'split-item is-on' : 'split-item'}
                  style={{ '--c': client.colour } as React.CSSProperties}
                  onClick={() => onSelect(client.id)}
                >
                  <span className="split-item-title">{client.name}</span>
                  <span className="split-item-meta">
                    {formatMoney(own.value)} · {own.cards} card{own.cards === 1 ? '' : 's'}
                    {own.logged > 0 ? ` · ${formatEstimate(own.logged)} logged` : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="split-detail">
        {!active || !sums ? (
          <div className="split-blank">
            <h3>Pick a client</h3>
            <p>
              A client gathers everything you are doing for one customer: the projects tagged with them, what those
              are worth, and every card on them. Tag a card or a project from its own panel — a client here is the
              view of that work, not a second place to file it.
            </p>
          </div>
        ) : (
          <>
            <header className="split-detail-head">
              <input
                type="color"
                className="cat-colour"
                value={active.colour}
                aria-label={`Colour for ${active.name}`}
                onChange={(event) => onPatch(active.id, { colour: event.target.value })}
              />
              <input
                className="drawer-title"
                value={active.name}
                maxLength={CLIENT_NAME_MAX}
                placeholder="Client name"
                onChange={(event) => onPatch(active.id, { name: event.target.value.slice(0, CLIENT_NAME_MAX) })}
                onBlur={(event) => {
                  // An unnamed chip on a card would be a coloured blank.
                  if (!event.target.value.trim()) onPatch(active.id, { name: active.name || 'Client' });
                }}
              />
              <div className="drawer-head-actions">
                <button
                  type="button"
                  className="ghost danger"
                  onClick={() => {
                    const tagged = sums.projects + sums.cards;
                    const warning = tagged > 0 ? ` The tag comes off ${sums.cards} card${sums.cards === 1 ? '' : 's'} and ${sums.projects} project${sums.projects === 1 ? '' : 's'}; the work itself stays.` : '';
                    if (window.confirm(`Remove the client “${active.name}”?${warning}`)) {
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
              <ul className="totals">
                <li>
                  <span className="totals-label">Value</span>
                  <span className="totals-value">{formatMoney(sums.value)}</span>
                </li>
                <li>
                  <span className="totals-label">Projects</span>
                  <span className="totals-value">{sums.projects}</span>
                </li>
                <li>
                  <span className="totals-label">Cards</span>
                  <span className="totals-value">
                    {sums.cards}
                    {sums.done > 0 && <small> · {sums.done} done</small>}
                  </span>
                </li>
                <li>
                  <span className="totals-label">Still to do</span>
                  <span className="totals-value">{formatEstimate(sums.planned) || '—'}</span>
                </li>
                <li>
                  <span className="totals-label">Logged</span>
                  <span className="totals-value is-done">{formatEstimate(sums.logged) || '—'}</span>
                </li>
              </ul>

              <div className="field">
                <span className="field-label">Projects · {projects.length}</span>
                <ul className="split-cards">
                  {projects.length === 0 && <li className="split-empty">No projects tagged with this client.</li>}
                  {projects.map((project) => (
                    <li key={project.id} className={`split-card c-${project.colour}`}>
                      <button type="button" className="split-card-open" onClick={() => onOpenProject(project.id)}>
                        <span className="split-card-title">{project.title || 'Untitled project'}</span>
                        {project.archived && <span className="pill">Archived</span>}
                        <span className="split-card-est">{formatMoney(project.value)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="field">
                <span className="field-label">
                  Cards · {cards.length}
                  {sums.done > 0 ? ` · ${sums.done} done` : ''}
                </span>
                <p className="field-note">
                  Cards tagged with this client, and every card on their projects.
                </p>
                <ul className="split-cards">
                  {cards.length === 0 && <li className="split-empty">Nothing on the board for this client yet.</li>}
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
                        title={lane === BACKLOG ? 'In the backlog' : 'The day this card sits on'}
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
