-- =====================================================================
-- Migration 0002: Simplify to single public schema
--
-- Drops master/identity/curation schemas and recreates all tables
-- in the public schema. RLS policies remain the same (user_id = auth.uid()).
-- =====================================================================

-- Drop old schemas ( CASCADE removes all objects within )
drop schema if exists curation cascade;
drop schema if exists identity cascade;
drop schema if exists master cascade;

-- ---------------------------------------------------------------------
-- Sources: import metadata (one row per uploaded file)
-- ---------------------------------------------------------------------
create table public.sources (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid(),
  kind         text not null check (kind in ('takeout', 'gpay_statement', 'bank_csv', 'bank_pdf')),
  label        text not null,
  file_name    text,
  content_hash text,
  period_start date,
  period_end   date,
  raw_record_count int not null default 0,
  imported_at  timestamptz not null default now(),
  unique (user_id, kind, file_name, content_hash)
);

-- ---------------------------------------------------------------------
-- Source records: raw rows exactly as imported
-- ---------------------------------------------------------------------
create table public.source_records (
  id          uuid primary key default gen_random_uuid(),
  source_id   uuid not null references public.sources(id) on delete cascade,
  user_id     uuid not null default auth.uid(),
  row_index   int not null,
  raw         jsonb not null,
  created_at  timestamptz not null default now(),
  unique (source_id, row_index)
);

-- ---------------------------------------------------------------------
-- Recipients: unique counterparties (merchants, people, platforms)
-- ---------------------------------------------------------------------
create table public.recipients (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid(),
  canonical_name text not null,
  display_name   text,
  kind           text not null default 'auto' check (kind in ('auto', 'merchant', 'person', 'platform', 'atm', 'google')),
  notes          text,
  created_at     timestamptz not null default now(),
  unique (user_id, canonical_name)
);

-- ---------------------------------------------------------------------
-- Recipient aliases: raw name variants linked to canonical entity
-- ---------------------------------------------------------------------
create table public.recipient_aliases (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.recipients(id) on delete cascade,
  user_id      uuid not null default auth.uid(),
  alias        text not null,
  unique (recipient_id, alias)
);

-- ---------------------------------------------------------------------
-- Recipient relations: directed graph edges between entities
-- ---------------------------------------------------------------------
create table public.recipient_relations (
  id             uuid primary key default gen_random_uuid(),
  from_recipient uuid not null references public.recipients(id) on delete cascade,
  to_recipient   uuid not null references public.recipients(id) on delete cascade,
  relation       text not null check (relation in ('same_person', 'owns', 'family', 'employer', 'merchant_brand', 'peer')),
  confirmed      boolean not null default false,
  user_id        uuid not null default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (from_recipient, to_recipient, relation),
  check (from_recipient <> to_recipient)
);
create index on public.recipient_relations (to_recipient);

-- ---------------------------------------------------------------------
-- Transactions: canonical transaction records (one physical event)
-- ---------------------------------------------------------------------
create table public.transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid(),
  occurred_at   timestamptz not null,
  amount_paise  bigint not null check (amount_paise >= 0),
  direction     text not null check (direction in ('in', 'out')),
  type          text not null check (type in ('paid', 'received', 'sent')),
  method        text,
  status        text,
  external_id   text,
  counterparty_id uuid references public.recipients(id),
  note          text,
  created_at    timestamptz not null default now()
);
create index on public.transactions (user_id, occurred_at desc);
create index on public.transactions (user_id, counterparty_id);
create unique index on public.transactions (user_id, external_id) where external_id is not null;

-- ---------------------------------------------------------------------
-- Correlations: source record ↔ canonical transaction links
-- ---------------------------------------------------------------------
create table public.correlations (
  id               uuid primary key default gen_random_uuid(),
  transaction_id   uuid not null references public.transactions(id) on delete cascade,
  source_record_id uuid not null references public.source_records(id) on delete cascade,
  confidence       real not null check (confidence between 0 and 1),
  match_method     text not null check (match_method in ('exact_id', 'date_amount', 'ai_suggested', 'manual')),
  status           text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  user_id          uuid not null default auth.uid(),
  decided_at       timestamptz,
  unique (transaction_id, source_record_id)
);
create index on public.correlations (status);
create index on public.correlations (user_id, status);

-- ---------------------------------------------------------------------
-- Categories: user-defined transaction categories
-- ---------------------------------------------------------------------
create table public.categories (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name    text not null,
  icon    text,
  color   text,
  unique (user_id, name)
);

-- ---------------------------------------------------------------------
-- Transaction categories: many-to-many join
-- ---------------------------------------------------------------------
create table public.transaction_categories (
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  category_id    uuid not null references public.categories(id) on delete cascade,
  user_id        uuid not null default auth.uid(),
  user_set       boolean not null default false,
  primary key (transaction_id, category_id)
);

-- ---------------------------------------------------------------------
-- Tx names: manual name attached to unknown transactions
-- ---------------------------------------------------------------------
create table public.tx_names (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.transactions(id) on delete cascade,
  user_id        uuid not null default auth.uid(),
  name           text not null,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Pins: bookmarked recipients
-- ---------------------------------------------------------------------
create table public.pins (
  recipient_id uuid not null references public.recipients(id) on delete cascade,
  user_id      uuid not null default auth.uid(),
  primary key (recipient_id)
);

-- ---------------------------------------------------------------------
-- Confirmations: audit trail for user decisions
-- ---------------------------------------------------------------------
create table public.confirmations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  target_type text not null check (target_type in ('correlation', 'recipient_relation', 'tx_name', 'merge', 'category')),
  target_id   uuid not null,
  decision    text not null check (decision in ('accepted', 'rejected', 'created', 'merged')),
  created_at  timestamptz not null default now()
);
create index on public.confirmations (target_type, target_id);

-- =====================================================================
-- Row Level Security: owner-only access
-- =====================================================================
alter table public.sources                enable row level security;
alter table public.source_records         enable row level security;
alter table public.transactions           enable row level security;
alter table public.correlations           enable row level security;
alter table public.recipients             enable row level security;
alter table public.recipient_aliases      enable row level security;
alter table public.recipient_relations    enable row level security;
alter table public.categories             enable row level security;
alter table public.transaction_categories enable row level security;
alter table public.tx_names               enable row level security;
alter table public.pins                   enable row level security;
alter table public.confirmations          enable row level security;

do $$
declare
  tbl text;
begin
  for tbl in select unnest(array[
    'sources', 'source_records', 'transactions', 'correlations',
    'recipients', 'recipient_aliases', 'recipient_relations',
    'categories', 'transaction_categories', 'tx_names', 'pins', 'confirmations'
  ]) loop
    execute format(
      'create policy "owner full access" on public.%I using (user_id = auth.uid()) with check (user_id = auth.uid())',
      tbl
    );
  end loop;
end $$;
