import {
  BACKLOG,
  CATEGORY_IDS,
  CLIENT_NAME_MAX,
  CLIENT_PALETTE,
  DEFAULT_CATEGORIES,
  LABEL_MAX,
  defaultCategories,
  type BoardState,
  type Card,
  type Categories,
  type Category,
  type CategoryId,
  type Client,
  type LaneId,
  type Project,
  type Status,
} from './types';
import { isHexColour } from './colour';
import { addDays, todayKey } from './dates';

const STORAGE_KEY = 'tcard-planner.board.v1';
const VERSION = 2;

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function emptyBoard(): BoardState {
  return {
    version: VERSION,
    cards: {},
    lanes: {},
    categories: defaultCategories(),
    projects: {},
    clients: {},
    clientOrder: [],
  };
}

export function newCard(title: string, patch: Partial<Card> = {}): Card {
  const now = new Date().toISOString();
  return {
    id: uid(),
    title,
    description: '',
    colour: 'slate',
    status: 'todo',
    estimate: 0,
    start: null,
    projectId: null,
    clients: [],
    publish: false,
    eventId: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

export function newProject(title: string, patch: Partial<Project> = {}): Project {
  const now = new Date().toISOString();
  return {
    id: uid(),
    title,
    description: '',
    value: 0,
    clients: [],
    colour: 'blue',
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

export function newClient(name: string, colour: string): Client {
  return { id: uid(), name, colour };
}

export type Action =
  | { type: 'add'; lane: LaneId; card: Card; index?: number }
  | { type: 'update'; id: string; patch: Partial<Card> }
  | { type: 'delete'; id: string }
  | { type: 'duplicate'; id: string }
  | { type: 'move'; id: string; lane: LaneId; index?: number }
  | { type: 'rollOver'; from: LaneId[]; to: LaneId }
  | { type: 'category'; id: CategoryId; patch: Partial<Category> }
  | { type: 'resetCategories' }
  | { type: 'addProject'; project: Project }
  | { type: 'updateProject'; id: string; patch: Partial<Project> }
  | { type: 'deleteProject'; id: string }
  | { type: 'addClient'; client: Client }
  | { type: 'updateClient'; id: string; patch: Partial<Client> }
  | { type: 'deleteClient'; id: string }
  | { type: 'replace'; state: BoardState };

export function laneOf(state: BoardState, cardId: string): LaneId | undefined {
  for (const [lane, ids] of Object.entries(state.lanes)) {
    if (ids.includes(cardId)) return lane;
  }
  return undefined;
}

export function cardsIn(state: BoardState, lane: LaneId): Card[] {
  return (state.lanes[lane] ?? []).map((id) => state.cards[id]).filter(Boolean);
}

/** Every card on this project, newest day first, so a project reads as a plan
 *  rather than as whatever order the cards happen to sit in on the board. */
export function cardsOfProject(state: BoardState, projectId: string): { card: Card; lane: LaneId }[] {
  const found: { card: Card; lane: LaneId }[] = [];
  for (const [lane, ids] of Object.entries(state.lanes)) {
    for (const id of ids) {
      const card = state.cards[id];
      if (card?.projectId === projectId) found.push({ card, lane });
    }
  }
  return found.sort((a, b) => {
    // The backlog sits after the scheduled days rather than before "b…".
    const key = (lane: LaneId) => (lane === BACKLOG ? '￿' : lane);
    return key(a.lane) < key(b.lane) ? -1 : key(a.lane) > key(b.lane) ? 1 : 0;
  });
}

/** Drops a card into a lane at an index, removing it from wherever it was. */
function place(lanes: BoardState['lanes'], id: string, lane: LaneId, index?: number): BoardState['lanes'] {
  const next: BoardState['lanes'] = {};
  for (const [key, ids] of Object.entries(lanes)) {
    const filtered = ids.filter((x) => x !== id);
    // Drop day lanes that have emptied out; keep the backlog so it stays addressable.
    if (filtered.length > 0 || key === BACKLOG || key === lane) next[key] = filtered;
  }
  const target = [...(next[lane] ?? [])];
  const at = index == null || index < 0 || index > target.length ? target.length : index;
  target.splice(at, 0, id);
  next[lane] = target;
  return next;
}

/** Where a card lands when it is dropped into a lane by hand: above the done
 *  pile, because finished cards have sunk to the bottom and a card being moved
 *  onto a day is, by definition, not finished. */
function firstDoneIndex(state: BoardState, lane: LaneId): number {
  const ids = state.lanes[lane] ?? [];
  const at = ids.findIndex((id) => state.cards[id]?.status === 'done');
  return at === -1 ? ids.length : at;
}

/** Do two boards lay their cards out identically? Empty lanes are invisible, so
 *  they don't count — this is what makes a drag that ends where it started a
 *  no-op rather than an undo entry that appears to do nothing. */
export function sameArrangement(a: BoardState, b: BoardState): boolean {
  if (a === b) return true;
  const filled = (state: BoardState) =>
    Object.entries(state.lanes)
      .filter(([, ids]) => ids.length > 0)
      .sort(([x], [y]) => (x < y ? -1 : 1));
  const left = filled(a);
  const right = filled(b);
  if (left.length !== right.length) return false;
  return left.every(
    ([lane, ids], i) =>
      right[i][0] === lane && right[i][1].length === ids.length && ids.every((id, j) => right[i][1][j] === id),
  );
}

export function reducer(state: BoardState, action: Action): BoardState {
  switch (action.type) {
    case 'add': {
      const cards = { ...state.cards, [action.card.id]: action.card };
      const index = action.index ?? firstDoneIndex(state, action.lane);
      return { ...state, cards, lanes: place(state.lanes, action.card.id, action.lane, index) };
    }

    case 'update': {
      const existing = state.cards[action.id];
      if (!existing) return state;
      const updated: Card = { ...existing, ...action.patch, updatedAt: new Date().toISOString() };

      // Finishing a card stamps it and sinks it; un-finishing clears the stamp
      // but leaves it where it is, so an accidental tick doesn't reshuffle a day.
      let lanes = state.lanes;
      if (action.patch.status && action.patch.status !== existing.status) {
        if (updated.status === 'done') {
          updated.completedAt = new Date().toISOString();
          const lane = laneOf(state, action.id);
          if (lane) lanes = place(lanes, action.id, lane);
        } else {
          updated.completedAt = null;
        }
      }

      return { ...state, cards: { ...state.cards, [action.id]: updated }, lanes };
    }

    case 'delete': {
      const cards = { ...state.cards };
      delete cards[action.id];
      const lanes: BoardState['lanes'] = {};
      for (const [key, ids] of Object.entries(state.lanes)) {
        const filtered = ids.filter((x) => x !== action.id);
        if (filtered.length > 0 || key === BACKLOG) lanes[key] = filtered;
      }
      return { ...state, cards, lanes };
    }

    case 'duplicate': {
      const source = state.cards[action.id];
      if (!source) return state;
      const lane = laneOf(state, action.id) ?? BACKLOG;
      const copy = newCard(`${source.title} (copy)`, {
        description: source.description,
        colour: source.colour,
        status: source.status,
        estimate: source.estimate,
        start: source.start,
        projectId: source.projectId,
        clients: [...source.clients],
        // The copy is its own card: it gets its own calendar entry, or none.
        publish: false,
        eventId: null,
      });
      const index = (state.lanes[lane] ?? []).indexOf(action.id) + 1;
      return {
        ...state,
        cards: { ...state.cards, [copy.id]: copy },
        lanes: place(state.lanes, copy.id, lane, index),
      };
    }

    case 'move': {
      const card = state.cards[action.id];
      if (!card) return state;
      const index = action.index ?? (card.status === 'done' ? undefined : firstDoneIndex(state, action.lane));
      const next = { ...state, lanes: place(state.lanes, action.id, action.lane, index) };
      return sameArrangement(state, next) ? state : next;
    }

    case 'rollOver': {
      // Carry everything unfinished from the given lanes to the target lane,
      // appending in the order it was originally planned.
      let lanes = state.lanes;
      const moving = action.from
        .filter((lane) => lane !== action.to)
        .flatMap((lane) => (lanes[lane] ?? []).filter((id) => state.cards[id]?.status !== 'done'));
      for (const id of moving) lanes = place(lanes, id, action.to, firstDoneIndex({ ...state, lanes }, action.to));
      return moving.length > 0 ? { ...state, lanes } : state;
    }

    case 'category': {
      const current = state.categories[action.id];
      if (!current) return state;
      return {
        ...state,
        categories: { ...state.categories, [action.id]: { ...current, ...action.patch } },
      };
    }

    case 'resetCategories':
      return { ...state, categories: defaultCategories() };

    case 'addProject':
      return { ...state, projects: { ...state.projects, [action.project.id]: action.project } };

    case 'updateProject': {
      const current = state.projects[action.id];
      if (!current) return state;
      const updated: Project = { ...current, ...action.patch, updatedAt: new Date().toISOString() };
      return { ...state, projects: { ...state.projects, [action.id]: updated } };
    }

    case 'deleteProject': {
      const projects = { ...state.projects };
      delete projects[action.id];
      // The cards outlive the project; they simply stop belonging to one.
      const cards: Record<string, Card> = {};
      for (const [id, card] of Object.entries(state.cards)) {
        cards[id] = card.projectId === action.id ? { ...card, projectId: null } : card;
      }
      return { ...state, projects, cards };
    }

    case 'addClient':
      return {
        ...state,
        clients: { ...state.clients, [action.client.id]: action.client },
        clientOrder: [...state.clientOrder, action.client.id],
      };

    case 'updateClient': {
      const current = state.clients[action.id];
      if (!current) return state;
      return { ...state, clients: { ...state.clients, [action.id]: { ...current, ...action.patch } } };
    }

    case 'deleteClient': {
      const clients = { ...state.clients };
      delete clients[action.id];
      const drop = (ids: string[]) => (ids.includes(action.id) ? ids.filter((x) => x !== action.id) : ids);
      const cards: Record<string, Card> = {};
      for (const [id, card] of Object.entries(state.cards)) {
        const kept = drop(card.clients);
        cards[id] = kept === card.clients ? card : { ...card, clients: kept };
      }
      const projects: Record<string, Project> = {};
      for (const [id, project] of Object.entries(state.projects)) {
        const kept = drop(project.clients);
        projects[id] = kept === project.clients ? project : { ...project, clients: kept };
      }
      return { ...state, clients, clientOrder: state.clientOrder.filter((x) => x !== action.id), cards, projects };
    }

    case 'replace':
      return action.state;

    default:
      return state;
  }
}

/* ---------- persistence ---------- */

function isCard(value: unknown): value is Card {
  const c = value as Card;
  return !!c && typeof c.id === 'string' && typeof c.title === 'string';
}

/** Categories are eight fixed slots, so a board written by an older version —
 *  or edited by hand — is filled in from the defaults rather than rejected. */
function normaliseCategories(input: unknown): Categories {
  const raw = (input ?? {}) as Partial<Record<CategoryId, Partial<Category>>>;
  const categories = {} as Categories;
  for (const id of CATEGORY_IDS) {
    const value = typeof raw[id] === 'object' && raw[id] ? raw[id] : {};
    const label = typeof value.label === 'string' ? value.label.trim().slice(0, LABEL_MAX) : '';
    categories[id] = {
      label: label || DEFAULT_CATEGORIES[id].label,
      colour: isHexColour(value.colour) ? value.colour.toLowerCase() : DEFAULT_CATEGORIES[id].colour,
    };
  }
  return categories;
}

function normaliseClients(input: unknown, order: unknown): Pick<BoardState, 'clients' | 'clientOrder'> {
  const raw = (input ?? {}) as Record<string, Partial<Client>>;
  const clients: Record<string, Client> = {};
  let i = 0;
  for (const [id, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    const name = typeof value.name === 'string' ? value.name.trim().slice(0, CLIENT_NAME_MAX) : '';
    if (!name) continue;
    clients[id] = {
      id,
      name,
      colour: isHexColour(value.colour) ? value.colour.toLowerCase() : CLIENT_PALETTE[i % CLIENT_PALETTE.length],
    };
    i++;
  }
  const listed = Array.isArray(order) ? (order as unknown[]).filter((id): id is string => typeof id === 'string' && !!clients[id]) : [];
  const seen = new Set(listed);
  return { clients, clientOrder: [...listed, ...Object.keys(clients).filter((id) => !seen.has(id))] };
}

function normaliseProjects(input: unknown, clients: Record<string, Client>): Record<string, Project> {
  const raw = (input ?? {}) as Record<string, Partial<Project>>;
  const projects: Record<string, Project> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object' || typeof value.title !== 'string') continue;
    const now = new Date().toISOString();
    projects[id] = {
      id,
      title: value.title,
      description: typeof value.description === 'string' ? value.description : '',
      value: Number.isFinite(value.value) ? Math.max(0, Number(value.value)) : 0,
      clients: Array.isArray(value.clients) ? value.clients.filter((c): c is string => typeof c === 'string' && !!clients[c]) : [],
      colour: CATEGORY_IDS.includes(value.colour as CategoryId) ? (value.colour as CategoryId) : 'blue',
      archived: value.archived === true,
      createdAt: value.createdAt ?? now,
      updatedAt: value.updatedAt ?? now,
    };
  }
  return projects;
}

/** Minutes from midnight, or null. Anything outside a day is "unplaced" rather
 *  than clamped, so a bad value doesn't quietly become 00:00. */
function normaliseStart(value: unknown): number | null {
  if (!Number.isFinite(value)) return null;
  const minutes = Math.round(Number(value));
  return minutes >= 0 && minutes < 24 * 60 ? minutes : null;
}

/** Tolerant of hand-edited or partial files — anything unrecognised is dropped
 *  rather than throwing away the whole board. Boards written before projects
 *  and clients existed simply arrive without them. */
export function normalise(input: unknown): BoardState {
  const raw = input as Partial<BoardState> | null;
  if (!raw || typeof raw !== 'object') return emptyBoard();

  const { clients, clientOrder } = normaliseClients(raw.clients, raw.clientOrder);
  const projects = normaliseProjects(raw.projects, clients);

  const cards: Record<string, Card> = {};
  for (const [id, value] of Object.entries(raw.cards ?? {})) {
    if (!isCard(value)) continue;
    cards[id] = {
      ...value,
      description: typeof value.description === 'string' ? value.description : '',
      colour: CATEGORY_IDS.includes(value.colour as CategoryId) ? (value.colour as CategoryId) : 'slate',
      status: (value.status ?? 'todo') as Status,
      estimate: Number.isFinite(value.estimate) ? Number(value.estimate) : 0,
      start: normaliseStart(value.start),
      projectId: typeof value.projectId === 'string' && projects[value.projectId] ? value.projectId : null,
      clients: Array.isArray(value.clients) ? value.clients.filter((c): c is string => typeof c === 'string' && !!clients[c]) : [],
      publish: value.publish === true,
      eventId: typeof value.eventId === 'string' ? value.eventId : null,
      completedAt: typeof value.completedAt === 'string' ? value.completedAt : null,
      createdAt: value.createdAt ?? new Date().toISOString(),
      updatedAt: value.updatedAt ?? new Date().toISOString(),
    };
  }

  const lanes: Record<LaneId, string[]> = {};
  const seen = new Set<string>();
  for (const [lane, ids] of Object.entries(raw.lanes ?? {})) {
    if (!Array.isArray(ids)) continue;
    const kept = ids.filter((id) => typeof id === 'string' && cards[id] && !seen.has(id));
    kept.forEach((id) => seen.add(id));
    // Finished cards sink here too, not only when they are ticked: a board
    // arriving from an older version, another device, or a hand-edited export
    // has to hold the same invariant, because the "Done" divider on a column
    // is drawn where the done pile begins rather than searched for.
    const sunk = [
      ...kept.filter((id) => cards[id].status !== 'done'),
      ...kept.filter((id) => cards[id].status === 'done'),
    ];
    if (sunk.length > 0 || lane === BACKLOG) lanes[lane] = sunk;
  }
  // Any card that lost its lane lands in the backlog rather than vanishing.
  const orphans = Object.keys(cards).filter((id) => !seen.has(id));
  if (orphans.length > 0) lanes[BACKLOG] = [...(lanes[BACKLOG] ?? []), ...orphans];

  return {
    version: VERSION,
    cards,
    lanes,
    categories: normaliseCategories(raw.categories),
    projects,
    clients,
    clientOrder,
  };
}

export function load(): BoardState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedBoard();
    return normalise(JSON.parse(raw));
  } catch {
    return emptyBoard();
  }
}

export function save(state: BoardState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota or private-mode failures shouldn't take the board down.
  }
}

export const SEED_PREFIX = 'seed-';

/** Has this board only ever held the demo cards? Connecting such a device to a
 *  server that already has a board can safely take the server's copy; a board
 *  with real work on it has to ask first. */
export function isUntouched(state: BoardState): boolean {
  const ids = Object.keys(state.cards);
  return ids.length === 0 || ids.every((id) => id.startsWith(SEED_PREFIX));
}

/** A first run with an empty board looks broken, so show how the pieces fit. */
function seedBoard(): BoardState {
  const today = todayKey();
  const client: Client = { id: `${SEED_PREFIX}client`, name: 'Acme Ltd', colour: CLIENT_PALETTE[0] };
  const project = newProject('Acme website refresh', {
    id: `${SEED_PREFIX}project`,
    value: 4500,
    clients: [client.id],
    colour: 'blue',
    description: '<p>Projects group cards, carry a value, and can be tagged with the clients they are for.</p>',
  });

  const cards = [
    newCard('Welcome — click a card to open it', {
      id: `${SEED_PREFIX}welcome`,
      colour: 'blue',
      estimate: 0.5,
      start: 9 * 60,
      projectId: project.id,
      clients: [client.id],
      description:
        '<p>This is a <strong>T-card</strong>. The coloured strip is its category, the body is yours.</p>' +
        '<ul><li>Drag cards between days, or up and down within a day</li>' +
        '<li>Press <code>N</code> for a new card, <code>/</code> to search</li></ul>',
    }),
    newCard('Try dragging me to tomorrow', {
      id: `${SEED_PREFIX}drag`,
      colour: 'green',
      status: 'doing',
      estimate: 1,
      start: 10 * 60,
    }),
    newCard('Anything unscheduled lives in the backlog', {
      id: `${SEED_PREFIX}backlog`,
      colour: 'amber',
      estimate: 2,
    }),
  ];
  return {
    version: VERSION,
    categories: defaultCategories(),
    projects: { [project.id]: project },
    clients: { [client.id]: client },
    clientOrder: [client.id],
    cards: Object.fromEntries(cards.map((c) => [c.id, c])),
    lanes: {
      [today]: [cards[0].id, cards[1].id],
      [addDays(today, 1)]: [],
      [BACKLOG]: [cards[2].id],
    },
  };
}
