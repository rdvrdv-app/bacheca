import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Scoperta eventi (crawler) ────────────────────────────────
// Per ogni sito: scarica la pagina-elenco (letta per intero), poi segue
// alcuni articoli recenti per i dettagli, e passa tutto a Claude in UNA
// chiamata. Inserisce i risultati in pre-approvazione.

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type":                 "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

const DEFAULT_OPTIONS = ["Sì, ci sono", "Forse", "Non ci sono"];
const emptyVotes = () => Object.fromEntries(DEFAULT_OPTIONS.map(o => [o, []]));

// Pagine-elenco da cui partire.
const DEFAULT_SEEDS = [
  "https://www.eventipescara.it/",
  "https://www.abruzzonews.eu/eventi",
  "https://www.abruzzoinfesta.it/",
  "https://angelipierre.it/discoteche-in-abruzzo/",
];

// User-Agent da browser reale: molti siti bloccano/limitano i bot sconosciuti.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MODEL = "claude-sonnet-4-6";
const SEED_TEXT_CHARS   = 26000;  // legge per intero la lista eventi
const ARTICLES_PER_SEED = 5;
const PER_ARTICLE_CHARS = 1500;
const TOTAL_CHARS       = 95000;
const FETCH_TIMEOUT_MS  = 10000;

function htmlToText(html: string, cap: number): string {
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => `${inner.replace(/<[^>]+>/g, "")} (${href})`)
    .replace(/<\/(p|div|li|h[1-6]|tr|article|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  t = t
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#8217;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  return t.slice(0, cap);
}

async function fetchRaw(url: string): Promise<{ url: string; html: string; ok: boolean; note: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { url, html: "", ok: false, note: `HTTP ${res.status}` };
    const html = await res.text();
    return { url, html, ok: true, note: "" };
  } catch (e: any) {
    clearTimeout(timer);
    return { url, html: "", ok: false, note: e?.name === "AbortError" ? "timeout" : (e?.message || "errore") };
  }
}

function sameHost(u: string, host: string): boolean {
  try { return new URL(u).hostname.replace(/^www\./, "") === host.replace(/^www\./, ""); }
  catch { return false; }
}

function extractArticleLinks(html: string, baseUrl: string, max: number): string[] {
  const host = new URL(baseUrl).hostname;
  const out: string[] = [];
  const seen = new Set<string>();
  const bad = /(\/(tag|tags|category|categoria|categorie|author|autore|page|pagina|cerca|search|feed|rss|login|contatt|contribuisci|wp-)|\.(?:jpg|jpeg|png|gif|webp|svg|pdf|zip|css|js|ico)(?:\?|$)|mailto:|tel:|javascript:|\/(?:privacy|cookie|chi-siamo|redazione|note-legali|disclaimer)|(?:facebook|instagram|twitter|x|youtube|whatsapp|t\.me|tiktok|sktthemes)\b)/i;
  const re = /href=["']([^"'#\s]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && seen.size < max * 6) {
    let abs: string;
    try { abs = new URL(m[1].trim(), baseUrl).toString(); } catch { continue; }
    if (!sameHost(abs, host)) continue;
    if (bad.test(abs)) continue;
    let path = "";
    try { path = new URL(abs).pathname; } catch { continue; }
    if (path === "/" || path.replace(/\/+$/, "").length < 10) continue;
    if (!/-/.test(path)) continue;
    const norm = abs.split("#")[0].split("?")[0].replace(/\/+$/, "");
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
    if (out.length >= max) break;
  }
  return out;
}

async function crawl(seed: string) {
  const s = await fetchRaw(seed);
  if (!s.ok) return { seed, ok: false, note: s.note, links: 0, articles: 0, parts: [] as { url: string; text: string }[] };
  const parts: { url: string; text: string }[] = [];
  const seedText = htmlToText(s.html, SEED_TEXT_CHARS);
  if (seedText.length > 100) parts.push({ url: seed, text: seedText });
  const links = extractArticleLinks(s.html, seed, ARTICLES_PER_SEED);
  const arts = await Promise.all(links.map(l => fetchRaw(l)));
  let articles = 0;
  for (const a of arts) {
    if (!a.ok) continue;
    const txt = htmlToText(a.html, PER_ARTICLE_CHARS);
    if (txt.length > 150) { parts.push({ url: a.url, text: txt }); articles++; }
  }
  return { seed, ok: true, note: "", links: links.length, articles, parts };
}

async function extractWithClaude(apiKey: string, p: { city: string; radius: number; from: string; to: string; categories: string[] }, document: string) {
  const today = new Date().toISOString().slice(0, 10);
  const cats = (p.categories && p.categories.length && !p.categories.includes("Tutti"))
    ? `Interessano in particolare queste categorie: ${p.categories.join(", ")}. `
    : "";
  const system =
    `Sei un estrattore di eventi da pagine web italiane di eventi in Abruzzo. Oggi è ${today}. ` +
    `Ti fornisco il testo di più pagine (liste eventi e singoli articoli), separate da righe "### FONTE: <url>". ` +
    `I titoli spesso iniziano con la data abbreviata in italiano: es. "29Mag" = 29 maggio, "30-31Mag" = 30 e 31 maggio (usa la data di inizio), "14-17Mag" = dal 14 al 17 maggio. I mesi sono abbreviati: Gen Feb Mar Apr Mag Giu Lug Ago Set Ott Nov Dic. ` +
    `Estrai TUTTI gli eventi con una data chiara che si svolgono a ${p.city} o in località entro circa ${p.radius} km da ${p.city}, ` +
    `con data compresa tra ${p.from} e ${p.to}. ` + cats +
    `Includi anche gli eventi nei lidi, stabilimenti balneari e locali/serate della zona (es. Pepito Beach, Lido San Marco, Jambo Beach, ecc.). ` +
    `Se l'anno non è scritto, deducilo (un evento il cui giorno/mese è già passato rispetto a oggi va all'anno successivo). ` +
    `Rispondi ESCLUSIVAMENTE con un array JSON valido, senza testo introduttivo e senza markdown. ` +
    `Ogni elemento: {"title": string, "date": "YYYY-MM-DD", "time": "HH:MM"|null, "town": string|null, "address": string|null, "url": string|null, "category": string|null, "notes": string|null}. ` +
    `Per "url" usa il link specifico dell'articolo/evento se presente, altrimenti l'URL della FONTE. ` +
    `Se non trovi eventi validi rispondi [].`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: document }],
    }),
  });

  if (!r.ok) {
    const b = await r.text();
    if (r.status === 429)
      throw new Error("Limite di velocità Anthropic raggiunto (token al minuto). Riprova tra un minuto oppure aumenta il tier del tuo account su console.anthropic.com.");
    throw new Error(`Claude ${r.status}: ${b.slice(0, 200)}`);
  }
  const data = await r.json();
  const out = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  const start = out.indexOf("[");
  const end   = out.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  let parsed: any;
  try { parsed = JSON.parse(out.slice(start, end + 1)); } catch { throw new Error("Claude non ha restituito un JSON valido."); }
  return Array.isArray(parsed) ? parsed : [];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { city, radius = 30, from, to, categories = [], seeds } =
      (await req.json()) as { city?: string; radius?: number; from?: string; to?: string; categories?: string[]; seeds?: string[] };

    if (!city || !String(city).trim())
      return json({ error: "Indica una città di riferimento." }, 400);
    if (!from || !to)
      return json({ error: "Indica l'intervallo di date (da / a)." }, 400);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey)
      return json({ error: "Secret ANTHROPIC_API_KEY non configurato su Supabase." }, 500);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const cityT    = String(city).trim();
    const rad      = Number(radius) || 30;
    const seedList = (Array.isArray(seeds) && seeds.length) ? seeds : DEFAULT_SEEDS;

    const blocks = await Promise.all(seedList.map(s => crawl(String(s).trim())));

    let document = "";
    for (const b of blocks) {
      for (const part of b.parts) {
        if (document.length >= TOTAL_CHARS) break;
        const chunk = `\n\n### FONTE: ${part.url}\n${part.text}`;
        document += chunk.slice(0, Math.max(0, TOTAL_CHARS - document.length));
      }
    }

    const sites = blocks.map(b => ({ seed: b.seed, ok: b.ok, note: b.note, links: b.links, articles: b.articles }));
    console.log("[discover-events] crawl: " + JSON.stringify(sites) + " docChars=" + document.length);

    if (!document.trim())
      return json({ created: 0, message: "Nessun sito leggibile in questo momento.", report: [{ city: cityT, radius: rad, found: 0 }], sites });

    const evs = await extractWithClaude(apiKey, { city: cityT, radius: rad, from, to, categories }, document);

    const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);
    const valid = evs
      .filter((e: any) => e && e.title && /^\d{4}-\d{2}-\d{2}$/.test(e.date || "") && inRange(e.date))
      .map((e: any) => ({
        title:    String(e.title).trim(),
        date:     e.date,
        time:     e.time && /^\d{2}:\d{2}$/.test(e.time) ? e.time : null,
        address:  [e.address, e.town].filter(Boolean).join(", ").trim() || null,
        url:      e.url ? String(e.url).trim() : null,
        category: e.category ? String(e.category).trim() : null,
        notes:    e.notes ? String(e.notes).trim().slice(0, 600) : null,
      }));

    console.log("[discover-events] estratti=" + evs.length + " validi=" + valid.length + " citta=" + cityT + " dal=" + from + " al=" + to);

    const report = [{ city: cityT, radius: rad, found: valid.length }];

    if (!valid.length)
      return json({ created: 0, message: "Nessun evento trovato sui siti per i criteri indicati.", report, sites });

    const { data: existing } = await sb.from("events").select("social, title, date").is("deleted_at", null);
    const urls = new Set((existing ?? []).map((e: any) => e.social).filter(Boolean));
    const td   = new Set((existing ?? []).map((e: any) => `${e.title}__${e.date}`));

    const toInsert = valid.map((e: any) => ({
      title:            e.title,
      organizer:        null,
      address:          e.address,
      date:             e.date,
      time:             e.time,
      notes:            e.notes,
      social:           e.url,
      status:           "open",
      multi_select:     false,
      lista_spesa:      false,
      gestione_quote:   false,
      options:          DEFAULT_OPTIONS,
      participants:     [],
      votes:            emptyVotes(),
      shopping_list:    [],
      pending_approval: true,
      source:           "agent",
      visible_to:       [],
      discovery_meta:   { url: e.url, category: e.category || "Evento", city: cityT },
    })).filter((e: any) => {
      if (e.social && urls.has(e.social)) return false;
      if (e.title && e.date && td.has(`${e.title}__${e.date}`)) return false;
      return true;
    });

    if (!toInsert.length)
      return json({ created: 0, message: "Tutti gli eventi trovati sono già presenti.", report, sites });

    const { error: insErr } = await sb.from("events").insert(toInsert);
    if (insErr) throw new Error("Errore inserimento DB: " + insErr.message);

    return json({ created: toInsert.length, report, sites });

  } catch (err: any) {
    return json({ error: err?.message ?? "Errore sconosciuto" }, 500);
  }
});
