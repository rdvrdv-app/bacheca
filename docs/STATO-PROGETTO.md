# Bacheca — Stato del progetto (10-06-2026)

Documento di contesto per riprendere il lavoro in una nuova chat.

## Cos'è

**Bacheca** è una web-app per un gruppo di amici: eventi con sondaggi (anche
multi-giorno e con accompagnatori), calendario, ferie condivise, lista della
spesa per evento, gestione quote con anticipi, notifiche Telegram.

- **Sito**: https://rdvrdv-app.github.io/bacheca/ (GitHub Pages, repo `rdvrdv-app/bacheca`)
- **Stack**: React 18 da CDN, app in un **unico `index.html`** (~2.400 righe, JSX);
  in produzione il JSX è **precompilato** da una GitHub Action con esbuild
  (`scripts/build.js` → `dist/`), quindi niente Babel nel browser. È anche una
  **PWA** installabile (`manifest.json`, `sw.js`, `icon.svg`).
- **Backend**: Supabase (auth con email+password, Postgres con RLS, storage, edge functions).

## Ambienti — REGOLA FONDAMENTALE

| Ambiente | Branch git | Progetto Supabase | Note |
|---|---|---|---|
| **PROD** | `main` | **"Bacheca"** `divxqcadlishdfhpvixd` | deploy automatico su Pages a ogni push (workflow "Build & Deploy Pages"; Pages è in modalità GitHub Actions) |
| **DEV** | `claude/loving-hypatia-6gf955` (o branch dev futuri) | **"Bacheca-Dev"** `xgzmjxththubvpfwgsnu` | ambiente completo: stesse tabelle, bucket `event-flyers`, tutte le edge functions |

- `index.html` contiene URL+chiave anon del progetto Supabase: **sul branch dev
  puntano a Bacheca-Dev, su main a Bacheca (prod)**. Le credenziali dell'altro
  ambiente sono conservate nel commento del blocco `// ── Config`.
- Al merge/cherry-pick verso `main` va ripristinato il puntamento prod (vedi
  anche `docs/IMPLEMENTAZIONI.md`).
- Per testare a mano: scaricare `index.html` dal branch dev e aprirlo in locale.

## Struttura repo

- `index.html` — tutta l'app (sorgente con JSX)
- `scripts/build.js` — build di produzione (esbuild, rimuove babel-standalone)
- `.github/workflows/deploy.yml` — build + deploy Pages a ogni push su main
- `.github/workflows/backup.yml` — backup notturno (02:00 UTC) del DB **prod**:
  tabelle events, profiles, activity_log, telegram_subscriptions, app_config,
  **ferie** + **locandine** da `flyer_url`; cifrato GPG e committato su
  `rdvrdv-app/bacheca-backups` (ultimi 30); notifica Telegram se fallisce
- `manifest.json`, `sw.js`, `icon.svg` — PWA
- `maintenance.html` — pagina di cortesia
- `supabase/migrations/` — SQL documentati (vedi intestazioni: alcuni GIÀ applicati)
- `supabase/functions/event-reminders/` — promemoria giornalieri, **NON deployata, NON attiva**
- `docs/IMPLEMENTAZIONI.md` — dettaglio delle feature e passi manuali

## Database (entrambi i progetti, RLS attivo ovunque)

Tabelle: `events`, `profiles`, `activity_log`, `telegram_subscriptions` (con
`prefs` jsonb), `app_config` (contiene `telegram_bot_token`), `ferie`.

RPC rilevanti: `cast_vote`, `cancel_vote`, `save_shopping_list` (aperta a tutti
gli autenticati), `save_quotes` (**solo creatore evento, delegato o admin** —
verificato su prod e dev), `is_name_taken`, `is_admin`.

Edge functions deployate (prod e dev): `parse-event` (AI: compila il form da
testo/locandina), `delete-user`, `telegram-webhook`, `discover-events`
(scoperta automatica eventi → coda approvazione admin). ⚠️ Non sono versionate
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

## Lista della spesa — costi (10-06-2026)

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
- Il totale **non** alimenta automaticamente "Totale spesa" della gestione quote
  (lì resta inserimento manuale).

## Realtime

Attivo su prod e dev (publication `supabase_realtime` su `events` e `ferie`):
il client si sottoscrive e ricarica da solo. Niente più pull-to-refresh necessario.

## Come rilasciare in prod (flusso usato finora)

1. Sviluppo e test sul branch dev (che punta a Bacheca-Dev).
2. Commit di "ripristino credenziali prod" oppure cherry-pick su `main`
   verificando che `SUPABASE_URL` attivo sia `divxqcadlishdfhpvixd`.
3. Push di `main` → la Action compila e pubblica da sola.
4. Modifiche al DB prod: via migration SQL (documentarle in `supabase/migrations/`).

⚠️ Vincoli dell'ambiente Claude Code: il token git della sessione è in sola
lettura — per pushare serve un **PAT temporaneo** fornito in chat (scope `repo`;
**+ `workflow`** se si toccano file in `.github/workflows/`). Revocarlo a fine
sessione. I commit vanno firmati (risultano "Verified" su GitHub; il check
locale può dare falsi negativi).

## Cose fatte il 09/10-06-2026 (sessione precedente)

Ottimizzazioni (dedup resize immagini, preconnect, memoizzazioni, fix toast/avatar),
i "9 punti" (build precompilata, PWA, Realtime, promemoria-solo-codice, backup
ferie+locandine, esporta in Google Calendar/.ics, ricerca estesa a
organizzatore/luogo, anticipi quote, supabase-js pinnato a 2.49.4), puntamento
dev→Bacheca-Dev, preferenze notifiche per utente, fix contatore quote coperte
e aggiunta rapida, switch Pages a GitHub Actions. Tutto deployato e funzionante.

## Da valutare in futuro

- Copiare nel repo le edge functions esistenti (`parse-event`, `delete-user`,
  `telegram-webhook`, `discover-events`) per averle sotto controllo versione.
- `EVENT_CATEGORIES` e `ITALIAN_CITIES` in `index.html`: usati solo dalla
  scoperta automatica lato server, nel client sono inutilizzati.
- Test periodico di **restore** del backup (scaricare l'ultimo `.tar.gz.gpg`, decifrare, verificare).
- Attivazione (eventuale) dei promemoria giornalieri Telegram: vedi sezione 2
  di `supabase/migrations/20260609_realtime_e_promemoria.sql` + deploy della
  edge function `event-reminders` con i secret `TELEGRAM_BOT_TOKEN` e `CRON_SECRET`.
- Eventuale aggiornamento del pin di supabase-js (oggi `2.49.4` nel tag script).
- Promemoria scadenze/eventi anche via notifiche push PWA (alternativa a Telegram).
