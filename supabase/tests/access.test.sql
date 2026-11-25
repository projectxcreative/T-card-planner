-- Client isolation tests. Run with supabase/tests/run.sh.
-- Every block raises (and stops the run) on the first expectation that fails.

\set ON_ERROR_STOP on

/* ---------- fixtures, as the database owner ---------- */

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000005a', 'ben@example.com'),
  ('00000000-0000-0000-0000-0000000000a1', 'alice@acme.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'bob@beta.test'),
  ('00000000-0000-0000-0000-0000000000f0', 'stranger@example.com');

update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-00000000005a';

insert into public.clients (id, name, retainer_hours) values
  ('acme', 'Acme', 20), ('beta', 'Beta', 10);

insert into public.client_members (client_id, user_id) values
  ('acme', '00000000-0000-0000-0000-0000000000a1'),
  ('beta', '00000000-0000-0000-0000-0000000000b1');

insert into public.projects (id, title, value, client_id, stage) values
  ('p-acme', 'Acme autumn campaign', 4800, 'acme', 'active'),
  ('p-beta', 'Beta relaunch', 9000, 'beta', 'won');

insert into public.cards (id, title, estimate, client_id, client_visible, project_id, status, lane) values
  ('c-acme-shared', 'Acme shared', 3, 'acme', true, 'p-acme', 'doing', '2026-11-26'),
  ('c-acme-private', 'Acme private', 2, 'acme', false, 'p-acme', 'todo', 'backlog'),
  ('c-beta-shared', 'Beta shared', 5, 'beta', true, 'p-beta', 'blocked', 'backlog'),
  ('c-internal', 'Internal admin', 1, null, false, null, 'todo', 'backlog');

insert into public.card_internal_notes (card_id, body) values ('c-acme-shared', 'margin is thin');
insert into public.card_tags (card_id, client_id) values ('c-beta-shared', 'acme');
insert into public.card_updates (card_id, minutes, date) values
  ('c-acme-shared', 90, '2026-11-20'), ('c-acme-private', 30, '2026-11-21'),
  ('c-beta-shared', 120, '2026-11-20');

insert into public.attachments (id, card_id, name, storage_path, client_visible) values
  ('f-acme-shared', 'c-acme-shared', 'brief.pdf', 'acme/f-acme-shared/brief.pdf', true),
  ('f-acme-hidden', 'c-acme-shared', 'quote.pdf', 'acme/f-acme-hidden/quote.pdf', false),
  ('f-acme-oncard', 'c-acme-private', 'draft.png', 'acme/f-acme-oncard/draft.png', true),
  ('f-beta-shared', 'c-beta-shared', 'logo.svg', 'beta/f-beta-shared/logo.svg', true);

insert into storage.objects (bucket_id, name)
select 'attachments', storage_path from public.attachments;

create function pg_temp.expect_denied(statement text) returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'expected to be refused: %', statement;
exception
  when insufficient_privilege or check_violation or raise_exception then
    if sqlerrm like 'expected to be refused%' then raise; end if;
end;
$$;
grant execute on function pg_temp.expect_denied(text) to anon, authenticated;

/* ---------- a client sees their own shared cards, and nothing else ---------- */

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare n int;
begin
  select count(*) into n from public.portal_cards;
  assert n = 1, format('alice should see 1 portal card, saw %s', n);
  assert (select title from public.portal_cards) = 'Acme shared', 'alice sees the wrong card';
  assert (select portal_column from public.portal_cards) = 'in_progress', 'doing maps to in_progress';
  assert (select scheduled_for from public.portal_cards) = date '2026-11-26', 'day lane becomes a date';
  assert (select project_title from public.portal_cards) = 'Acme autumn campaign', 'project title shown';

  assert (select count(*) from public.portal_clients) = 1, 'alice sees only Acme';
  assert (select id from public.portal_clients) = 'acme', 'alice sees the wrong client';

  assert (select count(*) from public.portal_attachments) = 1, 'alice sees only the shared file on the shared card';
  assert (select count(*) from storage.objects) = 1, 'alice can download only one file';
  assert (select name from storage.objects) = 'acme/f-acme-shared/brief.pdf', 'alice downloads the wrong file';

  assert (select count(*) from public.portal_retainer_usage) = 1, 'alice sees only Acme usage';
  assert (select minutes from public.portal_retainer_usage) = 120, 'Acme usage counts all its cards (90 + 30)';

  -- The tables themselves are closed to clients.
  assert (select count(*) from public.cards) = 0, 'clients read no cards rows directly';
  assert (select count(*) from public.projects) = 0, 'clients read no projects (money)';
  assert (select count(*) from public.expenses) = 0, 'clients read no expenses';
  assert (select count(*) from public.card_internal_notes) = 0, 'clients read no internal notes';
  assert (select count(*) from public.card_updates) = 0, 'clients read no individual time entries';
  assert (select count(*) from public.card_tags) = 0, 'extra tags grant nothing';
  assert (select count(*) from public.attachments) = 0, 'clients read no attachment rows directly';
  assert (select count(*) from public.calendar_feeds) = 0, 'clients read no feed tokens';
  assert (select count(*) from public.client_members) = 1, 'alice sees only her own membership';
  assert (select count(*) from public.profiles) = 1, 'alice sees only her own profile';
end;
$$;

-- Writes are refused or touch nothing.
do $$
declare n int;
begin
  update public.cards set title = 'hacked' where id = 'c-acme-shared';
  get diagnostics n = row_count;
  assert n = 0, 'alice must not update cards';
  delete from public.cards;
  get diagnostics n = row_count;
  assert n = 0, 'alice must not delete cards';
  update public.profiles set display_name = 'Alice A' where id = auth.uid();
  get diagnostics n = row_count;
  assert n = 1, 'alice can rename herself';
end;
$$;
select pg_temp.expect_denied($$insert into public.cards (id, title, client_id, client_visible) values ('x', 'x', 'acme', true)$$);
select pg_temp.expect_denied($$insert into public.client_members (client_id, user_id) values ('beta', '00000000-0000-0000-0000-0000000000a1')$$);
select pg_temp.expect_denied($$update public.profiles set role = 'staff' where id = auth.uid()$$);
select pg_temp.expect_denied($$select public.set_user_role('00000000-0000-0000-0000-0000000000a1', 'staff')$$);
select pg_temp.expect_denied($$insert into storage.objects (bucket_id, name) values ('attachments', 'acme/x/evil.html')$$);
rollback;

/* ---------- the other client sees only theirs ---------- */

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
do $$
begin
  assert (select count(*) from public.portal_cards) = 1, 'bob sees 1 card';
  assert (select title from public.portal_cards) = 'Beta shared', 'bob sees the wrong card';
  assert (select portal_column from public.portal_cards) = 'waiting_on_you', 'blocked maps to waiting_on_you';
  assert (select scheduled_for from public.portal_cards) is null, 'backlog has no date';
  assert (select count(*) from public.portal_attachments) = 1, 'bob sees his one file';
  assert (select count(*) from storage.objects where name like 'acme/%') = 0, 'bob cannot reach Acme files';
end;
$$;
rollback;

/* ---------- a login with no client sees nothing ---------- */

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', true);
do $$
begin
  assert (select count(*) from public.portal_cards) = 0, 'stranger sees no cards';
  assert (select count(*) from public.portal_clients) = 0, 'stranger sees no clients';
  assert (select count(*) from public.portal_retainer_usage) = 0, 'stranger sees no usage';
  assert (select count(*) from storage.objects) = 0, 'stranger downloads nothing';
end;
$$;
rollback;

/* ---------- signed out gets nothing at all ---------- */

begin;
set local role anon;
select pg_temp.expect_denied($$select * from public.portal_cards$$);
select pg_temp.expect_denied($$select * from public.cards$$);
select pg_temp.expect_denied($$select * from public.clients$$);
rollback;

/* ---------- staff see and change everything ---------- */

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000005a', true);
do $$
declare n int;
begin
  assert (select count(*) from public.cards) = 4, 'staff see every card';
  assert (select count(*) from public.portal_cards) = 2, 'staff can preview every shared card';
  assert (select count(*) from storage.objects) = 4, 'staff reach every file';
  insert into public.cards (title) values ('New from staff');
  update public.cards set estimate = 4 where id = 'c-acme-private';
  get diagnostics n = row_count;
  assert n = 1, 'staff can edit cards';
  perform public.set_user_role('00000000-0000-0000-0000-0000000000f0', 'client');
end;
$$;
select pg_temp.expect_denied($$insert into public.cards (title, client_visible) values ('shared with nobody', true)$$);
select pg_temp.expect_denied($$select public.set_user_role('00000000-0000-0000-0000-00000000005a', 'client')$$);
rollback;

/* ---------- sharing a card shows it; unsharing hides it ---------- */

update public.cards set client_visible = true where id = 'c-acme-private';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
begin
  assert (select count(*) from public.portal_cards) = 2, 'a newly shared card appears';
  assert (select count(*) from public.portal_attachments) = 2, 'its shared file appears with it';
end;
$$;
rollback;
update public.cards set client_visible = false where id = 'c-acme-shared';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
begin
  assert (select count(*) from public.portal_cards where id = 'c-acme-shared') = 0, 'an unshared card disappears';
  assert (select count(*) from storage.objects where name = 'acme/f-acme-shared/brief.pdf') = 0, 'and its files go with it';
end;
$$;
rollback;

\echo 'All access tests passed.'
