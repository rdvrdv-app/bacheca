import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // ── Verifica che chi chiama sia autenticato e admin ──────────
    const callerToken = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!callerToken) return json({ error: "Non autorizzato" }, 401);

    // Client service role per operazioni admin
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Client user-scoped per verificare il token del caller
    const userSb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: `Bearer ${callerToken}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      }
    );

    // Controlla che il caller sia autenticato
    const { data: { user: caller }, error: authError } = await userSb.auth.getUser();
    if (authError || !caller) return json({ error: "Token non valido" }, 401);

    const { data: callerProfile } = await sb
      .from("profiles").select("role").eq("id", caller.id).single();
    if (callerProfile?.role !== "admin") return json({ error: "Non sei admin" }, 403);

    // ── Dati dell'utente da eliminare ───────────────────────────
    const { userId, voterName } = await req.json();
    if (!userId) return json({ error: "userId mancante" }, 400);

    // Impedisce all'admin di cancellare se stesso
    if (userId === caller.id) return json({ error: "Non puoi eliminare te stesso" }, 400);

    // ── Pulizia dati ────────────────────────────────────────────

    // 1. Rimuove voti e partecipazione da tutti gli eventi
    if (voterName) {
      const { error: voteErr } = await sb.rpc("remove_user_votes", { p_voter: voterName });
      if (voteErr) console.error("remove_user_votes:", voteErr.message);
    }

    // 2. Notifiche Telegram
    await sb.from("telegram_subscriptions").delete().eq("user_id", userId);

    // 3. Log attività
    await sb.from("activity_log").delete().eq("user_id", userId);

    // 4. Profilo
    await sb.from("profiles").delete().eq("id", userId);

    // 5. Utente auth (richiede service role)
    const { error: authErr } = await sb.auth.admin.deleteUser(userId);
    if (authErr) throw authErr;

    return json({ success: true });
  } catch (err) {
    console.error(err);
    return json({ error: err.message ?? "Errore sconosciuto" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
