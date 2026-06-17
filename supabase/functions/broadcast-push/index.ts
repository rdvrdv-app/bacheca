import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Broadcast push (Web Push / VAPID) chiamata dai trigger del DB ─
// Autenticata con header x-cron-secret == app_config.cron_secret (nessun JWT:
// la invoca Postgres via pg_net). Invia una notifica push cifrata (RFC 8291
// aes128gcm) agli utenti che possono vedere l'evento e che hanno la preferenza
// push della categoria attiva, escluso chi ha generato l'azione.
//
// Body atteso: { category, title, body, url?, event_id?, exclude_user? }
// Secret richiesti: VAPID_PUBLIC_KEY, VAPID_PRIVATE_JWK, VAPID_SUBJECT.

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const enc = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]) => {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const b64urlToU8 = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
};
const u8ToB64url = (buf: ArrayBuffer | Uint8Array) => {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function hmac(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
const hkdfExtract = (salt: Uint8Array, ikm: Uint8Array) => hmac(salt, ikm);
async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const t = await hmac(prk, concat(info, new Uint8Array([1])));
  return t.slice(0, length);
}

async function encryptPayload(p256dh: string | null, auth: string | null, plaintext: Uint8Array): Promise<Uint8Array | null> {
  if (!p256dh || !auth) return null;
  const uaPublic = b64urlToU8(p256dh);
  const authSecret = b64urlToU8(auth);
  const asKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeyPair.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeyPair.privateKey, 256));
  const keyInfo = concat(enc("WebPush: info"), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdfExpand(await hkdfExtract(authSecret, ecdh), keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, concat(enc("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdfExpand(prk, concat(enc("Content-Encoding: nonce"), new Uint8Array([0])), 12);
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const record = concat(plaintext, new Uint8Array([2]));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, record));
  const rs = new Uint8Array([0, 0, 0x10, 0]);
  const header = concat(salt, rs, new Uint8Array([asPublic.length]), asPublic);
  return concat(header, ct);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const PUBLIC  = Deno.env.get("VAPID_PUBLIC_KEY");
    const JWKRAW  = Deno.env.get("VAPID_PRIVATE_JWK");
    const SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@bacheca.app";
    if (!PUBLIC || !JWKRAW) return json({ error: "Chiavi VAPID non configurate." }, 500);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Autorizzazione: segreto condiviso col job pg_net
    const secret = req.headers.get("x-cron-secret") || "";
    const { data: cfg } = await sb.from("app_config").select("value").eq("key", "cron_secret").maybeSingle();
    if (!cfg?.value || secret !== cfg.value) return json({ error: "Non autorizzato" }, 403);

    const { category, title, body, url, event_id, exclude_user } = await req.json() as {
      category?: string; title?: string; body?: string; url?: string; event_id?: string; exclude_user?: string;
    };
    if (!category || !title) return json({ error: "category/title mancanti" }, 400);

    // Visibilità dell'evento (se fornito)
    let allowed: string[] | null = null;
    if (event_id) {
      const { data: ev } = await sb.from("events")
        .select("visible_to, created_by, deleted_at").eq("id", event_id).maybeSingle();
      if (!ev || ev.deleted_at) return json({ sent: 0, skipped: "evento non valido" });
      const vis = Array.isArray(ev.visible_to) ? ev.visible_to.map(String) : [];
      if (vis.length > 0) allowed = Array.from(new Set([...vis, ev.created_by].filter(Boolean))) as string[];
    }

    let q = sb.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth");
    if (allowed) q = q.in("user_id", allowed);
    const { data: subs } = await q;
    let targets = (subs ?? []).filter(s => s.user_id !== exclude_user);
    if (targets.length) {
      const ids = Array.from(new Set(targets.map(t => t.user_id)));
      const { data: prefs } = await sb.from("notification_prefs").select("user_id, push").in("user_id", ids);
      const off = new Set((prefs ?? []).filter(p => p.push && p.push[category] === false).map(p => p.user_id));
      targets = targets.filter(t => !off.has(t.user_id));
    }
    if (!targets.length) return json({ sent: 0 });

    const payload = enc(JSON.stringify({ title, body: body || "", url: url || "./", eventId: event_id || "" }));

    const jwk = JSON.parse(JWKRAW);
    const signKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const audCache = new Map<string, string>();
    const vapidJwt = async (origin: string): Promise<string> => {
      if (audCache.has(origin)) return audCache.get(origin)!;
      const h = u8ToB64url(enc(JSON.stringify({ typ: "JWT", alg: "ES256" })));
      const p = u8ToB64url(enc(JSON.stringify({ aud: origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })));
      const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signKey, enc(`${h}.${p}`));
      const jwt = `${h}.${p}.${u8ToB64url(sig)}`;
      audCache.set(origin, jwt);
      return jwt;
    };

    let sent = 0;
    const stale: string[] = [];
    await Promise.all(targets.map(async (s) => {
      try {
        const origin = new URL(s.endpoint).origin;
        const jwt = await vapidJwt(origin);
        const headers: Record<string, string> = { "Authorization": `vapid t=${jwt}, k=${PUBLIC}`, "TTL": "86400" };
        let b: Uint8Array | undefined;
        const e1 = await encryptPayload(s.p256dh, s.auth, payload);
        if (e1) { b = e1; headers["Content-Encoding"] = "aes128gcm"; headers["Content-Type"] = "application/octet-stream"; }
        const res = await fetch(s.endpoint, { method: "POST", headers, body: b });
        console.log(`[broadcast-push] ${category} ${origin} -> ${res.status}`);
        if (res.status === 404 || res.status === 410) stale.push(s.id);
        else if (res.ok) sent++;
      } catch (e) { console.log(`[broadcast-push] errore: ${e?.message ?? e}`); }
    }));
    if (stale.length) await sb.from("push_subscriptions").delete().in("id", stale);

    return json({ sent, targets: targets.length, removed: stale.length });
  } catch (err: any) {
    return json({ error: err?.message ?? "Errore" }, 500);
  }
});
