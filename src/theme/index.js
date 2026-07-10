export const LIGHT = {
  bg:"#FDF4ED", card:"rgba(255,255,255,.60)", border:"rgba(255,255,255,.85)", text:"#2C2320", sub:"#9A7E6F",
  input:"rgba(255,255,255,.85)", inputBorder:"rgba(0,0,0,.05)", accent:"#3AA5E0", ok:"#2FBF8F", warn:"#F5A94B", danger:"#E9603F",
  grad:"linear-gradient(135deg,#4FB3E8,#45CF9B)",
  gradShadow:"0 6px 16px rgba(79,179,232,.35)",
  cardShadow:"0 8px 24px rgba(120,90,70,.10)",
  aurora:"radial-gradient(600px 400px at 85% -10%,#BFE3F8 0%,transparent 60%),radial-gradient(500px 380px at -15% 25%,#FFD9C7 0%,transparent 60%),radial-gradient(520px 420px at 70% 105%,#C9F1DC 0%,transparent 55%),#FDF4ED",
};

export const DARK = {
  bg:"#101B2B", card:"rgba(255,255,255,.06)", border:"rgba(255,255,255,.12)", text:"#EDF4FA", sub:"#93AEC4",
  input:"rgba(255,255,255,.08)", inputBorder:"rgba(255,255,255,.12)", accent:"#63C7FF", ok:"#3FD9A0", warn:"#FFB35C", danger:"#FF8E6B",
  grad:"linear-gradient(135deg,#4FB3E8,#45CF9B)",
  gradShadow:"0 6px 18px rgba(79,179,232,.40)",
  cardShadow:"0 8px 24px rgba(0,0,0,.25)",
  aurora:"radial-gradient(600px 400px at 85% -10%,rgba(79,179,232,.28) 0%,transparent 60%),radial-gradient(500px 380px at -15% 25%,rgba(242,131,107,.20) 0%,transparent 60%),radial-gradient(520px 420px at 70% 105%,rgba(69,207,155,.18) 0%,transparent 55%),#101B2B",
};

export const STATUS_CONFIG = {
  open:    { label: "Prenotabile",    colorKey: "ok"     },
  pending: { label: "In valutazione", colorKey: "warn"   },
  full:    { label: "Al completo",    colorKey: "danger" },
};

export const scColor = (sc, th) => th[sc.colorKey] || th.accent;

export const UNITS  = ["pz","kg","g","L","cl","ml"];
export const MONTHS = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
export const DAYS   = ["Lun","Mar","Mer","Gio","Ven","Sab","Dom"];
export const AVATAR_COLORS = ["#7EB8D4","#85C9A8","#F6C97A","#E8907A","#A8C4D4","#F4A97A"];

export const cardSt    = th => ({ background: th.card, borderRadius: 20, padding: 16, border: `1px solid ${th.border}`, backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", boxShadow: th.cardShadow });
export const inputSt   = th => ({ width: "100%", background: th.input, border: `1px solid ${th.inputBorder}`, borderRadius: 14, padding: "11px 14px", fontSize: 16, color: th.text, marginBottom: 12, outline: "none" });
export const labelSt   = th => ({ display: "block", fontSize: 11, color: th.sub, marginBottom: 5, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" });
export const btnSt     = th => ({ background: th.input, border: `1px solid ${th.inputBorder}`, borderRadius: 14, padding: "8px 14px", cursor: "pointer", fontSize: 13, color: th.text });
export const primBtn   = th => ({ background: th.grad, border: "none", borderRadius: 999, padding: "11px 18px", cursor: "pointer", fontSize: 13, color: "#fff", fontWeight: 800, boxShadow: th.gradShadow });
export const backBtn   = th => ({ background: th.card, border: `1px solid ${th.border}`, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderRadius: 999, padding: "10px 20px", cursor: "pointer", fontSize: 14, color: th.text, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 18, boxShadow: th.cardShadow });
export const dangerBtn = th => ({ width: "100%", padding: "11px 16px", borderRadius: 999, cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#fff", border: "none", background: th.danger });
export const sectTitle = th => ({ fontSize:12, color:th.sub, marginBottom:10, fontWeight:700, textTransform:"uppercase", letterSpacing:1 });

export const eventBadge = (date, th) => {
  if (!date) return null;
  const t = new Date(); t.setHours(0,0,0,0);
  const d = new Date(date + "T00:00:00"); d.setHours(0,0,0,0);
  const diff = Math.round((d - t) / 86400000);
  if (diff === 0) return { label: "🔔 Oggi",   bg: th.danger, color: "#fff" };
  if (diff === 1) return { label: "📅 Domani", bg: th.ok,     color: "#fff" };
  return null;
};

