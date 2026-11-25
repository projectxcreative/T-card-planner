-- Who may read and change what.
--
-- The rule of thumb: the tables are staff-only. Clients never query a table
-- directly; they read the portal_* views below, which hand over only the
-- columns a client is allowed to see, for only the clients they belong to.
-- That way a column added to cards later (a rate, a margin) stays private
-- until someone deliberately adds it to a portal view.

/* ---------- nobody signed out gets anything ---------- */

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;

/* ---------- row-level security on every table ---------- */

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.client_members enable row level security;
alter table public.categories enable row level security;
alter table public.update_categories enable row level security;
alter table public.projects enable row level security;
alter table public.project_milestones enable row level security;
alter table public.expenses enable row level security;
alter table public.cards enable row level security;
alter table public.card_internal_notes enable row level security;
alter table public.card_tags enable row level security;
alter table public.card_updates enable row level security;
alter table public.attachments enable row level security;
alter table public.orphaned_events enable row level security;
alter table public.calendar_feeds enable row level security;
alter table public.user_settings enable row level security;

/* ---------- staff: everything ---------- */

do $$
declare t text;
begin
  foreach t in array array[
    'clients', 'client_members', 'categories', 'update_categories', 'projects',
    'project_milestones', 'expenses', 'cards', 'card_internal_notes', 'card_tags',
    'card_updates', 'attachments', 'orphaned_events', 'calendar_feeds'
  ] loop
    execute format(
      'create policy staff_all on public.%I for all to authenticated
         using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end;
$$;

/* ---------- profiles ---------- */

create policy read_own_profile on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());

create policy update_own_profile on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- A user may change their own name, never their own role.
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;
revoke insert, delete on public.profiles from authenticated;

-- Roles change only through this, and only at a staff member's hand.
create or replace function public.set_user_role(target uuid, new_role public.app_role)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'only staff can change roles' using errcode = '42501';
  end if;
  if target = auth.uid() and new_role <> 'staff' then
    raise exception 'staff cannot demote themselves' using errcode = '42501';
  end if;
  update public.profiles set role = new_role where id = target;
end;
$$;
revoke all on function public.set_user_role(uuid, public.app_role) from public;
grant execute on function public.set_user_role(uuid, public.app_role) to authenticated;

/* ---------- a client user's own memberships ---------- */

create policy read_own_memberships on public.client_members for select to authenticated
  using (user_id = auth.uid());

/* ---------- per-user settings ---------- */

create policy own_settings on public.user_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

/* ---------- the portal ----------
 * These views run with their owner's rights, so they read past the staff-only
 * policies above; the where clause on each is what limits them instead. Staff
 * pass it too, so you can preview any client's portal. */

create view public.portal_clients as
select c.id, c.name, c.colour, c.retainer_hours
from public.clients c
where not c.archived
  and (public.is_client_member(c.id) or public.is_staff());

create view public.portal_cards as
select
  c.id,
  c.client_id,
  c.title,
  c.description,
  c.status,
  case c.status
    when 'todo' then 'planned'
    when 'doing' then 'in_progress'
    when 'blocked' then 'waiting_on_you'
    when 'done' then 'done'
  end as portal_column,
  case when c.lane = 'backlog' then null else c.lane::date end as scheduled_for,
  c.due_date,
  c.position,
  c.completed_at,
  c.updated_at,
  p.id as project_id,
  p.title as project_title,
  p.stage as project_stage
from public.cards c
left join public.projects p on p.id = c.project_id
where c.client_visible
  and (public.is_client_member(c.client_id) or public.is_staff());

create view public.portal_attachments as
select a.id, a.card_id, a.name, a.mime_type, a.size, a.storage_path, a.created_at
from public.attachments a
join public.cards c on c.id = a.card_id
where a.client_visible
  and c.client_visible
  and (public.is_client_member(c.client_id) or public.is_staff());

-- Hours logged per client per month, across all of that client's cards: the
-- retainer meter. Totals only; individual entries and notes stay private.
create view public.portal_retainer_usage as
select
  c.client_id,
  to_char(u.date, 'YYYY-MM') as month,
  sum(u.minutes)::integer as minutes
from public.card_updates u
join public.cards c on c.id = u.card_id
where c.client_id is not null
  and (public.is_client_member(c.client_id) or public.is_staff())
group by c.client_id, to_char(u.date, 'YYYY-MM');

revoke all on public.portal_clients, public.portal_cards,
  public.portal_attachments, public.portal_retainer_usage from anon, authenticated;
grant select on public.portal_clients, public.portal_cards,
  public.portal_attachments, public.portal_retainer_usage to authenticated;
