import { BACKLOG, type BoardState, type Card, type Colour, type LaneId, type Status } from './types';
import { addDays, todayKey } from './dates';

const STORAGE_KEY = 'tcard-planner.board.v1';
const VERSION = 1;

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function emptyBoard(): BoardState {
  return { version: VERSION, cards: {}, lanes: {} };
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
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

export type Action =
  | { type: 'add'; lane: LaneId; card: Card; index?: number }
  | { type: 'update'; id: string; patch: Partial<Card> }
  | { type: 'delete'; id: string }
  | { type: 'duplicate'; id: string }
  | { type: 'move'; id: string; lane: LaneId; index?: number }
  | { type: 'rollOver'; from: LaneId[]; to: LaneId }
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
      return { ...state, cards, lanes: place(state.lanes, action.card.id, action.lane, action.index) };
    }

    case 'update': {
      const existing = state.cards[action.id];
      if (!existing) return state;
      const updated: Card = { ...existing, ...action.patch, updatedAt: new Date().toISOString() };
      return { ...state, cards: { ...state.cards, [action.id]: updated } };
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
      });
      const index = (state.lanes[lane] ?? []).indexOf(action.id) + 1;
      return {
        ...state,
        cards: { ...state.cards, [copy.id]: copy },
        lanes: place(state.lanes, copy.id, lane, index),
      };
    }

    case 'move': {
      if (!state.cards[action.id]) return state;
      const next = { ...state, lanes: place(state.lanes, action.id, action.lane, action.index) };
      return sameArrangement(state, next) ? state : next;
    }

    case 'rollOver': {
      // Carry everything unfinished from the given lanes to the target lane,
      // appending in the order it was originally planned.
      let lanes = state.lanes;
      const moving = action.from
        .filter((lane) => lane !== action.to)
        .flatMap((lane) => (lanes[lane] ?? []).filter((id) => state.cards[id]?.status !== 'done'));
      for (const id of moving) lanes = place(lanes, id, action.to);
      return moving.length > 0 ? { ...state, lanes } : state;
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

/** Tolerant of hand-edited or partial files — anything unrecognised is dropped
 *  rather than throwing away the whole board. */
export function normalise(input: unknown): BoardState {
  const raw = input as Partial<BoardState> | null;
  if (!raw || typeof raw !== 'object') return emptyBoard();

  const cards: Record<string, Card> = {};
  for (const [id, value] of Object.entries(raw.cards ?? {})) {
    if (!isCard(value)) continue;
    cards[id] = {
      ...value,
      description: typeof value.description === 'string' ? value.description : '',
      colour: (value.colour ?? 'slate') as Colour,
      status: (value.status ?? 'todo') as Status,
      estimate: Number.isFinite(value.estimate) ? Number(value.estimate) : 0,
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
    if (kept.length > 0 || lane === BACKLOG) lanes[lane] = kept;
  }
  // Any card that lost its lane lands in the backlog rather than vanishing.
  const orphans = Object.keys(cards).filter((id) => !seen.has(id));
  if (orphans.length > 0) lanes[BACKLOG] = [...(lanes[BACKLOG] ?? []), ...orphans];

  return { version: VERSION, cards, lanes };
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
  const cards = [
    newCard('Welcome — click a card to open it', {
      id: `${SEED_PREFIX}welcome`,
      colour: 'blue',
      estimate: 0.5,
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
    }),
    newCard('Anything unscheduled lives in the backlog', {
      id: `${SEED_PREFIX}backlog`,
      colour: 'amber',
      estimate: 2,
    }),
  ];
  return {
    version: VERSION,
    cards: Object.fromEntries(cards.map((c) => [c.id, c])),
    lanes: {
      [today]: [cards[0].id, cards[1].id],
      [addDays(today, 1)]: [],
      [BACKLOG]: [cards[2].id],
    },
  };
}
