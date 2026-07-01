# Bacheca — Stato del progetto (01-07-2026)

Documento di contesto per riprendere il lavoro in una nuova chat.

## Ultime modifiche (01-07-2026)

- **Rimossa la funzione "Scopri"** (scoperta automatica eventi da Instagram): via
  dal client `DiscoverySection`, `VenueEditor`, il tab admin e i metadati
  `discovery_meta`/`source:"agent"`; rimosse dal repo le edge function
  `discover-events`, `instagram-scan`, `instagram-results`; disattivato il cron di
  polling su **dev**. La coda **✅ Approva** resta (serve alle bozze manuali).
  ⚠️ Residui backend non ancora rimossi: le stesse edge function **deployate** su
  Supabase (dev+prod), il cron su **prod**, e le tabelle `venues`/`discovery_runs`
  (+ chiavi `app_config`: `discovery_config`, `saved_searches`, `cron_secret`).
- **Più immagini per evento**: nuova colonna `events.images` (jsonb, array di URL);
  la prima è la copertina ed è duplicata in `flyer_url` per retrocompatibilità.
  Migrazione `supabase/migrations/20260701_eventi_immagini_multiple.sql`
  **applicata a dev e prod**. Nel form si caricano/rimuovono più immagini e si
  sceglie la copertina; la scheda evento mostra la galleria.
- **Visibilità "Solo selezionati"**: il creatore è aggiunto in automatico ed è
  **non rimovibile** (bloccato in UI e forzato al salvataggio).

## Cos'è

**Bacheca** è una web-app per un gruppo di amici: eventi con sondaggi (anche
multi-giorno e con accompagnatori), calendario, ferie condivise, lista della
spesa per evento, gestione quote con anticipi, notifiche Telegram.

- **Sito**: https://rdvrdv-app.github.io/bacheca/ (GitHub Pages, repo `rdvrdv-app/bacheca`)
- **Stack**: React 18 da CDN, app in un **unico `index.html`** (~2.900 righe, JSX);
  in produzione il JSX è **precompilato** da una GitHub Action con esbuild
  (`scripts/build.js` → `dist/`), quindi niente Babel nel browser. È anche una
  **PWA** installabile (`manifest.json`, `sw.js`, `icon.svg`).
- **Backend**: Supabase (auth con email+password, Postgres con RLS, storage, edge functions).

## Ambienti — REGOLA FONDAMENTALE

| Ambiente | Dove | Progetto Supabase | Note |
|---|---|---|---|
| **PROD** | repo `rdvrdv-app/bacheca`, branch `main` | **"Bacheca"** `divxqcadlishdfhpvixd` | deploy automatico su Pages a ogni push (workflow "Build & Deploy Pages"; Pages in modalità GitHub Actions) |
| **DEV (test)** | feature branch nel repo prod | **"Bacheca-Dev"** `xgzmjxththubvpfwgsnu` | DB sandbox: stesse tabelle/bucket/edge functions; ci si punta temporaneamente per provare modifiche rischiose |

- **Strategia adottata il 14-06-2026**: un **solo repo** (`bacheca`). Lo sviluppo
  avviene su **feature branch**; si fa merge in `main` solo quando è pronto, così
  prod resta stabile. Il vecchio repo separato `bacheca-dev` è stato **eliminato
  il 14-06-2026** (causava il doppio `index.html` da tenere allineato). **Il DB
  `Bacheca-Dev` (`xgzmjxththubvpfwgsnu`) resta attivo** come sandbox per i test.
- **Switch ambiente automatico (dal 14-06-2026)**: `index.html` contiene **entrambe**
  le config Supabase (`SUPABASE_ENVS` nel blocco `// ── Config`) e sceglie a
  runtime — **niente più credenziali da modificare a mano**:
  - host `rdvrdv-app.github.io` → **prod** (Bacheca);
  - qualunque altro contesto (file locale, `localhost`, branch di test) → **dev** (Bacheca-Dev);
  - override per una visita: `?env=dev` / `?env=prod`.
  - quando NON si è in prod compare in basso a destra un badge **🧪 DEV DB**.
  Le anon key sono pubbliche (la sicurezza è data dalle RLS), quindi tenerle
  entrambe nel file è sicuro. **Promozione in prod = solo merge in `main`.**
- Per testare a mano: scaricare/aprire `index.html` del branch in locale → usa
  già il DB dev in automatico.
- Rollback di prod: vedi `docs/ROLLBACK.md`.

## Struttura repo

- `index.html` — tutta l'app (sorgente con JSX)
- `scripts/build.js` — build di produzione (esbuild, rimuove babel-standalone)
- `.github/workflows/deploy.yml` — build + deploy Pages a ogni push su main
- `.github/workflows/backup.yml` — backup notturno (02:00 UTC) del DB **prod**:
  tabelle events, profiles, activity_log, telegram_subscriptions, app_config,
  **ferie** + **locandine** da `flyer_url`; cifrato GPG e committato su
  `rdvrdv-app/bacheca-backups` (ultimi 30); notifica Telegram se fallisce.
  ⚠️ Il backup scarica solo la copertina (`flyer_url`): le immagini extra in
  `events.images` non sono ancora incluse (da estendere se serve)
- `manifest.json`, `sw.js`, `icon.svg` — PWA
- `maintenance.html` — pagina di cortesia
- `supabase/migrations/` — SQL documentati (vedi intestazioni: alcuni GIÀ applicati)
- `supabase/functions/event-reminders/` — promemoria giornalieri, **NON deployata, NON attiva**
- `docs/IMPLEMENTAZIONI.md` — storico dei "9 punti" (documento superato: ormai
  applicati in prod; tenuto come riferimento)
- `docs/ROLLBACK.md` — come tornare indietro / ripubblicare una versione precedente

## Database (entrambi i progetti, RLS attivo ovunque)

Tabelle: `events`, `profiles`, `activity_log`, `telegram_subscriptions` (con
`prefs` jsonb), `app_config` (contiene `telegram_bot_token`), `ferie`.

RPC rilevanti: `cast_vote`, `cancel_vote`, `save_shopping_list` (aperta a tutti
gli autenticati), `save_quotes` (**solo creatore evento, delegato o admin** —
verificato su prod e dev), `is_name_taken`, `is_admin`.

Edge functions deployate (prod e dev): `parse-event` (AI: compila il form da
testo/locandina), `delete-user`, `telegram-webhook`. ⚠️ Non sono versionate
nel repo: varrebbe la pena copiarle in `supabase/functions/`.

Trigger Postgres su `events`: `trigger_notify_new_event` e
`trigger_notify_event_updated` → `notify_telegram(message, category)`.

## Notifiche Telegram (stato attuale, deciso il 10-06-2026)

- **PROD notifica SOLO**: evento creato / modificato / eliminato / ripristinato
  (categoria `eventi`), voto aggiunto e voto tolto (categoria `voti`).
  **Niente** notifiche per lista spesa e gestione quote.
- **Preferenze per utente**: toggle nel profilo (📅 Eventi / 🗳️ Voti) salvati in
  `telegram_subscriptions.prefs`; default tutto attivo.
- **DEV: notifiche SEMPRE spente** (`notify_telegram` su Bacheca-Dev è un no-op). Non riattivarle.
- **Promemoria giornalieri (`event-reminders`): NON attivi**, solo codice nel repo.
- Eventi con visibilità ristretta non notificano mai.
- SQL di riferimento: `supabase/migrations/20260610_notifiche_telegram_prefs.sql` (già applicato).

## Logica quote e anticipi (regole concordate)

- Quota a persona = totale spesa / numero partecipanti.
- **L'anticipo copre la quota**: se `anticipo >= quota` la quota risulta pagata
  automaticamente (💰 non modificabile) e l'eccedenza è un **credito da
  incassare** ("da chi è irrilevante" — niente calcoli stile Splitwise A→B).
- Anticipo parziale: mostra quanto resta da versare; il 💰 manuale indica il saldo del resto.
- Riepilogo: "Quote coperte X/N", "Incassato / anticipato", "Ancora da
  incassare", "Da restituire (anticipi extra)". Identità: incassato + da
  incassare − da restituire = totale spesa.
- L'aggiunta rapida propone **solo i partecipanti al sondaggio** (accompagnatori inclusi).
- Permessi modifica quote: **solo admin, creatore evento e delegato** (enforced
  nell'RPC `save_quotes`, non solo nel client).

## Lista Spesa — costi (10-06-2026)

- Ogni articolo può avere un **costo facoltativo** (`cost`, numero in €, dentro il
  jsonb `shopping_list` — **nessuna migration necessaria**, l'RPC
  `save_shopping_list` salva il jsonb così com'è).
- Quando un articolo viene **segnato come acquistato** si apre un campo inline
  "Quanto è costato?" (si può saltare); il costo si modifica in seguito toccando
  l'importo accanto all'articolo.
- Il **totale speso** somma solo gli articoli acquistati con costo inserito:
  riepilogo in fondo alla sezione "Acquistati" (con nota se alcuni articoli non
  hanno costo) e accanto al contatore nel pulsante 🛒 della scheda evento.
- Se un articolo torna "da acquistare" il costo resta memorizzato ma esce dal totale.
- Il campo "Assegnato a" ha l'**aggiunta rapida dai partecipanti all'evento**
  (chips, come nelle quote); l'inserimento manuale di un nome resta possibile.
- **Collegamento con la gestione quote (deciso il 10-06-2026, sostituisce la
  separazione iniziale)**: attivare la lista spesa **attiva sempre anche la
  gestione quote** (il toggle quote resta bloccato finché la lista è attiva; gli
  eventi vecchi vengono normalizzati alla prima modifica). **A spesa completata**
  (nessun articolo "da acquistare") compare il tasto **"Vai a gestione quote"**
  che travasa: totale spesa → `quota_tot`, **partecipanti all'evento → lista
  persone** delle quote (l'aggiunta manuale di altri resta possibile lì),
  numero persone in lista → `quota_num` (si ritocca nelle quote se serve, dove
  si aggiorna la quota a persona) e **somma dei costi pagati da ciascun
  assegnatario → anticipo** della persona (sovrascritto a ogni travaso:
  ripetibile senza doppi conteggi; usa `save_quotes`, quindi tasto visibile
  **solo a owner, delegato o admin**). Nella lista spesa non si inserisce più
  alcun numero di persone (il calcolatore "Dividi in parti uguali" è stato
  rimosso il 10-06-2026). La gestione quote da sola (senza lista) resta per
  compleanni e acquisti spot (biglietti concerti, teatro…).
- Etichetta UI rinominata da "Lista della spesa" a **"Lista Spesa"** (10-06-2026).

## Realtime

Attivo su prod e dev (publication `supabase_realtime` su `events` e `ferie`):
il client si sottoscrive e ricarica da solo. Niente più pull-to-refresh necessario.

## Come rilasciare in prod (flusso attuale)

1. Sviluppo su un **feature branch**; testo aprendo `index.html` in locale →
   usa **Bacheca-Dev** in automatico (badge 🧪 DEV DB). Niente credenziali da toccare.
2. Eventuali modifiche di schema: applicarle **prima su Bacheca-Dev**, poi (alla
   promozione) **su Bacheca**, sempre via migration SQL versionata in
   `supabase/migrations/`.
3. Quando è pronto: **merge del feature branch in `main`** (fast-forward o PR).
   La Action compila e pubblica da sola; il sito gira su **Bacheca (prod)**.
4. Rollback: vedi `docs/ROLLBACK.md`.

⚠️ Vincoli dell'ambiente Claude Code: il token git della sessione è in sola
lettura — per pushare serve un **PAT temporaneo** fornito in chat (scope `repo`;
**+ `workflow`** se si toccano file in `.github/workflows/`). Revocarlo a fine
sessione. I commit vanno firmati (risultano "Verified" su GitHub; il check
locale può dare falsi negativi).

## Cose fatte il 09/10-06-2026 (sessione precedente)

Ottimizzazioni (dedup resize immagini, preconnect, memoizzazioni, fix toast/avatar),
i "9 punti" (build precompilata, PWA, Realtime, promemoria-solo-codice, backup
ferie+locandine, esporta in Google Calendar, ricerca estesa a
organizzatore/luogo, anticipi quote, supabase-js pinnato a 2.49.4), puntamento
dev→Bacheca-Dev, preferenze notifiche per utente, fix contatore quote coperte
e aggiunta rapida, switch Pages a GitHub Actions. Tutto deployato e funzionante.

## Cose fatte il 10-06-2026 (sessione Lista Spesa)

Tutto **deployato in prod**, branch dev `claude/cool-brown-g0f1j5` allineato:

- Costi facoltativi per articolo (jsonb, nessuna migration) e totale speso.
- Lista spesa ⇒ gestione quote sempre attiva (toggle bloccato).
- "Assegnato a" con chips dei partecipanti all'evento (+ inserimento manuale).
- A spesa completata: tasto "Vai a gestione quote" che travasa totale,
  partecipanti e anticipi (costi pagati da ciascun assegnatario). Niente campo
  "numero persone" nella lista: partecipanti e quota a persona si ritoccano
  nelle quote. Dettagli nella sezione "Lista Spesa — costi" sopra.
- Etichetta UI rinominata in "Lista Spesa".

## Cose fatte il 14-06-2026 (allineamento prod ↔ dev + nuove feature)

Tutto **deployato in prod** (`main`, Action verde) e allineato con la dev prima
della dismissione del repo separato:

- **Lista Spesa / Gestione quote con anticipi** portate/confermate in prod
  (travaso lista→quote, costo per articolo, totale speso, aggiunta rapida
  assegnatari dai partecipanti, riepilogo anticipi/credito). Vedi sezioni sopra.
- **Eventi multi-giorno** in prod: toggle "Evento su più giorni", voto per
  singolo giorno o «Tutto il periodo», barre multi-giorno nel calendario.
  Usa la colonna `events.end_date` (già presente sul DB prod).
- **Export calendario**: tasti **Google Calendar** e **Outlook** nel dettaglio
  evento (sostituito il download `.ics`).
- **Preferenze notifiche Telegram** (📅 Eventi / 🗳️ Voti) aggiunte anche alla UI
  prod (il backend `telegram_subscriptions.prefs` + `event-reminders` c'era già).
- **PWA attivata in prod**: collegati `manifest.json`/`icon.svg` nell'`<head>` e
  registrato `sw.js` (service worker *network-first* → resta aggiornato, si apre
  offline). I file erano già nel repo e vengono copiati in `dist/` dal build.
- **Campo social** uniformato a "Link social".
- **Strategia repo unico** (vedi *Ambienti*): repo `bacheca-dev` dismesso,
  sviluppo su feature branch nel repo prod, DB `Bacheca-Dev` tenuto come sandbox.
- Aggiunta `docs/ROLLBACK.md`.

## Cose fatte il 14-06-2026 (sera — riposizionamento tasti + cestino)

Tutto **deployato in prod** (`main`):

- **Posizione tasti (versione finale)**: nel form di creazione/modifica evento i
  toggle "🛒 Lista Spesa / 💶 Gestione quote" (con il campo delegato) sono **in
  cima, sopra il titolo "Nuovo sondaggio"**; nel dettaglio evento i pulsanti
  "🛒 Lista Spesa / 💶 Gestione quote", quando attivi, compaiono **sopra il titolo
  dell'evento** (prima erano sotto "Stato evento" / sotto i risultati).
- **Svuota cestino**: nel pannello Admin → tab 🗑️ Cestino, nuovo tasto **"🗑️
  Svuota cestino (N)"** con conferma, che elimina **definitivamente** in un colpo
  tutti gli eventi nel cestino (`delete ... in (ids)`).
- Repo `bacheca-dev` **eliminato** (vedi *Ambienti*); resta il DB `Bacheca-Dev`.
- **"Anticipi e saldi" comprimibile**: nella Gestione quote la sezione 💸 Anticipi
  e saldi è collassata di default; si apre/chiude cliccando l'intestazione (mostra
  il totale anticipato da chiuso). Stato `anticipiOpen` in `QuoteView`.
- **Auto-eliminazione eventi passati (>1 settimana)**: gli eventi la cui data
  effettiva (`end_date` o `date`) è più vecchia di 7 giorni vengono spostati nel
  **cestino** (soft-delete, recuperabili 30gg). Implementato **client-side**: un
  `useEffect` in `App` gira **solo sul client di un admin** dopo il caricamento
  eventi, è idempotente e silenzioso. ⚠️ **Limite**: scatta solo quando un admin
  apre l'app (non è un cron garantito). Per renderlo realmente server-side servirà
  o `pg_cron` su Supabase **oppure** uno step nel workflow notturno `backup.yml`
  (che ha già la `service_role` key) — vedi *Da valutare*.

## Cose fatte il 17-06-2026 (commenti + push + auto-cestino server + edge functions versionate)

Sviluppato sul branch `claude/gracious-darwin-c9cal1`; **schema/funzioni applicati a
Bacheca-Dev** e poi **promossi in prod il 17-06-2026** (5 migrazioni `20260617_*`
applicate a Bacheca, `send-push`+`broadcast-push` deployate, `functions_base_url`
impostato, secret VAPID configurati). Frontend pubblicato con **fast-forward in
`main`** (deploy Pages verde).

**Pulizia branch (17-06-2026):** dopo la promozione sono stati **eliminati tutti
i feature branch remoti** ora obsoleti — `claude/gracious-darwin-c9cal1` (questa
release, già in `main`), `claude/sleepy-babbage-njshr3`, e i vecchi branch dev
pre-unificazione `claude/cool-brown-g0f1j5` e `claude/loving-hypatia-6gf955`. In
prod resta **solo `main`**; i prossimi lavori partiranno da nuovi feature branch.

- **💬 Commenti per evento (bacheca asincrona)**: nuova tabella `event_comments`
  (`supabase/migrations/20260617_commenti_e_push.sql`) con RLS basate sull'helper
  `can_see_event(uuid)` (legge i commenti chi può vedere l'evento; scrive a proprio
  nome; cancella autore o admin — soft-delete via `deleted_at`). Realtime attivo
  (`event_comments` aggiunta a `supabase_realtime`). UI: componente
  `CommentsSection` nel dettaglio evento, con sottoscrizione realtime per
  `event_id`. Visibile a tutti i partecipanti, non solo all'owner.
- **📲 Notifiche push PWA (Web Push)**: tabella `push_subscriptions` (una riga per
  dispositivo). Chiavi **VAPID** generate (la pubblica è in `index.html` →
  `VAPID_PUBLIC_KEY`; la **privata è solo un secret** della edge function, mai nel
  repo). SW (`sw.js`, ora `bacheca-v2`) gestisce `push` + `notificationclick`.
  Profilo: card "📲 Notifiche push (questo dispositivo)" con attiva/disattiva.
  Edge function **`send-push`** (VAPID JWT ES256, notifica *muta* senza payload
  cifrato): invocata dal client dopo ogni commento, notifica chi può vedere
  l'evento tranne l'autore; rimuove le iscrizioni scadute (404/410). **Deployata
  su dev**, NON su prod. ⚠️ Richiede i secret `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_JWK`, `VAPID_SUBJECT` (non impostabili via MCP: vanno messi a
  mano). Su iPhone le push funzionano solo con app installata sulla Home (iOS 16.4+).
- **🗑️ Auto-cestino eventi passati lato SERVER**: funzione `trash_stale_events()`
  + job **pg_cron** `trash-stale-events-daily` (03:30 UTC), in
  `supabase/migrations/20260617_auto_cestino_server.sql`. Supera il limite della
  pulizia client-side (che resta come fallback innocuo). Applicato a dev.
- **Edge functions versionate** in `supabase/functions/`: `parse-event`,
  `delete-user`, `telegram-webhook` (+ `send-push`). ⚠️ In `telegram-webhook` il bot
  token **hardcoded** è stato sostituito con `Deno.env.get("TELEGRAM_BOT_TOKEN")`:
  la function live storica ha ancora il token in chiaro → **ruotarlo, impostare il
  secret e ridеployare**.
- **Fix CORS `send-push`** (dev v6): l'`Access-Control-Allow-Headers` non includeva
  `apikey`/`x-client-info` (inviati da supabase-js) → il preflight OPTIONS passava
  ma la POST veniva bloccata dal browser (nei log comparivano solo OPTIONS).
  Aggiunti quegli header + `Access-Control-Allow-Methods` e un log della risposta
  del push service.
- **⭐ Eventi preferiti**: tabella `event_favorites` (PK `user_id,event_id`, RLS
  per utente) in `supabase/migrations/20260617_eventi_preferiti.sql`. Stella
  toggle sulle `EventCard`; nella lista "Prossimi eventi" i preferiti sono
  ordinati **in cima**, mantenendo l'ordine per data dentro ciascun gruppo (sort
  stabile). Applicata a dev.
- **Push con payload + deep-link** (send-push v7): notifica con titolo evento +
  "autore: commento", cifrata aes128gcm; clic → apre la scheda evento
  (`?event=<id>` o postMessage del SW). SW `bacheca-v3`.
- **Fix "arriva solo la prima notifica"** (SW `bacheca-v4`): il `tag` fisso
  faceva sostituire silenziosamente le notifiche successive. Ora `tag` per-evento
  + `renotify:true`.
- **Pannello notifiche unificato (tipo × canale)** nel profilo: matrice
  Eventi/Voti/Commenti × Telegram/Push. Preferenze push per-utente in tabella
  `notification_prefs` (`supabase/migrations/20260617_preferenze_notifiche.sql`);
  `send-push` (v8) rispetta la preferenza push `commenti`. Aggiunto trigger
  `on_comment_created` → `notify_telegram(...,'commenti')` (no-op su dev, attivo
  in prod) così i commenti possono notificare anche via Telegram.
- **Push anche per Eventi e Voti**: edge function **`broadcast-push`**
  (verify_jwt=false, auth con `app_config.cron_secret`) + funzione SQL
  `notify_push(...)` (pg_net) + trigger **`on_event_push`** su `events` (separato
  da quelli Telegram, così non tocca il flusso esistente). Categorie: nuovo
  evento/stato/scadenza → `eventi`; voto → `voti`. NIENTE push su eliminazioni
  (evita lo spam dell'auto-cestino) né su eventi privati; esclude chi genera
  l'azione. `notification_prefs.push` ora governa tutte e 3 le categorie; la
  matrice nel profilo abilita Push per Eventi/Voti/Commenti. Migration
  `20260617_push_eventi_voti.sql`. **Per ambiente** serve impostare
  `app_config.functions_base_url` (su dev già fatto). Wiring verificato su dev
  (pg_net → broadcast-push = 200).
- **Stella preferiti** spostata in **alto a destra** della card evento (assoluta).
- **Analisi PDF "Piano di Miglioramento"**: punti 1 (pg_cron auto-delete) e 2
  (edge functions versionate) erano già fatti; aggiunto `supabase/config.toml`.
  Punto 3: build con **`minify`** (esbuild target es2020) → `dist/index.html` da
  ~207 a ~141 KB, Babel già rimosso. Punto 4: SW (`bacheca-v5`) precache di
  `maintenance.html` e fallback finale offline su di esso. La modularizzazione
  completa di `index.html` è stata **scartata** (contraria al design single-file,
  ROI basso/rischio alto).

## Da valutare in futuro

- **Promuovere in prod il lavoro del 17-06** (vedi sopra): applicare le 2 migration
  a Bacheca (`divxqcadlishdfhpvixd`), deploy `send-push`, impostare i secret VAPID,
  merge in `main`. Le push non sono testabili end-to-end senza un dispositivo reale
  + i secret impostati.
- Notifiche push **con payload** (titolo evento + estratto del commento): richiede
  cifratura aes128gcm nel `send-push` (oggi notifica generica). Migliora la UX.
- Notifica anche via **Telegram** sui nuovi commenti (categoria `commenti`,
  riusando `notify_telegram` + un toggle nelle preferenze).

- Test periodico di **restore** del backup (scaricare l'ultimo `.tar.gz.gpg`, decifrare, verificare).
- Attivazione (eventuale) dei promemoria giornalieri Telegram: vedi sezione 2
  di `supabase/migrations/20260609_realtime_e_promemoria.sql` + deploy della
  edge function `event-reminders` con i secret `TELEGRAM_BOT_TOKEN` e `CRON_SECRET`.
- Eventuale aggiornamento del pin di supabase-js (oggi `2.49.4` nel tag script).
- Promemoria scadenze/eventi anche via notifiche push PWA ora che l'infrastruttura
  push esiste (riusare `send-push`/`push_subscriptions`).
