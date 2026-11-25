/**
 * Converts between the in-memory board (one BoardState, as the views use it)
 * and the Supabase tables (rows, one per card, project, client…).
 *
 * The app keeps working on a whole BoardState exactly as before. What changes
 * is how it is saved: instead of sending the whole board, the sync works out
 * which rows changed since the last save and writes only those.
 *
 * Pure functions with type-only imports, so they can be tested with plain
 * `node --test` (see boardRows.test.ts).
 */
import type {
  Attachment,
  BoardState,
  Card,
  CardUpdate,
  Client,
  Expense,
  Project,
  ProjectMilestone,
} from '../types';

export type Row = Record<string, unknown>;

/** Tables in the order they are written: parents before children. Deletes
 *  run in the reverse order. */
export const TABLES = [
  'clients',
  'categories',
  'update_categories',
  'projects',
  'project_milestones',
  'expenses',
  'cards',
  'card_tags',
  'card_updates',
  'attachments',
  'orphaned_events',
] as const;
export type Table = (typeof TABLES)[number];

export type Rows = Record<Table, Map<string, Row>>;

const BACKLOG = 'backlog';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function emptyRows(): Rows {
  return Object.fromEntries(TABLES.map((t) => [t, new Map<string, Row>()])) as Rows;
}

/** The key a row is stored under in a Rows map: its primary key. */
export function rowKey(table: Table, row: Row): string {
  if (table === 'card_tags') return `${row.card_id}:${row.client_id}`;
  if (table === 'orphaned_events') return String(row.event_id);
  return String(row.id);
}

/** Groups rows fetched from Supabase into a Rows map. */
export function indexRows(fetched: Partial<Record<Table, Row[]>>): Rows {
  const rows = emptyRows();
  for (const table of TABLES) {
    for (const row of fetched[table] ?? []) rows[table].set(rowKey(table, row), row);
  }
  return rows;
}

const safeName = (name: string) => name.replace(/[/\\]/g, '_').slice(0, 120) || 'file';

/* ---------- rows -> board ---------- */

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
const strOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null);
const byOrder = (a: Row, b: Row) => num(a.sort_order) - num(b.sort_order);

function attachmentOf(row: Row): Attachment {
  return {
    id: String(row.id),
    name: String(row.name ?? 'file'),
    type: String(row.mime_type ?? 'application/octet-stream'),
    size: num(row.size),
    createdAt: String(row.created_at ?? ''),
  };
}

/** Builds a BoardState from the tables. Pass the result through the store's
 *  normalise() to fill in anything the tables don't hold. */
export function rowsToBoard(rows: Rows): BoardState {
  const all = (t: Table) => [...rows[t].values()];

  const clients: Record<string, Client> = {};
  const clientRows = all('clients').sort(byOrder);
  for (const r of clientRows) {
    clients[String(r.id)] = { id: String(r.id), name: String(r.name ?? ''), colour: String(r.colour ?? '#64748b') };
  }

  const categoryRows = all('categories').sort(byOrder);
  const updateCategoryRows = all('update_categories').sort(byOrder);

  const attachmentsByCard = new Map<string, Attachment[]>();
  const attachmentsByProject = new Map<string, Attachment[]>();
  for (const r of all('attachments').sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    const target = r.card_id ? attachmentsByCard : attachmentsByProject;
    const key = String(r.card_id ?? r.project_id);
    target.set(key, [...(target.get(key) ?? []), attachmentOf(r)]);
  }

  const milestonesByProject = new Map<string, ProjectMilestone[]>();
  for (const r of all('project_milestones').sort(byOrder)) {
    const key = String(r.project_id);
    milestonesByProject.set(key, [
      ...(milestonesByProject.get(key) ?? []),
      {
        id: String(r.id),
        label: String(r.label ?? ''),
        amount: num(r.amount),
        invoiceMonth: strOrNull(r.invoice_month),
        status: (r.status as ProjectMilestone['status']) ?? 'todo',
      },
    ]);
  }
  const expensesByProject = new Map<string, Expense[]>();
  for (const r of all('expenses').sort(byOrder)) {
    const key = String(r.project_id);
    expensesByProject.set(key, [
      ...(expensesByProject.get(key) ?? []),
      { id: String(r.id), label: String(r.label ?? ''), amount: num(r.amount), chargeable: Boolean(r.chargeable) },
    ]);
  }

  const projects: Record<string, Project> = {};
  for (const r of all('projects')) {
    const id = String(r.id);
    projects[id] = {
      id,
      title: String(r.title ?? ''),
      description: String(r.description ?? ''),
      value: num(r.value),
      budgetHours: num(r.budget_hours),
      stage: (r.stage as Project['stage']) ?? 'enquiry',
      clientId: strOrNull(r.client_id),
      invoiceMonth: strOrNull(r.invoice_month),
      milestones: milestonesByProject.get(id) ?? [],
      colour: String(r.category_id ?? 'slate'),
      expenses: expensesByProject.get(id) ?? [],
      attachments: attachmentsByProject.get(id) ?? [],
      archived: Boolean(r.archived),
      createdAt: String(r.created_at ?? ''),
      updatedAt: String(r.updated_at ?? ''),
    };
  }

  const tagsByCard = new Map<string, string[]>();
  for (const r of all('card_tags')) {
    const key = String(r.card_id);
    tagsByCard.set(key, [...(tagsByCard.get(key) ?? []), String(r.client_id)]);
  }
  const updatesByCard = new Map<string, CardUpdate[]>();
  for (const r of all('card_updates').sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    const key = String(r.card_id);
    updatesByCard.set(key, [
      ...(updatesByCard.get(key) ?? []),
      {
        id: String(r.id),
        categoryId: String(r.category_id ?? ''),
        minutes: num(r.minutes),
        note: String(r.note ?? ''),
        date: String(r.date ?? ''),
        createdAt: String(r.created_at ?? ''),
      },
    ]);
  }

  const cards: Record<string, Card> = {};
  const lanes: Record<string, string[]> = { [BACKLOG]: [] };
  const cardRows = all('cards').sort((a, b) => num(a.position) - num(b.position) || String(a.id).localeCompare(String(b.id)));
  for (const r of cardRows) {
    const id = String(r.id);
    const owner = strOrNull(r.client_id);
    const tags = (tagsByCard.get(id) ?? []).filter((t) => t !== owner).sort();
    cards[id] = {
      id,
      title: String(r.title ?? ''),
      description: String(r.description ?? ''),
      colour: String(r.category_id ?? 'slate'),
      status: (r.status as Card['status']) ?? 'todo',
      estimate: num(r.estimate),
      start: r.start_minute === null || r.start_minute === undefined ? null : num(r.start_minute),
      dueDate: strOrNull(r.due_date),
      assigneeId: strOrNull(r.assignee_id),
      projectId: strOrNull(r.project_id),
      clients: owner ? [owner, ...tags] : tags,
      publish: Boolean(r.publish),
      eventId: strOrNull(r.event_id),
      completedAt: strOrNull(r.completed_at),
      updates: updatesByCard.get(id) ?? [],
      attachments: attachmentsByCard.get(id) ?? [],
      createdAt: String(r.created_at ?? ''),
      updatedAt: String(r.updated_at ?? ''),
    };
    const lane = typeof r.lane === 'string' && (r.lane === BACKLOG || DAY.test(r.lane)) ? r.lane : BACKLOG;
    (lanes[lane] ??= []).push(id);
  }

  return {
    version: 1,
    cards,
    lanes,
    categories: Object.fromEntries(
      categoryRows.map((r) => [String(r.id), { label: String(r.label ?? ''), colour: String(r.colour) }]),
    ),
    categoryOrder: categoryRows.map((r) => String(r.id)),
    updateCategories: Object.fromEntries(
      updateCategoryRows.map((r) => [String(r.id), { label: String(r.label ?? ''), colour: String(r.colour) }]),
    ),
    updateCategoryOrder: updateCategoryRows.map((r) => String(r.id)),
    projects,
    clients,
    clientOrder: clientRows.map((r) => String(r.id)),
    orphanedEvents: all('orphaned_events').map((r) => String(r.event_id)),
  } as BoardState;
}

/* ---------- board -> rows ---------- */

/**
 * The rows a board should be stored as. `previous` is what the database held
 * at the last load or save: columns the board doesn't know about (a card's
 * client sharing, an attachment's storage path) are carried over from it, so
 * saving from the board never resets them.
 */
export function boardToRows(board: BoardState, previous: Rows = emptyRows()): Rows {
  const rows = emptyRows();
  const put = (table: Table, fields: Row) => {
    const key = rowKey(table, fields);
    rows[table].set(key, { ...(previous[table].get(key) ?? {}), ...fields });
  };
  const clientExists = (id: unknown) => typeof id === 'string' && Object.hasOwn(board.clients, id);

  const clientOrder = board.clientOrder.filter(clientExists);
  for (const id of Object.keys(board.clients)) if (!clientOrder.includes(id)) clientOrder.push(id);
  clientOrder.forEach((id, i) => {
    const c = board.clients[id];
    put('clients', { id, name: c.name, colour: c.colour, sort_order: i });
  });

  const order = (ids: string[], map: Record<string, unknown>) => {
    const out = ids.filter((id) => Object.hasOwn(map, id));
    for (const id of Object.keys(map)) if (!out.includes(id)) out.push(id);
    return out;
  };
  order(board.categoryOrder, board.categories).forEach((id, i) => {
    const c = board.categories[id];
    put('categories', { id, label: c.label, colour: c.colour, sort_order: i });
  });
  order(board.updateCategoryOrder, board.updateCategories).forEach((id, i) => {
    const c = board.updateCategories[id];
    put('update_categories', { id, label: c.label, colour: c.colour, sort_order: i });
  });

  const attachment = (a: Attachment, parent: { card_id: string | null; project_id: string | null }, owner: string | null) => {
    const prev = previous.attachments.get(a.id);
    put('attachments', {
      id: a.id,
      ...parent,
      name: a.name,
      mime_type: a.type,
      size: a.size,
      storage_path: (prev?.storage_path as string) ?? `${owner ?? 'internal'}/${a.id}/${safeName(a.name)}`,
      client_visible: (prev?.client_visible as boolean) ?? false,
      ...(a.createdAt ? { created_at: a.createdAt } : {}),
    });
  };

  for (const p of Object.values(board.projects)) {
    const clientId = clientExists(p.clientId) ? p.clientId : null;
    put('projects', {
      id: p.id,
      title: p.title,
      description: p.description,
      value: p.value,
      budget_hours: p.budgetHours,
      stage: p.stage,
      client_id: clientId,
      invoice_month: p.invoiceMonth,
      category_id: p.colour,
      archived: p.archived,
    });
    (p.milestones ?? []).forEach((m, i) =>
      put('project_milestones', {
        id: m.id,
        project_id: p.id,
        label: m.label,
        amount: m.amount,
        invoice_month: m.invoiceMonth,
        status: m.status,
        sort_order: i,
      }),
    );
    (p.expenses ?? []).forEach((e, i) =>
      put('expenses', { id: e.id, project_id: p.id, label: e.label, amount: e.amount, chargeable: e.chargeable, sort_order: i }),
    );
    for (const a of p.attachments ?? []) attachment(a, { card_id: null, project_id: p.id }, clientId);
  }

  const placement = new Map<string, { lane: string; position: number }>();
  for (const [lane, ids] of Object.entries(board.lanes)) {
    if (lane !== BACKLOG && !DAY.test(lane)) continue;
    ids.forEach((id, i) => {
      if (!placement.has(id)) placement.set(id, { lane, position: i });
    });
  }

  let stray = 0;
  for (const c of Object.values(board.cards)) {
    const tags = (c.clients ?? []).filter(clientExists);
    const projectClient = c.projectId ? board.projects[c.projectId]?.clientId : null;
    const owner = tags[0] ?? (clientExists(projectClient) ? (projectClient as string) : null);
    const place = placement.get(c.id) ?? { lane: BACKLOG, position: (board.lanes[BACKLOG]?.length ?? 0) + stray++ };
    const prev = previous.cards.get(c.id);
    put('cards', {
      id: c.id,
      title: c.title,
      description: c.description ?? "",
      category_id: c.colour,
      status: c.status,
      estimate: c.estimate ?? 0,
      start_minute: c.start ?? null,
      due_date: c.dueDate ?? null,
      lane: place.lane,
      position: place.position,
      project_id: c.projectId && board.projects[c.projectId] ? c.projectId : null,
      client_id: owner,
      // Sharing survives a change of owner only while there is an owner.
      client_visible: owner ? ((prev?.client_visible as boolean) ?? false) : false,
      assignee_id: c.assigneeId && UUID.test(c.assigneeId) ? c.assigneeId : null,
      publish: Boolean(c.publish),
      event_id: c.eventId ?? null,
      completed_at: c.completedAt ?? null,
    });
    for (const tag of tags) if (tag !== owner) put('card_tags', { card_id: c.id, client_id: tag });
    for (const u of c.updates ?? []) {
      put('card_updates', {
        id: u.id,
        card_id: c.id,
        category_id: u.categoryId || null,
        minutes: Math.max(0, Math.round(u.minutes)),
        note: u.note,
        date: DAY.test(u.date) ? u.date : (u.createdAt || '').slice(0, 10) || null,
        ...(u.createdAt ? { created_at: u.createdAt } : {}),
      });
    }
    for (const a of c.attachments ?? []) attachment(a, { card_id: c.id, project_id: null }, owner);
  }

  for (const eventId of board.orphanedEvents) put('orphaned_events', { event_id: eventId });

  return rows;
}

/* ---------- what to write ---------- */

export interface RowChanges {
  upserts: { table: Table; rows: Row[] }[];
  deletes: { table: Table; keys: string[] }[];
}

const same = (a: Row, b: Row) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) return false;
  }
  return true;
};

/** The writes that turn `before` into `after`, in a safe order. */
export function diffRows(before: Rows, after: Rows): RowChanges {
  const upserts: RowChanges['upserts'] = [];
  const deletes: RowChanges['deletes'] = [];
  for (const table of TABLES) {
    const changed: Row[] = [];
    for (const [key, row] of after[table]) {
      const old = before[table].get(key);
      if (!old || !same(old, row)) changed.push(row);
    }
    if (changed.length) upserts.push({ table, rows: changed });
  }
  for (const table of [...TABLES].reverse()) {
    const gone = [...before[table].keys()].filter((key) => !after[table].has(key));
    if (gone.length) deletes.push({ table, keys: gone });
  }
  return { upserts, deletes };
}

export const isEmptyChange = (c: RowChanges) => c.upserts.length === 0 && c.deletes.length === 0;
