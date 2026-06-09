// Promemoria Telegram giornalieri:
//  - eventi che si svolgono domani
//  - sondaggi la cui scadenza è domani
// NON deployata automaticamente: vedi docs/IMPLEMENTAZIONI.md per i passi.
//
// Variabili d'ambiente richieste (oltre a quelle standard di Supabase):
//  - TELEGRAM_BOT_TOKEN  token del bot @bacheca_notifiche_bot
//  - CRON_SECRET         segreto condiviso con il job pg_cron che la invoca
import { createClient } from "npm:@supabase/supabase-js@2";

const fmtIt = (ds: string) => { const [y, m, d] = ds.split("-"); return `${d}-${m}-${y}`; };

Deno.serve(async (req) => {
  if (req.headers.get("Authorization") !== `Bearer ${Deno.env.get("CRON_SECRET")}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const [{ data: tomorrowEvents }, { data: deadlineEvents }, { data: subs }] = await Promise.all([
    sb.from("events")
      .select("title,date,time,address,visible_to")
      .eq("date", tomorrow).is("deleted_at", null).eq("pending_approval", false),
    sb.from("events")
      .select("title,deadline,visible_to")
      .eq("deadline", tomorrow).is("deleted_at", null).eq("pending_approval", false),
    sb.from("telegram_subscriptions").select("user_id,chat_id"),
  ]);

  // Gli eventi a visibilità ristretta vengono notificati solo agli utenti autorizzati
  const visibleTo = (e: { visible_to?: string[] | null }, uid: string) =>
    !e.visible_to || e.visible_to.length === 0 || e.visible_to.includes(uid);

  let sent = 0;
  for (const sub of subs ?? []) {
    const lines: string[] = [];
    for (const e of (tomorrowEvents ?? []).filter((e) => visibleTo(e, sub.user_id))) {
      lines.push(`📅 Domani: *${e.title}*${e.time ? ` alle ${e.time}` : ""}${e.address ? `\n   📍 ${e.address}` : ""}`);
    }
    for (const e of (deadlineEvents ?? []).filter((e) => visibleTo(e, sub.user_id))) {
      lines.push(`⏰ Scade domani (${fmtIt(e.deadline)}) il sondaggio: *${e.title}*`);
    }
    if (!lines.length) continue;

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: sub.chat_id,
        text: `🔔 *Promemoria Bacheca*\n\n${lines.join("\n\n")}\n\n🗳️ https://rdvrdv-app.github.io/bacheca/`,
        parse_mode: "Markdown",
      }),
    });
    if (res.ok) sent++;
  }

  return new Response(JSON.stringify({ ok: true, date: tomorrow, sent }), {
    headers: { "Content-Type": "application/json" },
  });
});
