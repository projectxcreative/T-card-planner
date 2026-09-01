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
npm test             # the Access login checks
npm run deploy       # build, then wrangler deploy
```

`npm run dev` is enough for working on the board itself. `dev:worker` runs the
real Worker against a local KV, which is what you want when touching sync; put
a token in `.dev.vars` first:

```
BOARD_TOKEN=any-string-you-like
```

There is no Cloudflare Access in front of a local run — Access lives at the
edge, and `wrangler dev` isn't behind it — so the token is how you get in while
developing. To watch the Worker refuse everything that hasn't logged in, add
`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` to `.dev.vars` as well: with no real
Access session to present, every request is turned away, which is the point.

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

Point it at the Worker and the same board follows you between machines. Behind
Cloudflare Access there is nothing to set up per device: you log in, the badge
reads **Synced** and says which address you logged in as. Each device holds the
whole board and the revision it last agreed with the server:

- Edits are pushed about a second after you stop making them.
- Other devices pick them up when you next look at the tab, and every 45
  seconds while it's open.
- Edits made with no signal queue up and go when you're back — the badge reads
  **Offline** meanwhile.
- When an Access session runs out the badge reads **Signed out** and offers to
  sign you back in. The board keeps working on the device meanwhile; nothing is
  lost, it just stops going up until you're back in.
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

Until one of `BOARD_TOKEN` or Cloudflare Access is set up the API refuses every
request, so the board is never briefly public while you finish setting it up.
With only a token, open the site, click the sync badge and paste the same token
— once per device. Adding the login below is better, and means you never do
that again.

`wrangler.jsonc` turns the `*.workers.dev` and preview URLs off, so the custom
domain is the only way in — otherwise the same board answers on a second
address that no Access policy on the domain covers. Attach the domain itself in
the dashboard rather than in config: a domain declared in `wrangler.jsonc` makes
a CI deploy ask for a confirmation it cannot get, and fail.

Worth knowing: KV is eventually consistent, so a write can take a few seconds
to reach another region, in which case the other device sees the older board
until it next polls, or is offered the conflict choice.

## The login

A shared token is fine as far as it goes, but it is one secret pasted into
every browser you own, it never expires, and it guards the API while leaving
the app itself open to anyone who finds the address. **Cloudflare Access** puts
a real login in front of the whole thing: you sign in with a code emailed to
you, or with Google or GitHub, and everyone else gets a locked door instead of
a board.

Access does the challenge at the edge, before a request reaches the Worker. The
Worker then verifies the signed token Access attaches (`worker/access.ts`), so
"Access is probably in front of me" becomes something it actually knows — a
request that arrived by some other route is refused rather than trusted.

### Setting it up

In the [Zero Trust dashboard](https://one.dash.cloudflare.com), under **Access
→ Applications**, add a **self-hosted** application:

1. Point it at the board's domain — the whole thing, path included if you like.
2. Give it a policy: **Allow**, *Emails*, your address. That list is who gets in.
3. Pick a login method. **One-time PIN** emails you a code and needs nothing set
   up; Google, GitHub and the rest need an identity provider adding first.
4. Save, then open the board. You should be asked to log in, and land on the
   board afterwards.

Once the login itself works, close the back door by telling the Worker to check
it. The **Application Audience (AUD) tag** is on the application's overview
page, and the team domain is your `<team>.cloudflareaccess.com`:

```bash
npx wrangler secret put ACCESS_TEAM_DOMAIN   # e.g. myteam
npx wrangler secret put ACCESS_AUD           # the AUD tag, a long hex string
npx wrangler deploy
```

**In that order.** The moment those two are set, the Worker serves nothing —
not even the app shell — without a login it has verified, so a Worker that can
still be reached at some address the Access application doesn't cover is a
closed door rather than an open one. Set them before the application exists and
you lock yourself out until you delete them again (`npx wrangler secret delete
ACCESS_AUD`).

With the login in place the token is only useful to things that aren't a
browser — a backup script, a `wrangler dev` run. Keep it for those, or drop it:

```bash
npx wrangler secret delete BOARD_TOKEN
```

### Two smaller knobs

`ACCESS_EMAILS` is an optional second list, checked after Access has had its
say:

```bash
npx wrangler secret put ACCESS_EMAILS        # you@example.com, someone@else.com
```

The policy in the dashboard decides who may log in; this decides who the board
answers to. They're normally the same list, and having one here means a policy
widened by accident — *any Google account* rather than yours — doesn't quietly
hand over the board. Leave it unset for "whoever the policy let in".

**Sessions.** How long a login lasts is the application's *session duration* in
the dashboard, 24 hours by default. When it runs out the badge says **Signed
out** and offers to sign you back in; the board carries on working on the
device meanwhile.

## Layout

```
worker/index.ts        the Worker: /api/board over KV, and the built app
worker/access.ts       verifies the Cloudflare Access login on every request
worker/access.test.mjs signed-JWT checks for it — `npm test`
wrangler.jsonc         Worker config — KV binding, assets, SPA fallback
src/
  App.tsx              board state, drag and drop, keyboard, undo
  sync.ts              pull/push, offline queueing, conflict detection, session
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
    SyncBadge.tsx      sync status, who you're signed in as, the conflict prompt
```

Day columns are keyed by local `YYYY-MM-DD` strings rather than timestamps, so a
card dropped on Monday stays on Monday whatever the timezone. `lanes` — lane id
to ordered card ids — is the single source of truth for both which day a card is
on and where it sits in that day.

Mouse and touch use separate dnd-kit sensors: a mouse drags after 5px of
movement, a finger after a short press, so a swipe still scrolls the board.

Built with React, Vite, [dnd-kit](https://dndkit.com),
[Tiptap](https://tiptap.dev) and Cloudflare Workers + KV.
