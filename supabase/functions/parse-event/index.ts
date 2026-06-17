import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type":                 "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

const MODEL = "claude-sonnet-4-6";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { text, imageBase64, imageMediaType } = await req.json() as {
      text?: string;
      imageBase64?: string;
      imageMediaType?: string;
    };

    if (!text?.trim() && !imageBase64)
      return json({ error: "Fornisci almeno un testo o un'immagine." }, 400);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey)
      return json({ error: "Secret ANTHROPIC_API_KEY non configurato." }, 500);

    const today = new Date().toISOString().slice(0, 10);
    const system =
      `Sei un assistente che estrae i dati di un evento da testo (post social) o da un'immagine (locandina). Oggi è ${today}. ` +
      `Estrai le informazioni dell'evento e rispondi ESCLUSIVAMENTE con un oggetto JSON valido (senza markdown, senza testo prima o dopo) con questa struttura: ` +
      `{"title": string, "organizer": string|null, "address": string|null, "date": "YYYY-MM-DD"|null, "time": "HH:MM"|null, "notes": string|null, "social": string|null}. ` +
      `Regole: se l'anno non è indicato usa l'anno corrente, oppure il prossimo se il mese è già passato. ` +
      `L'ora deve essere in formato 24h (es. 21:30). ` +
      `Le note devono essere una sintesi breve della descrizione dell'evento (max 300 caratteri). ` +
      `Il campo social è il link all'evento/post se presente nel testo. ` +
      `Se un campo non è rilevabile, metti null. Non inventare informazioni non presenti.`;

    const content: any[] = [];
    if (imageBase64 && imageMediaType) {
      content.push({ type: "image", source: { type: "base64", media_type: imageMediaType, data: imageBase64 } });
    }
    content.push({ type: "text", text: text?.trim() || "Estrai i dati dell'evento da questa immagine." });

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content }],
      }),
    });

    if (!r.ok) {
      const b = await r.text();
      if (r.status === 429)
        throw new Error("Limite di velocità Anthropic raggiunto. Riprova tra un minuto.");
      throw new Error(`Claude ${r.status}: ${b.slice(0, 200)}`);
    }

    const data = await r.json();
    const out = (data.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();

    const start = out.indexOf("{");
    const end   = out.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("Risposta non valida da Claude.");

    let parsed: any;
    try { parsed = JSON.parse(out.slice(start, end + 1)); }
    catch { throw new Error("JSON non valido nella risposta di Claude."); }

    return json(parsed);

  } catch (err: any) {
    return json({ error: err?.message ?? "Errore sconosciuto" }, 500);
  }
});
