-- ─────────────────────────────────────────────────────────────
-- Bacheca — Preferenze notifiche per utente (canale Push) +
-- notifica Telegram sui nuovi commenti.
-- Le preferenze Telegram restano in telegram_subscriptions.prefs (jsonb).
-- Applicata a Bacheca-Dev il 17-06-2026; da applicare a prod alla promozione.
-- ─────────────────────────────────────────────────────────────

-- Preferenze del canale PUSH, per utente (le push sono per-dispositivo, ma la
-- scelta dei tipi è per-utente). Chi non ha riga = tutto attivo (default true).
create table if not exists public.notification_prefs (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  push       jsonb not null default '{"eventi":true,"voti":true,"commenti":true}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

drop policy if exists notification_prefs_all on public.notification_prefs;
create policy notification_prefs_all on public.notification_prefs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── Telegram sui nuovi commenti (categoria 'commenti') ────────
-- Su dev notify_telegram è un no-op, quindi questo trigger è innocuo;
-- in prod invia ai soli iscritti con la preferenza 'commenti' attiva.
create or replace function public.trigger_notify_new_comment()
returns trigger
language plpgsql
as $function$
declare
  v_title text;
  v_vis   jsonb;
  msg     text;
begin
  select title, visible_to into v_title, v_vis from public.events where id = NEW.event_id;
  if v_title is null then return NEW; end if;
  -- Niente notifiche per eventi a visibilità ristretta
  if jsonb_array_length(coalesce(v_vis, '[]'::jsonb)) > 0 then return NEW; end if;

  msg := '💬 <b>Nuovo commento: ' || v_title || '</b>' || chr(10) ||
         '👤 ' || coalesce(NEW.author_name, '') || chr(10) ||
         left(NEW.body, 200) || chr(10) || chr(10) ||
         '👉 <a href="https://rdvrdv-app.github.io/bacheca/">Apri Bacheca</a>';
  perform notify_telegram(msg, 'commenti');
  return NEW;
end;
$function$;

drop trigger if exists on_comment_created on public.event_comments;
create trigger on_comment_created
  after insert on public.event_comments
  for each row execute function public.trigger_notify_new_comment();
