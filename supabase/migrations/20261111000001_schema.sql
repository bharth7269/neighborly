-- =============================================================================
-- Neighborly · 0001 · Schema
-- Tables, types, indexes and constraints.
-- Security model: every table has RLS; clients get the narrowest column grants;
-- every state change on loans, memberships, trust and disputes goes through
-- SECURITY DEFINER functions (see 0003_functions.sql). Never trust the client.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- Internal schema: NOT exposed through the Supabase API.
create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.circle_kind     as enum ('society', 'campus', 'other');
create type public.member_role     as enum ('member', 'moderator', 'admin');
create type public.member_status   as enum ('pending', 'active', 'rejected', 'suspended');
create type public.item_tier       as enum ('free', 'protected', 'premium');
create type public.item_condition  as enum ('new', 'like_new', 'good', 'fair');
create type public.item_status     as enum ('available', 'reserved', 'on_loan', 'paused', 'removed');
create type public.loan_status     as enum ('requested', 'approved', 'declined', 'cancelled',
                                            'active', 'returned', 'completed', 'disputed', 'resolved');
create type public.handover_stage  as enum ('pickup', 'return');
create type public.request_status  as enum ('open', 'fulfilled', 'closed');
create type public.dispute_outcome as enum ('no_fault', 'borrower_at_fault', 'lender_at_fault');

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users; created by trigger on signup)
-- Phone/email stay in auth.users and are never copied here.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 60),
  bio          text check (char_length(bio) <= 280),
  trust_score  smallint not null default 50 check (trust_score between 0 and 100),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Circles (an apartment society, campus, ...) and memberships
-- ---------------------------------------------------------------------------
create table public.circles (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 3 and 80),
  kind       public.circle_kind not null default 'society',
  city       text check (char_length(city) <= 60),
  join_code  text not null unique,             -- column hidden from clients (see grants)
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.circle_members (
  circle_id   uuid not null references public.circles (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        public.member_role   not null default 'member',
  status      public.member_status not null default 'pending',
  unit_label  text not null check (char_length(btrim(unit_label)) between 1 and 40), -- e.g. "Tower B · 1204"; hidden column
  created_at  timestamptz not null default now(),
  approved_at timestamptz,
  primary key (circle_id, user_id)
);
create index circle_members_user_idx on public.circle_members (user_id);

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------
create table public.items (
  id          uuid primary key default gen_random_uuid(),
  circle_id   uuid not null references public.circles (id) on delete cascade,
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 3 and 80),
  description text not null default '' check (char_length(description) <= 1000),
  category    text not null check (category in ('tools', 'kitchen', 'electronics', 'outdoor',
                                                'sports', 'party', 'kids', 'books', 'other')),
  condition   public.item_condition not null,
  tier        public.item_tier not null default 'free',
  min_trust   smallint not null default 0 check (min_trust between 0 and 100),
  deposit_inr integer  not null default 0 check (deposit_inr between 0 and 100000),
  max_days    smallint not null default 7 check (max_days between 1 and 30),
  status      public.item_status not null default 'available',
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 6),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint free_items_have_no_deposit check (tier <> 'free' or deposit_inr = 0)
);
create index items_circle_status_idx on public.items (circle_id, status);
create index items_owner_idx on public.items (owner_id);

-- ---------------------------------------------------------------------------
-- Requests board ("Need a ladder on Saturday")
-- ---------------------------------------------------------------------------
create table public.requests (
  id           uuid primary key default gen_random_uuid(),
  circle_id    uuid not null references public.circles (id) on delete cascade,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  need         text not null check (char_length(btrim(need)) between 3 and 140),
  details      text not null default '' check (char_length(details) <= 500),
  needed_by    date,
  status       public.request_status not null default 'open',
  created_at   timestamptz not null default now()
);
create index requests_circle_status_idx on public.requests (circle_id, status, created_at desc);

create table public.request_offers (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  offerer_id uuid not null references public.profiles (id) on delete cascade,
  item_id    uuid references public.items (id) on delete set null,
  note       text not null default '' check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  unique (request_id, offerer_id)
);

-- ---------------------------------------------------------------------------
-- Loans and the handover protocol
-- ---------------------------------------------------------------------------
create table public.loans (
  id                  uuid primary key default gen_random_uuid(),
  item_id             uuid not null references public.items (id) on delete cascade,
  circle_id           uuid not null references public.circles (id) on delete cascade,
  lender_id           uuid references public.profiles (id) on delete set null,
  borrower_id         uuid references public.profiles (id) on delete set null,
  status              public.loan_status not null default 'requested',
  start_date          date not null,
  end_date            date not null,
  message             text not null default '' check (char_length(message) <= 500),
  deposit_inr         integer not null default 0 check (deposit_inr >= 0),
  approved_at         timestamptz,
  started_at          timestamptz,
  due_at              timestamptz,
  returned_at         timestamptz,
  closed_at           timestamptz,
  overdue_notified_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint loan_dates_ordered check (end_date >= start_date),
  constraint loan_two_people    check (lender_id is null or borrower_id is null or lender_id <> borrower_id)
);
create index loans_lender_idx   on public.loans (lender_id, status);
create index loans_borrower_idx on public.loans (borrower_id, status);
-- A borrower can have only one open request/loan per item.
create unique index loans_one_open_per_borrower on public.loans (item_id, borrower_id)
  where status in ('requested', 'approved', 'active', 'returned', 'disputed');
-- An item can be in only one live loan at a time.
create unique index loans_one_live_per_item on public.loans (item_id)
  where status in ('approved', 'active', 'returned', 'disputed');

-- One-time QR codes. Only the SHA-256 of the code is stored. No client access.
create table public.handover_tokens (
  loan_id    uuid not null references public.loans (id) on delete cascade,
  stage      public.handover_stage not null,
  token_hash bytea not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  primary key (loan_id, stage)
);

-- Condition photos. Written ONLY by the handover-photo Edge Function (service role),
-- which computes the SHA-256 on the server and stamps the server time.
create table public.handover_photos (
  id           uuid primary key default gen_random_uuid(),
  loan_id      uuid not null references public.loans (id) on delete cascade,
  stage        public.handover_stage not null,
  taken_by     uuid references public.profiles (id) on delete set null,
  storage_path text not null unique,
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size    integer not null check (byte_size between 1 and 5242880),
  mime_type    text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  server_time  timestamptz not null default now()
);
create index handover_photos_loan_idx on public.handover_photos (loan_id, stage);

-- ---------------------------------------------------------------------------
-- Chat, notifications, trust, ratings, disputes, reports
-- ---------------------------------------------------------------------------
create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  loan_id    uuid not null references public.loans (id) on delete cascade,
  sender_id  uuid references public.profiles (id) on delete set null default auth.uid(),
  body       text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index messages_loan_idx on public.messages (loan_id, created_at);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text not null default '',
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.trust_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  loan_id    uuid references public.loans (id) on delete set null,
  delta      smallint not null check (delta between -50 and 50),
  reason     text not null,
  created_at timestamptz not null default now()
);
create index trust_events_user_idx on public.trust_events (user_id, created_at desc);
-- A loan can affect a user's score for a given reason only once.
create unique index trust_events_once on public.trust_events (user_id, loan_id, reason) where loan_id is not null;

create table public.ratings (
  loan_id    uuid not null references public.loans (id) on delete cascade,
  rater_id   uuid not null references public.profiles (id) on delete cascade,
  ratee_id   uuid not null references public.profiles (id) on delete cascade,
  stars      smallint not null check (stars between 1 and 5),
  comment    text not null default '' check (char_length(comment) <= 300),
  created_at timestamptz not null default now(),
  primary key (loan_id, rater_id),
  check (rater_id <> ratee_id)
);

create table public.disputes (
  loan_id               uuid primary key references public.loans (id) on delete cascade,
  raised_by             uuid references public.profiles (id) on delete set null,
  reason                text not null check (char_length(btrim(reason)) between 10 and 1000),
  status                text not null default 'open' check (status in ('open', 'resolved')),
  moderator_id          uuid references public.profiles (id) on delete set null,
  outcome               public.dispute_outcome,
  notes                 text check (char_length(notes) <= 1000),
  deposit_to_lender_inr integer check (deposit_to_lender_inr >= 0),
  created_at            timestamptz not null default now(),
  resolved_at           timestamptz
);

create table public.reports (
  id             uuid primary key default gen_random_uuid(),
  circle_id      uuid not null references public.circles (id) on delete cascade,
  reporter_id    uuid references public.profiles (id) on delete set null,
  target_user_id uuid references public.profiles (id) on delete cascade,
  target_item_id uuid references public.items (id) on delete cascade,
  reason         text not null check (char_length(btrim(reason)) between 5 and 500),
  status         text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at     timestamptz not null default now(),
  check (target_user_id is not null or target_item_id is not null)
);

-- ---------------------------------------------------------------------------
-- Private: audit log and rate limiting (never reachable from the API)
-- ---------------------------------------------------------------------------
create table private.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid,
  action     text not null,
  entity     text not null,
  entity_id  uuid,
  details    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on private.audit_log (entity, entity_id);

create table private.rate_events (
  user_id    uuid not null,
  action     text not null,
  created_at timestamptz not null default now()
);
create index rate_events_lookup_idx on private.rate_events (user_id, action, created_at desc);
