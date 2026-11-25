# Supabase backend (rebuild, phase 1)

This folder is the new home of the board's data: Postgres tables, the rules
that decide who can see what, and tests that prove a client can't see another
client's work. The live app still runs on the Cloudflare Worker and KV; nothing
here changes it yet.

## What's here

| Path | What it is |
| --- | --- |
| `migrations/20261125000000_initial_schema.sql` | Tables: profiles, clients, client members, projects, milestones, expenses, cards, internal notes, time entries, attachments, calendar feed |
| `migrations/20261125000100_access_rules.sql` | Row-level security: staff see everything; clients see only the `portal_*` views, filtered to their own client |
| `migrations/20261125000200_storage.sql` | Private `attachments` bucket; clients can download only files shared on cards shared with them |
| `migrations/20261125000300_realtime.sql` | Live updates between signed-in devices |
| `tests/run.sh` | Spins up a throwaway local Postgres, applies the migrations, runs the tests |
| `../scripts/board-to-sql.mjs` | Converts a board export (Settings → Backup) into SQL for the new tables |

Run the tests with `npm run test:db`. It needs Postgres 15+ installed locally;
no Supabase account or Docker.

## The access model in one paragraph

Every login has a role, `staff` or `client`, and new logins start as `client`
with no memberships, so they see nothing. Staff add a client login to a
client with a `client_members` row. The tables are staff-only. A client reads
only four views: `portal_clients`, `portal_cards`, `portal_attachments` and
`portal_retainer_usage`. A card appears in the portal only when its
`client_visible` flag is on and its `client_id` is one of the viewer's
clients. Money, estimates, internal notes and individual time entries are
never in a portal view.

## Setting up the Supabase project

1. Create a project at [supabase.com](https://supabase.com/dashboard), region
   **London (eu-west-2)**. Keep the database password somewhere safe.
2. **SQL editor:** paste and run the four migration files, in order.
   (Or with the Supabase CLI: `supabase link` then `supabase db push`.)
3. **Authentication → Sign In / Providers:**
   - Turn **off** "Allow new users to sign up". Only people you invite get in.
   - Leave **Email** on (magic link). Optionally add Google or Azure
     (Microsoft 365) for your own login.
4. **Authentication → URL Configuration:** set the Site URL to the planner's
   address, and add the portal address to the redirect URLs once it exists.
5. **Authentication → Users → Invite user:** invite yourself, accept the
   email, then make yourself staff in the SQL editor:

   ```sql
   update public.profiles set role = 'staff'
   where id = (select id from auth.users where email = 'you@example.com');
   ```
6. Send the project URL and the **anon** public key (Project Settings → API)
   to the thread. Never share the `service_role` key or the database password.

## Bringing the board across

```bash
node scripts/board-to-sql.mjs t-card-planner-2026-11-25.json > import.sql
```

Run `import.sql` in the SQL editor. It is one transaction. Nothing arrives
shared with clients. The script prints an attachment manifest to stderr: the
files themselves are copied from KV to Storage as a separate step.

## Running the app against Supabase

`cp .env.supabase .env.local && npm run dev`. With those two variables set:

- `src/Root.tsx` asks for an emailed sign-in link and lets only staff in.
- `src/backend/useSupabaseSync.ts` replaces the Worker sync: it loads the
  board from the tables, saves only the rows that changed
  (`src/backend/boardRows.ts`, tested in `boardRows.test.ts`), and reloads
  when another device changes something.
- If the database has no cards yet and this device has a board, the first
  save uploads it. That is an alternative to the import script.

Without them the app runs on the Cloudflare Worker exactly as before.

## Still to do in phase 1

- Team management screen: invite and remove staff through Supabase (for now,
  invite in the Supabase dashboard).
- Upload new attachments to Storage (they stay on the device for now), copy existing files from KV, and rewrite `/api/files/<id>`
  image links inside card and project descriptions.
- Move the ICS calendar feed and its token check to a Supabase Edge Function.
