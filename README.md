# T-Card Planner

A work planner that sits between a T-card board, a calendar and a kanban board.
Cards carry a title and a rich text description, live in a column per day, and
move by drag and drop.

![The board](docs/board.png)

## Running it

```bash
npm install
npm run dev          # http://localhost:5173 — board only, no sync
npm run dev:worker   # http://localhost:8787 — board plus the sync API
npm run typecheck    # app and Worker
npm run deploy       # build, then wrangler deploy
```

`npm run dev` is enough for working on the board itself. `dev:worker` runs the
real Worker against a local KV, which is what you want when touching sync; put
a token in `.dev.vars` first:

```
BOARD_TOKEN=any-string-you-like
```

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

## On a phone

![The board on a phone](docs/mobile.png)

The board opens on today rather than the far left, and columns snap one at a
time. A swipe scrolls; **press and hold** a card for a moment and it lifts, so
dragging and scrolling don't fight each other. Add it to your home screen and
it runs full-screen, and the app shell is cached so it opens without a signal —
the board itself is already on the device.

## Your data, on more than one device

Cards live in `localStorage` and the app works with no server at all — that is
the **Sync off** state in the toolbar, and it's a perfectly good way to run.

Point it at the Worker and the same board follows you between machines. Each
device holds the whole board and the revision it last agreed with the server:

- Edits are pushed about a second after you stop making them.
- Other devices pick them up when you next look at the tab, and every 45
  seconds while it's open.
- Edits made with no signal queue up and go when you're back — the badge reads
  **Offline** meanwhile.
- If two devices changed the same board while apart, nothing is merged and
  nothing is silently dropped: you are shown both and pick a side. The same
  happens when you first connect a device that already has real work on it.

**Export** still writes a dated JSON backup and **Import** reads one back.
Worth doing occasionally regardless — one KV key is not a backup strategy.

## Deploying it

A single Worker serves both the built app and the API, configured by
`wrangler.jsonc`. Once:

```bash
npx wrangler kv namespace create BOARD      # put the id in wrangler.jsonc
npx wrangler secret put BOARD_TOKEN         # a long random string
```

Then `npm run deploy`, or let a GitHub-connected Worker build run
`npm run build` and deploy with `npx wrangler deploy`.

Open the site, click the sync badge, paste the same token — once per device.
Until `BOARD_TOKEN` is set the API refuses every request, so the board is never
briefly public while you finish setting it up.

Two things worth knowing. The token is the only thing guarding the API, so make
it long and random; putting Cloudflare Access in front of the domain adds a
real login on top. And KV is eventually consistent — a write can take a few
seconds to reach another region, in which case the other device sees the older
board until it next polls, or is offered the conflict choice.

## Layout

```
worker/index.ts        the Worker: /api/board over KV, and the built app
wrangler.jsonc         Worker config — KV binding, assets, SPA fallback
src/
  App.tsx              board state, drag and drop, keyboard, undo
  sync.ts              pull/push, offline queueing, conflict detection
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
    SyncBadge.tsx      sync status, token entry, the conflict prompt
```

Day columns are keyed by local `YYYY-MM-DD` strings rather than timestamps, so a
card dropped on Monday stays on Monday whatever the timezone. `lanes` — lane id
to ordered card ids — is the single source of truth for both which day a card is
on and where it sits in that day.

Mouse and touch use separate dnd-kit sensors: a mouse drags after 5px of
movement, a finger after a short press, so a swipe still scrolls the board.

Built with React, Vite, [dnd-kit](https://dndkit.com),
[Tiptap](https://tiptap.dev) and Cloudflare Workers + KV.
