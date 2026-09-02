export const STATUSES = ['todo', 'doing', 'blocked', 'done'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  todo: 'To do',
  doing: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
};

/** T-card boards run on colour coding — each colour is a category of work.
 *  The ids are fixed so a card keeps its category across renames; the label
 *  and the colour behind it are both yours to change in Settings. */
export const CATEGORY_IDS = ['slate', 'blue', 'teal', 'green', 'amber', 'red', 'purple', 'pink'] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

export interface Category {
  label: string;
  /** `#rrggbb`. The light-theme strip; dark lifts it to a pastel of itself. */
  colour: string;
}

export type Categories = Record<CategoryId, Category>;

/** The eight defaults are lifted off the logo's own gradient — teal through
 *  blue and violet on one arm, lime through amber and red to magenta on the
 *  other — so a board full of colour still looks like it belongs to the mark
 *  in the corner. Any of them can be changed in Settings. */
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

export function defaultCategories(): Categories {
  return Object.fromEntries(
    CATEGORY_IDS.map((id) => [id, { ...DEFAULT_CATEGORIES[id] }]),
  ) as Categories;
}

/** The label to show when someone has cleared the box but not yet typed. */
export function categoryLabel(categories: Categories, id: CategoryId): string {
  return categories[id]?.label.trim() || DEFAULT_CATEGORIES[id].label;
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
  /** Cards created inside a project start with this category. */
  colour: CategoryId;
  /** Archived projects drop out of the pickers but keep their cards. */
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ---------- settings ---------- */

/** Where a card opens: beside the board, or over it. */
export type CardSurface = 'drawer' | 'modal';

export const VIEWS = ['week', 'day', 'month', 'projects', 'clients'] as const;
export type ViewMode = (typeof VIEWS)[number];

export const VIEW_LABELS: Record<ViewMode, string> = {
  week: 'Week',
  day: 'Day',
  month: 'Month',
  projects: 'Projects',
  clients: 'Clients',
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

/* ---------- cards ---------- */

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
