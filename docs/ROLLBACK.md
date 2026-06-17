# Rollback / tornare indietro (prod)

La prod è servita da GitHub Pages tramite il workflow **Build & Deploy Pages**
(`.github/workflows/deploy.yml`), che si attiva a ogni push su `main`.
Tornare indietro significa cambiare cosa c'è su `main` (o ripubblicare un
commit precedente). I commit non si perdono: restano nella storia di `main`.

## Caso 1 — annullare UNA modifica sbagliata (consigliato)
Mantiene tutta la storia; aggiunge un commit "inverso".
```bash
git log --oneline -10          # trova lo SHA del commit da annullare
git revert <sha>               # crea un commit che lo annulla
git push origin main           # il deploy ripubblica da solo
```
Funziona anche se sopra al commit "cattivo" ce ne sono altri buoni.

## Caso 2 — riportare tutto a una versione nota buona
```bash
git revert --no-edit <good_sha>..HEAD   # annulla tutto ciò che viene dopo
git push origin main
```

## Caso 3 — rollback rapido SENZA toccare il codice (temporaneo)
GitHub → **Actions** → workflow *Build & Deploy Pages* → apri una run vecchia
andata a buon fine → **Re-run all jobs**. Ripubblica lo stato di quel commit.
Al successivo push su `main` si torna alla versione corrente.

## Regole
- Preferisci `git revert` (Casi 1–2): è sicuro e non riscrive la storia.
- Evita `git reset --hard <sha>` + `git push --force origin main` sul `main`
  pubblicato, se non è strettamente necessario.
- Dopo il push, controlla che il workflow *Build & Deploy Pages* sia verde.

## Database
Il rollback del **codice** non tocca il **database** Supabase. Modifiche allo
schema/ai dati vanno gestite a parte (migrazioni). Per provarle in sicurezza
usa il progetto **Bacheca-Dev** puntandoci temporaneamente `SUPABASE_URL/KEY`
su un branch di test, poi riporta i valori di produzione prima del merge.

### Rollback rapido della release 17-06 (commenti/preferiti/push/auto-cestino)
Le migrazioni sono **additive** (nuove tabelle/funzioni/trigger): l'unico effetto
"attivo" sono i trigger di notifica e il cron. Per **disattivare al volo** i nuovi
comportamenti senza perdere dati, esegui sul progetto prod (`divxqcadlishdfhpvixd`):
```sql
-- ferma le push automatiche su eventi/voti e la notifica Telegram sui commenti
drop trigger if exists on_event_push   on public.events;
drop trigger if exists on_comment_created on public.event_comments;
-- (facoltativo) ferma l'auto-cestino server-side
select cron.unschedule('trash-stale-events-daily');
```
Le tabelle `event_comments`, `push_subscriptions`, `event_favorites`,
`notification_prefs` possono restare (innocue). Per ripristinare, riapplica le
migrazioni `supabase/migrations/20260617_*`. Il rollback del **frontend** (Casi
1–3 sopra) è indipendente: la vecchia UI ignora semplicemente le nuove tabelle.
