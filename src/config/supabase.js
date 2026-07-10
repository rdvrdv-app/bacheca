import { createClient } from '@supabase/supabase-js';

// ── Config ────────────────────────────────────────────────────
const SUPABASE_ENVS = {
  prod: {
    url: "https://divxqcadlishdfhpvixd.supabase.co",
    key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpdnhxY2FkbGlzaGRmaHB2aXhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4ODM4OTQsImV4cCI6MjA5NTQ1OTg5NH0.EqTuOJBLsrSIA1vK3eNP4YZnzR6_GxqO_TsEKaEfxYg",
  },
  dev: {
    url: "https://xgzmjxththubvpfwgsnu.supabase.co",
    key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhnem1qeHRodGh1YnZwZndnc251Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NjI4ODYsImV4cCI6MjA5NTUzODg4Nn0.hEacNTOkx7ZbjV67dlDbGSq4iD2H3cXF1D2ICBpXX64",
  },
};

const PROD_HOST = "rdvrdv-app.github.io";
export const APP_ENV = (() => {
  try {
    const q = new URLSearchParams(location.search).get("env");
    if (q === "dev" || q === "prod") return q;
  } catch {}
  return window.location.hostname === PROD_HOST ? "prod" : "dev";
})();

export const SUPABASE_URL = SUPABASE_ENVS[APP_ENV].url;
export const SUPABASE_KEY = SUPABASE_ENVS[APP_ENV].key;
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

if (APP_ENV !== "prod") {
  const showEnvBadge = () => {
    if (!document.body || document.getElementById("__envBadge")) return;
    const b = document.createElement("div");
    b.id = "__envBadge";
    b.textContent = "🧪 DEV DB";
    b.style.cssText = "position:fixed;bottom:8px;right:8px;z-index:99999;background:#b45309;color:#fff;font:600 11px system-ui,sans-serif;padding:4px 9px;border-radius:8px;opacity:.9;pointer-events:none;box-shadow:0 1px 4px #0006";
    document.body.appendChild(b);
  };
  if (document.body) showEnvBadge();
  else window.addEventListener("DOMContentLoaded", showEnvBadge);
}
