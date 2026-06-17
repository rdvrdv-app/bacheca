import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ⚠️ Il bot token NON va messo in chiaro nel repo (è pubblico via GitHub Pages).
// Impostalo come secret della function e leggilo da env:
//   supabase secrets set TELEGRAM_BOT_TOKEN=...
// (La versione live storica aveva il token hardcoded: ruotarlo e impostare il secret.)
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('OK', { status: 200 });

  try {
    const body = await req.json();
    const message = body?.message;
    if (!message) return new Response('OK', { status: 200 });

    const chatId = message.chat?.id;
    const text = (message.text ?? '').trim();
    const firstName = message.from?.first_name ?? 'amico';

    if (text.startsWith('/start')) {
      const reply = [
        `Ciao ${firstName}! 👋`,
        '',
        '📅 Sei connesso a <b>Bacheca</b> — il sistema di notifiche per gli eventi del gruppo.',
        '',
        '🔑 Il tuo <b>Chat ID</b> è:',
        `<code>${chatId}</code>`,
        '',
        'Copia questo numero e incollalo nella sezione <b>Notifiche Telegram</b> del tuo profilo su Bacheca per ricevere gli aggiornamenti sugli eventi! 🎉',
      ].join('\n');

      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: reply, parse_mode: 'HTML' }),
      });

      const json = await res.json();
      console.log('Telegram response:', JSON.stringify(json));
    }

    return new Response('OK', { status: 200 });
  } catch (e) {
    console.error('Error:', e);
    return new Response('Error', { status: 500 });
  }
});
