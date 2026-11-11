-- =============================================================================
-- Neighborly · 0003 · Server functions (the only way state changes)
-- All functions: SECURITY DEFINER, empty search_path, fully-qualified names,
-- explicit authorization checks, row locks on the rows they change.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Internal utilities
-- ---------------------------------------------------------------------------
create or replace function private.require_user() returns uuid
language plpgsql stable set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Please sign in' using errcode = '28000';
  end if;
  return uid;
end $$;

-- Sliding-window rate limit per user and action.
create or replace function private.rate_limit(p_user uuid, p_action text, p_max int, p_window interval)
returns void language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  select count(*) into n from private.rate_events
   where user_id = p_user and action = p_action and created_at > now() - p_window;
  if n >= p_max then
    raise exception 'Too many attempts. Please wait and try again.' using errcode = 'P0429';
  end if;
  insert into private.rate_events (user_id, action) values (p_user, p_action);
end $$;

create or replace function private.audit(p_action text, p_entity text, p_id uuid, p_details jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into private.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), p_action, p_entity, p_id, coalesce(p_details, '{}'));
$$;

create or replace function private.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, title, body, link)
  select p_user, p_kind, p_title, coalesce(p_body, ''), p_link where p_user is not null;
$$;

create or replace function private.notify_staff(p_circle uuid, p_kind text, p_title text, p_body text, p_link text, p_except uuid[] default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, title, body, link)
  select m.user_id, p_kind, p_title, coalesce(p_body, ''), p_link
    from public.circle_members m
   where m.circle_id = p_circle and m.status = 'active' and m.role in ('moderator', 'admin')
     and not (m.user_id = any (p_except));
$$;

create or replace function private.add_trust(p_user uuid, p_loan uuid, p_delta int, p_reason text)
returns void language sql security definer set search_path = '' as $$
  insert into public.trust_events (user_id, loan_id, delta, reason)
  select p_user, p_loan, p_delta, p_reason where p_user is not null and p_delta <> 0
  on conflict do nothing;
$$;

-- trust_events → profiles.trust_score (clamped 0..100)
create or replace function private.apply_trust_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles
     set trust_score = greatest(0, least(100, trust_score + new.delta))
   where id = new.user_id;
  return new;
end $$;
create trigger trust_events_apply after insert on public.trust_events
  for each row execute function private.apply_trust_event();

-- New auth user → profile
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n text := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
begin
  if char_length(n) < 2 or char_length(n) > 60 then n := 'Neighbour'; end if;
  insert into public.profiles (id, display_name) values (new.id, n) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Chat flood protection
create or replace function private.messages_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.rate_limit(new.sender_id, 'message', 20, interval '1 minute');
  new.body := btrim(new.body);
  return new;
end $$;
create trigger messages_rate_limit before insert on public.messages
  for each row execute function private.messages_rate_limit();

-- Notify the other party of a new chat message
create or replace function private.messages_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l public.loans;
begin
  select * into l from public.loans where id = new.loan_id;
  perform private.notify(
    case when new.sender_id = l.lender_id then l.borrower_id else l.lender_id end,
    'message', 'New message', left(new.body, 120), '/loans/' || l.id);
  return new;
end $$;
create trigger messages_notify after insert on public.messages
  for each row execute function private.messages_notify();

-- ---------------------------------------------------------------------------
-- Circles & membership
-- ---------------------------------------------------------------------------
create or replace function public.create_circle(p_name text, p_kind public.circle_kind, p_city text, p_unit text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  cid uuid;
begin
  perform private.rate_limit(uid, 'create_circle', 3, interval '1 day');
  insert into public.circles (name, kind, city, join_code, created_by)
  values (btrim(p_name), p_kind, nullif(btrim(p_city), ''),
          upper(encode(extensions.gen_random_bytes(5), 'hex')), uid)
  returning id into cid;
  insert into public.circle_members (circle_id, user_id, role, status, unit_label, approved_at)
  values (cid, uid, 'admin', 'active', btrim(p_unit), now());
  perform private.audit('circle.create', 'circle', cid);
  return cid;
end $$;

create or replace function public.join_circle(p_code text, p_unit text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  c public.circles;
  m public.circle_members;
begin
  -- 40-bit codes + 10 tries/hour makes guessing impractical.
  perform private.rate_limit(uid, 'join_circle', 10, interval '1 hour');
  select * into c from public.circles where join_code = upper(btrim(p_code));
  if not found then
    -- Return NULL instead of raising: an exception would roll back the rate-limit
    -- record and make brute-forcing codes free. The client shows "invalid code".
    return null;
  end if;

  select * into m from public.circle_members where circle_id = c.id and user_id = uid for update;
  if found then
    if m.status = 'suspended' then
      raise exception 'Your membership in this circle is suspended' using errcode = '42501';
    elsif m.status = 'rejected' then
      update public.circle_members set status = 'pending', unit_label = btrim(p_unit), created_at = now()
       where circle_id = c.id and user_id = uid;
    end if;
  else
    insert into public.circle_members (circle_id, user_id, unit_label) values (c.id, uid, btrim(p_unit));
  end if;

  perform private.notify_staff(c.id, 'member.pending', 'New join request',
                               'Someone asked to join ' || c.name || '. Please verify their flat.',
                               '/circle/' || c.id || '/members');
  perform private.audit('circle.join_request', 'circle', c.id);
  return c.id;
end $$;

create or replace function public.list_pending_members(p_circle uuid)
returns table (user_id uuid, display_name text, unit_label text, requested_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_circle_staff(p_circle) then
    raise exception 'Only circle moderators can do this' using errcode = '42501';
  end if;
  return query
    select m.user_id, p.display_name, m.unit_label, m.created_at
      from public.circle_members m join public.profiles p on p.id = m.user_id
     where m.circle_id = p_circle and m.status = 'pending'
     order by m.created_at;
end $$;

create or replace function public.review_member(p_circle uuid, p_user uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  cname text;
begin
  if not private.is_circle_staff(p_circle) then
    raise exception 'Only circle moderators can do this' using errcode = '42501';
  end if;
  update public.circle_members
     set status = case when p_approve then 'active'::public.member_status else 'rejected' end,
         approved_at = case when p_approve then now() end
   where circle_id = p_circle and user_id = p_user and status = 'pending';
  if not found then
    raise exception 'No pending request for this person' using errcode = 'P0002';
  end if;
  select name into cname from public.circles where id = p_circle;
  perform private.notify(p_user, 'member.reviewed',
    case when p_approve then 'Welcome to ' || cname else 'Join request declined' end,
    case when p_approve then 'You can now borrow and lend in this circle.' else 'Contact the circle admin if this is a mistake.' end,
    '/');
  perform private.audit(case when p_approve then 'member.approve' else 'member.reject' end,
                        'circle', p_circle, jsonb_build_object('user', p_user, 'by', uid));
end $$;

create or replace function public.set_member_role(p_circle uuid, p_user uuid, p_role public.member_role)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if not private.is_circle_admin(p_circle) then
    raise exception 'Only circle admins can change roles' using errcode = '42501';
  end if;
  if p_user = uid then
    raise exception 'You cannot change your own role' using errcode = '42501';
  end if;
  update public.circle_members set role = p_role
   where circle_id = p_circle and user_id = p_user and status = 'active';
  if not found then raise exception 'Member not found' using errcode = 'P0002'; end if;
  perform private.audit('member.role', 'circle', p_circle, jsonb_build_object('user', p_user, 'role', p_role));
end $$;

create or replace function public.suspend_member(p_circle uuid, p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  target_role public.member_role;
begin
  if not private.is_circle_staff(p_circle) then
    raise exception 'Only circle moderators can do this' using errcode = '42501';
  end if;
  if p_user = uid then raise exception 'You cannot suspend yourself' using errcode = '42501'; end if;
  select role into target_role from public.circle_members where circle_id = p_circle and user_id = p_user;
  if target_role = 'admin' or (target_role = 'moderator' and not private.is_circle_admin(p_circle)) then
    raise exception 'You cannot suspend this member' using errcode = '42501';
  end if;
  update public.circle_members set status = 'suspended' where circle_id = p_circle and user_id = p_user;
  perform private.audit('member.suspend', 'circle', p_circle, jsonb_build_object('user', p_user, 'reason', left(p_reason, 300)));
end $$;

create or replace function public.get_circle_invite(p_circle uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare code text;
begin
  if not private.is_circle_staff(p_circle) then
    raise exception 'Only circle moderators can see the invite code' using errcode = '42501';
  end if;
  select join_code into code from public.circles where id = p_circle;
  return code;
end $$;

create or replace function public.rotate_circle_invite(p_circle uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare code text := upper(encode(extensions.gen_random_bytes(5), 'hex'));
begin
  if not private.is_circle_admin(p_circle) then
    raise exception 'Only circle admins can do this' using errcode = '42501';
  end if;
  update public.circles set join_code = code where id = p_circle;
  perform private.audit('circle.rotate_invite', 'circle', p_circle);
  return code;
end $$;

-- ---------------------------------------------------------------------------
-- Loans: request → approve/decline → (QR + photos) active → (QR + photos) returned → completed
-- ---------------------------------------------------------------------------
create or replace function public.request_loan(p_item uuid, p_start date, p_end date, p_message text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  it public.items;
  score smallint;
  lid uuid;
begin
  perform private.rate_limit(uid, 'request_loan', 20, interval '1 day');
  select * into it from public.items where id = p_item for share;
  if not found or it.status = 'removed' or not private.is_active_member(it.circle_id) then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;
  if it.owner_id = uid then
    raise exception 'You cannot borrow your own item' using errcode = '42501';
  end if;
  if it.status <> 'available' then
    raise exception 'This item is not available right now' using errcode = 'P0409';
  end if;
  if p_start < current_date - 1 or p_start > current_date + 60 or p_end < p_start
     or (p_end - p_start + 1) > it.max_days then
    raise exception 'Please choose dates within % days, starting in the next 60 days', it.max_days using errcode = '22023';
  end if;

  select trust_score into score from public.profiles where id = uid;
  if score < it.min_trust then
    raise exception 'Your trust score (%) is below the owner''s minimum (%) for this item', score, it.min_trust
      using errcode = '42501';
  end if;
  if it.tier = 'premium' and not exists (
       select 1 from auth.users u where u.id = uid and u.phone_confirmed_at is not null) then
    raise exception 'Premium items need a verified phone number' using errcode = '42501';
  end if;

  begin
    insert into public.loans (item_id, circle_id, lender_id, borrower_id, start_date, end_date, message, deposit_inr)
    values (it.id, it.circle_id, it.owner_id, uid, p_start, p_end, left(btrim(coalesce(p_message, '')), 500), it.deposit_inr)
    returning id into lid;
  exception when unique_violation then
    raise exception 'You already have an open request for this item' using errcode = 'P0409';
  end;

  perform private.notify(it.owner_id, 'loan.requested', 'New borrow request',
                         'Someone wants to borrow your ' || it.title || '.', '/loans/' || lid);
  perform private.audit('loan.request', 'loan', lid);
  return lid;
end $$;

create or replace function public.respond_loan(p_loan uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  l public.loans;
  it public.items;
  other record;
begin
  select * into l from public.loans where id = p_loan for update;
  if not found or l.lender_id <> uid then
    raise exception 'Loan not found' using errcode = 'P0002';
  end if;
  if l.status <> 'requested' then
    raise exception 'This request was already answered' using errcode = 'P0409';
  end if;

  if not p_approve then
    update public.loans set status = 'declined', closed_at = now(), updated_at = now() where id = l.id;
    perform private.notify(l.borrower_id, 'loan.declined', 'Request declined',
                           'The owner can''t lend this item right now.', '/loans/' || l.id);
    perform private.audit('loan.decline', 'loan', l.id);
    return;
  end if;

  select * into it from public.items where id = l.item_id for update;
  if it.status <> 'available' then
    raise exception 'The item is not available (paused, reserved or on loan)' using errcode = 'P0409';
  end if;
  update public.items set status = 'reserved' where id = it.id;
  update public.loans set status = 'approved', approved_at = now(), updated_at = now() where id = l.id;

  -- Everyone else waiting for this item is told it went to someone else.
  for other in
    update public.loans set status = 'declined', closed_at = now(), updated_at = now()
     where item_id = it.id and status = 'requested' and id <> l.id
    returning id, borrower_id
  loop
    perform private.notify(other.borrower_id, 'loan.declined', 'Request declined',
                           it.title || ' was lent to another neighbour.', '/loans/' || other.id);
  end loop;

  perform private.notify(l.borrower_id, 'loan.approved', 'Request approved',
                         'Your request for ' || it.title || ' was approved. Arrange the pickup in chat.', '/loans/' || l.id);
  perform private.audit('loan.approve', 'loan', l.id);
end $$;

create or replace function public.cancel_loan(p_loan uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  l public.loans;
begin
  select * into l from public.loans where id = p_loan for update;
  if not found or uid not in (l.lender_id, l.borrower_id) then
    raise exception 'Loan not found' using errcode = 'P0002';
  end if;
  if l.status not in ('requested', 'approved') then
    raise exception 'Only requests that haven''t been picked up can be cancelled' using errcode = 'P0409';
  end if;
  update public.loans set status = 'cancelled', closed_at = now(), updated_at = now() where id = l.id;
  if l.status = 'approved' then
    update public.items set status = 'available' where id = l.item_id and status = 'reserved';
  end if;
  perform private.notify(case when uid = l.lender_id then l.borrower_id else l.lender_id end,
                         'loan.cancelled', 'Loan cancelled', 'A loan was cancelled.', '/loans/' || l.id);
  perform private.audit('loan.cancel', 'loan', l.id);
end $$;

-- Who is on the other side, and which flat to go to. Revealed only after approval.
create or replace function public.get_loan_contact(p_loan uuid)
returns table (display_name text, unit_label text)
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  l public.loans;
  other uuid;
begin
  select * into l from public.loans where id = p_loan;
  if not found or uid not in (l.lender_id, l.borrower_id) then
    raise exception 'Loan not found' using errcode = 'P0002';
  end if;
  if l.status not in ('approved', 'active', 'returned', 'disputed') then
    raise exception 'Contact details are shared once the request is approved' using errcode = '42501';
  end if;
  other := case when uid = l.lender_id then l.borrower_id else l.lender_id end;
  return query
    select p.display_name, m.unit_label
      from public.profiles p
      join public.circle_members m on m.user_id = p.id and m.circle_id = l.circle_id
     where p.id = other;
end $$;

-- Lender shows this as a QR. 128-bit, single use, 5 minutes, only its hash is stored.
create or replace function public.issue_handover_code(p_loan uuid, p_stage public.handover_stage)
returns text language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  l public.loans;
  code text := encode(extensions.gen_random_bytes(16), 'hex');
begin
  perform private.rate_limit(uid, 'handover_code', 30, interval '1 hour');
  select * into l from public.loans where id = p_loan;
  if not found or l.lender_id <> uid then
    raise exception 'Only the owner can show the handover code' using errcode = '42501';
  end if;
  if (p_stage = 'pickup' and l.status <> 'approved') or (p_stage = 'return' and l.status <> 'active') then
    raise exception 'This loan is not ready for %', p_stage using errcode = 'P0409';
  end if;
  insert into public.handover_tokens (loan_id, stage, token_hash, expires_at)
  values (l.id, p_stage, sha256(convert_to(code, 'UTF8')), now() + interval '5 minutes')
  on conflict (loan_id, stage) do update
    set token_hash = excluded.token_hash, expires_at = excluded.expires_at, used_at = null, created_at = now()
    where public.handover_tokens.used_at is null;
  if not found then
    raise exception 'This handover was already completed' using errcode = 'P0409';
  end if;
  return code;
end $$;

-- Borrower scans the lender's QR. Both must have uploaded condition photos for this stage.
create or replace function public.confirm_handover(p_loan uuid, p_stage public.handover_stage, p_code text)
returns public.loan_status language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  l public.loans;
  t public.handover_tokens;
  it_title text;
  new_status public.loan_status;
begin
  perform private.rate_limit(uid, 'handover_confirm', 10, interval '10 minutes');
  select * into l from public.loans where id = p_loan for update;
  if not found or l.borrower_id <> uid then
    raise exception 'Only the borrower can scan the handover code' using errcode = '42501';
  end if;
  if (p_stage = 'pickup' and l.status <> 'approved') or (p_stage = 'return' and l.status <> 'active') then
    raise exception 'This loan is not ready for %', p_stage using errcode = 'P0409';
  end if;

  select * into t from public.handover_tokens where loan_id = l.id and stage = p_stage for update;
  if not found or t.used_at is not null or t.expires_at < now()
     or t.token_hash <> sha256(convert_to(coalesce(p_code, ''), 'UTF8')) then
    -- NULL (not an exception) so the failed attempt still counts toward the rate limit.
    return null;
  end if;

  if not exists (select 1 from public.handover_photos where loan_id = l.id and stage = p_stage and taken_by = l.lender_id)
     or not exists (select 1 from public.handover_photos where loan_id = l.id and stage = p_stage and taken_by = l.borrower_id) then
    raise exception 'Both of you need to take condition photos first' using errcode = 'P0412';
  end if;

  update public.handover_tokens set used_at = now() where loan_id = l.id and stage = p_stage;
  select title into it_title from public.items where id = l.item_id;

  if p_stage = 'pickup' then
    new_status := 'active';
    update public.loans
       set status = 'active', started_at = now(), updated_at = now(),
           due_at = ((l.end_date + 1)::timestamp at time zone 'Asia/Kolkata')
     where id = l.id;
    update public.items set status = 'on_loan' where id = l.item_id;
    perform private.notify(l.lender_id, 'loan.active', 'Handed over', it_title || ' is now on loan.', '/loans/' || l.id);
  else
    new_status := 'returned';
    update public.loans set status = 'returned', returned_at = now(), updated_at = now() where id = l.id;
    if now() > l.due_at then
      perform private.add_trust(l.borrower_id, l.id, -5, 'late_return');
    end if;
    perform private.notify(l.lender_id, 'loan.returned', 'Item returned',
      'Check ' || it_title || '. Report any damage within 24 hours, or accept the return.', '/loans/' || l.id);
  end if;
  perform private.audit('loan.handover', 'loan', l.id, jsonb_build_object('stage', p_stage));
  return new_status;
end $$;

-- Trust: weighted by tier, capped per pair and per week so friends can't farm points.
create or replace function private.award_trust(l public.loans)
returns void language plpgsql security definer set search_path = '' as $$
declare
  tier public.item_tier;
  pair_count int;
  week_gain int;
  gain int;
begin
  select i.tier into tier from public.items i where i.id = l.item_id;
  gain := case tier when 'premium' then 6 when 'protected' then 4 else 2 end;

  select count(*) into pair_count from public.loans x
   where x.status = 'completed' and x.id <> l.id
     and x.lender_id = l.lender_id and x.borrower_id = l.borrower_id
     and x.closed_at > now() - interval '30 days';
  if pair_count >= 3 then gain := 0; end if;

  select coalesce(sum(delta), 0) into week_gain from public.trust_events
   where user_id = l.borrower_id and delta > 0 and created_at > now() - interval '7 days';
  gain := least(gain, greatest(0, 15 - week_gain));

  perform private.add_trust(l.borrower_id, l.id, gain, 'returned_on_time');
  if pair_count < 3 then
    perform private.add_trust(l.lender_id, l.id, 1, 'lent_item');
  end if;
end $$;

create or replace function private.complete_loan(p_loan uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.loans;
begin
  update public.loans set status = 'completed', closed_at = now(), updated_at = now()
   where id = p_loan and status = 'returned'
  returning * into l;
  if not found then return; end if;
  update public.items set status = 'available' where id = l.item_id and status = 'on_loan';
  perform private.award_trust(l);
  perform private.notify(l.borrower_id, 'loan.completed', 'Loan completed', 'Thanks for returning it. Rate your neighbour.', '/loans/' || l.id);
  perform private.notify(l.lender_id,  'loan.completed', 'Loan completed', 'Rate your neighbour.', '/loans/' || l.id);
  perform private.audit('loan.complete', 'loan', l.id);
end $$;

create or replace function public.accept_return(p_loan uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  l public.loans;
begin
  select * into l from public.loans where id = p_loan for update;
  if not found or l.lender_id <> uid then
    raise exception 'Loan not found' using errcode = 'P0002';
  end if;
  if l.status <> 'returned' then
    raise exception 'This loan is not waiting for return confirmation' using errcode = 'P0409';
  end if;
  perform private.complete_loan(l.id);
end $$;

-- ---------------------------------------------------------------------------
-- Disputes
-- ---------------------------------------------------------------------------
create or replace function public.raise_dispute(p_loan uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  l public.loans;
begin
  perform private.rate_limit(uid, 'dispute', 5, interval '1 day');
  select * into l from public.loans where id = p_loan for update;
  if not found or uid not in (l.lender_id, l.borrower_id) then
    raise exception 'Loan not found' using errcode = 'P0002';
  end if;
  if not (l.status = 'active' or (l.status = 'returned' and l.returned_at > now() - interval '24 hours')) then
    raise exception 'Disputes can be raised during a loan or within 24 hours of return' using errcode = 'P0409';
  end if;
  insert into public.disputes (loan_id, raised_by, reason) values (l.id, uid, btrim(p_reason));
  update public.loans set status = 'disputed', updated_at = now() where id = l.id;
  perform private.notify(case when uid = l.lender_id then l.borrower_id else l.lender_id end,
    'dispute.opened', 'A problem was reported', 'A circle moderator will review the photo timeline.', '/loans/' || l.id);
  perform private.notify_staff(l.circle_id, 'dispute.opened', 'Dispute needs review',
    'Review the handover photos and decide.', '/loans/' || l.id, array[l.lender_id, l.borrower_id]);
  perform private.audit('dispute.open', 'loan', l.id);
end $$;

create or replace function public.resolve_dispute(p_loan uuid, p_outcome public.dispute_outcome,
                                                  p_notes text, p_deposit_to_lender integer default 0)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  l public.loans;
begin
  select * into l from public.loans where id = p_loan for update;
  if not found or not private.is_circle_staff(l.circle_id) then
    raise exception 'Only circle moderators can resolve disputes' using errcode = '42501';
  end if;
  if uid in (l.lender_id, l.borrower_id) then
    raise exception 'You can''t resolve a dispute you are part of' using errcode = '42501';
  end if;
  if l.status <> 'disputed' then
    raise exception 'There is no open dispute on this loan' using errcode = 'P0409';
  end if;
  if coalesce(p_deposit_to_lender, 0) < 0 or coalesce(p_deposit_to_lender, 0) > l.deposit_inr then
    raise exception 'Deposit amount must be between 0 and %', l.deposit_inr using errcode = '22023';
  end if;

  update public.disputes
     set status = 'resolved', moderator_id = uid, outcome = p_outcome, notes = left(p_notes, 1000),
         deposit_to_lender_inr = coalesce(p_deposit_to_lender, 0), resolved_at = now()
   where loan_id = l.id;
  update public.loans set status = 'resolved', closed_at = now(), updated_at = now() where id = l.id;
  -- If the borrower damaged it, the owner should inspect before lending again.
  update public.items
     set status = case when p_outcome = 'borrower_at_fault' then 'paused'::public.item_status else 'available' end
   where id = l.item_id and status in ('on_loan', 'reserved');

  if p_outcome = 'borrower_at_fault' then
    perform private.add_trust(l.borrower_id, l.id, -15, 'dispute_at_fault');
  elsif p_outcome = 'lender_at_fault' then
    perform private.add_trust(l.lender_id, l.id, -10, 'dispute_at_fault');
  end if;

  perform private.notify(l.borrower_id, 'dispute.resolved', 'Dispute resolved', 'A moderator made a decision.', '/loans/' || l.id);
  perform private.notify(l.lender_id,   'dispute.resolved', 'Dispute resolved', 'A moderator made a decision.', '/loans/' || l.id);
  perform private.audit('dispute.resolve', 'loan', l.id,
    jsonb_build_object('outcome', p_outcome, 'deposit_to_lender', p_deposit_to_lender));
end $$;

-- ---------------------------------------------------------------------------
-- Ratings, requests board, notifications, reports
-- ---------------------------------------------------------------------------
create or replace function public.rate_neighbour(p_loan uuid, p_stars smallint, p_comment text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  l public.loans;
begin
  select * into l from public.loans where id = p_loan;
  if not found or uid not in (l.lender_id, l.borrower_id) then
    raise exception 'Loan not found' using errcode = 'P0002';
  end if;
  if l.status not in ('completed', 'resolved') then
    raise exception 'You can rate once the loan is finished' using errcode = 'P0409';
  end if;
  begin
    insert into public.ratings (loan_id, rater_id, ratee_id, stars, comment)
    values (l.id, uid, case when uid = l.lender_id then l.borrower_id else l.lender_id end,
            p_stars, left(btrim(coalesce(p_comment, '')), 300));
  exception when unique_violation then
    raise exception 'You already rated this loan' using errcode = 'P0409';
  end;
end $$;

create or replace function public.offer_help(p_request uuid, p_item uuid, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  r public.requests;
begin
  perform private.rate_limit(uid, 'offer_help', 30, interval '1 day');
  select * into r from public.requests where id = p_request;
  if not found or not private.is_active_member(r.circle_id) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if r.status <> 'open' then raise exception 'This request is closed' using errcode = 'P0409'; end if;
  if r.requester_id = uid then raise exception 'This is your own request' using errcode = '42501'; end if;
  if p_item is not null and not exists (
       select 1 from public.items i where i.id = p_item and i.owner_id = uid and i.circle_id = r.circle_id) then
    raise exception 'You can only offer your own items' using errcode = '42501';
  end if;
  begin
    insert into public.request_offers (request_id, offerer_id, item_id, note)
    values (r.id, uid, p_item, left(btrim(coalesce(p_note, '')), 300));
  exception when unique_violation then
    raise exception 'You already offered to help' using errcode = 'P0409';
  end;
  perform private.notify(r.requester_id, 'request.offer', 'Someone can help',
                         'A neighbour has what you asked for: ' || r.need, '/requests/' || r.id);
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
$$;

create or replace function public.report_content(p_circle uuid, p_user uuid, p_item uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  perform private.rate_limit(uid, 'report', 10, interval '1 day');
  if not private.is_active_member(p_circle) then
    raise exception 'Not a member of this circle' using errcode = '42501';
  end if;
  insert into public.reports (circle_id, reporter_id, target_user_id, target_item_id, reason)
  values (p_circle, uid, p_user, p_item, btrim(p_reason));
  perform private.notify_staff(p_circle, 'report.new', 'New report', 'A member reported something. Please review.',
                               '/circle/' || p_circle || '/members', array[uid]);
end $$;

-- ---------------------------------------------------------------------------
-- Service-role-only functions (called by Edge Functions after verifying the JWT)
-- ---------------------------------------------------------------------------
create or replace function public.check_handover_upload(p_user uuid, p_loan uuid, p_stage public.handover_stage)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare l public.loans;
begin
  select * into l from public.loans where id = p_loan;
  if not found or p_user not in (l.lender_id, l.borrower_id) then
    raise exception 'Loan not found' using errcode = 'P0002';
  end if;
  if (p_stage = 'pickup' and l.status <> 'approved') or (p_stage = 'return' and l.status <> 'active') then
    raise exception 'Photos for % can''t be added now', p_stage using errcode = 'P0409';
  end if;
  if (select count(*) from public.handover_photos
       where loan_id = p_loan and stage = p_stage and taken_by = p_user) >= 4 then
    raise exception 'You can add up to 4 photos per handover' using errcode = 'P0409';
  end if;
  return l.circle_id;
end $$;

create or replace function public.record_handover_photo(p_user uuid, p_loan uuid, p_stage public.handover_stage,
                                                        p_path text, p_sha256 text, p_size integer, p_mime text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare pid uuid;
begin
  perform public.check_handover_upload(p_user, p_loan, p_stage);
  if p_path not like (p_loan::text || '/' || p_stage::text || '/' || p_user::text || '/%') then
    raise exception 'Invalid storage path' using errcode = '22023';
  end if;
  insert into public.handover_photos (loan_id, stage, taken_by, storage_path, sha256, byte_size, mime_type)
  values (p_loan, p_stage, p_user, p_path, lower(p_sha256), p_size, p_mime)
  returning id into pid;
  insert into private.audit_log (actor_id, action, entity, entity_id, details)
  values (p_user, 'photo.record', 'loan', p_loan, jsonb_build_object('stage', p_stage, 'sha256', p_sha256));
  return pid;
end $$;

create or replace function public.account_deletion_blockers(p_user uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.loans
   where p_user in (lender_id, borrower_id) and status in ('approved', 'active', 'returned', 'disputed');
$$;

-- ---------------------------------------------------------------------------
-- Scheduled jobs (pg_cron, run as postgres)
-- ---------------------------------------------------------------------------
create or replace function private.finalize_returned_loans()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from public.loans where status = 'returned' and returned_at < now() - interval '24 hours' loop
    perform private.complete_loan(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function private.flag_overdue_loans()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in
    update public.loans set overdue_notified_at = now()
     where status = 'active' and due_at < now() and overdue_notified_at is null
    returning id, lender_id, borrower_id
  loop
    perform private.notify(r.borrower_id, 'loan.overdue', 'Return overdue', 'Please return the item today.', '/loans/' || r.id);
    perform private.notify(r.lender_id, 'loan.overdue', 'Item overdue', 'Your item is past its return date.', '/loans/' || r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function private.cleanup()
returns void language sql security definer set search_path = '' as $$
  delete from private.rate_events where created_at < now() - interval '2 days';
  delete from public.handover_tokens where used_at is null and expires_at < now() - interval '1 day';
  delete from public.notifications where read_at < now() - interval '90 days';
$$;

-- ---------------------------------------------------------------------------
-- Execute permissions: nothing by default, then exactly what each role needs.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public  from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

grant execute on function
  private.try_uuid(text), private.is_active_member(uuid), private.is_circle_staff(uuid),
  private.is_circle_admin(uuid), private.shares_circle(uuid), private.is_loan_party(uuid),
  private.can_view_loan(uuid)
  to authenticated;

grant execute on function
  public.create_circle(text, public.circle_kind, text, text),
  public.join_circle(text, text),
  public.list_pending_members(uuid),
  public.review_member(uuid, uuid, boolean),
  public.set_member_role(uuid, uuid, public.member_role),
  public.suspend_member(uuid, uuid, text),
  public.get_circle_invite(uuid),
  public.rotate_circle_invite(uuid),
  public.request_loan(uuid, date, date, text),
  public.respond_loan(uuid, boolean),
  public.cancel_loan(uuid),
  public.get_loan_contact(uuid),
  public.issue_handover_code(uuid, public.handover_stage),
  public.confirm_handover(uuid, public.handover_stage, text),
  public.accept_return(uuid),
  public.raise_dispute(uuid, text),
  public.resolve_dispute(uuid, public.dispute_outcome, text, integer),
  public.rate_neighbour(uuid, smallint, text),
  public.offer_help(uuid, uuid, text),
  public.mark_notifications_read(uuid[]),
  public.report_content(uuid, uuid, uuid, text)
  to authenticated;

grant execute on function
  public.check_handover_upload(uuid, uuid, public.handover_stage),
  public.record_handover_photo(uuid, uuid, public.handover_stage, text, text, integer, text),
  public.account_deletion_blockers(uuid)
  to service_role;
