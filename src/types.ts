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

export const DEFAULT_CATEGORIES: Categories = {
  slate: { label: 'General', colour: '#64748b' },
  blue: { label: 'Client work', colour: '#2f6df6' },
  teal: { label: 'Meetings', colour: '#0b7f75' },
  green: { label: 'Admin', colour: '#3f9142' },
  amber: { label: 'Waiting on', colour: '#a86a00' },
  red: { label: 'Urgent', colour: '#d4453c' },
  purple: { label: 'Deep work', colour: '#7c4ddb' },
  pink: { label: 'Personal', colour: '#cd4a8c' },
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

/** Per-device view preferences. Unlike categories these stay on the device:
 *  how many hours you plan into a day, and whether you want to see the
 *  weekend, is about the screen in front of you rather than about the board. */
export interface Settings {
  includeWeekend: boolean;
  capacity: number;
  theme: 'light' | 'dark';
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
}
