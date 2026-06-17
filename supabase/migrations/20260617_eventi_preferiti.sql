-- ─────────────────────────────────────────────────────────────
-- Bacheca — Eventi preferiti (per utente)
-- I preferiti vengono mostrati in cima alla lista "Prossimi eventi".
-- Applicata a Bacheca-Dev il 17-06-2026; da applicare a prod alla promozione.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.event_favorites (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  event_id   uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

alter table public.event_favorites enable row level security;

-- Ognuno gestisce solo i propri preferiti
drop policy if exists event_favorites_all on public.event_favorites;
create policy event_favorites_all on public.event_favorites
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
