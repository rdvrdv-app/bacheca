-- ─────────────────────────────────────────────────────────────
-- Bacheca — Auto-cestino eventi passati (>1 settimana) lato SERVER
-- Sostituisce il limite della pulizia client-side (che scattava solo
-- all'apertura dell'app da parte di un admin). Richiede pg_cron (attivo).
-- Applicata a Bacheca-Dev il 17-06-2026; da applicare a prod alla promozione.
-- ─────────────────────────────────────────────────────────────

-- date / end_date sono testo 'YYYY-MM-DD' (ordinabili lessicalmente).
-- Sposta nel cestino (soft-delete) gli eventi la cui data effettiva è più
-- vecchia di 7 giorni. Ritorna quanti ne ha spostati.
create or replace function public.trash_stale_events()
returns integer
language sql
security definer
set search_path to 'public'
as $$
  with upd as (
    update public.events
    set deleted_at = now()
    where deleted_at is null
      and coalesce(nullif(end_date, ''), nullif(date, '')) is not null
      and coalesce(nullif(end_date, ''), nullif(date, ''))
          < to_char((current_date - interval '7 days')::date, 'YYYY-MM-DD')
    returning 1
  )
  select count(*)::int from upd;
$$;

-- Pianificazione giornaliera (03:30 UTC). Se esiste già, la sostituisce.
select cron.unschedule('trash-stale-events-daily')
where exists (select 1 from cron.job where jobname = 'trash-stale-events-daily');

select cron.schedule(
  'trash-stale-events-daily',
  '30 3 * * *',
  $$ select public.trash_stale_events(); $$
);
