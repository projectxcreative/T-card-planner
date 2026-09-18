export const STATUSES = ['todo', 'doing', 'blocked', 'done'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  todo: 'To do',
  doing: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
};

/** T-card boards run on colour coding — each colour is a category of work.
 *  You start with eight, and can add or remove your own from Settings — a
 *  card keeps the category id it was given, so a rename or a recolour
 *  reaches every card at once, and only removing the category itself moves
 *  a card off it. */
export type CategoryId = string;

export interface Category {
  label: string;
  /** `#rrggbb`. The light-theme strip; dark lifts it to a pastel of itself. */
  colour: string;
}

export type Categories = Record<string, Category>;

/** The built-in ids, in the order a fresh board lists them. Fixed, unlike a
 *  category you add yourself, so a board written before categories were
 *  addable still lines up with what "Reset all" puts back. */
export const DEFAULT_CATEGORY_ORDER = ['slate', 'blue', 'teal', 'green', 'amber', 'red', 'purple', 'pink'];

/** A board always keeps at least one — a card with no category at all would
 *  have nothing to draw its strip in. */
export const MIN_CATEGORIES = 1;

/** The eight defaults are lifted off the logo's own gradient — teal through
 *  blue and violet on one arm, lime through amber and red to magenta on the
 *  other — so a board full of colour still looks like it belongs to the mark
 *  in the corner. Any of them can be changed or removed in Settings. */
export const DEFAULT_CATEGORIES: Categories = {
  slate: { label: 'General', colour: '#64748b' },
  blue: { label: 'Client work', colour: '#2179c8' },
  teal: { label: 'Meetings', colour: '#0f8f8a' },
  green: { label: 'Admin', colour: '#6f9c22' },
  amber: { label: 'Waiting on', colour: '#c68512' },
  red: { label: 'Urgent', colour: '#d84630' },
  purple: { label: 'Deep work', colour: '#7b4a9e' },
  pink: { label: 'Personal', colour: '#b81f6a' },
};

/** Long enough for "Client work — retainers", short enough to fit the strip. */
export const LABEL_MAX = 28;

/** The colours a new category is offered, cycling once every hue is used —
 *  the same set a new client picks from, so the two lists don't clash if
 *  you're looking at them side by side. */
export const CATEGORY_PALETTE = [
  '#2179c8', '#0f8f8a', '#6f9c22', '#c68512',
  '#d84630', '#7b4a9e', '#b81f6a', '#64748b',
];

export function defaultCategories(): Categories {
  return Object.fromEntries(
    DEFAULT_CATEGORY_ORDER.map((id) => [id, { ...DEFAULT_CATEGORIES[id] }]),
  );
}

/** The label to show when someone has cleared the box, or a card is wearing
 *  a category that has since been removed. */
export function categoryLabel(categories: Categories, id: CategoryId): string {
  const category = categories[id];
  if (!category) return 'Category';
  return category.label.trim() || DEFAULT_CATEGORIES[id]?.label || 'Category';
}

/* ---------- clients ---------- */

/** A client is a tag with a name and a colour of its own. Unlike categories
 *  there is no fixed set of them: you add the ones you bill, and a card or a
 *  project can wear several at once. */
export interface Client {
  id: string;
  name: string;
  /** `#rrggbb`, used for the chip. */
  colour: string;
}

export const CLIENT_NAME_MAX = 40;

/** The colours a new client is offered, in order — enough that the first
 *  handful are distinguishable without anyone reaching for the picker. */
export const CLIENT_PALETTE = [
  '#2179c8', '#0f8f8a', '#6f9c22', '#c68512',
  '#d84630', '#7b4a9e', '#b81f6a', '#64748b',
];

/* ---------- projects ---------- */

/** Where a project sits, from the first email to the money landing. Ordered:
 *  the list reads top to bottom as the pipeline, so this array is the order. */
export const PROJECT_STAGES = [
  'enquiry',
  'quoted',
  'won',
  'active',
  'delivered',
  'invoiced',
  'paid',
  'lost',
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const STAGE_LABELS: Record<ProjectStage, string> = {
  enquiry: 'Enquiry',
  quoted: 'Quoted',
  won: 'Won',
  active: 'In progress',
  delivered: 'Delivered',
  invoiced: 'Invoiced',
  paid: 'Paid',
  lost: 'Closed lost',
};

/**
 * What a stage means for the money, which is not the same as where it sits in
 * the pipeline. Two stages can be miles apart in the process and count the same
 * way in a total — "won" and "delivered" are both work you are committed to and
 * have not billed for.
 */
export type StageGroup = 'prospect' | 'committed' | 'owed' | 'banked' | 'lost';

export const STAGE_GROUP: Record<ProjectStage, StageGroup> = {
  enquiry: 'prospect',
  quoted: 'prospect',
  won: 'committed',
  active: 'committed',
  delivered: 'committed',
  invoiced: 'owed',
  paid: 'banked',
  lost: 'lost',
};

export const STAGE_GROUP_LABELS: Record<StageGroup, string> = {
  prospect: 'Pipeline',
  committed: 'In hand',
  owed: 'Invoiced',
  banked: 'Paid',
  lost: 'Lost',
};

/** A lost project is worth nothing and shouldn't swell any total. */
export const isLost = (stage: ProjectStage) => stage === 'lost';

/** The stage at which a project stops being work and starts being money: it is
 *  finished, and the invoice is the next thing that has to happen to it. */
export const isBillable = (stage: ProjectStage) => stage === 'delivered';

/**
 * A project no new work is going to be planned against: it has been billed,
 * paid for, or lost. The card picker leaves these out — they only ever grow in
 * number, and a list that grows forever is a list you stop reading.
 *
 * "Delivered" is deliberately not one of them: the work is done but the
 * invoice hasn't gone out, and late amends still want somewhere to go.
 */
export const isClosedStage = (stage: ProjectStage) =>
  stage === 'invoiced' || stage === 'paid' || stage === 'lost';

/** How the billing view splits a month. Narrower than the money groups, which
 *  fold "delivered" in with work still under way — for billing, delivered is
 *  precisely the row you are looking for. */
export const BILLING_BUCKETS = ['todo', 'due', 'sent', 'paid'] as const;
export type BillingBucket = (typeof BILLING_BUCKETS)[number];

export const BILLING_LABELS: Record<BillingBucket, string> = {
  todo: 'Still working',
  due: 'To invoice',
  sent: 'Invoiced',
  paid: 'Paid',
};

export function billingBucket(stage: ProjectStage): BillingBucket | null {
  if (stage === 'delivered') return 'due';
  if (stage === 'invoiced') return 'sent';
  if (stage === 'paid') return 'paid';
  return isLost(stage) ? null : 'todo';
}

/** A cost against a project — a prop, a freelancer, travel — kept separate
 *  from its value so what it earns and what it costs stay two figures rather
 *  than one blurred one. */
export interface Expense {
  id: string;
  label: string;
  /** Pounds. */
  amount: number;
  /** Billed on to the client and recovered in full, rather than coming out of
   *  what the project earns. Defaults to false: an expense is a project cost
   *  unless it is marked otherwise. */
  chargeable: boolean;
}

export const EXPENSE_LABEL_MAX = 60;

/** A piece of billable work several cards belong to. The value is what the
 *  whole thing is worth, in whole pounds — enough to see what a week of cards
 *  is actually earning, without turning the planner into an invoicing tool. */
export interface Project {
  id: string;
  title: string;
  /** Rich text, stored as HTML from the editor. */
  description: string;
  /** Pounds. 0 means "not valued", which is different from "worth nothing". */
  value: number;
  /** Where it is in the pipeline. */
  stage: ProjectStage;
  /** The client it is for. One, not a list: a project belongs to whoever is
   *  paying for it, and two payers is a different kind of thing entirely. */
  clientId: string | null;
  /**
   * The month this is to be billed in, as `YYYY-MM`, or null until it is.
   *
   * Deliberately not derived from when the work finished. Something delivered
   * at the end of June often goes on July's invoice, and which month a job
   * lands in is a decision rather than a fact about the calendar — so it is set
   * when a project is first delivered and freely moved afterwards.
   */
  invoiceMonth: string | null;
  /** Cards created inside a project start with this category. */
  colour: CategoryId;
  /** Costs against the project's value — expenses, not time. */
  expenses: Expense[];
  /** Files on the project — a brief, a quote, the signed order. */
  attachments: Attachment[];
  /** Archived projects drop out of the pickers but keep their cards. */
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The expenses that come out of what the project earns — everything not
 *  marked chargeable. This, not the total, is what the project's net is
 *  worked out from. */
export function projectCosts(project: Project): number {
  return project.expenses.reduce((sum, expense) => (expense.chargeable ? sum : sum + expense.amount), 0);
}

/** Expenses billed on to the client rather than absorbed — recovered in
 *  full, so they leave the project's own margin untouched. */
export function chargeableExpenses(project: Project): number {
  return project.expenses.reduce((sum, expense) => (expense.chargeable ? sum + expense.amount : sum), 0);
}

/* ---------- settings ---------- */

/** Where a card opens: beside the board, or over it. */
export type CardSurface = 'drawer' | 'modal';

export const VIEWS = ['week', 'day', 'month', 'projects', 'clients', 'billing'] as const;
export type ViewMode = (typeof VIEWS)[number];

export const VIEW_LABELS: Record<ViewMode, string> = {
  week: 'Week',
  day: 'Day',
  month: 'Month',
  projects: 'Projects',
  clients: 'Clients',
  billing: 'Billing',
};

/** What the app needs to talk to a Microsoft 365 tenant. Both halves come off
 *  an app registration in Entra ID; neither is a secret, which is why they can
 *  live on the device — the sign-in itself is PKCE, so nothing here grants
 *  access on its own. */
export interface M365Config {
  /** `common`, `organizations`, or your own tenant id / domain. */
  tenant: string;
  /** The app registration's Application (client) ID. */
  clientId: string;
}

/** Per-device view preferences. Unlike categories these stay on the device:
 *  how many hours you plan into a day, and whether you want to see the
 *  weekend, is about the screen in front of you rather than about the board. */
/** The board's visual skin. `default` is the app's own look; `draft` is the
 *  squarer, denser one after the K10k design zines — columns ruled together by
 *  hairlines, numbered and letterspaced, figures that line up in a column.
 *
 *  It is a separate axis from `theme`, not a third value of it: a skin changes
 *  shape and type, a theme changes the palette, and either skin wears either
 *  theme. */
export type Skin = 'default' | 'draft';

export interface Settings {
  includeWeekend: boolean;
  capacity: number;
  theme: 'light' | 'dark';
  skin: Skin;
  /** The category a new card gets when nothing else decides. */
  defaultCategory: CategoryId;
  /** Show the description excerpt on the card face. */
  showDescription: boolean;
  cardSurface: CardSurface;
  /** First and last hour drawn on the day view's timeline. */
  dayStart: number;
  dayEnd: number;
  m365: M365Config;
}

export const DEFAULT_SETTINGS: Settings = {
  includeWeekend: false,
  capacity: 6,
  theme: 'light',
  skin: 'default',
  defaultCategory: 'slate',
  showDescription: true,
  cardSurface: 'drawer',
  dayStart: 8,
  dayEnd: 19,
  m365: { tenant: 'common', clientId: '' },
};

/* ---------- update categories ---------- */

/** The kind of work an update logs — video editing, capture, travel, account
 *  management and so on. Same shape as a card's own category, and managed the
 *  same way in Settings, but a separate list: what a card *is* and what was
 *  actually *done* on it are different questions, and a card only ever wears
 *  one of the former while collecting as many of the latter as it needs. */
export interface UpdateCategory {
  label: string;
  /** `#rrggbb`, used for the update's chip. */
  colour: string;
}

export type UpdateCategories = Record<string, UpdateCategory>;

export const UPDATE_CATEGORY_LABEL_MAX = 32;

/** A board always keeps at least one, for the same reason a card always
 *  keeps at least one category: an update with nothing to file it under
 *  isn't a choice, it's a gap. */
export const MIN_UPDATE_CATEGORIES = 1;

/** A starting set covering the kinds of work a small studio actually logs
 *  time against — entirely yours to add to, rename or remove in Settings. */
export const DEFAULT_UPDATE_CATEGORIES: UpdateCategories = {
  capture: { label: 'Video capture', colour: '#2179c8' },
  editing: { label: 'Video editing', colour: '#7b4a9e' },
  photo: { label: 'Photo editing', colour: '#0f8f8a' },
  travel: { label: 'Travel', colour: '#c68512' },
  admin: { label: 'Account management', colour: '#6f9c22' },
};

export const DEFAULT_UPDATE_CATEGORY_ORDER = ['capture', 'editing', 'photo', 'travel', 'admin'];

export function defaultUpdateCategories(): UpdateCategories {
  return Object.fromEntries(
    DEFAULT_UPDATE_CATEGORY_ORDER.map((id) => [id, { ...DEFAULT_UPDATE_CATEGORIES[id] }]),
  );
}

export function updateCategoryLabel(categories: UpdateCategories, id: string): string {
  const category = categories[id];
  if (!category) return 'Uncategorised';
  return category.label.trim() || DEFAULT_UPDATE_CATEGORIES[id]?.label || 'Uncategorised';
}

/* ---------- attachments ---------- */

/** A file kept with a card or a project: an image pasted into a description, a
 *  brief, a quote, a signed order.
 *
 *  Only what a file *is* travels in the board — the bytes never do. They sit in
 *  the browser's own file store and, once there is a Worker to sync to,
 *  alongside the board there; `id` is the whole address of both. A board blob
 *  that grew a megabyte every time someone pasted a screenshot would stop
 *  syncing long before anyone ran out of screenshots. */
export interface Attachment {
  id: string;
  /** What it was called when it arrived, and what it downloads as. */
  name: string;
  /** What the browser said it was, e.g. `image/png`. */
  type: string;
  /** Bytes. */
  size: number;
  createdAt: string;
}

/** Long enough for a real filename, short enough not to wreck a row. */
export const ATTACHMENT_NAME_MAX = 120;

/** What an attachment id may be. It ends up as a URL path segment, a storage
 *  key in the browser and a key in KV, so it stays to the characters all three
 *  read the same way. The Worker keeps its own copy of this, being a separate
 *  program that has to distrust what it is sent regardless. */
export const FILE_ID = /^[A-Za-z0-9_-]{6,64}$/;

/** Per file. A KV value tops out at 25 MB, and this leaves room under that for
 *  a phone photo or a page of PDF while keeping a video out of the question —
 *  which is the right way round for a planner. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** The ones shown as a thumbnail, and the ones a description can hold inline. */
export const isImageType = (type: string) => type.startsWith('image/');

/** File sizes, at the precision anyone actually reads them at. */
export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 KB';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/* ---------- cards ---------- */

/** A discrete piece of logged work on a card — what kind it was, and how long
 *  it took. Several can sit on one card: a shoot's capture, its edit and its
 *  export logged separately rather than folded into one estimate. */
export interface CardUpdate {
  id: string;
  /** What kind of work this was — an `UpdateCategory` id. */
  categoryId: string;
  /** Minutes spent. */
  minutes: number;
  /** What was actually done, in a line. */
  note: string;
  createdAt: string;
}

export const UPDATE_NOTE_MAX = 140;

/** Minutes logged on a card, across every update on it. */
export function totalUpdateMinutes(updates: CardUpdate[]): number {
  return updates.reduce((sum, update) => sum + update.minutes, 0);
}

export interface Card {
  id: string;
  title: string;
  /** Rich text, stored as HTML from the editor. */
  description: string;
  colour: CategoryId;
  status: Status;
  /** Rough size in hours; drives the per-day load bar. 0 = unsized. */
  estimate: number;
  /** Minutes from local midnight on its day, or null for "sometime today".
   *  Set by dropping the card onto the day view's timeline. */
  start: number | null;
  /** The project this card belongs to, if any. */
  projectId: string | null;
  /** Client ids. A card can carry several, and needn't inherit its project's. */
  clients: string[];
  /** Mirror this card into the connected Microsoft 365 calendar. */
  publish: boolean;
  /** The Graph event id, once published. Null until the first push lands. */
  eventId: string | null;
  /** When the card was last marked done — what the day's "logged" total and
   *  the look-back are counted from. */
  completedAt: string | null;
  /** Discrete logged work — what was done, and how long it took, kept apart
   *  from the card's own rough estimate. */
  updates: CardUpdate[];
  /** Files on the card. Images pasted into the description are not listed
   *  here — those are in the description, which is where they are read. */
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
}

/** Lane ids are either a day key (`YYYY-MM-DD`) or the backlog. */
export const BACKLOG = 'backlog';
export type LaneId = string;

export interface BoardState {
  version: number;
  cards: Record<string, Card>;
  /** Lane id -> ordered card ids. This is the source of truth for both
   *  which day a card sits on and where in that day it sits. */
  lanes: Record<LaneId, string[]>;
  /** Category labels and colours, kept with the board so every device that
   *  syncs it reads the same colour code. */
  categories: Categories;
  /** Category ids in the order they should be listed. */
  categoryOrder: string[];
  /** The categories an update can be logged as, kept with the board for the
   *  same reason as a card's own categories. */
  updateCategories: UpdateCategories;
  updateCategoryOrder: string[];
  /** Projects and clients travel with the board for the same reason. */
  projects: Record<string, Project>;
  clients: Record<string, Client>;
  /** Client ids in the order they should be listed. */
  clientOrder: string[];
  /**
   * Calendar entries whose card is gone, waiting to be taken off the calendar.
   *
   * A published card carries the id of its entry, so removing the entry when
   * the card changes is easy — you still have the card. Deleting the card takes
   * that id with it, and the entry is left in Outlook with nothing pointing at
   * it. The id is kept here instead until a connected device can remove it,
   * which is also why it travels with the board rather than sitting on the
   * device that did the deleting: that device may never be the one connected.
   */
  orphanedEvents: string[];
}

/** Pounds, with the pence dropped — project values are round numbers. */
const money = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

export function formatMoney(value: number): string {
  return money.format(Number.isFinite(value) ? value : 0);
}
