-- Checks scripts/board-to-sql.mjs output after it has been loaded by run.sh.
\set ON_ERROR_STOP on
do $$
begin
  assert (select count(*) from public.clients where id in ('cl1', 'cl2')) = 2, 'clients imported';
  assert (select name from public.clients where id = 'cl1') = 'O''Brien & Co', 'quotes survive';
  assert (select colour from public.clients where id = 'cl2') = '#64748b', 'bad colour falls back';
  assert (select client_id from public.cards where id = 'k1') = 'cl2', 'first existing client owns the card';
  assert (select count(*) from public.card_tags where card_id = 'k1') = 1, 'other client kept as a tag';
  assert (select client_id from public.cards where id = 'k2') = 'cl1', 'untagged card takes its project client';
  assert (select lane from public.cards where id = 'k1') = '2026-11-25', 'day lane kept';
  assert (select start_minute from public.cards where id = 'k1') = 540, 'start kept';
  assert (select lane from public.cards where id = 'k3') = 'backlog', 'card in no valid lane goes to backlog';
  assert (select count(*) from public.cards where client_visible and id in ('k1', 'k2', 'k3')) = 0, 'nothing shared on import';
  assert (select title from public.cards where id = 'k1') = 'Rob''s "launch" post', 'title intact';
  assert (select minutes from public.card_updates where id = 'u1') = 45, 'time entry kept';
  assert (select storage_path from public.attachments where id = 'att_0001') = 'cl2/att_0001/brief_v2.pdf', 'storage path';
  assert (select count(*) from public.project_milestones where project_id = 'pr1') = 1, 'milestone without id gets one';
  assert (select count(*) from public.expenses where id = 'e1') = 1, 'expense kept';
  assert (select count(*) from public.orphaned_events where event_id = 'evt-1') = 1, 'orphaned event kept';
end;
$$;
\echo 'Import test passed.'
