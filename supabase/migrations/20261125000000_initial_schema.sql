-- T-Card Planner: initial Supabase schema.
--
-- The board used to be one JSON value in Cloudflare KV. Here it becomes rows,
-- and every row a client might ever see carries the id of the client it
-- belongs to, so access can be decided per row by the database itself.
--
-- Two kinds of user:
--   staff   see and change everything (you, and anyone you hire later)
--   client  see only their own client's cards that are shared with them,
--           and only through the portal_* views at the end of this file
--
-- Ids are text rather than uuid so the ids already on the board (cards,
-- projects, clients, categories) survive the import unchanged.

create extension if not exists pgcrypto;

/* ---------- types ---------- */

create type public.app_role as enum ('staff', 'client');
create type public.card_status as enum ('todo', 'doing', 'blocked', 'done');
create type public.project_stage as enum (
  'enquiry', 'quoted', 'won', 'active', 'delivered', 'invoiced', 'paid', 'lost'
);
create type public.billing_bucket as enum ('todo', 'due', 'sent', 'paid');

create or replace function public.new_id() returns text
language sql volatile as $$
  select replace(gen_random_uuid()::text, '-', '')
$$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

/* ---------- people ---------- */

-- One row per login. Everyone starts as a client with no memberships, which
-- means they can see nothing at all until staff add them to a client.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  role public.app_role not null default 'client',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

/* ---------- clients ---------- */

create table public.clients (
  id text primary key default public.new_id(),
  name text not null check (char_length(name) between 1 and 80),
  colour text not null default '#64748b' check (colour ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer not null default 0,
  -- Hours a month the retainer covers; null for clients not on one.
  retainer_hours numeric(6, 2) check (retainer_hours is null or retainer_hours >= 0),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Which logins belong to which client. A person can belong to more than one
-- (an agency contact who looks after two brands, say).
create table public.client_members (
  client_id text not null references public.clients (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, user_id)
);
create index client_members_user_idx on public.client_members (user_id);

/* ---------- access helpers ----------
 * security definer so policies can call them without recursing through the
 * policies on profiles and client_members. */

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'staff'
  )
$$;

create or replace function public.is_client_member(cid text) returns boolean
language sql stable security definer set search_path = public as $$
  select cid is not null and exists (
    select 1 from public.client_members where client_id = cid and user_id = auth.uid()
  )
$$;

/* ---------- lookups ---------- */

create table public.categories (
  id text primary key default public.new_id(),
  label text not null default '',
  colour text not null check (colour ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer not null default 0
);

create table public.update_categories (
  id text primary key default public.new_id(),
  label text not null default '',
  colour text not null check (colour ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer not null default 0
);

/* ---------- projects ---------- */

create table public.projects (
  id text primary key default public.new_id(),
  title text not null default '',
  description text not null default '',
  value numeric(12, 2) not null default 0,
  budget_hours numeric(8, 2) not null default 0,
  stage public.project_stage not null default 'enquiry',
  client_id text references public.clients (id) on delete set null,
  invoice_month text check (invoice_month is null or invoice_month ~ '^\d{4}-\d{2}$'),
  category_id text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_client_idx on public.projects (client_id);

create table public.project_milestones (
  id text primary key default public.new_id(),
  project_id text not null references public.projects (id) on delete cascade,
  label text not null default '',
  amount numeric(12, 2) not null default 0,
  invoice_month text check (invoice_month is null or invoice_month ~ '^\d{4}-\d{2}$'),
  status public.billing_bucket not null default 'todo',
  sort_order integer not null default 0
);
create index project_milestones_project_idx on public.project_milestones (project_id);

create table public.expenses (
  id text primary key default public.new_id(),
  project_id text not null references public.projects (id) on delete cascade,
  label text not null default '',
  amount numeric(12, 2) not null default 0,
  chargeable boolean not null default false,
  sort_order integer not null default 0
);
create index expenses_project_idx on public.expenses (project_id);

/* ---------- cards ---------- */

create table public.cards (
  id text primary key default public.new_id(),
  title text not null default '',
  -- Rich text HTML. This is the description a client sees when the card is
  -- shared; anything only for you goes in card_internal_notes.
  description text not null default '',
  category_id text,
  status public.card_status not null default 'todo',
  estimate numeric(6, 2) not null default 0,
  -- Minutes from local midnight on its day, or null for "sometime that day".
  start_minute integer check (start_minute is null or start_minute between 0 and 1439),
  due_date date,
  -- 'backlog' or a day key, YYYY-MM-DD: which column the card sits in.
  lane text not null default 'backlog' check (lane = 'backlog' or lane ~ '^\d{4}-\d{2}-\d{2}$'),
  -- Order within the lane. Fractional, so a move rewrites one row.
  position double precision not null default 0,
  project_id text references public.projects (id) on delete set null,
  -- The one client this card is for: who may see it, if it is shared.
  client_id text references public.clients (id) on delete set null,
  client_visible boolean not null default false,
  -- The staff member doing it, if anyone in particular.
  assignee_id uuid references auth.users (id) on delete set null,
  publish boolean not null default false,
  event_id text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shared_cards_have_a_client check (not client_visible or client_id is not null)
);
create index cards_lane_idx on public.cards (lane, position);
create index cards_client_idx on public.cards (client_id) where client_id is not null;
create index cards_project_idx on public.cards (project_id) where project_id is not null;

-- Notes on a card that a client never sees, whatever its sharing.
create table public.card_internal_notes (
  card_id text primary key references public.cards (id) on delete cascade,
  body text not null default '',
  updated_at timestamptz not null default now()
);

-- Extra client tags beyond the owner. Staff-only labels for filtering; they
-- never grant a client access.
create table public.card_tags (
  card_id text not null references public.cards (id) on delete cascade,
  client_id text not null references public.clients (id) on delete cascade,
  primary key (card_id, client_id)
);

create table public.card_updates (
  id text primary key default public.new_id(),
  card_id text not null references public.cards (id) on delete cascade,
  category_id text,
  minutes integer not null check (minutes >= 0),
  note text not null default '',
  date date not null default current_date,
  created_at timestamptz not null default now()
);
create index card_updates_card_idx on public.card_updates (card_id);

/* ---------- files ---------- */

create table public.attachments (
  id text primary key default public.new_id(),
  card_id text references public.cards (id) on delete cascade,
  project_id text references public.projects (id) on delete cascade,
  name text not null,
  mime_type text not null default 'application/octet-stream',
  size bigint not null default 0,
  -- Path inside the private 'attachments' storage bucket.
  storage_path text not null unique,
  -- A file on a shared card is still private until it is shared too.
  client_visible boolean not null default false,
  created_at timestamptz not null default now(),
  constraint attachment_has_one_parent check ((card_id is null) <> (project_id is null))
);
create index attachments_card_idx on public.attachments (card_id);
create index attachments_project_idx on public.attachments (project_id);

/* ---------- calendar and per-user state ---------- */

-- Outlook entries whose card is gone, waiting for a connected device to
-- remove them.
create table public.orphaned_events (
  event_id text primary key,
  created_at timestamptz not null default now()
);

-- The subscribable calendar feed. The token is the password in the link.
create table public.calendar_feeds (
  id text primary key default public.new_id(),
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  options jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

/* ---------- updated_at ---------- */

create trigger clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();
create trigger cards_touch before update on public.cards
  for each row execute function public.touch_updated_at();
create trigger card_internal_notes_touch before update on public.card_internal_notes
  for each row execute function public.touch_updated_at();
create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();
