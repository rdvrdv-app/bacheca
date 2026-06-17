import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Invio notifiche push (Web Push / VAPID) con payload cifrato ─
// Invocata dal client (JWT utente) dopo l'inserimento di un commento.
// Manda un payload JSON cifrato (RFC 8291, aes128gcm) con titolo evento,
// autore+estratto del commento e link per aprire la scheda dell'evento.
//
// Secret richiesti (supabase secrets set ...):
//   VAPID_PUBLIC_KEY   chiave pubblica VAPID (base64url, 65 byte raw) — la stessa del client
//   VAPID_PRIVATE_JWK  chiave privata in formato JWK (JSON: {kty,crv,x,y,d})
//   VAPID_SUBJECT      es. "mailto:rdvrdv80@gmail.com"

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type":                 "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

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

// HKDF (estratto/espansione) via HMAC-SHA-256
async function hmac(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
const hkdfExtract = (salt: Uint8Array, ikm: Uint8Array) => hmac(salt, ikm);
async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const t = await hmac(prk, concat(info, new Uint8Array([1])));
  return t.slice(0, length);
}

// Cifra il payload per una subscription (RFC 8291 + RFC 8188 aes128gcm).
// Ritorna il body binario pronto da inviare, o null se mancano le chiavi.
async function encryptPayload(p256dh: string | null, auth: string | null, plaintext: Uint8Array): Promise<Uint8Array | null> {
  if (!p256dh || !auth) return null;
  const uaPublic = b64urlToU8(p256dh);   // 65 byte
  const authSecret = b64urlToU8(auth);   // 16 byte

  // Coppia ECDH effimera del server
  const asKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeyPair.publicKey)); // 65 byte
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeyPair.privateKey, 256));

  // IKM = HKDF(auth_secret, ecdh, "WebPush: info\0" || ua_public || as_public)
  const keyInfo = concat(enc("WebPush: info"), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdfExpand(await hkdfExtract(authSecret, ecdh), keyInfo, 32);

  // CEK e NONCE da salt random
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, concat(enc("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdfExpand(prk, concat(enc("Content-Encoding: nonce"), new Uint8Array([0])), 12);

  // record = plaintext || 0x02 (delimitatore ultimo record), cifrato AES-128-GCM
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const record = concat(plaintext, new Uint8Array([2]));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, record));

  // Header aes128gcm: salt(16) | rs(4) | idlen(1) | keyid(as_public)
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  const header = concat(salt, rs, new Uint8Array([asPublic.length]), asPublic);
  return concat(header, ct);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const PUBLIC  = Deno.env.get("VAPID_PUBLIC_KEY");
    const JWKRAW  = Deno.env.get("VAPID_PRIVATE_JWK");
    const SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@bacheca.app";
    if (!PUBLIC || !JWKRAW)
      return json({ error: "Chiavi VAPID non configurate (VAPID_PUBLIC_KEY / VAPID_PRIVATE_JWK)." }, 500);

    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Non autorizzato" }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: { user: caller }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !caller) return json({ error: "Token non valido" }, 401);

    const { event_id, comment_id } = await req.json() as { event_id?: string; comment_id?: string };
    if (!event_id) return json({ error: "event_id mancante" }, 400);

    const { data: ev } = await sb.from("events")
      .select("id, title, visible_to, created_by, deleted_at").eq("id", event_id).maybeSingle();
    if (!ev || ev.deleted_at) return json({ sent: 0, skipped: "evento non valido" });

    // Autore + testo del commento (per il corpo della notifica)
    let authorId = caller.id;
    let authorName = "";
    let snippet = "";
    if (comment_id) {
      const { data: c } = await sb.from("event_comments")
        .select("user_id, event_id, author_name, body").eq("id", comment_id).maybeSingle();
      if (c) {
        if (c.event_id !== event_id) return json({ sent: 0 });
        authorId = c.user_id;
        authorName = c.author_name || "";
        snippet = (c.body || "").slice(0, 120);
      }
    }

    const vis = Array.isArray(ev.visible_to) ? ev.visible_to.map(String) : [];
    let subsQuery = sb.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth");
    if (vis.length > 0) {
      const allowed = Array.from(new Set([...vis, ev.created_by].filter(Boolean)));
      subsQuery = subsQuery.in("user_id", allowed as string[]);
    }
    const { data: subs } = await subsQuery;
    const targets = (subs ?? []).filter(s => s.user_id !== authorId);
    console.log(`[send-push] event=${event_id} author=${authorId} targets=${targets.length}`);
    if (!targets.length) return json({ sent: 0 });

    // Payload mostrato dal service worker
    const payload = enc(JSON.stringify({
      title: ev.title || "Bacheca",
      body: (authorName ? `${authorName}: ` : "") + (snippet || "nuovo commento"),
      url: `./?event=${event_id}`,
      eventId: event_id,
    }));

    // Firma VAPID (ES256)
    const jwk = JSON.parse(JWKRAW);
    const signKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const audCache = new Map<string, string>();
    const vapidJwt = async (origin: string): Promise<string> => {
      if (audCache.has(origin)) return audCache.get(origin)!;
      const header  = u8ToB64url(enc(JSON.stringify({ typ: "JWT", alg: "ES256" })));
      const body    = u8ToB64url(enc(JSON.stringify({ aud: origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })));
      const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signKey, enc(`${header}.${body}`));
      const jwt = `${header}.${body}.${u8ToB64url(sig)}`;
      audCache.set(origin, jwt);
      return jwt;
    };

    let sent = 0;
    const stale: string[] = [];
    await Promise.all(targets.map(async (s) => {
      try {
        const origin = new URL(s.endpoint).origin;
        const jwt = await vapidJwt(origin);
        const headers: Record<string, string> = {
          "Authorization": `vapid t=${jwt}, k=${PUBLIC}`,
          "TTL": "86400",
        };
        let body: Uint8Array | undefined;
        const enc1 = await encryptPayload(s.p256dh, s.auth, payload);
        if (enc1) { body = enc1; headers["Content-Encoding"] = "aes128gcm"; headers["Content-Type"] = "application/octet-stream"; }
        const res = await fetch(s.endpoint, { method: "POST", headers, body });
        console.log(`[send-push] ${origin} -> ${res.status}${body ? " (payload)" : " (muta)"}`);
        if (res.status === 404 || res.status === 410) stale.push(s.id);
        else if (res.ok) sent++;
      } catch (e) { console.log(`[send-push] errore invio: ${e?.message ?? e}`); }
    }));

    if (stale.length) await sb.from("push_subscriptions").delete().in("id", stale);

    return json({ sent, targets: targets.length, removed: stale.length });
  } catch (err: any) {
    return json({ error: err?.message ?? "Errore sconosciuto" }, 500);
  }
});
