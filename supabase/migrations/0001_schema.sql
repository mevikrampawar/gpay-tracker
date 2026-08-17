-- =====================================================================
-- Google Pay personal finance dashboard — Supabase schema
--
-- Architecture:
--   master   : raw import sources, source records, canonical transactions, correlations
--   identity : recipient identity graph (entities, aliases, relations), categories
--   curation : user decisions (tx names, pins, confirmations audit trail)
--
-- Rules that guarantee "100% accurate representation":
--   * Money is stored as INTEGER paise (BIGINT) — no floating point drift.
--   * Raw source rows are preserved verbatim (source_records.raw jsonb).
--   * Nothing is silently guessed: every non-exact match creates a
--     correlation with status 'pending' and requires a user verdict.
--   * Every user decision is logged in curation.confirmations.
--   * RLS scopes everything to auth.uid() — only the owner can read/write.
-- =====================================================================

create schema if not exists master;
create schema if not exists identity;
create schema if not exists curation;

-- ---------------------------------------------------------------------
-- master: import sources
-- ---------------------------------------------------------------------
create table master.sources (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid(),
  kind         text not null check (kind in ('takeout', 'gpay_statement', 'bank_csv', 'bank_pdf')),
  label        text not null,
  file_name    text,
  content_hash text,                      -- guards against importing the same file twice
  period_start date,
  period_end   date,
  raw_record_count int not null default 0,
  imported_at  timestamptz not null default now(),
  unique (user_id, kind, file_name, content_hash)
);

-- Raw records exactly as imported (audit / re-derivation).
create table master.source_records (
  id          uuid primary key default gen_random_uuid(),
  source_id   uuid not null references master.sources(id) on delete cascade,
  user_id     uuid not null default auth.uid(),
  row_index   int not null,
  raw         jsonb not null,
  created_at  timestamptz not null default now(),
  unique (source_id, row_index)
);

-- ---------------------------------------------------------------------
-- identity: recipient graph (created before master.transactions which FK here)
-- ---------------------------------------------------------------------
create table identity.recipients (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid(),
  canonical_name text not null,               -- stable normalized key (nameKey)
  display_name   text,                        -- manual override shown everywhere
  kind           text not null default 'auto' check (kind in ('auto', 'merchant', 'person', 'platform', 'atm', 'google')),
  notes          text,
  created_at     timestamptz not null default now(),
  unique (user_id, canonical_name)
);

-- Every raw name variant seen in sources, folded into one entity.
create table identity.recipient_aliases (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references identity.recipients(id) on delete cascade,
  user_id      uuid not null default auth.uid(),
  alias        text not null,
  unique (recipient_id, alias)
);

-- Directed graph edges between entities (same_person, owns, family, ...).
create table identity.recipient_relations (
  id             uuid primary key default gen_random_uuid(),
  from_recipient uuid not null references identity.recipients(id) on delete cascade,
  to_recipient   uuid not null references identity.recipients(id) on delete cascade,
  relation       text not null check (relation in ('same_person', 'owns', 'family', 'employer', 'merchant_brand', 'peer')),
  confirmed      boolean not null default false,   -- true only after user approval
  user_id        uuid not null default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (from_recipient, to_recipient, relation),
  check (from_recipient <> to_recipient)
);
create index on identity.recipient_relations (to_recipient);

-- ---------------------------------------------------------------------
-- curation: categories, pins, audit (standalone tables)
-- ---------------------------------------------------------------------
create table curation.categories (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name    text not null,
  icon    text,
  color   text,
  unique (user_id, name)
);

create table curation.pins (
  recipient_id uuid not null references identity.recipients(id) on delete cascade,
  user_id      uuid not null default auth.uid(),
  primary key (recipient_id)
);

-- Audit trail: every human decision (accepted/rejected correlation,
-- confirmed relation, created tx name, merge, category assignment).
create table curation.confirmations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  target_type text not null check (target_type in ('correlation', 'recipient_relation', 'tx_name', 'merge', 'category')),
  target_id   uuid not null,
  decision    text not null check (decision in ('accepted', 'rejected', 'created', 'merged')),
  created_at  timestamptz not null default now()
);
create index on curation.confirmations (target_type, target_id);

-- ---------------------------------------------------------------------
-- master: canonical transactions (one physical event, normalized)
-- ---------------------------------------------------------------------
create table master.transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid(),
  occurred_at   timestamptz not null,          -- IST-normalized, stored as UTC
  amount_paise  bigint not null check (amount_paise >= 0),
  direction     text not null check (direction in ('in', 'out')),
  type          text not null check (type in ('paid', 'received', 'sent')),
  method        text,                          -- e.g. UPI, card, wallet, bank transfer
  status        text,
  external_id   text,                          -- 12-digit UPI id (statement) or Takeout Details id
  counterparty_id uuid references identity.recipients(id),
  note          text,
  created_at    timestamptz not null default now()
);
create index on master.transactions (user_id, occurred_at desc);
create index on master.transactions (user_id, counterparty_id);
create unique index on master.transactions (user_id, external_id) where external_id is not null;

-- ---------------------------------------------------------------------
-- master: correlations (source record <-> canonical tx) + user verdict
-- ---------------------------------------------------------------------
create table master.correlations (
  id               uuid primary key default gen_random_uuid(),
  transaction_id   uuid not null references master.transactions(id) on delete cascade,
  source_record_id uuid not null references master.source_records(id) on delete cascade,
  confidence       real not null check (confidence between 0 and 1),
  match_method     text not null check (match_method in ('exact_id', 'date_amount', 'ai_suggested', 'manual')),
  status           text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  user_id          uuid not null default auth.uid(),
  decided_at       timestamptz,
  unique (transaction_id, source_record_id)
);
create index on master.correlations (status);
create index on master.correlations (user_id, status);

-- ---------------------------------------------------------------------
-- curation: tables that reference master.transactions
-- ---------------------------------------------------------------------
create table curation.transaction_categories (
  transaction_id uuid not null references master.transactions(id) on delete cascade,
  category_id    uuid not null references curation.categories(id) on delete cascade,
  user_id        uuid not null default auth.uid(),
  user_set       boolean not null default false,
  primary key (transaction_id, category_id)
);

-- Manual name attached to a previously-unknown transaction.
create table curation.tx_names (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references master.transactions(id) on delete cascade,
  user_id        uuid not null default auth.uid(),
  name           text not null,
  created_at     timestamptz not null default now()
);

-- =====================================================================
-- Row Level Security: single-owner model (email login)
-- =====================================================================
alter table master.sources             enable row level security;
alter table master.source_records      enable row level security;
alter table master.transactions        enable row level security;
alter table master.correlations        enable row level security;
alter table identity.recipients        enable row level security;
alter table identity.recipient_aliases enable row level security;
alter table identity.recipient_relations enable row level security;
alter table curation.categories        enable row level security;
alter table curation.transaction_categories enable row level security;
alter table curation.tx_names          enable row level security;
alter table curation.pins              enable row level security;
alter table curation.confirmations     enable row level security;

do $$
declare
  t record;
begin
  for t in select 'master.sources'::text as rel union all
           select 'master.source_records' union all
           select 'master.transactions' union all
           select 'master.correlations' union all
           select 'identity.recipients' union all
           select 'identity.recipient_aliases' union all
           select 'identity.recipient_relations' union all
           select 'curation.categories' union all
           select 'curation.transaction_categories' union all
           select 'curation.tx_names' union all
           select 'curation.pins' union all
           select 'curation.confirmations'
  loop
    execute format(
      'create policy "owner full access" on %I.%I using (user_id = auth.uid()) with check (user_id = auth.uid())',
      split_part(t.rel, '.', 1), split_part(t.rel, '.', 2)
    );
  end loop;
end $$;
