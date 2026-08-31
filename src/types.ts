export const STATUSES = ['todo', 'doing', 'blocked', 'done'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  todo: 'To do',
  doing: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
};

/** T-card boards run on colour coding — each colour is a category of work. */
export const COLOURS = ['slate', 'blue', 'teal', 'green', 'amber', 'red', 'purple', 'pink'] as const;
export type Colour = (typeof COLOURS)[number];

export const COLOUR_LABELS: Record<Colour, string> = {
  slate: 'General',
  blue: 'Client work',
  teal: 'Meetings',
  green: 'Admin',
  amber: 'Waiting on',
  red: 'Urgent',
  purple: 'Deep work',
  pink: 'Personal',
};

export interface Card {
  id: string;
  title: string;
  /** Rich text, stored as HTML from the editor. */
  description: string;
  colour: Colour;
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
}
