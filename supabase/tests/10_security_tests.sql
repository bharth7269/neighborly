-- =============================================================================
-- Neighborly security & state-machine tests.
-- Each block impersonates a user the same way Supabase does:
--   role = authenticated, request.jwt.claims.sub = user id.
-- Any failed expectation aborts the run (ON_ERROR_STOP).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

create schema test;
grant usage on schema test to authenticated, anon, service_role;

-- Expect a statement to fail with a message matching pattern.
create function test.throws(p_sql text, p_pattern text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike p_pattern then return; end if;
    raise exception 'FAIL: % → wrong error "%" (wanted %)', p_sql, sqlerrm, p_pattern;
  end;
  raise exception 'FAIL: expected an error for: %', p_sql;
end $$;

create function test.eq(p_actual anyelement, p_expected anyelement, p_label text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL: % (got %, expected %)', p_label, p_actual, p_expected;
  end if;
  raise notice 'ok  %', p_label;
end $$;

create function test.pass(p_label text) returns void language plpgsql as $$
begin raise notice 'ok  %', p_label; end $$;
grant execute on all functions in schema test to authenticated, anon, service_role;

-- Fixed people
-- alice: creates the circle (admin)   bob: borrower (phone verified)
-- dan: member without phone           mona: moderator    carol: outsider (other circle)
insert into auth.users (id, email, phone_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@x.test', now(),  '{"display_name":"Alice"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@x.test',   now(),  '{"display_name":"Bob"}'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@x.test', null,   '{"display_name":"Carol"}'),
  ('00000000-0000-0000-0000-00000000000d', 'dan@x.test',   null,   '{"display_name":"Dan"}'),
  ('00000000-0000-0000-0000-00000000000e', 'mona@x.test',  now(),  '{"display_name":"<script>x</script>Mona"}');

\set alice '\'{"sub":"00000000-0000-0000-0000-00000000000a"}\''
\set bob   '\'{"sub":"00000000-0000-0000-0000-00000000000b"}\''
\set carol '\'{"sub":"00000000-0000-0000-0000-00000000000c"}\''
\set dan   '\'{"sub":"00000000-0000-0000-0000-00000000000d"}\''
\set mona  '\'{"sub":"00000000-0000-0000-0000-00000000000e"}\''

select test.eq((select count(*)::int from public.profiles), 5, 'profiles created by signup trigger');

-- Test-only driver that walks a loan through the whole lifecycle (runs as postgres).
create function test.full_loan(p_item uuid, p_lender uuid, p_borrower uuid) returns uuid
language plpgsql as $$
declare lid uuid; code text;
begin
  delete from private.rate_events;  -- tests run faster than humans; reset limits per loan
  perform set_config('request.jwt.claims', json_build_object('sub', p_borrower)::text, true);
  lid := public.request_loan(p_item, current_date, current_date + 1, 'please');
  perform set_config('request.jwt.claims', json_build_object('sub', p_lender)::text, true);
  perform public.respond_loan(lid, true);
  code := public.issue_handover_code(lid, 'pickup');
  perform public.record_handover_photo(p_lender,   lid, 'pickup', lid || '/pickup/' || p_lender   || '/a.jpg', repeat('a', 64), 100, 'image/jpeg');
  perform public.record_handover_photo(p_borrower, lid, 'pickup', lid || '/pickup/' || p_borrower || '/b.jpg', repeat('b', 64), 100, 'image/jpeg');
  perform set_config('request.jwt.claims', json_build_object('sub', p_borrower)::text, true);
  perform public.confirm_handover(lid, 'pickup', code);
  perform set_config('request.jwt.claims', json_build_object('sub', p_lender)::text, true);
  code := public.issue_handover_code(lid, 'return');
  perform public.record_handover_photo(p_lender,   lid, 'return', lid || '/return/' || p_lender   || '/c.jpg', repeat('c', 64), 100, 'image/jpeg');
  perform public.record_handover_photo(p_borrower, lid, 'return', lid || '/return/' || p_borrower || '/d.jpg', repeat('d', 64), 100, 'image/jpeg');
  perform set_config('request.jwt.claims', json_build_object('sub', p_borrower)::text, true);
  perform public.confirm_handover(lid, 'return', code);
  perform set_config('request.jwt.claims', json_build_object('sub', p_lender)::text, true);
  perform public.accept_return(lid);
  return lid;
end $$;

-- ---------------------------------------------------------------------------
\echo '--- 1. Anonymous visitors see nothing'
set role anon;
select test.throws('select * from public.items', '%permission denied%');
select test.throws('select * from public.profiles', '%permission denied%');
select test.throws($q$select public.create_circle('X', 'society', 'Chennai', 'A1')$q$, '%permission denied%');
reset role;

-- ---------------------------------------------------------------------------
\echo '--- 2. Circles and membership'
set role authenticated;
select set_config('request.jwt.claims', :alice, false);
select public.create_circle('Palm Grove Residency', 'society', 'Chennai', 'Tower A · 101') as circle_id \gset
select test.eq((select role::text from public.circle_members where user_id = auth.uid()), 'admin', 'creator becomes admin');
select test.throws('select join_code from public.circles', '%permission denied%');
select test.throws('select unit_label from public.circle_members', '%permission denied%');
select public.get_circle_invite(:'circle_id') as code \gset

select set_config('request.jwt.claims', :carol, false);
select public.create_circle('Other Place', 'society', 'Mumbai', 'Flat 9') as other_circle \gset
select test.throws(format('select public.get_circle_invite(%L)', :'circle_id'), '%moderators%');
select test.eq((select count(*)::int from public.circles where id = :'circle_id'), 0, 'outsider cannot see another circle');

select set_config('request.jwt.claims', :bob, false);
select public.join_circle(:'code', 'Tower B · 1204');
select test.eq((select status::text from public.circle_members where user_id = auth.uid() and circle_id = :'circle_id'), 'pending', 'joiner is pending');
select test.throws(format('select public.review_member(%L, %L, true)', :'circle_id', '00000000-0000-0000-0000-00000000000b'), '%moderators%');

select set_config('request.jwt.claims', :dan, false);
select public.join_circle(lower(:'code'), 'Tower C · 22');
select set_config('request.jwt.claims', :mona, false);
select public.join_circle(:'code', 'Tower D · 7');

select set_config('request.jwt.claims', :alice, false);
select test.eq((select count(*)::int from public.list_pending_members(:'circle_id')), 3, 'admin sees 3 pending with flats');
select public.review_member(:'circle_id', '00000000-0000-0000-0000-00000000000b', true);
select public.review_member(:'circle_id', '00000000-0000-0000-0000-00000000000d', true);
select public.review_member(:'circle_id', '00000000-0000-0000-0000-00000000000e', true);
select public.set_member_role(:'circle_id', '00000000-0000-0000-0000-00000000000e', 'moderator');
select test.throws(format('select public.set_member_role(%L, %L, %L)', :'circle_id', '00000000-0000-0000-0000-00000000000a', 'member'), '%own role%');

select set_config('request.jwt.claims', :carol, false);
select test.eq((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-00000000000a'), 0, 'outsider cannot see member profiles');
-- Brute-forcing invite codes is rate limited
select test.eq(public.join_circle('WRONG1', 'X'), null::uuid, 'invalid invite code returns nothing');
do $$ begin
  for i in 2..10 loop perform public.join_circle('WRONG' || i, 'X'); end loop;
end $$;
select test.throws($q$select public.join_circle('WRONG11', 'X')$q$, '%Too many attempts%');

-- ---------------------------------------------------------------------------
\echo '--- 3. Items'
select set_config('request.jwt.claims', :alice, false);
insert into public.items (circle_id, owner_id, title, category, condition)
values (:'circle_id', auth.uid(), 'Bosch drill', 'tools', 'good') returning id as drill \gset
insert into public.items (circle_id, owner_id, title, category, condition, tier, min_trust, deposit_inr)
values (:'circle_id', auth.uid(), 'Sony A7 camera', 'electronics', 'like_new', 'premium', 40, 5000) returning id as camera \gset
insert into public.items (circle_id, owner_id, title, category, condition, min_trust)
values (:'circle_id', auth.uid(), 'Telescope', 'outdoor', 'good', 80) returning id as scope \gset
select test.throws(format($q$update public.items set status = 'on_loan' where id = %L$q$, :'drill'), '%status%');
select test.throws(format($q$update public.items set photo_paths = array['../../etc/passwd'] where id = %L$q$, :'drill'), '%Invalid photo path%');
select test.throws(format($q$insert into public.items (circle_id, owner_id, title, category, condition, tier, deposit_inr) values (%L, auth.uid(), 'Free thing', 'other', 'good', 'free', 500)$q$, :'circle_id'), '%free_items_have_no_deposit%');

select set_config('request.jwt.claims', :bob, false);
select test.eq((select count(*)::int from public.items where circle_id = :'circle_id'), 3, 'member can browse items');
update public.items set title = 'hacked' where id = :'drill';
select test.eq((select title from public.items where id = :'drill'), 'Bosch drill', 'member cannot edit someone else''s item');
select test.throws(format($q$insert into public.items (circle_id, owner_id, title, category, condition) values (%L, '00000000-0000-0000-0000-00000000000a', 'Fake', 'tools', 'good')$q$, :'circle_id'), '%row-level security%');

select set_config('request.jwt.claims', :carol, false);
select test.eq((select count(*)::int from public.items where circle_id = :'circle_id'), 0, 'outsider cannot see items');
select test.throws(format('select public.request_loan(%L, current_date, current_date)', :'drill'), '%not found%');

-- ---------------------------------------------------------------------------
\echo '--- 4. Loan requests and approval'
select set_config('request.jwt.claims', :bob, false);
select test.throws(format($q$insert into public.loans (item_id, circle_id, lender_id, borrower_id, start_date, end_date, status) values (%L, %L, '00000000-0000-0000-0000-00000000000a', auth.uid(), current_date, current_date, 'completed')$q$, :'drill', :'circle_id'), '%permission denied%');
select test.throws(format('select public.request_loan(%L, current_date, current_date + 30)', :'drill'), '%within 7 days%');
select test.throws(format('select public.request_loan(%L, current_date, current_date)', :'scope'), '%below the owner%');
select public.request_loan(:'drill', current_date, current_date + 2, 'For a shelf') as loan \gset
select test.throws(format('select public.request_loan(%L, current_date, current_date)', :'drill'), '%already have an open request%');
select test.throws(format('select public.respond_loan(%L, true)', :'loan'), '%not found%');
select test.throws(format('select * from public.get_loan_contact(%L)', :'loan'), '%once the request is approved%');
select test.throws(format($q$update public.loans set status = 'completed' where id = %L$q$, :'loan'), '%permission denied%');

select set_config('request.jwt.claims', :dan, false);
select test.throws(format('select public.request_loan(%L, current_date, current_date)', :'camera'), '%verified phone%');
select public.request_loan(:'drill', current_date, current_date) as dan_loan \gset

select set_config('request.jwt.claims', :alice, false);
select public.respond_loan(:'loan', true);
select test.eq((select status::text from public.loans where id = :'dan_loan'), 'declined', 'competing request auto-declined');
select test.eq((select status::text from public.items where id = :'drill'), 'reserved', 'approved item is reserved');
select test.throws(format($q$update public.items set status = 'available' where id = %L$q$, :'drill'), '%reserved or on loan%');

select set_config('request.jwt.claims', :bob, false);
select test.eq((select unit_label from public.get_loan_contact(:'loan')), 'Tower A · 101', 'borrower gets owner flat after approval');

-- ---------------------------------------------------------------------------
\echo '--- 5. QR handover with two-sided photos'
select test.throws(format($q$select public.issue_handover_code(%L, 'pickup')$q$, :'loan'), '%Only the owner%');
select test.throws(format($q$select public.record_handover_photo(auth.uid(), %L, 'pickup', 'x', repeat('a',64), 1, 'image/jpeg')$q$, :'loan'), '%permission denied%');

select set_config('request.jwt.claims', :alice, false);
select public.issue_handover_code(:'loan', 'pickup') as code1 \gset
select set_config('request.jwt.claims', :bob, false);
select test.throws(format($q$select public.confirm_handover(%L, 'pickup', %L)$q$, :'loan', :'code1'), '%photos first%');

reset role; set role service_role;
select test.throws(format($q$select public.record_handover_photo('00000000-0000-0000-0000-00000000000c', %L, 'pickup', %L, repeat('a',64), 10, 'image/jpeg')$q$, :'loan', :'loan' || '/pickup/00000000-0000-0000-0000-00000000000c/x.jpg'), '%not found%');
select test.throws(format($q$select public.record_handover_photo('00000000-0000-0000-0000-00000000000b', %L, 'pickup', %L, repeat('a',64), 10, 'image/jpeg')$q$, :'loan', :'loan' || '/pickup/00000000-0000-0000-0000-00000000000a/x.jpg'), '%Invalid storage path%');
select public.record_handover_photo('00000000-0000-0000-0000-00000000000a', :'loan', 'pickup', :'loan' || '/pickup/00000000-0000-0000-0000-00000000000a/1.jpg', repeat('a',64), 1000, 'image/jpeg');
select public.record_handover_photo('00000000-0000-0000-0000-00000000000b', :'loan', 'pickup', :'loan' || '/pickup/00000000-0000-0000-0000-00000000000b/1.jpg', repeat('b',64), 1000, 'image/jpeg');
reset role; set role authenticated;

select set_config('request.jwt.claims', :bob, false);
select test.eq(public.confirm_handover(:'loan', 'pickup', 'deadbeef'), null::public.loan_status, 'wrong QR code rejected');
select test.eq(public.confirm_handover(:'loan', 'pickup', :'code1')::text, 'active', 'correct QR + photos starts the loan');
select test.throws(format($q$select public.confirm_handover(%L, 'pickup', %L)$q$, :'loan', :'code1'), '%not ready%');
select test.eq((select status::text from public.items where id = :'drill'), 'on_loan', 'item is on loan');

-- Expired code
select set_config('request.jwt.claims', :alice, false);
select public.issue_handover_code(:'loan', 'return') as code2 \gset
reset role;
update public.handover_tokens set expires_at = now() - interval '1 second' where loan_id = :'loan' and stage = 'return';
set role authenticated;
select set_config('request.jwt.claims', :bob, false);
select test.eq(public.confirm_handover(:'loan', 'return', :'code2'), null::public.loan_status, 'expired QR code rejected');

-- ---------------------------------------------------------------------------
\echo '--- 6. Chat'
insert into public.messages (loan_id, body) values (:'loan', 'See you at 6pm');
select test.throws(format($q$insert into public.messages (loan_id, sender_id, body) values (%L, '00000000-0000-0000-0000-00000000000a', 'spoof')$q$, :'loan'), '%permission denied%');
select set_config('request.jwt.claims', :alice, false);
select test.eq((select count(*)::int from public.notifications where kind = 'message'), 1, 'lender notified of message');
select set_config('request.jwt.claims', :dan, false);
select test.eq((select count(*)::int from public.messages where loan_id = :'loan'), 0, 'other members cannot read the chat');
select test.throws(format($q$insert into public.messages (loan_id, body) values (%L, 'hi')$q$, :'loan'), '%row-level security%');
select test.eq((select count(*)::int from public.notifications where kind = 'loan.approved'), 0, 'cannot see others'' notifications');

-- ---------------------------------------------------------------------------
\echo '--- 7. Return and trust'
select set_config('request.jwt.claims', :alice, false);
select public.issue_handover_code(:'loan', 'return') as code3 \gset
reset role; set role service_role;
select public.record_handover_photo('00000000-0000-0000-0000-00000000000a', :'loan', 'return', :'loan' || '/return/00000000-0000-0000-0000-00000000000a/1.jpg', repeat('c',64), 1000, 'image/jpeg');
select public.record_handover_photo('00000000-0000-0000-0000-00000000000b', :'loan', 'return', :'loan' || '/return/00000000-0000-0000-0000-00000000000b/1.jpg', repeat('d',64), 1000, 'image/jpeg');
reset role; set role authenticated;
select set_config('request.jwt.claims', :bob, false);
select test.eq(public.confirm_handover(:'loan', 'return', :'code3')::text, 'returned', 'return handover');
select test.throws(format('select public.accept_return(%L)', :'loan'), '%not found%');
select set_config('request.jwt.claims', :alice, false);
select public.accept_return(:'loan');
select test.eq((select trust_score from public.profiles where id = '00000000-0000-0000-0000-00000000000b'), 52::smallint, 'borrower +2 for a free item');
select test.eq((select trust_score from public.profiles where id = '00000000-0000-0000-0000-00000000000a'), 51::smallint, 'lender +1');
select test.eq((select status::text from public.items where id = :'drill'), 'available', 'item available again');

select set_config('request.jwt.claims', :bob, false);
select test.throws('update public.profiles set trust_score = 100 where id = auth.uid()', '%permission denied%');
select public.rate_neighbour(:'loan', 5::smallint, 'Great drill');
select test.throws(format('select public.rate_neighbour(%L, 1::smallint)', :'loan'), '%already rated%');
update public.profiles set display_name = '  Bobby  ' where id = auth.uid();
select test.eq((select display_name from public.profiles where id = auth.uid()), 'Bobby', 'profile name trimmed');

-- ---------------------------------------------------------------------------
\echo '--- 8. Trust farming is capped'
reset role;
select test.full_loan(:'drill', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
select test.full_loan(:'drill', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
select test.full_loan(:'drill', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
select test.full_loan(:'drill', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
select test.eq((select trust_score from public.profiles where id = '00000000-0000-0000-0000-00000000000b'), 56::smallint, 'same-pair gains stop after 3 loans in 30 days');

-- ---------------------------------------------------------------------------
\echo '--- 9. Disputes'
set role authenticated;
select set_config('request.jwt.claims', :bob, false);
select public.request_loan(:'camera', current_date, current_date + 1) as cam_loan \gset
select set_config('request.jwt.claims', :alice, false);
select public.respond_loan(:'cam_loan', true);
select public.issue_handover_code(:'cam_loan', 'pickup') as code4 \gset
reset role; set role service_role;
select public.record_handover_photo('00000000-0000-0000-0000-00000000000a', :'cam_loan', 'pickup', :'cam_loan' || '/pickup/00000000-0000-0000-0000-00000000000a/1.jpg', repeat('e',64), 1000, 'image/jpeg');
select public.record_handover_photo('00000000-0000-0000-0000-00000000000b', :'cam_loan', 'pickup', :'cam_loan' || '/pickup/00000000-0000-0000-0000-00000000000b/1.jpg', repeat('f',64), 1000, 'image/jpeg');
reset role; set role authenticated;
select set_config('request.jwt.claims', :bob, false);
select public.confirm_handover(:'cam_loan', 'pickup', :'code4');
select set_config('request.jwt.claims', :alice, false);
select test.throws(format($q$select public.raise_dispute(%L, 'short')$q$, :'cam_loan'), '%disputes_reason_check%');
select public.raise_dispute(:'cam_loan', 'Lens came back scratched, see photos');
select test.throws(format($q$select public.resolve_dispute(%L, 'borrower_at_fault', 'self', 0)$q$, :'cam_loan'), '%part of%');
select set_config('request.jwt.claims', :dan, false);
select test.throws(format($q$select public.resolve_dispute(%L, 'no_fault', 'x', 0)$q$, :'cam_loan'), '%Only circle moderators%');
select test.eq((select count(*)::int from public.handover_photos where loan_id = :'cam_loan'), 0, 'non-moderators cannot see dispute evidence');
select set_config('request.jwt.claims', :mona, false);
select test.eq((select count(*)::int from public.handover_photos where loan_id = :'cam_loan'), 2, 'moderator sees the photo timeline');
select test.throws(format($q$select public.resolve_dispute(%L, 'borrower_at_fault', 'x', 99999)$q$, :'cam_loan'), '%between 0 and 5000%');
select public.resolve_dispute(:'cam_loan', 'borrower_at_fault', 'Scratch visible only in return photos', 2000);
select test.eq((select trust_score from public.profiles where id = '00000000-0000-0000-0000-00000000000b'), 41::smallint, 'at-fault borrower loses 15');
select test.eq((select status::text from public.items where id = :'camera'), 'paused', 'damaged item paused for inspection');

-- ---------------------------------------------------------------------------
\echo '--- 10. Storage'
reset role;
insert into storage.objects (bucket_id, name) values
  ('item-photos', :'circle_id' || '/' || :'drill' || '/p1.jpg'),
  ('handover-photos', :'loan' || '/pickup/00000000-0000-0000-0000-00000000000a/1.jpg');
set role authenticated;
select set_config('request.jwt.claims', :dan, false);
select test.eq((select count(*)::int from storage.objects where bucket_id = 'item-photos'), 1, 'member can view item photos');
select test.eq((select count(*)::int from storage.objects where bucket_id = 'handover-photos'), 0, 'non-party cannot view handover photos');
select test.throws(format($q$insert into storage.objects (bucket_id, name) values ('item-photos', %L)$q$, :'circle_id' || '/' || :'drill' || '/evil.jpg'), '%row-level security%');
select set_config('request.jwt.claims', :bob, false);
select test.eq((select count(*)::int from storage.objects where bucket_id = 'handover-photos'), 1, 'party can view handover photos');
select test.throws(format($q$insert into storage.objects (bucket_id, name) values ('handover-photos', %L)$q$, :'loan' || '/pickup/x/fake.jpg'), '%row-level security%');
select set_config('request.jwt.claims', :carol, false);
select test.eq((select count(*)::int from storage.objects), 0, 'outsider sees no files');
select set_config('request.jwt.claims', :alice, false);
insert into storage.objects (bucket_id, name) values ('item-photos', :'circle_id' || '/' || :'drill' || '/p2.jpg');
select test.pass('owner can upload item photos');
reset role;

-- ---------------------------------------------------------------------------
\echo '--- 11. Account deletion guard and audit trail'
select test.eq(public.account_deletion_blockers('00000000-0000-0000-0000-00000000000b'), 0, 'no live loans block deletion');
select test.eq((select count(*)::int from private.audit_log where action = 'dispute.resolve'), 1, 'dispute resolution audited');
set role authenticated;
select test.throws('select * from private.audit_log', '%permission denied%');
reset role;

\echo ''
\echo 'ALL SECURITY TESTS PASSED'
