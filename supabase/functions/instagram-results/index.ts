import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as b64encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Recupero risultati scansione Instagram (Bright Data) ───────
// Quando lo snapshot è pronto:
//  • estrae gli eventi dalle caption con Claude, a blocchi: nessun post viene
//    scartato anche con decine di locali (il testo non viene più troncato);
//  • risolve il locale anche per i post in collaborazione col promoter
//    (@menzioni nella caption, nome del locale nel titolo): organizzatore =
//    @nick del locale, indirizzo censito, nome del locale all'inizio del titolo;
//  • scarta i doppioni, compreso lo stesso evento annunciato da profili
//    diversi (confronto per data + parole significative del titolo);
//  • inserisce subito in pre-approvazione e carica le locandine dopo, così un
//    eventuale timeout non fa perdere gli eventi; nei caroselli Claude sceglie
//    l'immagine giusta ricevendola in base64 (i CDN di Instagram rifiutano i
//    download fatti da terzi via URL).
// Invocabile dall'admin (JWT) o dal job pg_cron (header x-cron-secret).

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-cron-secret",
  "Content-Type":                 "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

const MODEL = "claude-sonnet-4-6";
const BATCH_CHARS = 80000;      // caption inviate a Claude per singola chiamata
const CAPTION_CHARS = 2200;
const MAX_FLYERS = 30;          // limite immagini caricate per scansione
const MAX_CAROUSEL_IMAGES = 8;  // immagini massime mostrate a Claude per scegliere
const DEFAULT_OPTIONS = ["Sì, ci sono", "Forse", "Non ci sono"];
const emptyVotes = () => Object.fromEntries(DEFAULT_OPTIONS.map(o => [o, []]));

// Riconosce un indirizzo "vero" estratto dalla caption (da preservare)
const STREET_RE = /\b(via|viale|piazza|piazzale|corso|lungomare|contrada|c\.da|strada|borgo|largo|vico|km\s?\d|ss\s?\d+|sp\s?\d+)\b/i;

// Normalizzazione per i confronti (maiuscole, accenti, punteggiatura)
const norm = (s: string) => (s || "").toLowerCase().normalize("NFD")
  .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Parole troppo generiche per identificare un locale o distinguere due titoli
const GENERIC = new Set([
  "club", "beach", "disco", "discoteca", "cafe", "caffe", "bar", "pub", "risto",
  "ristorante", "village", "lounge", "live", "party", "serata", "notte", "night",
  "show", "festa", "fest", "estate", "summer", "opening", "event", "evento",
  "experience", "special", "guest", "venerdi", "sabato", "domenica",
  "friday", "saturday", "sunday", "pescara", "montesilvano", "spoltore",
  "francavilla", "chieti", "teramo", "vasto", "giulianova",
]);

// Parole significative di un titolo, per il confronto fra eventi
const sigTokens = (s: string) =>
  new Set(norm(s).split(" ").filter(w => w.length >= 3 && !GENERIC.has(w)));

// Stesso evento se le parole significative coincidono in buona parte
function similarTitles(a: Set<string>, b: Set<string>): boolean {
  const min = Math.min(a.size, b.size);
  if (!min) return false;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter >= 2 && inter / min >= 0.6;
}

async function configValue(sb: any, key: string): Promise<string | null> {
  const { data } = await sb.from("app_config").select("value").eq("key", key).maybeSingle();
  const v = (data?.value ?? "").toString().trim();
  return v || null;
}

// Autorizzazione: job pg_cron (x-cron-secret) oppure utente admin (JWT)
async function authorize(req: Request, sb: any): Promise<boolean> {
  const secret = req.headers.get("x-cron-secret");
  if (secret) {
    const expected = await configValue(sb, "cron_secret");
    return !!expected && secret === expected;
  }
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user) return false;
  const { data: prof } = await sb.from("profiles").select("role").eq("id", user.id).single();
  return prof?.role === "admin";
}

// Handle del profilo da un URL instagram.com/<handle>/ (null per /p/, /reel/...)
function handleOf(u: string): string | null {
  try {
    const parts = new URL(u).pathname.split("/").filter(Boolean);
    if (!parts.length || ["p", "reel", "reels", "stories", "explore"].includes(parts[0])) return null;
    return parts[0].toLowerCase();
  } catch { return null; }
}

// Unisce indirizzo e località senza ripetere la località se già presente
function joinAddress(address: string | null, town: string | null): string | null {
  const a = (address || "").trim();
  const t = (town || "").trim();
  if (!a) return t || null;
  if (!t || a.toLowerCase().includes(t.toLowerCase())) return a;
  return `${a}, ${t}`;
}

// Scarica un'immagine (i CDN Instagram richiedono header da browser)
async function fetchImage(url: string): Promise<{ buf: Uint8Array; ct: string } | null> {
  try {
    const r = await fetch(url, { headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "image/*,*/*;q=0.8",
    } });
    if (!r.ok) return null;
    const ct = (r.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    if (!ct.startsWith("image/")) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (!buf.length || buf.length > 4_000_000) return null;
    return { buf, ct };
  } catch { return null; }
}

// Salva la locandina su Storage: resta visibile anche quando l'URL CDN scade
async function storeFlyer(sb: any, img: { buf: Uint8Array; ct: string }): Promise<string | null> {
  try {
    const ext = img.ct.includes("png") ? "png" : img.ct.includes("webp") ? "webp" : "jpg";
    const path = `instagram/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { data, error } = await sb.storage.from("event-flyers").upload(path, img.buf, { contentType: img.ct, upsert: false });
    if (error) return null;
    return sb.storage.from("event-flyers").getPublicUrl(data.path).data.publicUrl;
  } catch { return null; }
}

// Nei post carosello chiede a Claude quale immagine è la locandina dell'evento.
// Ritorna l'indice (0-based), -1 se Claude esclude tutte le immagini,
// null per errore tecnico (in quel caso si ripiega sulla prima immagine).
async function pickFlyerIndex(
  apiKey: string,
  ev: { title: string; date: string },
  photoUrls: string[],
): Promise<{ idx: number | null; none: boolean; images: Map<number, { buf: Uint8Array; ct: string }> }> {
  const images = new Map<number, { buf: Uint8Array; ct: string }>();
  const shown: number[] = [];
  for (let i = 0; i < photoUrls.length && shown.length < MAX_CAROUSEL_IMAGES; i++) {
    const img = await fetchImage(photoUrls[i]);
    if (img) { images.set(i, img); shown.push(i); }
  }
  if (!shown.length) return { idx: null, none: false, images };
  if (shown.length === 1) return { idx: shown[0], none: false, images };
  try {
    const content: any[] = shown.map(i => ({
      type: "image",
      source: { type: "base64", media_type: images.get(i)!.ct, data: b64encode(images.get(i)!.buf) },
    }));
    content.push({ type: "text", text:
      `Quale di queste ${shown.length} immagini è la locandina dell'evento "${ev.title}" del ${ev.date}? ` +
      `Rispondi SOLO con il numero dell'immagine (1-${shown.length}), oppure 0 se nessuna corrisponde chiaramente.` });
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 10, messages: [{ role: "user", content }] }),
    });
    if (!r.ok) return { idx: null, none: false, images };
    const data = await r.json();
    const out = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    const n = parseInt(out.match(/\d+/)?.[0] ?? "", 10);
    if (Number.isNaN(n)) return { idx: null, none: false, images };
    if (n === 0) return { idx: null, none: true, images };
    if (n < 1 || n > shown.length) return { idx: null, none: false, images };
    return { idx: shown[n - 1], none: false, images };
  } catch { return { idx: null, none: false, images }; }
}

async function extractWithClaude(apiKey: string, p: { city: string | null; km: number | null; from: string | null; to: string | null; categories: string[] }, document: string) {
  const today = new Date().toISOString().slice(0, 10);
  // I post arrivano dai profili dei locali esplicitamente selezionati dall'admin:
  // NON filtrare per zona geografica (scartava eventi di locali fuori dal raggio
  // della città di riferimento, es. Città Sant'Angelo); conta solo la data.
  const range = (p.from && p.to) ? `con data compresa tra ${p.from} e ${p.to}` : `con data futura (da ${today} in poi)`;
  const cats  = (p.categories?.length && !p.categories.includes("Tutti"))
    ? `Interessano in particolare queste categorie: ${p.categories.join(", ")}. `
    : "";
  const system =
    `Sei un estrattore di eventi dai post Instagram di locali e organizzatori italiani. Oggi è ${today}. ` +
    `Ti fornisco il testo (caption) di più post, separati da righe "### POST: <url>". ` +
    `Estrai TUTTI gli eventi con una data chiara annunciati in questi post (i locali sono già stati scelti, non scartare per zona geografica), ${range}. ` + cats +
    `Le caption usano spesso date informali ("saba 14/06", "domenica 15 giugno", "stasera"): deduci la data esatta rispetto alla data di pubblicazione del post. ` +
    `Se l'anno non è scritto, deducilo (un giorno/mese già passato rispetto a oggi va all'anno successivo). ` +
    `Ignora i post promozionali senza una data precisa e gli eventi già passati. ` +
    `Se più post annunciano lo STESSO evento — anche da profili diversi, ad esempio il locale e il promoter in collaborazione — restituiscilo UNA sola volta usando il post più dettagliato; come "organizer" indica il LOCALE in cui si svolge, non il promoter. ` +
    `Per "address" indica l'indirizzo SOLO se compare esplicitamente nella caption (via, piazza, ecc.), altrimenti null. ` +
    `In "notes" scrivi solo informazioni utili ai partecipanti (ospiti, orari, prevendite), MAI commenti sul processo di estrazione. ` +
    `Rispondi ESCLUSIVAMENTE con un array JSON valido, senza testo introduttivo e senza markdown. ` +
    `Ogni elemento: {"title": string, "date": "YYYY-MM-DD", "time": "HH:MM"|null, "town": string|null, "address": string|null, "url": string|null, "category": string|null, "organizer": string|null, "notes": string|null}. ` +
    `Per "url" usa il link del POST da cui hai estratto l'evento; per "organizer" il nome del locale/profilo. ` +
    `Se non trovi eventi validi rispondi [].`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, system, messages: [{ role: "user", content: document }] }),
  });
  if (!r.ok) {
    const b = await r.text();
    if (r.status === 429)
      throw new Error("Limite di velocità Anthropic raggiunto. Riprova tra un minuto.");
    throw new Error(`Claude ${r.status}: ${b.slice(0, 200)}`);
  }
  const data = await r.json();
  const out = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  const start = out.indexOf("[");
  const end   = out.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    const parsed = JSON.parse(out.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch { throw new Error("Claude non ha restituito un JSON valido."); }
}

// ── Fonti di incrocio: angelipierre.it + ilpescara.it ─────────
// Siti che pubblicano la programmazione di serate/eventi in Abruzzo. Spesso
// protetti da Cloudflare e non scaricabili direttamente (403): si interrogano
// col tool web_search dell'API Anthropic limitato ai due domini, che legge
// dall'indice dei motori di ricerca. Gli eventi trovati passano per la stessa
// risoluzione locale e dedup dei post Instagram, quindi confermano o integrano
// quanto già estratto (utile per locali non presenti su Instagram). Fonte
// facoltativa: se fallisce, la scansione prosegue solo con Instagram.
const WEB_SOURCES = ["angelipierre.it", "ilpescara.it"];
async function searchPierreEvents(apiKey: string, p: { city: string | null; km: number | null; from: string | null; to: string | null }): Promise<any[]> {
  const today = new Date().toISOString().slice(0, 10);
  const targetYear = (p.from || today).slice(0, 4);
  const range = (p.from && p.to) ? `con data compresa tra ${p.from} e ${p.to} (anno ${targetYear})` : `con data futura (da ${today} in poi, anno ${targetYear})`;
  const where = p.city ? ` a ${p.city} o entro circa ${p.km || 30} km` : " in Abruzzo";
  const prompt =
    `Cerca su angelipierre.it e ilpescara.it (siti che pubblicano la programmazione di serate ed eventi nei locali e nelle discoteche dell'Abruzzo) ` +
    `gli eventi${where}, ${range}. Oggi è ${today}. ` +
    `IMPORTANTE: include SOLO eventi dell'anno ${targetYear}. Se il sito mostra pagine o eventi di anni precedenti (${Number(targetYear)-1} o prima), ignorali completamente. ` +
    `Includi SOLO eventi di cui trovi data esplicita nelle pagine dei siti: non dedurre e non inventare. ` +
    `Rispondi ESCLUSIVAMENTE con un array JSON valido, senza testo introduttivo e senza markdown. ` +
    `Ogni elemento: {"title": string, "date": "YYYY-MM-DD", "time": "HH:MM"|null, "town": string|null, "address": string|null, "url": string|null, "category": string|null, "organizer": string|null, "notes": string|null}. ` +
    `Per "url" usa la pagina dell'evento sul sito; per "organizer" il nome del locale. ` +
    `Se non trovi eventi validi rispondi [].`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 4000,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6, allowed_domains: WEB_SOURCES }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!r.ok) throw new Error(`Claude web_search ${r.status}`);
  const data = await r.json();
  const out = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  const start = out.indexOf("[");
  const end   = out.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    const parsed = JSON.parse(out.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let sb: any = null;
  let claimedRunId: string | null = null;
  try {
    sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (!(await authorize(req, sb)))
      return json({ error: "Operazione riservata agli admin." }, 403);

    const { runId } = (await req.json()) as { runId?: string };
    if (!runId) return json({ error: "runId mancante." }, 400);

    const { data: run, error: runErr } = await sb.from("discovery_runs").select("*").eq("id", runId).single();
    if (runErr || !run) return json({ error: "Scansione non trovata." }, 404);
    if (run.status === "done")
      return json({ status: "done", created: run.created_events, message: "Scansione già elaborata." });
    if (run.status === "error")
      return json({ status: "error", error: run.error || "La scansione è terminata con errore." });
    // Già in elaborazione da un'altra esecuzione (browser o cron): non rielaborare.
    if (run.status === "processing")
      return json({ status: "running" });

    const bdKey = (await configValue(sb, "brightdata_api_key")) || Deno.env.get("BRIGHTDATA_API_KEY");
    if (!bdKey) return json({ error: "Chiave API Bright Data non configurata." }, 400);
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) return json({ error: "Secret ANTHROPIC_API_KEY non configurato su Supabase." }, 500);

    // Tutti i locali censiti, indicizzati per handle Instagram: servono anche
    // quelli fuori da questa scansione per riconoscere i post in collaborazione.
    const { data: allVenues } = await sb.from("venues").select("*");
    const venuesByHandle = new Map<string, any>();
    for (const v of (allVenues ?? [])) {
      const h = v.instagram_url ? handleOf(v.instagram_url) : null;
      if (h) venuesByHandle.set(h, v);
    }
    // Parole identificative del nome di ogni locale (per il match nel titolo)
    const venueNameSig = [...venuesByHandle.entries()]
      .map(([h, v]) => ({ h, v, sig: norm(v.name).split(" ").filter(w => w.length >= 4 && !GENERIC.has(w)) }))
      .filter(x => x.sig.length);

    // Stato dello snapshot
    const prog = await fetch(`https://api.brightdata.com/datasets/v3/progress/${encodeURIComponent(run.snapshot_id)}`, {
      headers: { "Authorization": `Bearer ${bdKey}` },
    });
    const progBody = await prog.json().catch(() => ({}));
    const pStatus = (progBody?.status || "").toLowerCase();
    if (!prog.ok) throw new Error(`Bright Data progress ${prog.status}`);
    if (pStatus === "failed" || pStatus === "canceled") {
      await sb.from("discovery_runs").update({ status: "error", error: `Raccolta Bright Data: ${pStatus}`, updated_at: new Date().toISOString() }).eq("id", runId);
      return json({ status: "error", error: `La raccolta Bright Data è terminata con stato "${pStatus}".` });
    }
    if (pStatus !== "ready") return json({ status: "running" });

    // Lock atomico: una sola esecuzione passa da "running" a "processing" ed
    // elabora lo snapshot. Le chiamate sovrapposte (poll del browser ogni 12s
    // mentre l'estrazione dura di più, o browser + cron insieme) trovano lo
    // stato già "processing" e ritornano subito, senza ripetere l'estrazione
    // Claude (che altrimenti raddoppia i crediti). Il cron ricicla i run
    // rimasti "processing" troppo a lungo (vedi pg_cron jobid 3).
    const { data: claimed } = await sb.from("discovery_runs")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", runId).eq("status", "running").select("id");
    if (!claimed || !claimed.length) return json({ status: "running" });
    claimedRunId = runId;

    // Scarica i post
    const snap = await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${encodeURIComponent(run.snapshot_id)}?format=json`, {
      headers: { "Authorization": `Bearer ${bdKey}` },
    });
    if (snap.status === 202) {
      // Snapshot non ancora scaricabile: rilascia il lock così il prossimo
      // poll (o il cron) riprova senza restare bloccato su "processing".
      await sb.from("discovery_runs").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", runId);
      claimedRunId = null;
      return json({ status: "running" });
    }
    if (!snap.ok) throw new Error(`Bright Data snapshot ${snap.status}`);
    const records = await snap.json();
    const posts = (Array.isArray(records) ? records : [])
      .filter((r: any) => r && !r.error && (r.description || r.caption));

    if (!posts.length) {
      await sb.from("discovery_runs").update({ status: "done", created_events: 0, updated_at: new Date().toISOString() }).eq("id", runId);
      return json({ status: "done", created: 0, posts: 0, message: "Nessun post con testo trovato nel periodo." });
    }

    // Documenti per l'estrazione (a blocchi: nessun post viene scartato)
    // + mappe post -> foto, post -> caption, post -> locale di provenienza
    const photosByPost  = new Map<string, string[]>();
    const extrasByPost  = new Map<string, string[]>();
    const captionByPost = new Map<string, string>();
    const handleByPost  = new Map<string, string>();
    const docs: string[] = [];
    let current = "";
    for (const post of posts) {
      const postUrl = String(post.url || "").trim();
      const caption = String(post.description || post.caption || "").slice(0, CAPTION_CHARS);
      if (postUrl) {
        const photos = (Array.isArray(post.photos) ? post.photos : []).filter(Boolean).map((x: any) => String(x));
        const extras = [post.display_url, post.thumbnail].filter(Boolean).map((x: any) => String(x));
        if (photos.length) photosByPost.set(postUrl, photos);
        if (extras.length) extrasByPost.set(postUrl, extras);
        if (caption) captionByPost.set(postUrl, caption);
        // Il feed scansionato (dall'input della raccolta) vince sull'autore del
        // post: i post in collaborazione col promoter restano legati al locale.
        const feedHandle = handleOf(String(post.input?.url || "")) || (post.user_posted ? String(post.user_posted).toLowerCase() : null);
        if (feedHandle) handleByPost.set(postUrl, feedHandle);
      }
      const chunk =
        `\n\n### POST: ${postUrl}\n` +
        `Profilo: ${post.user_posted || post.profile_name || ""}\n` +
        `Pubblicato: ${post.date_posted || ""}\n` +
        (post.location ? `Luogo: ${typeof post.location === "string" ? post.location : JSON.stringify(post.location)}\n` : "") +
        caption;
      if (current && current.length + chunk.length > BATCH_CHARS) { docs.push(current); current = ""; }
      current += chunk;
    }
    if (current) docs.push(current);

    const p = run.params || {};
    const pp = {
      city: p.city || null, km: p.km || null, from: p.from || null, to: p.to || null,
      categories: Array.isArray(p.categories) ? p.categories : [],
    };
    let evs: any[] = [];
    let batchErrors = 0;
    for (const doc of docs) {
      try { evs = evs.concat(await extractWithClaude(anthropicKey, pp, doc)); }
      catch (e) { batchErrors++; if (batchErrors === docs.length) throw e; }
    }

    // Incrocio con angelipierre.it: gli eventi del sito si aggiungono in coda
    // (a parità di evento la dedup tiene quello estratto da Instagram).
    let webEvs: any[] = [];
    try {
      webEvs = await searchPierreEvents(anthropicKey, pp);
      console.log(`[instagram-results] run=${runId} angelipierre=${webEvs.length}`);
    } catch (e) {
      console.log(`[instagram-results] run=${runId} angelipierre saltato: ${e?.message ?? e}`);
    }

    const expectedYear = (pp.from || new Date().toISOString()).slice(0, 4);
    const inRange = (d: string) => d.slice(0, 4) === expectedYear && (!pp.from || d >= pp.from) && (!pp.to || d <= pp.to);
    const candidates = [
      ...evs.map((e: any) => ({ ...e, _source: "instagram" })),
      ...webEvs.map((e: any) => ({ ...e, _source: "web" })),
    ]
      .filter((e: any) => e && e.title && /^\d{4}-\d{2}-\d{2}$/.test(e.date || "") && inRange(e.date))
      .map((e: any) => ({
        title:            String(e.title).trim(),
        _raw:             String(e.title).trim(),
        organizer:        e.organizer ? String(e.organizer).trim() : null,
        address:          joinAddress(e.address ? String(e.address) : null, e.town ? String(e.town) : null),
        date:             e.date,
        time:             e.time && /^\d{2}:\d{2}$/.test(e.time) ? e.time : null,
        notes:            e.notes ? String(e.notes).trim().slice(0, 600) : null,
        social:           e.url ? String(e.url).trim() : null,
        flyer_url:        null as string | null,
        status:           "open",
        multi_select:     false,
        lista_spesa:      false,
        gestione_quote:   false,
        options:          DEFAULT_OPTIONS,
        participants:     [],
        votes:            emptyVotes(),
        shopping_list:    [],
        pending_approval: true,
        source:           e._source === "web" ? "web" : "instagram",
        visible_to:       [],
        discovery_meta:   { url: e.url || null, category: e.category ? String(e.category).trim() : "Evento", city: p.city || null, venue: null as string | null },
      }));

    // Risoluzione locale. In ordine: feed scansionato, @menzione di un locale
    // censito nella caption, nome del locale nel titolo/organizzatore estratto
    // (i post in collaborazione arrivano spesso a nome del promoter).
    // Poi: organizzatore = @nick del locale; indirizzo = quello censito, a meno
    // che la caption non contenga già un indirizzo esplicito con via/piazza;
    // titolo = sempre con il nome del locale all'inizio.
    for (const e of candidates) {
      const fh = e.social ? handleByPost.get(e.social) : null;
      let venue = fh ? (venuesByHandle.get(fh) ?? null) : null;
      let handle = venue ? fh! : null;
      if (!venue && e.social) {
        const cap = (captionByPost.get(e.social) || "").toLowerCase();
        for (const [h, v] of venuesByHandle) {
          if (cap.includes("@" + h)) { venue = v; handle = h; break; }
        }
      }
      if (!venue) {
        const hay = new Set(norm([e._raw, e.organizer, e.notes].filter(Boolean).join(" ")).split(" "));
        let best: { h: string; v: any; sig: string[] } | null = null;
        for (const x of venueNameSig) {
          if (x.sig.every(w => hay.has(w)) && (!best || x.sig.join(" ").length > best.sig.join(" ").length))
            best = x;
        }
        if (best) { venue = best.v; handle = best.h; }
      }

      if (venue && handle) {
        e.organizer = "@" + handle;
        e.discovery_meta.venue = handle;
      } else if (fh) {
        e.organizer = "@" + fh;
        e.discovery_meta.venue = fh;
      }
      if (venue) {
        const captionAddress = e.address && STREET_RE.test(e.address) ? e.address : null;
        if (venue.address) {
          e.address = joinAddress(venue.address, venue.city);
        } else if (!captionAddress) {
          e.address = [venue.name, venue.city].filter(Boolean).join(", ");
        }
      }
      const label = venue?.name || (fh ? "@" + fh : null);
      if (label) {
        const normLabel = norm(label);
        const normTitle = norm(e.title);
        if (!normTitle.startsWith(normLabel)) {
          // Remove any occurrence of the venue name from the title before prepending
          // to avoid "Pepito — Pepito presents XYZ" or "Cantieri — Cantieri Air"
          let cleanTitle = e.title;
          if (normTitle.includes(normLabel)) {
            const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            cleanTitle = cleanTitle.replace(new RegExp(`\\s*[-—@:·|]?\\s*${escaped}\\s*[-—@:·|]?\\s*`, "gi"), " ").replace(/\s+/g, " ").trim();
            if (!cleanTitle) cleanTitle = e.title;
          }
          e.title = `${label} — ${cleanTitle}`;
        }
      }
    }

    console.log(`[instagram-results] run=${runId} post=${posts.length} blocchi=${docs.length} estratti=${evs.length} candidati=${candidates.length}`);

    // Dedup: confronto con TUTTI gli eventi (anche cestinati: un doppione già
    // scartato dall'admin non deve ricomparire) su URL del post, titolo
    // normalizzato+data, locale+data e somiglianza del titolo a parità di data
    // (lo stesso evento annunciato da due profili ha spesso titoli diversi).
    const { data: existing } = await sb.from("events").select("social, title, date, time, organizer");
    const urls    = new Set((existing ?? []).map((e: any) => e.social).filter(Boolean));
    const tdNorm  = new Set((existing ?? []).map((e: any) => `${norm(e.title)}__${e.date}`));
    const orgDate = new Set((existing ?? [])
      .filter((e: any) => e.organizer && String(e.organizer).startsWith("@") && e.date)
      .map((e: any) => `${String(e.organizer).slice(1).toLowerCase()}__${e.date}`));
    const existingSigs = (existing ?? []).map((e: any) => ({ date: e.date, time: e.time ?? null, sig: sigTokens(e.title) }));
    const timeCompatible = (a: string | null, b: string | null) => !a || !b || a === b;

    // A parità di evento tenuto/scartato vince chi ha il nome del proprio
    // locale nel titolo originale (è il padrone di casa), poi chi ha più dati.
    const scoreOf = (e: any) => {
      let s = 0;
      const v = e.discovery_meta.venue ? venuesByHandle.get(e.discovery_meta.venue) : null;
      if (v) {
        s += 1;
        const words = new Set(norm(e._raw).split(" "));
        if (norm(v.name).split(" ").some(w => w.length >= 4 && !GENERIC.has(w) && words.has(w))) s += 4;
      }
      if (e.time) s += 1;
      if (e.social && photosByPost.get(e.social)?.length) s += 1;
      return s;
    };

    const toInsert: any[] = [];
    let scartati = 0;
    for (const e of candidates) {
      const kTitle = `${norm(e.title)}__${e.date}`;
      const kOrg   = (e.organizer && e.organizer.startsWith("@")) ? `${e.organizer.slice(1).toLowerCase()}__${e.date}` : null;
      const sig    = sigTokens(e._raw);
      if (e.social && urls.has(e.social)) { scartati++; continue; }
      if (tdNorm.has(kTitle)) { scartati++; continue; }
      if (kOrg && orgDate.has(kOrg)) { scartati++; continue; }
      if (existingSigs.some(x => x.date === e.date && timeCompatible(x.time, e.time) && similarTitles(sig, x.sig))) { scartati++; continue; }
      const dupIdx = toInsert.findIndex(k =>
        k.date === e.date && (
          `${norm(k.title)}__${k.date}` === kTitle ||
          (kOrg && k.organizer && k.organizer.toLowerCase() === e.organizer.toLowerCase()) ||
          (timeCompatible(k.time, e.time) && similarTitles(sig, k._sig))
        ));
      if (dupIdx >= 0) {
        if (scoreOf(e) > scoreOf(toInsert[dupIdx])) toInsert[dupIdx] = { ...e, _sig: sig };
        scartati++;
        continue;
      }
      toInsert.push({ ...e, _sig: sig });
    }

    // Inserimento PRIMA delle locandine: se il caricamento immagini va lungo
    // o fallisce, gli eventi sono comunque salvati.
    let inserted: any[] = [];
    if (toInsert.length) {
      const rows = toInsert.map(({ _raw, _sig, ...rest }: any) => rest);
      const { data, error: insErr } = await sb.from("events").insert(rows).select("id, title, date, social");
      if (insErr) throw new Error("Errore inserimento DB: " + insErr.message);
      inserted = data ?? [];
    }

    await sb.from("discovery_runs").update({ status: "done", created_events: inserted.length, updated_at: new Date().toISOString() }).eq("id", runId);

    // Locandine: la foto del post diventa flyer; nei caroselli Claude indica
    // quale immagine corrisponde all'evento. Se la scelta fallisce per un
    // errore tecnico si usa la prima foto; si salta solo se Claude esclude
    // esplicitamente tutte le immagini.
    let flyers = 0;
    for (const ev of inserted) {
      if (flyers >= MAX_FLYERS) break;
      const photos = ev.social ? (photosByPost.get(ev.social) ?? []) : [];
      const extras = ev.social ? (extrasByPost.get(ev.social) ?? []) : [];
      const pool = photos.length ? photos : extras;
      if (!pool.length) continue;
      let img: { buf: Uint8Array; ct: string } | null = null;
      if (pool.length > 1) {
        const pick = await pickFlyerIndex(anthropicKey, ev, pool);
        if (pick.none) continue;
        const idx = pick.idx ?? [...pick.images.keys()][0] ?? null;
        if (idx !== null) img = pick.images.get(idx) ?? await fetchImage(pool[idx]);
      } else {
        img = await fetchImage(pool[0]);
      }
      if (!img) for (const u of extras) { img = await fetchImage(u); if (img) break; }
      if (!img) continue;
      const url = await storeFlyer(sb, img);
      if (url) {
        flyers++;
        await sb.from("events").update({ flyer_url: url }).eq("id", ev.id);
      }
    }

    console.log(`[instagram-results] run=${runId} creati=${inserted.length} locandine=${flyers} scartati=${scartati}`);
    return json({ status: "done", created: inserted.length, posts: posts.length, flyers, scartati, blocchi: docs.length });

  } catch (err: any) {
    // Se il run era stato preso in carico, marcalo "error" per non lasciarlo
    // bloccato su "processing" e per fermare i retry (niente spreco di crediti).
    if (sb && claimedRunId) {
      try {
        await sb.from("discovery_runs").update({
          status: "error",
          error: String(err?.message ?? err).slice(0, 300),
          updated_at: new Date().toISOString(),
        }).eq("id", claimedRunId);
      } catch { /* best effort */ }
    }
    return json({ error: err?.message ?? "Errore sconosciuto" }, 500);
  }
});
