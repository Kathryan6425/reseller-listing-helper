-- ============================================================
-- Reseller Listing Helper — one-time database setup
--
-- What this does: creates the "listings" table that holds each
-- user's shelf, and locks it down so every person can only see
-- and change their OWN listings.
--
-- Run this ONCE:
--   1. Open your Supabase project.
--   2. Click "SQL Editor" in the left menu.
--   3. Click "New query", paste this whole file in, and click Run.
-- You should see "Success. No rows returned" — that's good!
-- ============================================================

-- gen_random_uuid() lives in pgcrypto (built into Supabase, just making sure)
create extension if not exists pgcrypto;

create table if not exists public.listings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  item_name   text not null default '',
  brand       text not null default '',
  size        text not null default '',
  condition   text not null default '',
  title       text not null default '',
  description text not null default '',
  price       numeric not null default 0,
  price_low   numeric not null default 0,
  price_high  numeric not null default 0,
  platform    text not null default 'Vinted',
  category    text not null default '',
  status      text not null default 'Draft'
              check (status in ('Draft', 'Ready', 'Listed', 'Sold')),
  photo_thumb text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Speeds up "load my shelf, newest first"
create index if not exists listings_user_created_idx
  on public.listings (user_id, created_at desc);

-- Lock the table down: Row Level Security ON means nobody can touch
-- any row unless a policy below says they can.
alter table public.listings enable row level security;

-- Each policy says the same thing in a different direction:
-- "you may only touch rows where user_id is YOU (auth.uid())."

drop policy if exists "Users can see their own listings" on public.listings;
create policy "Users can see their own listings"
  on public.listings for select
  using (auth.uid() = user_id);

drop policy if exists "Users can add their own listings" on public.listings;
create policy "Users can add their own listings"
  on public.listings for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own listings" on public.listings;
create policy "Users can update their own listings"
  on public.listings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own listings" on public.listings;
create policy "Users can delete their own listings"
  on public.listings for delete
  using (auth.uid() = user_id);
