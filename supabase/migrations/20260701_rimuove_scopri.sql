-- Rimozione definitiva della funzione "Scopri" (scoperta automatica eventi).
-- Elimina le tabelle usate solo dal discovery e le relative chiavi di config.
-- NB: il cron di polling (`instagram-results`) va tolto separatamente con
--     cron.unschedule() — non è versionato qui perché creato fuori dalle migration.

drop table if exists public.discovery_runs cascade;
drop table if exists public.venues cascade;

delete from public.app_config
 where key in ('discovery_config', 'saved_searches', 'cron_secret');
