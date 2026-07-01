-- Più immagini per evento.
-- Nuova colonna `images`: array jsonb di URL (storage bucket "event-flyers").
-- La prima immagine dell'array è la copertina e resta duplicata in `flyer_url`
-- per retrocompatibilità (notifiche, viste legacy, ecc.).

alter table public.events
  add column if not exists images jsonb not null default '[]'::jsonb;

-- Backfill: gli eventi esistenti con una locandina diventano un array con
-- quell'unica immagine, così la galleria mostra subito la copertina storica.
update public.events
   set images = jsonb_build_array(flyer_url)
 where (images is null or jsonb_array_length(images) = 0)
   and flyer_url is not null
   and flyer_url <> '';
