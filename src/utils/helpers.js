import { sb } from '../config/supabase';

export const orNull = v => { const s = (v ?? "").toString().trim(); return s === "" ? null : s; };

export const fmtEur = v => "€ " + (Number(v)||0).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtDateTime = ts => { try { return new Date(ts).toLocaleString("it-IT", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" }); } catch { return ""; } };

// ── Notifiche push (Web Push / PWA) ───────────────────────────
export const VAPID_PUBLIC_KEY = "BLIKrma0o9iDgmBpcxmTGRXD_Fq2LydGruH_-HIiomOfyO0JIY3W4db33aSWPrHw-XFdOYbKXIqyMQQiYHTIN68";
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const urlB64ToU8 = b64 => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(s); const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
};
export async function enablePush(userId) {
  if (!pushSupported()) throw new Error("Le notifiche push non sono supportate da questo browser/dispositivo.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Permesso notifiche negato.");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  const { error } = await sb.from("push_subscriptions").upsert({
    user_id: userId, endpoint: sub.endpoint,
    p256dh: j.keys?.p256dh || null, auth: j.keys?.auth || null,
    user_agent: (navigator.userAgent || "").slice(0, 200),
  }, { onConflict: "endpoint" });
  if (error) throw error;
}
export async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) { await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
}

// ── Helpers Calendario ───────────────────────────
export const getDaysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
export const getFirstDay    = (y, m) => (new Date(y, m, 1).getDay() + 6) % 7;
export const toDateStr      = (y, m, d) => `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
export const openMaps       = addr => window.open("https://maps.google.com/?q=" + encodeURIComponent(addr), "_blank");
export const ferieOnDay     = (ferie, ds) => (ferie||[]).filter(f => f.start_date <= ds && ds <= f.end_date);
export const fmtDate = v => {
  if (!v) return "";
  let y, mo, d;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) { [y, mo, d] = v.slice(0,10).split("-"); }
  else { const dt = new Date(v); if (isNaN(dt)) return ""; y = dt.getFullYear(); mo = String(dt.getMonth()+1).padStart(2,"0"); d = String(dt.getDate()).padStart(2,"0"); }
  return `${d}-${mo}-${y}`;
};
export const fmtFerie       = ds => fmtDate(ds);

export const WHOLE_PERIOD     = "Tutto il periodo";
export const isMultiDay       = e => !!(e && e.end_date && e.date && e.end_date > e.date);
export const eventCoversDay   = (e, ds) => !!(e && e.date) && ds >= e.date && ds <= (e.end_date || e.date);
export const dateRange = (start, end) => {
  if (!start) return [];
  if (!end || end <= start) return [start];
  const out = []; const d = new Date(start+"T00:00:00"); const last = new Date(end+"T00:00:00");
  while (d <= last) { out.push(toDateStr(d.getFullYear(), d.getMonth(), d.getDate())); d.setDate(d.getDate()+1); }
  return out;
};
export const dayOptLabel      = ds => { const dt = new Date(ds+"T00:00:00"); return `${dt.toLocaleDateString("it-IT",{weekday:"short"})} ${fmtDate(ds)}`; };
export const buildMultiDayOptions = (start, end) => [...dateRange(start, end).map(dayOptLabel), WHOLE_PERIOD];
export const fmtDateRange     = e => isMultiDay(e) ? `${fmtDate(e.date)} → ${fmtDate(e.end_date)}` : fmtDate(e.date);

export const daysUntil = deadline => {
  if (!deadline) return null;
  const t = new Date(); t.setHours(0,0,0,0);
  const d = new Date(deadline); d.setHours(0,0,0,0);
  return Math.round((d - t) / 86400000);
};

export const addDaysStr = (ds, n) => { const d = new Date(ds+"T00:00:00"); d.setDate(d.getDate()+n); return toDateStr(d.getFullYear(), d.getMonth(), d.getDate()); };

export const calendarDates = e => {
  if (e.time && !isMultiDay(e)) {
    const [h, mn] = e.time.split(":").map(Number);
    const stamp = (hh, mm) => `${e.date.replace(/-/g,"")}T${String(hh).padStart(2,"0")}${String(mm).padStart(2,"0")}00`;
    return { start: stamp(h, mn), end: stamp(Math.min(h+2, 23), mn), allDay: false };
  }
  return { start: e.date.replace(/-/g,""), end: addDaysStr(e.end_date || e.date, 1).replace(/-/g,""), allDay: true };
};

export const googleCalUrl = e => {
  const { start, end } = calendarDates(e);
  const p = new URLSearchParams({ action:"TEMPLATE", text:e.title||"Evento", dates:`${start}/${end}`, details:e.notes||"", location:e.address||"" });
  return "https://calendar.google.com/calendar/render?" + p.toString();
};

export const outlookCalUrl = e => {
  const pad = n => String(n).padStart(2,"0");
  let startdt, enddt, allday;
  if (e.time && !isMultiDay(e)) {
    const [h, mn] = e.time.split(":").map(Number);
    startdt = `${e.date}T${pad(h)}:${pad(mn)}:00`;
    enddt   = `${e.date}T${pad(Math.min(h+2,23))}:${pad(mn)}:00`;
    allday  = false;
  } else {
    startdt = e.date;
    enddt   = addDaysStr(e.end_date || e.date, 1);
    allday  = true;
  }
  const p = new URLSearchParams({ path:"/calendar/action/compose", rru:"addevent", subject:e.title||"Evento", startdt, enddt, body:e.notes||"", location:e.address||"" });
  if (allday) p.set("allday", "true");
  return "https://outlook.live.com/calendar/0/deeplink/compose?" + p.toString();
};

export const validatePassword = p => {
  if (p.length < 8)             return "Min. 8 caratteri.";
  if (!/[A-Z]/.test(p))         return "Serve almeno una maiuscola.";
  if (!/[a-z]/.test(p))         return "Serve almeno una minuscola.";
  if (!/[0-9]/.test(p))         return "Serve almeno un numero.";
  if (!/[^a-zA-Z0-9]/.test(p)) return "Serve almeno un carattere speciale.";
  return null;
};

export const canSeeEvent = (e, user, profile) => {
  if (profile?.role === "admin") return true;
  if (e.created_by && e.created_by === user?.id) return true;
  const vt = e.visible_to;
  if (!vt || (Array.isArray(vt) && vt.length === 0)) return true;
  return Array.isArray(vt) && vt.includes(user?.id);
};
