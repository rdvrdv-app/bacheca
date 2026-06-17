import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Scansione Instagram via Bright Data (trigger asincrono) ──
// L'admin indica i locali (venues) da scansionare: questa funzione avvia
// una raccolta Bright Data sui loro profili Instagram e registra la run.
// I risultati si recuperano poi con la funzione `instagram-results`.

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type":                 "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

// Dataset Bright Data "Instagram - Posts" (discover by profile URL)
const DEFAULT_DATASET_ID = "gd_lk5ns7kz21pck8jpis";
const POST_LOOKBACK_DAYS = 45; // i post più vecchi raramente annunciano eventi futuri

// Profili sempre inclusi in OGNI scansione (oltre ai locali selezionati):
// promoter/pagine abruzzesi molto attive che aggregano gli eventi di molti
// locali. I loro post vengono attribuiti al locale giusto in instagram-results
// (via @menzione nella caption o nome del locale nel titolo). Si leggono più
// post del solito perché coprono molte serate.
const ALWAYS_INCLUDE_PROFILES = ["https://www.instagram.com/pepe_105_eventi_abruzzo/"];
const ALWAYS_INCLUDE_POSTS = 40;
const normProfileUrl = (u: string) => u.trim().toLowerCase().replace(/\/+$/, "");

async function requireAdmin(req: Request, sb: any) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user) return null;
  const { data: prof } = await sb.from("profiles").select("role").eq("id", user.id).single();
  return prof?.role === "admin" ? user : null;
}

async function configValue(sb: any, key: string): Promise<string | null> {
  const { data } = await sb.from("app_config").select("value").eq("key", key).maybeSingle();
  const v = (data?.value ?? "").toString().trim();
  return v || null;
}

const mmddyyyy = (d: Date) =>
  `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const admin = await requireAdmin(req, sb);
    if (!admin) return json({ error: "Operazione riservata agli admin." }, 403);

    const { venueIds = [], postsPerVenue = 8, city, km, from, to, categories = [] } =
      (await req.json()) as { venueIds?: string[]; postsPerVenue?: number; city?: string; km?: number; from?: string; to?: string; categories?: string[] };

    if (!Array.isArray(venueIds) || !venueIds.length)
      return json({ error: "Nessun locale selezionato per la scansione." }, 400);

    const apiKey = (await configValue(sb, "brightdata_api_key")) || Deno.env.get("BRIGHTDATA_API_KEY");
    if (!apiKey)
      return json({ error: "Chiave API Bright Data non configurata: inseriscila nella sezione Scopri." }, 400);
    const datasetId = (await configValue(sb, "brightdata_dataset_id")) || DEFAULT_DATASET_ID;

    const { data: venues, error: vErr } = await sb.from("venues").select("*").in("id", venueIds);
    if (vErr) throw new Error("Lettura locali: " + vErr.message);
    const targets = (venues ?? []).filter((v: any) => (v.instagram_url || "").trim());
    if (!targets.length)
      return json({ error: "I locali selezionati non hanno un URL Instagram." }, 400);

    const startDate = mmddyyyy(new Date(Date.now() - POST_LOOKBACK_DAYS * 86400000));
    // Niente filtro post_type: i locali annunciano spesso gli eventi via Reel
    // (es. "La Casa del Gelso"), che con post_type="Post" venivano esclusi.
    const inputs = targets.map((v: any) => ({
      url: v.instagram_url.trim(),
      num_of_posts: Math.max(1, Math.min(50, Number(postsPerVenue) || 8)),
      start_date: startDate,
      end_date: "",
    }));

    // Aggiungi i profili sempre inclusi, se non già presenti tra i locali scelti.
    const seen = new Set(inputs.map((i: any) => normProfileUrl(i.url)));
    for (const url of ALWAYS_INCLUDE_PROFILES) {
      if (!seen.has(normProfileUrl(url))) {
        inputs.push({ url, num_of_posts: ALWAYS_INCLUDE_POSTS, start_date: startDate, end_date: "" });
        seen.add(normProfileUrl(url));
      }
    }

    const trigger = await fetch(
      `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${encodeURIComponent(datasetId)}&include_errors=true&type=discover_new&discover_by=url`,
      {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(inputs),
      },
    );
    const tBody = await trigger.text();
    if (!trigger.ok) {
      if (trigger.status === 401 || trigger.status === 403)
        throw new Error("Bright Data ha rifiutato la chiave API (verifica la chiave nella sezione Scopri).");
      throw new Error(`Bright Data ${trigger.status}: ${tBody.slice(0, 200)}`);
    }
    let snapshotId = "";
    try { snapshotId = JSON.parse(tBody)?.snapshot_id || ""; } catch { /* gestito sotto */ }
    if (!snapshotId) throw new Error("Bright Data non ha restituito uno snapshot_id: " + tBody.slice(0, 200));

    const params = {
      city: city || null, km: Number(km) || null, from: from || null, to: to || null,
      categories, postsPerVenue: Number(postsPerVenue) || 8,
      venues: targets.map((v: any) => v.name),
    };
    const { data: run, error: rErr } = await sb.from("discovery_runs")
      .insert({ kind: "instagram", snapshot_id: snapshotId, status: "running", params, venue_ids: targets.map((v: any) => v.id) })
      .select().single();
    if (rErr) throw new Error("Registrazione run: " + rErr.message);

    await sb.from("venues").update({ last_scan_at: new Date().toISOString() })
      .in("id", targets.map((v: any) => v.id));

    console.log(`[instagram-scan] snapshot=${snapshotId} locali=${targets.length}`);
    return json({ runId: run.id, snapshotId, venues: targets.length });

  } catch (err: any) {
    return json({ error: err?.message ?? "Errore sconosciuto" }, 500);
  }
});
