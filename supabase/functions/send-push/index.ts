import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Invio notifiche push (Web Push / VAPID) ───────────────────
// Invocata dal client (JWT utente) dopo l'inserimento di un commento.
// Manda una notifica "muta" (senza payload cifrato): il service worker mostra
// un messaggio generico e apre l'app al click. Niente cifratura del payload =
// implementazione semplice e robusta.
//
// Secret richiesti (supabase secrets set ...):
//   VAPID_PUBLIC_KEY   chiave pubblica VAPID (base64url, 65 byte raw) — la stessa del client
//   VAPID_PRIVATE_JWK  chiave privata in formato JWK (JSON: {kty,crv,x,y,d})
//   VAPID_SUBJECT      es. "mailto:rdvrdv80@gmail.com"

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type":                 "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlStr = (str: string) => b64url(new TextEncoder().encode(str));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const PUBLIC  = Deno.env.get("VAPID_PUBLIC_KEY");
    const JWKRAW  = Deno.env.get("VAPID_PRIVATE_JWK");
    const SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@bacheca.app";
    if (!PUBLIC || !JWKRAW)
      return json({ error: "Chiavi VAPID non configurate (VAPID_PUBLIC_KEY / VAPID_PRIVATE_JWK)." }, 500);

    // ── Autenticazione del chiamante ────────────────────────────
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

    // ── Evento + autore del commento ────────────────────────────
    const { data: ev } = await sb.from("events")
      .select("id, title, visible_to, created_by, deleted_at").eq("id", event_id).maybeSingle();
    if (!ev || ev.deleted_at) return json({ sent: 0, skipped: "evento non valido" });

    let authorId: string | null = caller.id;
    if (comment_id) {
      const { data: c } = await sb.from("event_comments")
        .select("user_id, event_id").eq("id", comment_id).maybeSingle();
      if (c) { authorId = c.user_id; if (c.event_id !== event_id) return json({ sent: 0 }); }
    }

    // ── Destinatari: chi può vedere l'evento, escluso l'autore ──
    const vis = Array.isArray(ev.visible_to) ? ev.visible_to.map(String) : [];
    let subsQuery = sb.from("push_subscriptions").select("id, user_id, endpoint");
    if (vis.length > 0) {
      const allowed = Array.from(new Set([...vis, ev.created_by].filter(Boolean)));
      subsQuery = subsQuery.in("user_id", allowed as string[]);
    }
    const { data: subs } = await subsQuery;
    const targets = (subs ?? []).filter(s => s.user_id !== authorId);
    if (!targets.length) return json({ sent: 0 });

    // ── Firma VAPID (ES256) + invio ─────────────────────────────
    const jwk = JSON.parse(JWKRAW);
    const signKey = await crypto.subtle.importKey(
      "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
    );
    const audCache = new Map<string, string>();
    const vapidJwt = async (origin: string): Promise<string> => {
      if (audCache.has(origin)) return audCache.get(origin)!;
      const header  = b64urlStr(JSON.stringify({ typ: "JWT", alg: "ES256" }));
      const payload = b64urlStr(JSON.stringify({
        aud: origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT,
      }));
      const sig = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" }, signKey,
        new TextEncoder().encode(`${header}.${payload}`),
      );
      const jwt = `${header}.${payload}.${b64url(sig)}`;
      audCache.set(origin, jwt);
      return jwt;
    };

    let sent = 0;
    const stale: string[] = [];
    await Promise.all(targets.map(async (s) => {
      try {
        const origin = new URL(s.endpoint).origin;
        const jwt = await vapidJwt(origin);
        const res = await fetch(s.endpoint, {
          method: "POST",
          headers: {
            "Authorization": `vapid t=${jwt}, k=${PUBLIC}`,
            "TTL": "86400",
          },
        });
        if (res.status === 404 || res.status === 410) stale.push(s.id);
        else if (res.ok) sent++;
      } catch { /* best effort per-endpoint */ }
    }));

    if (stale.length) await sb.from("push_subscriptions").delete().in("id", stale);

    return json({ sent, targets: targets.length, removed: stale.length });
  } catch (err: any) {
    return json({ error: err?.message ?? "Errore sconosciuto" }, 500);
  }
});
