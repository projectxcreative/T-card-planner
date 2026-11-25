-- Let signed-in devices hear about each other's changes. Realtime applies the
-- same row-level security, so a client login hears nothing from these tables.
alter publication supabase_realtime add table
  public.clients, public.categories, public.update_categories, public.projects,
  public.project_milestones, public.expenses, public.cards, public.card_tags,
  public.card_updates, public.attachments, public.orphaned_events;
