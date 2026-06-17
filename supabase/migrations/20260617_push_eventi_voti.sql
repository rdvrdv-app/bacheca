-- ─────────────────────────────────────────────────────────────
-- Bacheca — Notifiche PUSH anche per eventi e voti
-- Un trigger dedicato (separato da quelli Telegram) invia, via pg_net, alla
-- edge function broadcast-push. Le preferenze push per-utente/categoria stanno
-- in notification_prefs.push (eventi/voti/commenti).
-- Applicata a Bacheca-Dev il 17-06-2026; da applicare a prod alla promozione.
--
-- ⚠️ Per ambiente impostare (NON in questa migration, valore diverso dev/prod):
--   insert into app_config(key,value)
--   values ('functions_base_url','https://<PROJECT_REF>.supabase.co/functions/v1')
--   on conflict (key) do update set value = excluded.value;
-- Serve anche app_config.cron_secret (già presente) come segreto condiviso.
-- ─────────────────────────────────────────────────────────────

-- Inoltra una notifica push alla edge function broadcast-push (fire-and-forget)
create or replace function public.notify_push(
  p_category text, p_title text, p_body text, p_event_id uuid, p_exclude uuid default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_url    text;
  v_secret text;
begin
  select value into v_url    from app_config where key = 'functions_base_url';
  select value into v_secret from app_config where key = 'cron_secret';
  if v_url is null or v_secret is null then return; end if;  -- non configurato: no-op
  perform net.http_post(
    url     := v_url || '/broadcast-push',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
    body    := jsonb_build_object(
      'category', p_category, 'title', p_title, 'body', p_body,
      'event_id', p_event_id, 'exclude_user', p_exclude,
      'url', './?event=' || p_event_id
    )
  );
end;
$function$;

-- Trigger push su events: nuovo evento ('eventi'), voto ('voti'),
-- cambio stato/scadenza ('eventi'). NIENTE push per eliminazioni (evita lo
-- spam dell'auto-cestino) né per eventi privati.
create or replace function public.trigger_push_event()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  added text;
begin
  if jsonb_array_length(coalesce(NEW.visible_to, '[]'::jsonb)) > 0 then return NEW; end if;

  -- Nuovo evento: insert, pubblicazione bozza o ripristino dal cestino
  if NEW.deleted_at is null
     and coalesce(NEW.pending_approval, false) = false
     and (
       TG_OP = 'INSERT'
       or (TG_OP = 'UPDATE' and OLD.deleted_at is not null)
       or (TG_OP = 'UPDATE' and coalesce(OLD.pending_approval, false) = true)
     ) then
    perform notify_push('eventi', NEW.title,
      '📅 Nuovo evento' || case when NEW.date is not null and NEW.date <> '' then ' • ' || NEW.date else '' end,
      NEW.id, NEW.created_by);
    return NEW;
  end if;

  if TG_OP <> 'UPDATE' then return NEW; end if;
  if NEW.deleted_at is not null then return NEW; end if;
  if coalesce(NEW.pending_approval, false) = true then return NEW; end if;

  -- Voto aggiunto
  if NEW.participants is distinct from OLD.participants then
    select string_agg(x, ', ') into added from (
      select jsonb_array_elements_text(coalesce(NEW.participants, '[]'::jsonb))
      except
      select jsonb_array_elements_text(coalesce(OLD.participants, '[]'::jsonb))
    ) q(x);
    if added is not null and added <> '' then
      perform notify_push('voti', NEW.title, '🗳️ ' || added || ' ha votato', NEW.id, null);
      return NEW;
    end if;
  end if;

  -- Cambio stato
  if NEW.status is distinct from OLD.status then
    perform notify_push('eventi', NEW.title,
      '🔔 Stato: ' || case NEW.status
        when 'open' then 'Prenotabile' when 'pending' then 'In valutazione'
        when 'full' then 'Al completo' else NEW.status end,
      NEW.id, NEW.created_by);
    return NEW;
  end if;

  -- Cambio scadenza
  if NEW.deadline is distinct from OLD.deadline then
    perform notify_push('eventi', NEW.title, '⏰ Scadenza aggiornata', NEW.id, NEW.created_by);
    return NEW;
  end if;

  return NEW;
end;
$function$;

drop trigger if exists on_event_push on public.events;
create trigger on_event_push
  after insert or update on public.events
  for each row execute function public.trigger_push_event();
