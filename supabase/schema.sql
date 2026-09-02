-- Interview Anki cloud schema.
-- Run this entire file once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deck_id uuid not null references public.decks(id) on delete cascade,
  question text not null check (char_length(trim(question)) between 1 and 5000),
  answer text not null check (char_length(trim(answer)) between 1 and 10000),
  tags text[] not null default '{}',
  due_at timestamptz not null default now(),
  interval integer not null default 0 check (interval >= 0),
  ease numeric(3,2) not null default 2.5 check (ease between 1.3 and 3.2),
  audio_path text,
  attachment_paths jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cards add column if not exists card_state text not null default 'new';
alter table public.cards add column if not exists learning_step integer not null default 0;
alter table public.cards add column if not exists lapse_interval integer not null default 0;

update public.cards
set card_state = 'review'
where card_state = 'new' and interval > 0;

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  deck_id uuid not null references public.decks(id) on delete cascade,
  rating text not null check (rating in ('again', 'hard', 'good', 'easy')),
  reviewed_at timestamptz not null default now()
);

create table if not exists public.review_recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  storage_path text not null,
  transcript text,
  created_at timestamptz not null default now()
);

create index if not exists decks_user_id_idx on public.decks(user_id);
create index if not exists cards_user_id_idx on public.cards(user_id);
create index if not exists cards_due_at_idx on public.cards(user_id, due_at);
create index if not exists reviews_user_id_idx on public.reviews(user_id, reviewed_at);
create index if not exists review_recordings_user_id_idx on public.review_recordings(user_id, created_at);

alter table public.decks enable row level security;
alter table public.cards enable row level security;
alter table public.reviews enable row level security;
alter table public.review_recordings enable row level security;

drop policy if exists "Users can manage their own decks" on public.decks;
create policy "Users can manage their own decks"
  on public.decks for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can manage their own cards" on public.cards;
create policy "Users can manage their own cards"
  on public.cards for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.decks
      where decks.id = cards.deck_id and decks.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can manage their own reviews" on public.reviews;
create policy "Users can manage their own reviews"
  on public.reviews for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.cards
      where cards.id = reviews.card_id and cards.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can manage their own recordings" on public.review_recordings;
create policy "Users can manage their own recordings"
  on public.review_recordings for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.cards
      where cards.id = review_recordings.card_id and cards.user_id = (select auth.uid())
    )
  );

insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values (
  'card-assets',
  'card-assets',
  false,
  array['audio/*', 'image/*', 'application/pdf'],
  26214400
)
on conflict (id) do update set
  public = excluded.public,
  allowed_mime_types = excluded.allowed_mime_types,
  file_size_limit = excluded.file_size_limit;

drop policy if exists "Users can view their own card assets" on storage.objects;
create policy "Users can view their own card assets"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'card-assets'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "Users can upload their own card assets" on storage.objects;
create policy "Users can upload their own card assets"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'card-assets'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "Users can update their own card assets" on storage.objects;
create policy "Users can update their own card assets"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'card-assets'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'card-assets'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "Users can delete their own card assets" on storage.objects;
create policy "Users can delete their own card assets"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'card-assets'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
