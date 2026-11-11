-- =============================================================================
-- Neighborly · 0002 · Row-level security, column grants, guard triggers
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper predicates (SECURITY DEFINER so policies don't recurse through RLS)
-- ---------------------------------------------------------------------------
create or replace function private.try_uuid(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

create or replace function private.is_active_member(p_circle uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.circle_members m
    where m.circle_id = p_circle and m.user_id = auth.uid() and m.status = 'active');
$$;

create or replace function private.is_circle_staff(p_circle uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.circle_members m
    where m.circle_id = p_circle and m.user_id = auth.uid()
      and m.status = 'active' and m.role in ('moderator', 'admin'));
$$;

create or replace function private.is_circle_admin(p_circle uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.circle_members m
    where m.circle_id = p_circle and m.user_id = auth.uid()
      and m.status = 'active' and m.role = 'admin');
$$;

create or replace function private.shares_circle(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.circle_members me
    join public.circle_members them on them.circle_id = me.circle_id
    where me.user_id = auth.uid() and me.status = 'active'
      and them.user_id = p_user and them.status in ('active', 'pending'));
$$;

create or replace function private.is_loan_party(p_loan uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.loans l
    where l.id = p_loan and auth.uid() in (l.lender_id, l.borrower_id));
$$;

create or replace function private.can_view_loan(p_loan uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.loans l
    where l.id = p_loan
      and (auth.uid() in (l.lender_id, l.borrower_id)
           or (l.status in ('disputed', 'resolved') and private.is_circle_staff(l.circle_id))));
$$;

-- Policies run as the caller, so the caller needs to reach these helpers.
grant usage on schema private to authenticated;
grant execute on function
  private.try_uuid(text), private.is_active_member(uuid), private.is_circle_staff(uuid),
  private.is_circle_admin(uuid), private.shares_circle(uuid), private.is_loan_party(uuid),
  private.can_view_loan(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Lock everything down, then grant back the minimum.
-- ---------------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

alter table public.profiles        enable row level security;
alter table public.circles         enable row level security;
alter table public.circle_members  enable row level security;
alter table public.items           enable row level security;
alter table public.requests        enable row level security;
alter table public.request_offers  enable row level security;
alter table public.loans           enable row level security;
alter table public.handover_tokens enable row level security;
alter table public.handover_photos enable row level security;
alter table public.messages        enable row level security;
alter table public.notifications   enable row level security;
alter table public.trust_events    enable row level security;
alter table public.ratings         enable row level security;
alter table public.disputes        enable row level security;
alter table public.reports         enable row level security;

-- Profiles: see yourself and people in your circles; edit only name and bio.
grant select on public.profiles to authenticated;
grant update (display_name, bio) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or private.shares_circle(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Circles: visible to your memberships (any status). join_code is NOT granted.
grant select (id, name, kind, city, created_by, created_at) on public.circles to authenticated;
create policy circles_select on public.circles for select to authenticated
  using (exists (select 1 from public.circle_members m
                 where m.circle_id = circles.id and m.user_id = auth.uid()
                   and m.status in ('active', 'pending')));

-- Memberships: your own rows; active members see active members; staff see all.
-- unit_label (flat number) is NOT granted — exposed only via get_loan_contact / staff RPCs.
grant select (circle_id, user_id, role, status, created_at, approved_at) on public.circle_members to authenticated;
create policy members_select on public.circle_members for select to authenticated
  using (user_id = auth.uid()
         or (status = 'active' and private.is_active_member(circle_id))
         or private.is_circle_staff(circle_id));

-- Items: members browse; owners create and edit their own. No deletes (use status 'removed').
grant select on public.items to authenticated;
grant insert (circle_id, owner_id, title, description, category, condition, tier,
              min_trust, deposit_inr, max_days, photo_paths) on public.items to authenticated;
grant update (title, description, category, condition, tier, min_trust, deposit_inr,
              max_days, photo_paths, status) on public.items to authenticated;
create policy items_select on public.items for select to authenticated
  using (owner_id = auth.uid() or (status <> 'removed' and private.is_active_member(circle_id)));
create policy items_insert on public.items for insert to authenticated
  with check (owner_id = auth.uid() and private.is_active_member(circle_id));
create policy items_update on public.items for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Requests board
grant select on public.requests to authenticated;
grant insert (circle_id, requester_id, need, details, needed_by) on public.requests to authenticated;
grant update (status) on public.requests to authenticated;
create policy requests_select on public.requests for select to authenticated
  using (private.is_active_member(circle_id));
create policy requests_insert on public.requests for insert to authenticated
  with check (requester_id = auth.uid() and private.is_active_member(circle_id));
create policy requests_update on public.requests for update to authenticated
  using (requester_id = auth.uid()) with check (requester_id = auth.uid());

grant select on public.request_offers to authenticated;
create policy offers_select on public.request_offers for select to authenticated
  using (offerer_id = auth.uid()
         or exists (select 1 from public.requests r where r.id = request_id and r.requester_id = auth.uid()));

-- Loans: read-only for clients. Every change goes through RPCs.
grant select on public.loans to authenticated;
create policy loans_select on public.loans for select to authenticated
  using (private.can_view_loan(id));

-- handover_tokens: no grants, no policies → unreachable from the API.

grant select on public.handover_photos to authenticated;
create policy handover_photos_select on public.handover_photos for select to authenticated
  using (private.can_view_loan(loan_id));

-- Chat: loan parties only; sender is always the caller; closed loans are read-only.
grant select on public.messages to authenticated;
grant insert (loan_id, body) on public.messages to authenticated;
create policy messages_select on public.messages for select to authenticated
  using (private.can_view_loan(loan_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (select 1 from public.loans l
                where l.id = loan_id and auth.uid() in (l.lender_id, l.borrower_id)
                  and l.status in ('requested', 'approved', 'active', 'returned', 'disputed')));

grant select on public.notifications to authenticated;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());

grant select on public.trust_events to authenticated;
create policy trust_events_select on public.trust_events for select to authenticated
  using (user_id = auth.uid());

grant select on public.ratings to authenticated;
create policy ratings_select on public.ratings for select to authenticated
  using (auth.uid() in (rater_id, ratee_id));

grant select on public.disputes to authenticated;
create policy disputes_select on public.disputes for select to authenticated
  using (private.can_view_loan(loan_id));

grant select on public.reports to authenticated;
create policy reports_select on public.reports for select to authenticated
  using (reporter_id = auth.uid() or private.is_circle_staff(circle_id));

-- ---------------------------------------------------------------------------
-- Guard triggers: rules that hold even if a policy is ever loosened.
-- They check current_user: direct client writes run as 'authenticated';
-- SECURITY DEFINER functions run as the function owner.
-- ---------------------------------------------------------------------------
create or replace function private.items_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  p text;
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.status := 'available';
    else
      if new.owner_id <> old.owner_id or new.circle_id <> old.circle_id or new.created_at <> old.created_at then
        raise exception 'These item fields cannot be changed' using errcode = '42501';
      end if;
      if new.status is distinct from old.status then
        if old.status not in ('available', 'paused') or new.status not in ('available', 'paused', 'removed') then
          raise exception 'Item status can''t be changed while it is reserved or on loan' using errcode = '42501';
        end if;
      end if;
    end if;
  end if;

  -- Photos must live in this item's own storage folder: <circle_id>/<item_id>/<file>
  foreach p in array new.photo_paths loop
    if p !~ ('^' || new.circle_id::text || '/' || new.id::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$') then
      raise exception 'Invalid photo path' using errcode = '22023';
    end if;
  end loop;

  new.title := btrim(new.title);
  new.updated_at := now();
  return new;
end $$;

create trigger items_guard before insert or update on public.items
  for each row execute function private.items_guard();

create or replace function private.requests_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.status := 'open';
      if new.needed_by is not null and new.needed_by < current_date - 1 then
        raise exception 'Needed-by date is in the past' using errcode = '22023';
      end if;
    elsif new.status = 'open' and old.status <> 'open' then
      raise exception 'A closed request cannot be reopened' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger requests_guard before insert or update on public.requests
  for each row execute function private.requests_guard();

-- Profiles: trust_score is only ever changed by trust_events (not grantable, but belt and braces).
create or replace function private.profiles_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and new.trust_score <> old.trust_score then
    raise exception 'Trust score cannot be edited' using errcode = '42501';
  end if;
  new.display_name := btrim(new.display_name);
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function private.profiles_guard();
