-- Attachments live in one private bucket. Paths are
--   <client id or "internal">/<attachment id>/<file name>
-- Staff read and write any of them; a client can download a file only when it
-- is listed in portal_attachments for them, i.e. both the file and its card
-- are shared and the card is theirs.

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy staff_all_attachments on storage.objects for all to authenticated
  using (bucket_id = 'attachments' and public.is_staff())
  with check (bucket_id = 'attachments' and public.is_staff());

create policy client_read_shared_attachments on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and exists (select 1 from public.portal_attachments pa where pa.storage_path = storage.objects.name)
  );
