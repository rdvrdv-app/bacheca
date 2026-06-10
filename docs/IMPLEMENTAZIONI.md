# Implementazioni preparate (branch dev)

Tutte le modifiche sono sul branch dev e **nulla è stato applicato alla produzione**:
né a `main` (che alimenta GitHub Pages), né al progetto Supabase. Questo documento
elenca, per ognuno dei 9 punti, cosa è pronto e cosa va fatto a mano per attivarlo.

| # | Punto | Stato su dev | Attivo dopo il merge? |
|---|-------|--------------|----------------------|
| 1 | Precompilazione JSX | `scripts/build.js` + `.github/workflows/deploy.yml` | ❌ serve anche un passo manuale |
| 2 | PWA | `manifest.json`, `sw.js`, `icon.svg`, registrazione in `index.html` | ✅ sì |
| 3 | Realtime | sottoscrizione nel client + SQL in `supabase/migrations/` | ❌ serve eseguire l'SQL |
| 4 | Promemoria Telegram | `supabase/functions/event-reminders/` + SQL cron | ❌ serve deploy + SQL |
| 5 | Backup locandine | step aggiunto a `backup.yml` | ✅ sì (il cron gira da `main`) |
| 6 | Esporta in calendario | pulsanti Google Calendar / .ics nel dettaglio evento | ✅ sì |
| 7 | Ricerca estesa | ricerca anche su organizzatore e luogo | ✅ sì |
| 8 | Quote stile Splitwise | sezione "Anticipi e saldi" in Gestione quote | ✅ sì |
| 9 | Pin supabase-js | versione fissata a `2.49.4` in `index.html` | ✅ sì |

## ⚠️ Prima del merge in main

Il branch dev punta al progetto Supabase **Bacheca-Dev** (`xgzmjxththubvpfwgsnu`):
i test non toccano i dati veri. Al momento del merge in `main` **ripristinare le
credenziali di produzione** in `index.html` (URL e KEY del progetto "Bacheca",
`divxqcadlishdfhpvixd` — sono conservate nel commento del blocco Config).

## Passi manuali per la produzione

### 1 — Precompilazione JSX
Il workflow `deploy.yml` compila `index.html` con esbuild (rimuovendo babel-standalone,
~1,5 MB) e pubblica `dist/` su Pages. Dopo il merge in `main`:

1. GitHub → Settings → Pages → **Source: GitHub Actions** (oggi è "Deploy from a branch").
2. Lancia il workflow "Build & Deploy Pages" (o pusha su `main`).
3. Verifica il sito; in caso di problemi si torna indietro reimpostando Source = branch `main`.

Il flusso di sviluppo non cambia: si continua a modificare solo `index.html`,
che resta funzionante anche aperto direttamente (babel rimane nel sorgente).

### 2 — PWA
Funziona da sola dopo il merge. Su Android/Chrome comparirà "Aggiungi a schermata Home";
su iOS: Condividi → "Aggiungi a Home". Il service worker usa network-first per l'app
(mai stantia) e cache-first per i CDN. **Se si cambia qualcosa di grosso**, incrementare
`CACHE` in `sw.js` (es. `bacheca-v2`) per svuotare le cache dei client.

### 3 — Realtime
Eseguire nel SQL Editor di Supabase la sezione 1 di
`supabase/migrations/20260609_realtime_e_promemoria.sql`. Da quel momento voti,
nuovi eventi e ferie si aggiornano in tempo reale senza pull-to-refresh.
Senza l'SQL il client funziona come oggi (la sottoscrizione resta muta).

### 4 — Promemoria Telegram
1. `supabase functions deploy event-reminders`
2. `supabase secrets set TELEGRAM_BOT_TOKEN=<token> CRON_SECRET=<segreto casuale lungo>`
3. Abilitare le estensioni `pg_cron` e `pg_net` (Dashboard → Database → Extensions).
4. Eseguire la sezione 2 della migration (decommentata, con il CRON_SECRET vero).

Invia ogni mattina alle 08:00 UTC un messaggio a chi ha attivato le notifiche, con gli
eventi di domani e i sondaggi in scadenza domani. Rispetta la visibilità ristretta.

### 5 — Backup locandine
Già incluso in `backup.yml`: scarica in `backup/flyers/` tutte le immagini referenziate
da `events.flyer_url`. Attivo al primo run del cron dopo il merge in `main`.
**Consiglio**: ogni tanto provare un restore (scaricare l'ultimo `.tar.gz.gpg`,
decifrarlo con la passphrase e controllare i JSON).

### 9 — Pin supabase-js
Fissato a `2.49.4`. Per aggiornare: cambiare il numero nel tag `<script>` di
`index.html` e fare un giro di test (login, voto, upload locandina).

## Costi nella lista della spesa (10-06-2026)

Sviluppato sul branch `claude/cool-brown-g0f1j5` (che punta a Bacheca-Dev):

- Segnando un articolo come **acquistato** compare un campo inline per il costo
  (facoltativo, si può saltare); l'importo è poi modificabile toccandolo.
- **Totale speso** in fondo alla sezione "Acquistati" e nel pulsante 🛒 della
  scheda evento; conta solo gli articoli acquistati con costo inserito.
- Dati: campo `cost` dentro il jsonb `shopping_list` — **nessuna migration,
  nessun passo manuale**. ✅ Attivo subito dopo il merge in `main` (ricordando
  come sempre di ripristinare le credenziali Supabase di produzione in `index.html`).

## Notifiche Telegram (stato al 10-06-2026)

- **Attive in PROD solo per**: evento creato / modificato / eliminato / ripristinato,
  voto aggiunto, voto tolto. Lista spesa e gestione quote **non** notificano.
- **Preferenze per utente**: nel profilo, due toggle per macro-funzionalità
  ("Eventi" e "Voti") salvati in `telegram_subscriptions.prefs`. Default: tutto attivo.
- **DEV sempre muta**: su Bacheca-Dev `notify_telegram` è un no-op.
- I **promemoria giornalieri** (`event-reminders`) restano NON attivi ovunque.
- SQL applicato: `supabase/migrations/20260610_notifiche_telegram_prefs.sql`.

## Note
- `EVENT_CATEGORIES` e `ITALIAN_CITIES` in `index.html` sono ancora inutilizzati nel
  client: predisposti per la scoperta automatica eventi (`discovery_meta`, `source:"agent"`).
- Le edge function esistenti (`parse-event`, `delete-user`) non sono versionate in questo
  repo: varrebbe la pena copiarle in `supabase/functions/` per averle sotto controllo versione.
