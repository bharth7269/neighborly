-- =============================================================================
-- Neighborly · 0004 · Storage buckets & policies, realtime, scheduled jobs
-- =============================================================================

-- Both buckets are PRIVATE: files are served only via short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('item-photos',     'item-photos',     false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('handover-photos', 'handover-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- item-photos path: <circle_id>/<item_id>/<file>
create policy "item photos: members can view" on storage.objects for select to authenticated
  using (bucket_id = 'item-photos'
         and private.is_active_member(private.try_uuid((storage.foldername(name))[1])));

create policy "item photos: owner can upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'item-photos'
              and exists (select 1 from public.items i
                           where i.id = private.try_uuid((storage.foldername(name))[2])
                             and i.circle_id = private.try_uuid((storage.foldername(name))[1])
                             and i.owner_id = auth.uid()));

create policy "item photos: owner can delete" on storage.objects for delete to authenticated
  using (bucket_id = 'item-photos'
         and exists (select 1 from public.items i
                      where i.id = private.try_uuid((storage.foldername(name))[2])
                        and i.owner_id = auth.uid()));

-- handover-photos path: <loan_id>/<stage>/<user_id>/<file>
-- No insert/update/delete policy: only the handover-photo Edge Function (service role) writes,
-- so evidence cannot be replaced or deleted by either party.
create policy "handover photos: parties and moderators can view" on storage.objects for select to authenticated
  using (bucket_id = 'handover-photos'
         and private.can_view_loan(private.try_uuid((storage.foldername(name))[1])));

-- Realtime: chat and notifications (RLS applies to realtime subscriptions).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.notifications, public.loans, public.handover_photos;
  end if;
end $$;

-- Scheduled jobs (pg_cron is available on Supabase; enable it under Database → Extensions).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('neighborly-finalize-returns', '*/15 * * * *', 'select private.finalize_returned_loans()');
    perform cron.schedule('neighborly-overdue',          '0 * * * *',    'select private.flag_overdue_loans()');
    perform cron.schedule('neighborly-cleanup',          '30 3 * * *',   'select private.cleanup()');
  end if;
end $$;
