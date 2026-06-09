-- ⚠️ NON ANCORA APPLICATA ALLA PRODUZIONE.
-- Da eseguire nel SQL Editor di Supabase (o con `supabase db push`) quando si decide
-- di attivare le feature corrispondenti. Vedi docs/IMPLEMENTAZIONI.md.

-- ─────────────────────────────────────────────────────────────
-- 1) Realtime su events e ferie
--    Abilita gli aggiornamenti live nel client (la sottoscrizione è già nel codice
--    e resta muta finché questo non viene eseguito).
-- ─────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.ferie;

-- ─────────────────────────────────────────────────────────────
-- 2) Cron giornaliero per i promemoria Telegram (ore 08:00 UTC)
--    Prerequisiti:
--      a. estensioni pg_cron e pg_net abilitate (Dashboard → Database → Extensions)
--      b. edge function event-reminders deployata:
--           supabase functions deploy event-reminders
--      c. secret impostati sulla function:
--           supabase secrets set TELEGRAM_BOT_TOKEN=... CRON_SECRET=<segreto-casuale>
--      d. sostituire <CRON_SECRET> qui sotto con lo stesso valore
-- ─────────────────────────────────────────────────────────────
-- select cron.schedule(
--   'event-reminders-daily',
--   '0 8 * * *',
--   $$
--   select net.http_post(
--     url     := 'https://divxqcadlishdfhpvixd.supabase.co/functions/v1/event-reminders',
--     headers := '{"Content-Type":"application/json","Authorization":"Bearer <CRON_SECRET>"}'::jsonb,
--     body    := '{}'::jsonb
--   );
--   $$
-- );
