-- ─────────────────────────────────────────────────────────────
-- Bacheca — Commenti per evento (bacheca asincrona) + Push PWA
-- Applicata a Bacheca-Dev il 17-06-2026; da applicare a prod alla promozione.
-- ─────────────────────────────────────────────────────────────

-- Helper: l'utente corrente può vedere l'evento?
-- (visible_to è jsonb: array di uid in formato stringa; vuoto/null = pubblico)
create or replace function public.can_see_event(e_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.events e
    where e.id = e_id
      and e.deleted_at is null
      and (not e.pending_approval or e.created_by = auth.uid() or public.is_admin())
      and (
        e.created_by = auth.uid()
        or public.is_admin()
        or coalesce(jsonb_array_length(e.visible_to), 0) = 0
        or e.visible_to ? auth.uid()::text
      )
  );
$$;

-- ── Commenti ──────────────────────────────────────────────────
create table if not exists public.event_comments (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  author_name text not null,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists event_comments_event_idx
  on public.event_comments (event_id, created_at);

alter table public.event_comments enable row level security;

-- Lettura: chiunque possa vedere l'evento
drop policy if exists event_comments_select on public.event_comments;
create policy event_comments_select on public.event_comments
  for select to authenticated
  using (public.can_see_event(event_id));

-- Inserimento: solo a proprio nome e solo su eventi visibili
drop policy if exists event_comments_insert on public.event_comments;
create policy event_comments_insert on public.event_comments
  for insert to authenticated
  with check (user_id = auth.uid() and public.can_see_event(event_id));

-- Modifica/soft-delete: autore o admin
drop policy if exists event_comments_update on public.event_comments;
create policy event_comments_update on public.event_comments
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- Cancellazione definitiva: autore o admin
drop policy if exists event_comments_delete on public.event_comments;
create policy event_comments_delete on public.event_comments
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Realtime: il client si sottoscrive ai commenti dell'evento aperto
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'event_comments'
  ) then
    alter publication supabase_realtime add table public.event_comments;
  end if;
end $$;

-- ── Iscrizioni push PWA (Web Push) ────────────────────────────
-- Una riga per dispositivo/browser. p256dh/auth servono solo se in futuro
-- si vorranno notifiche con payload cifrato; oggi le notifiche sono "mute"
-- (il service worker mostra un messaggio generico).
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text,
  auth       text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Ognuno gestisce solo le proprie iscrizioni (l'invio usa la service role e
-- bypassa la RLS).
drop policy if exists push_subscriptions_all on public.push_subscriptions;
create policy push_subscriptions_all on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
