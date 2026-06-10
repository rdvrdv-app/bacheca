-- ✅ GIÀ APPLICATA il 10-06-2026 a PROD (Bacheca) e, in variante muta, a DEV (Bacheca-Dev).
-- Conservata qui per documentazione e disaster recovery.
--
-- Cosa fa:
--  • notifiche Telegram SOLO per: evento creato / modificato / eliminato / ripristinato,
--    voto aggiunto, voto tolto (nuovo: prima il ritiro voto non notificava)
--  • RIMOSSA la notifica "Lista spesa aggiornata" (le quote non hanno mai notificato)
--  • eliminato il doppio messaggio sul ripristino dal cestino (ora solo ♻️)
--  • preferenze per iscritto: telegram_subscriptions.prefs = {"eventi": bool, "voti": bool}
--    (default: tutto attivo; UI nel profilo utente)
--  • su DEV notify_telegram è un no-op: notifiche sempre spente in sviluppo

alter table public.telegram_subscriptions
  add column if not exists prefs jsonb not null default '{}'::jsonb;

-- notify_telegram con categoria: invia solo a chi ha la categoria attiva (default: attiva)
drop function if exists public.notify_telegram(text);
create or replace function public.notify_telegram(message text, category text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  token text;
  chat record;
  url text;
begin
  select value into token from app_config where key = 'telegram_bot_token';
  if token is null then return; end if;
  url := 'https://api.telegram.org/bot' || token || '/sendMessage';
  for chat in
    select chat_id from telegram_subscriptions
    where category is null or coalesce((prefs->>category)::boolean, true)
  loop
    perform net.http_post(
      url,
      jsonb_build_object('chat_id', chat.chat_id, 'text', message, 'parse_mode', 'HTML'),
      '{}'::jsonb,
      '{"Content-Type":"application/json"}'::jsonb
    );
  end loop;
end;
$$;

-- Nuovo evento (insert o pubblicazione di una bozza). Il ripristino dal cestino
-- NON passa più di qui: lo notifica solo il trigger di update (♻️), niente doppioni.
create or replace function public.trigger_notify_new_event()
returns trigger
language plpgsql
as $$
declare
  msg text;
begin
  if NEW.deleted_at is null
     and coalesce(NEW.pending_approval, false) = false
     and jsonb_array_length(coalesce(NEW.visible_to, '[]'::jsonb)) = 0
     and (
       TG_OP = 'INSERT'
       or (TG_OP = 'UPDATE' and coalesce(OLD.pending_approval, false) = true and OLD.deleted_at is null)
     ) then
    msg := '📅 <b>Nuovo evento: ' || NEW.title || '</b>' || chr(10) ||
           case when NEW.date is not null and NEW.date != '' then '🗓 ' || NEW.date || case when NEW.time is not null and NEW.time != '' then ' alle ' || NEW.time else '' end || chr(10) else '' end ||
           case when NEW.address is not null and NEW.address != '' then '📍 ' || NEW.address || chr(10) else '' end ||
           case when NEW.notes is not null and NEW.notes != '' then '📝 ' || NEW.notes || chr(10) else '' end ||
           chr(10) ||
           '👉 <a href="https://rdvrdv-app.github.io/bacheca/">Apri Bacheca per votare!</a>';
    perform notify_telegram(msg, 'eventi');
  end if;
  return NEW;
end;
$$;

-- Update: eliminazione, ripristino, voti aggiunti/tolti, modifiche ai dati evento.
-- Niente notifiche per lista spesa e quote.
create or replace function public.trigger_notify_event_updated()
returns trigger
language plpgsql
as $$
declare
  msg text := '';
  changes text := '';
  added text;
  removed text;
  header text;
  stato text;
begin
  if TG_OP != 'UPDATE' then return NEW; end if;

  -- Niente notifiche per eventi privati
  if jsonb_array_length(coalesce(NEW.visible_to, '[]'::jsonb)) > 0 then return NEW; end if;

  header := case when NEW.date is not null and NEW.date != ''
                 then '🗓 ' || NEW.date || case when NEW.time is not null and NEW.time != '' then ' alle ' || NEW.time else '' end || chr(10)
                 else '' end;

  -- Eliminazione (cestino)
  if OLD.deleted_at is null and NEW.deleted_at is not null then
    perform notify_telegram('🗑️ <b>Evento eliminato: ' || NEW.title || '</b>' || chr(10) || header || chr(10) ||
      '👉 <a href="https://rdvrdv-app.github.io/bacheca/">Apri Bacheca</a>', 'eventi');
    return NEW;
  end if;

  -- Ripristino dal cestino
  if OLD.deleted_at is not null and NEW.deleted_at is null then
    perform notify_telegram('♻️ <b>Evento ripristinato: ' || NEW.title || '</b>' || chr(10) || header || chr(10) ||
      '👉 <a href="https://rdvrdv-app.github.io/bacheca/">Apri Bacheca</a>', 'eventi');
    return NEW;
  end if;

  if NEW.deleted_at is not null then return NEW; end if;
  if coalesce(NEW.pending_approval, false) = true then return NEW; end if;

  -- Voti aggiunti e tolti
  if NEW.participants is distinct from OLD.participants then
    select string_agg(x, ', ') into added from (
      select jsonb_array_elements_text(coalesce(NEW.participants, '[]'::jsonb)) as x
      except
      select jsonb_array_elements_text(coalesce(OLD.participants, '[]'::jsonb))
    ) q;
    select string_agg(x, ', ') into removed from (
      select jsonb_array_elements_text(coalesce(OLD.participants, '[]'::jsonb)) as x
      except
      select jsonb_array_elements_text(coalesce(NEW.participants, '[]'::jsonb))
    ) q;
    if added is not null and added <> '' then
      perform notify_telegram('🗳️ <b>Nuovo voto: ' || NEW.title || '</b>' || chr(10) ||
        '👤 ' || added || chr(10) || chr(10) ||
        '👉 <a href="https://rdvrdv-app.github.io/bacheca/">Apri Bacheca</a>', 'voti');
    end if;
    if removed is not null and removed <> '' then
      perform notify_telegram('↩️ <b>Voto ritirato: ' || NEW.title || '</b>' || chr(10) ||
        '👤 ' || removed || chr(10) || chr(10) ||
        '👉 <a href="https://rdvrdv-app.github.io/bacheca/">Apri Bacheca</a>', 'voti');
    end if;
    if (added is not null and added <> '') or (removed is not null and removed <> '') then return NEW; end if;
  end if;

  -- Modifiche ai dati dell'evento
  if NEW.status is distinct from OLD.status then
    stato := case NEW.status
      when 'open'    then '🟢 Prenotabile'
      when 'pending' then '🟡 In valutazione'
      when 'full'    then '🔴 Al completo'
      else NEW.status end;
    changes := changes || '• Stato → ' || stato || chr(10);
  end if;

  if NEW.deadline is distinct from OLD.deadline then
    if NEW.deadline is null or NEW.deadline = '' then
      changes := changes || '• Scadenza rimossa' || chr(10);
    else
      changes := changes || '• Scadenza → ' || NEW.deadline || chr(10);
    end if;
  end if;

  if NEW.last_edit is distinct from OLD.last_edit and NEW.last_edit is not null then
    changes := changes || '• ' || NEW.last_edit || chr(10);
  end if;

  if changes = '' then return NEW; end if;

  perform notify_telegram('✏️ <b>Evento aggiornato: ' || NEW.title || '</b>' || chr(10) || header || chr(10) ||
    changes || chr(10) ||
    '👉 <a href="https://rdvrdv-app.github.io/bacheca/">Apri Bacheca per i dettagli!</a>', 'eventi');
  return NEW;
end;
$$;
