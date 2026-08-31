# T-Card Planner

A work planner that sits between a T-card board, a calendar and a kanban board.
Cards carry a title and a rich text description, live in a column per day, and
move by drag and drop.

![The board](docs/board.png)

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

`npm run build` produces a static bundle in `dist/` — it is a plain single-page
app, so anything that serves files will host it.

## How it works

**The board.** One column per weekday for the week you're looking at, plus a
**Backlog** column on the left for anything not yet given a day. Weekends are
hidden until you tick *Weekend*. Today's column is outlined.

**The cards.** Each card is a T-card: a coloured strip across the top naming its
category, and the body below. Colour is the category (client work, meetings,
admin, urgent…), and it's the thing you read the board by from across the room.

- **Drag** a card to another day, or up and down to reorder within a day.
  Dropping it nowhere puts it back, and `Esc` mid-drag cancels.
- **Click** a card to open it: title, status, category, size, day, and a rich
  text description with headings, lists, checklists, links and code.
![A card open for editing](docs/card.png)

- **Status** is the kanban part — To do, In progress, Blocked, Done. Done cards
  grey out and stop counting toward the day's load.
- **Size** is a rough hour estimate. Each day's bar fills as you plan it and
  turns red past the hours-per-day you set in the toolbar, so an over-committed
  Tuesday is visible before you get to it.
- **Roll over** appears when past days still hold unfinished cards, and moves
  them all to today in one go.

## Keyboard

| Key | Does |
| --- | --- |
| `N` | New card on today, opened for editing |
| `/` | Focus search |
| `Esc` | Close the card panel, or cancel a drag |
| `⌘Z` / `Ctrl+Z` | Undo the last move, delete or roll-over |
| `Enter` | Open the focused card |

Search dims what doesn't match rather than hiding it, so the shape of the week
stays put while you look.

## Your data

Everything lives in `localStorage` in your browser — no account, no server,
nothing leaves the machine. That also means it is scoped to one browser on one
device, and clearing site data clears the board, so **Export** writes a dated
JSON backup and **Import** reads one back.

## Layout

```
src/
  App.tsx              board state, drag and drop, keyboard, undo
  store.ts             reducer, persistence, import normalisation
  dates.ts             local-time day keys (YYYY-MM-DD) and formatting
  types.ts             Card, statuses, categories
  cardText.ts          card-face summary of the rich text
  components/
    TopBar.tsx         week nav, search, settings, export/import
    Lane.tsx           a day (or the backlog), quick add, load bar
    TCard.tsx          the card face and its sortable wrapper
    CardDrawer.tsx     the editing panel
    RichText.tsx       Tiptap editor, lazy-loaded on first card open
```

Day columns are keyed by local `YYYY-MM-DD` strings rather than timestamps, so a
card dropped on Monday stays on Monday whatever the timezone. `lanes` — lane id
to ordered card ids — is the single source of truth for both which day a card is
on and where it sits in that day.

Built with React, Vite, [dnd-kit](https://dndkit.com) and
[Tiptap](https://tiptap.dev).
