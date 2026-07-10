import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DeadlineBadge, Avatar, Toggle, ItemRow, EventCard, CalGrid } from './components/SharedUI.jsx';
import { PasswordRecoveryView, LoginView, RegisterView } from './views/AuthViews.jsx';
import { ShoppingListView, QuoteView, CommentsSection, EventDetail, VoteView, EventForm, ImportFromPostCard } from './views/EventViews.jsx';
import { ApprovalQueue, AdminView, ProfileView, SearchView, FerieView } from './views/AdminViews.jsx';
import { sb, SUPABASE_URL } from './config/supabase.js';
import { LIGHT, DARK, STATUS_CONFIG, scColor, UNITS, MONTHS, DAYS, AVATAR_COLORS, cardSt, inputSt, labelSt, btnSt, primBtn, backBtn, dangerBtn, sectTitle, eventBadge } from './theme/index.js';
import { orNull, fmtEur, fmtDateTime, enablePush, disablePush, pushSupported, getDaysInMonth, getFirstDay, toDateStr, openMaps, ferieOnDay, fmtDate, fmtFerie, WHOLE_PERIOD, isMultiDay, eventCoversDay, dateRange, dayOptLabel, buildMultiDayOptions, fmtDateRange, daysUntil, addDaysStr, calendarDates, googleCalUrl, outlookCalUrl, validatePassword, canSeeEvent } from './utils/helpers.js';

export function App() {
  const [dark,    setDark]    = useState(() => localStorage.getItem("bacheca_dark") === "1");
  const [auth,    setAuth]    = useState("loading");
  const [user,    setUser]    = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileLoaded, setPL]= useState(false);
  const [view,    setView]    = useState("calendar");
  const [tab,     setTab]     = useState("cal");
  const [events,  setEvents]  = useState([]);
  const [allUsers,setAllUsers]= useState([]);
  const [favorites, setFavorites] = useState(() => new Set());
  const [ferie,   setFerie]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [selEvent,setSelEvent]= useState(null);
  const [adminSection, setAdminSection] = useState("users"); // sezione admin da ripristinare al ritorno
  const [editFrom, setEditFrom] = useState("event");          // da dove si è aperta la modifica evento
  const [calDate, setCalDate] = useState({ y: new Date().getFullYear(), m: new Date().getMonth() });
  const [filtDay, setFiltDay] = useState(null);
  const [toast,   setToast]   = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [trashRefresh, setTrashRefresh] = useState(0);
  const [showPast,setShowPast]= useState(false);
  const [ptrY,    setPtrY]    = useState(0);
  const [ptrLoading, setPtrLoading] = useState(false);
  const ptrStartY = React.useRef(0);
  const ptrActive = React.useRef(false);
  const PTR_THRESHOLD = 70;

  const th = useMemo(() => dark ? DARK : LIGHT, [dark]);

  const toggleDark = () => setDark(d => { localStorage.setItem("bacheca_dark", d?"0":"1"); return !d; });
  const showToast  = msg => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  useEffect(() => {
    sb.auth.getSession().then(({ data: { session } }) => {
      if (session) { setUser(session.user); setAuth("app"); }
      else setAuth("login");
    });
    const { data: { subscription } } = sb.auth.onAuthStateChange((_, session) => {
      if (session) { setUser(session.user); setAuth("app"); }
      else { setUser(null); setProfile(null); setAuth("login"); }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    sb.from("profiles").select("*").eq("id", user.id).single()
      .then(({ data }) => {
        if (data?.blocked) { sb.auth.signOut(); showToast("🚫 Account bloccato. Contatta l'amministratore."); return; }
        if (data) setProfile(data);
        setPL(true);
      });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    sb.from("profiles").select("id,full_name,email,role").order("full_name")
      .then(({ data }) => setAllUsers(data || []));
  }, [user]);

  // Eventi preferiti dell'utente (in cima alla lista)
  useEffect(() => {
    if (!user) return;
    sb.from("event_favorites").select("event_id")
      .then(({ data }) => setFavorites(new Set((data || []).map(r => r.event_id))));
  }, [user]);

  const toggleFav = async (eventId) => {
    const isFav = favorites.has(eventId);
    setFavorites(prev => { const n = new Set(prev); isFav ? n.delete(eventId) : n.add(eventId); return n; });
    const { error } = isFav
      ? await sb.from("event_favorites").delete().eq("user_id", user.id).eq("event_id", eventId)
      : await sb.from("event_favorites").insert({ user_id: user.id, event_id: eventId });
    if (error) { // ripristina in caso di errore
      setFavorites(prev => { const n = new Set(prev); isFav ? n.add(eventId) : n.delete(eventId); return n; });
      showToast("❌ Errore preferiti");
    }
  };

  // Deep-link: notifica push cliccata → apri la scheda dell'evento.
  // ?event=<id> all'avvio (finestra nuova) o messaggio dal service worker (app già aperta).
  const [pendingEventId, setPendingEventId] = useState(() => {
    try { return new URLSearchParams(location.search).get("event") || null; } catch { return null; }
  });
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMsg = ev => { if (ev.data?.type === "open-event" && ev.data.eventId) setPendingEventId(ev.data.eventId); };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, []);
  useEffect(() => {
    if (!pendingEventId || !events.length) return;
    const ev = events.find(x => x.id === pendingEventId);
    if (ev) {
      setSelEvent(ev); setView("event"); setPendingEventId(null);
      try { history.replaceState(null, "", location.pathname); } catch {}
    }
  }, [pendingEventId, events]);

  const loadEvents = useCallback(async () => {
    if (!user || !profileLoaded) return;
    const { data, error } = await sb.from("events").select("*").is("deleted_at", null).order("date", { ascending: true, nullsFirst: false });
    if (error) { showToast("❌ Errore caricamento"); return; }
    setEvents(data.map(e => ({
      ...e,
      options: e.options||[], participants: e.participants||[], votes: e.votes||{},
      shopping_list: e.shopping_list||[], multiSelect: e.multi_select,
      gestione_quote: !!e.gestione_quote, quote: e.quote||[], quote_delegato: e.quote_delegato||null,
      quota_num: e.quota_num!=null ? Number(e.quota_num) : 0,
      quota_tot: e.quota_tot!=null ? Number(e.quota_tot) : 0,
      pending_approval: !!e.pending_approval,
      visible_to: Array.isArray(e.visible_to) ? e.visible_to : [],
      flyer_url: e.flyer_url || null,
      images: Array.isArray(e.images) && e.images.length ? e.images : (e.flyer_url ? [e.flyer_url] : []),
    })));
    setLoading(false);
  }, [user, profileLoaded]);

  useEffect(() => { if (auth==="app" && profileLoaded) loadEvents(); }, [auth, loadEvents, profileLoaded]);

  // Pulizia automatica: gli eventi passati da più di 1 settimana finiscono nel
  // cestino (soft-delete, recuperabili 30gg dall'admin). Gira solo sul client di
  // un admin (le RLS impediscono agli altri di toccare eventi non propri) ed è
  // idempotente: dopo lo spostamento il reload non trova più nulla e si ferma.
  useEffect(() => {
    if (profile?.role !== "admin" || !events.length) return;
    const cutoff = new Date(Date.now() - 7*24*60*60*1000).toISOString().slice(0,10);
    const staleIds = events.filter(e => { const d = e.end_date || e.date; return d && d < cutoff; }).map(e => e.id);
    if (!staleIds.length) return;
    (async () => {
      const { error } = await sb.from("events").update({ deleted_at: new Date().toISOString() }).in("id", staleIds);
      if (!error) { setTrashRefresh(n => n+1); await loadEvents(); }
    })();
  }, [events, profile, loadEvents]);

  const loadFerie = useCallback(async () => {
    if (!user) return;
    const { data } = await sb.from("ferie").select("*").order("start_date");
    setFerie(data || []);
  }, [user]);

  useEffect(() => { if (auth==="app") loadFerie(); }, [auth, loadFerie]);

  const handleAddFerie = async (start, end, note) => {
    const { error } = await sb.from("ferie").insert({ user_id: user.id, start_date: start, end_date: end, note: note || null });
    if (error) { showToast("❌ " + error.message); return; }
    showToast("🌴 Ferie aggiunte!"); await loadFerie();
  };

  const handleDeleteFerie = async (id) => {
    const { error } = await sb.from("ferie").delete().eq("id", id);
    if (error) { showToast("❌ " + error.message); return; }
    showToast("🗑️ Periodo rimosso"); await loadFerie();
  };

  // Eventi visibili: pubblici visibili all'utente + le proprie bozze (pre-approvazione)
  const visibleEvents = useMemo(
    () => events.filter(e => canSeeEvent(e, user, profile) && (!e.pending_approval || e.created_by === user?.id)),
    [events, user, profile]
  );
  // Eventi in pre-approvazione (gestiti dall'admin nella coda)
  const pendingEvents = useMemo(
    () => events.filter(e => e.pending_approval),
    [events]
  );

  const logActivity = async (action, event, details = "") => {
    await sb.from("activity_log").insert({ user_id:user.id, user_email:user.email, action, entity_type:"event", entity_id:event?.id, entity_title:event?.title, details });
  };

  const buildEditLog = (old, form) => {
    const changes = [];
    const cmp = (a, b) => (a||"").trim() === (b||"").trim();
    if (!cmp(old.title,    form.title))    changes.push("titolo");
    if (!cmp(old.date,     form.date))     changes.push("data");
    if ((old.end_date||"") !== (form.multiDay ? form.endDate : "")) changes.push("durata");
    if (!cmp(old.time,     form.time))     changes.push("orario");
    if (!cmp(old.address,  form.address))  changes.push("luogo");
    if (!cmp(old.deadline, form.deadline)) changes.push("scadenza");
    if (!cmp(old.notes,    form.notes))    changes.push("note");
    if (!cmp(old.social,   form.social))   changes.push("link social");
    if (JSON.stringify(Array.isArray(old.images)&&old.images.length?old.images:(old.flyer_url?[old.flyer_url]:[])) !== JSON.stringify(form.images||[])) changes.push("immagini");
    if (!cmp(old.status,   form.status))   changes.push("stato");
    if (!!(old.multiSelect||old.multi_select) !== !!form.multiSelect) changes.push("tipo selezione");
    if (!!old.lista_spesa !== !!form.listaSpesa) changes.push("lista spesa");
    if (!!old.gestione_quote !== !!form.gestioneQuote) changes.push("gestione quote");
    if ((old.quote_delegato||"") !== (form.quoteDelegato||"")) changes.push("delegato quote");
    const oldVis = (old.visible_to||[]).slice().sort();
    const newVis = (form.visMode==="some" ? form.visibleTo : []).slice().sort();
    if (JSON.stringify(oldVis) !== JSON.stringify(newVis)) changes.push("visibilità");
    if (JSON.stringify((old.options||[]).map(o=>(o||"").trim()).filter(Boolean)) !== JSON.stringify(form.options.map(o=>(o||"").trim()).filter(Boolean))) changes.push("opzioni");
    if (!changes.length) return null;
    const _n = new Date();
    const now = `${fmtDate(_n)} ${String(_n.getHours()).padStart(2,"0")}:${String(_n.getMinutes()).padStart(2,"0")}`;
    return `${now} — Modificato: ${changes.join(", ")}`;
  };

  const handleCreate = async form => {
    if (!form.title.trim()) return showToast("Inserisci un titolo!");
    if (!form.date)         return showToast("Inserisci la data dell'evento!");
    const multiDay = form.multiDay && form.endDate && form.endDate > form.date;
    if (form.multiDay && !multiDay) return showToast("La data di fine deve essere successiva alla data di inizio!");
    let opts, multiSel;
    if (multiDay) { opts = buildMultiDayOptions(form.date, form.endDate); multiSel = true; }
    else {
      opts = form.options.map(o => o.trim()).filter(Boolean); multiSel = form.multiSelect;
      if (opts.length < 1)    return showToast("Aggiungi almeno un'opzione!");
      if (multiSel && opts.length < 2) return showToast("Con selezione multipla servono almeno 2 opzioni!");
    }
    setSaving(true);
    const votes = {}; opts.forEach(o => { votes[o] = []; });
    const images = Array.isArray(form.images) ? form.images : [];
    // In visibilità ristretta il creatore è sempre incluso (non rimovibile lato UI).
    const visibleTo = form.visMode==="some" ? Array.from(new Set([...(form.visibleTo||[]), user.id])) : [];
    const { data, error } = await sb.from("events").insert({
      title:form.title.trim(), organizer:orNull(form.organizer)||profile?.full_name, address:orNull(form.address),
      date:orNull(form.date), end_date: multiDay ? form.endDate : null, time:orNull(form.time), deadline:orNull(form.deadline), notes:orNull(form.notes), social:orNull(form.social),
      flyer_url: images[0] || null, images,
      status:form.status, multi_select:multiSel, lista_spesa:form.listaSpesa,
      gestione_quote:form.gestioneQuote, quote:[], quote_delegato:orNull(form.quoteDelegato),
      options:opts, participants:[], votes, shopping_list:[], created_by:user.id,
      visible_to: visibleTo, pending_approval: form.publishNow === false,
    }).select().single();
    setSaving(false);
    if (error) return showToast("❌ Errore salvataggio: " + error.message);
    await logActivity(form.publishNow === false ? "Bozza creata" : "Evento creato", data);
    showToast(form.publishNow === false ? "🔍 Bozza salvata!" : "🎉 Sondaggio creato!"); await loadEvents(); setTab("cal"); setView("calendar");
  };

  const handleEdit = async (form, old) => {
    if (!form.title.trim()) return showToast("Inserisci un titolo!");
    if (!form.date)         return showToast("Inserisci la data dell'evento!");
    const multiDay = form.multiDay && form.endDate && form.endDate > form.date;
    if (form.multiDay && !multiDay) return showToast("La data di fine deve essere successiva alla data di inizio!");
    let opts, multiSel;
    if (multiDay) { opts = buildMultiDayOptions(form.date, form.endDate); multiSel = true; }
    else {
      opts = form.options.map(o => o.trim()).filter(Boolean); multiSel = form.multiSelect;
      if (opts.length < 1)    return showToast("Aggiungi almeno un'opzione!");
      if (multiSel && opts.length < 2) return showToast("Con selezione multipla servono almeno 2 opzioni!");
    }
    const log = buildEditLog(old, {...form, options:opts, multiSelect:multiSel});
    if (!log) { showToast("Nessuna modifica rilevata."); return; }
    const votes = {...old.votes}; opts.forEach(o => { if (!votes[o]) votes[o] = []; });
    setSaving(true);
    const images = Array.isArray(form.images) ? form.images : [];
    // In visibilità ristretta il creatore originale resta sempre incluso.
    const creatorId = old.created_by || user.id;
    const visibleTo = form.visMode==="some" ? Array.from(new Set([...(form.visibleTo||[]), creatorId])) : [];
    const { error } = await sb.from("events").update({
      title:form.title.trim(), organizer:orNull(form.organizer), address:orNull(form.address), date:orNull(form.date), end_date: multiDay ? form.endDate : null, time:orNull(form.time),
      deadline:orNull(form.deadline), notes:orNull(form.notes), social:orNull(form.social),
      flyer_url: images[0] || null, images, status:form.status,
      multi_select:multiSel, lista_spesa:form.listaSpesa, options:opts, votes, last_edit:log,
      gestione_quote:form.gestioneQuote, quote_delegato:orNull(form.quoteDelegato),
      visible_to: visibleTo,
    }).eq("id", old.id);
    setSaving(false);
    if (error) return showToast("❌ Errore salvataggio: " + error.message);
    await logActivity("Evento modificato", {...old, ...form}, log);
    showToast("✏️ Modifiche salvate!"); await loadEvents(); setView(editFrom==="admin" ? "admin" : "event");
  };

  const handleVote = async (voters, sel) => {
    const e = events.find(x => x.id===selEvent.id);
    const voterList = Array.isArray(voters) ? voters : [voters];
    setSaving(true);
    for (const voter of voterList) {
      const { error } = await sb.rpc("cast_vote", { p_event_id:e.id, p_voter:voter, p_options:sel });
      if (error) { setSaving(false); return showToast("❌ " + error.message); }
    }
    setSaving(false);
    const logNote = voterList.length > 1
      ? `${voterList[0]} + ${voterList.slice(1).join(", ")} → ${sel.join(", ")}`
      : sel.join(", ");
    await logActivity("Voto registrato", e, logNote);
    showToast(voterList.length > 1 ? `✅ ${voterList.length} voti registrati!` : "✅ Voto registrato!");
    await loadEvents(); setView("event");
  };

  const handleCancelVote = async (id, voterName) => {
    const e = events.find(x => x.id===id);
    const { error } = await sb.rpc("cancel_vote", { p_event_id:id, p_voter:voterName });
    if (error) return showToast("❌ " + error.message);
    await logActivity("Voto ritirato", e, `Voto di ${voterName} rimosso`);
    showToast("↩️ Voto ritirato!"); await loadEvents();
  };

  const handleStatusChange = async (id, status) => {
    const { error } = await sb.from("events").update({ status }).eq("id", id);
    if (error) return showToast("❌ Errore");
    showToast("✅ Stato aggiornato!"); await loadEvents();
  };

  const handleDelete = async id => {
    const e = events.find(x => x.id===id);
    const { error } = await sb.from("events").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) return showToast("❌ Errore");
    await logActivity("Evento eliminato", e, "Spostato nel cestino");
    setTrashRefresh(n => n+1);
    showToast("🗑️ Evento spostato nel cestino"); await loadEvents();
    setView(view==="event" ? "calendar" : view);
  };

  // Pubblica / nascondi (pre-approvazione / bozza)
  const handlePublish = async (id, publish) => {
    const e = events.find(x => x.id===id);
    const { error } = await sb.from("events").update({ pending_approval: !publish }).eq("id", id);
    if (error) return showToast("❌ Errore");
    await logActivity(publish ? "Evento pubblicato" : "Evento nascosto", e);
    showToast(publish ? "✅ Pubblicato!" : "🙈 Rimesso in bozza");
    await loadEvents();
  };

  const handleShopSave = async (id, shopping_list) => {
    const { error } = await sb.from("events").update({ shopping_list }).eq("id", id);
    if (error) { showToast("❌ Errore salvataggio"); return; }
    setEvents(p => p.map(e => e.id===id ? {...e, shopping_list} : e));
  };

  const handleQuoteSave = async (id, patch) => {
    const { error } = await sb.from("events").update(patch).eq("id", id);
    if (error) { showToast("❌ Errore salvataggio"); return false; }
    setEvents(p => p.map(e => e.id===id ? {...e, ...patch} : e));
    showToast("💾 Salvato!");
    return true;
  };

  const handleLogout = async () => { await sb.auth.signOut(); setView("calendar"); setTab("cal"); };
  const openEvent    = e => { setSelEvent(e); setView("event"); };

  if (auth === "loading") return (
    <div style={{minHeight:"100vh",background:th.aurora,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{fontSize:40}}>📅</div>
    </div>
  );
  if (auth === "recovery") return <PasswordRecoveryView th={th} onDone={() => setAuth("login")}/>;
  if (auth === "login")    return <LoginView th={th} onGoRegister={() => setAuth("register")} onRecovery={u => { setUser(u); setAuth("recovery"); }}/>;
  if (auth === "register") return <RegisterView th={th} onGoLogin={() => setAuth("login")}/>;

  const mainContent = () => {
    if (view==="event")    return <EventDetail event={selEvent} events={events} th={th} user={user} profile={profile} users={allUsers} onBack={() => setView("calendar")} onVote={() => setView("vote")} onToast={showToast} onStatusChange={handleStatusChange} onCancelVote={handleCancelVote} onDelete={handleDelete} onEdit={e => { setEditFrom("event"); setSelEvent(e); setView("edit"); }} onShopping={e => { setSelEvent(e); setView("shopping"); }} onQuote={e => { setSelEvent(e); setView("quote"); }} onPublish={handlePublish}/>;
    if (view==="vote")     return <VoteView event={selEvent} events={events} th={th} profile={profile} user={user} onBack={() => setView("event")} onSubmit={handleVote} saving={saving}/>;
    if (view==="edit")     return <EventForm event={selEvent} th={th} onBack={() => setView(editFrom==="admin" ? "admin" : "event")} onSubmit={form => handleEdit(form, selEvent)} saving={saving} isEdit={true} profile={profile} users={allUsers} userId={user?.id}/>;
    if (view==="shopping") return <ShoppingListView event={selEvent} events={events} th={th} user={user} profile={profile} onBack={() => setView("event")} onSave={handleShopSave} onGoQuote={async (id, patch) => { if (await handleQuoteSave(id, patch)) setView("quote"); }}/>;
    if (view==="quote")    return <QuoteView event={selEvent} events={events} th={th} users={allUsers} onBack={() => setView("event")} onSave={handleQuoteSave}/>;
    if (view==="profile")  return <ProfileView th={th} user={user} profile={profile} onBack={() => setView("calendar")} onLogout={handleLogout}/>;
    if (view==="admin")    return <AdminView th={th} user={user} onBack={() => setView("calendar")} showToast={showToast} pendingEvents={pendingEvents} onPublish={handlePublish} onEditEvent={e => { setEditFrom("admin"); setSelEvent(e); setView("edit"); }} onDeleteEvent={handleDelete} trashRefresh={trashRefresh} initialSection={adminSection} onSection={setAdminSection}/>;
    if (tab==="new")       return <EventForm th={th} profile={profile} users={allUsers} onBack={() => { setTab("cal"); setView("calendar"); }} onSubmit={handleCreate} saving={saving} isEdit={false} userId={user?.id}/>;
    if (tab==="search")    return <SearchView events={visibleEvents} th={th} onOpen={openEvent} onBack={() => setTab("cal")}/>;
    if (tab==="ferie")     return <FerieView th={th} user={user} ferie={ferie} users={allUsers} onAdd={handleAddFerie} onDelete={handleDeleteFerie} onBack={() => setTab("cal")}/>;

    const now = new Date();
    const future = visibleEvents.filter(e => {
      if (!e.date) return true;
      const timeStr = e.time || "23:59";
      const eventEnd = new Date(e.date + "T" + timeStr);
      eventEnd.setMinutes(eventEnd.getMinutes() + 1);
      return now < eventEnd;
    });
    const past = visibleEvents.filter(e => !future.includes(e));

    const exportDay = () => {
      if (!filtDay || !filtDay.events.length) return showToast("Nessun evento in questa giornata da esportare.");
      const win = window.open("", "_blank");
      let html = `<html><head><title>Eventi del ${fmtDate(filtDay.date)}</title><meta charset="utf-8"/><style>body{font-family:sans-serif;padding:20px;max-width:800px;margin:0 auto} .ev{border:1px solid #ccc;padding:15px;margin-bottom:20px;border-radius:8px;page-break-after:always;break-after:page;} .ev:last-child{page-break-after:auto;break-after:auto;} img{max-width:100%;height:auto;margin-top:10px;border-radius:8px;}</style></head><body>`;
      html += `<h1>📅 Eventi del ${fmtDate(filtDay.date)}</h1>`;
      for (const e of filtDay.events) {
        const sc = STATUS_CONFIG[e.status] || STATUS_CONFIG.open;
        const images = Array.isArray(e.images) && e.images.length ? e.images : (e.flyer_url ? [e.flyer_url] : []);
        html += `<div class="ev">`;
        html += `<h2 style="margin-top:0">${e.title}</h2>`;
        html += `<p><b>Stato:</b> ${sc.label} | <b>Partecipanti:</b> ${(e.participants||[]).length}</p>`;
        if (e.organizer) html += `<p><b>Organizzatore:</b> ${e.organizer}</p>`;
        if (e.date || e.time) html += `<p><b>Quando:</b> ${e.date ? fmtDateRange(e) : ""} ${e.time ? "ore " + e.time : ""}</p>`;
        if (e.address) html += `<p><b>Luogo:</b> ${e.address}</p>`;
        if (e.notes) html += `<p><b>Note:</b><br>${e.notes.replace(/\n/g, '<br>')}</p>`;
        if (e.options && e.options.length) {
          html += `<h3>Opzioni votate:</h3><ul>`;
          for (const o of e.options) {
            const v = e.votes[o]||[];
            html += `<li>${o}: ${v.length} voti ${v.length>0 ? `(${v.join(", ")})` : ""}</li>`;
          }
          html += `</ul>`;
        }
        for (const url of images) {
          html += `<img src="${url}" />`;
        }
        html += `</div>`;
      }
      html += `<script>window.onload = function() { window.print(); }</script></body></html>`;
      win.document.write(html);
      win.document.close();
    };

    return (
      <div>
        <CalGrid calDate={calDate} setCalDate={setCalDate} events={visibleEvents} ferie={ferie} th={th} onDayClick={(ds, evs) => setFiltDay({ date:ds, events:evs })} selDate={filtDay?.date}/>
        <div style={{marginTop:20}}>
          {filtDay ? (
            <>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                <div style={{fontSize:13,fontWeight:600,color:th.sub,letterSpacing:1,textTransform:"uppercase"}}>
                  📅 {new Date(filtDay.date+"T00:00:00").toLocaleDateString("it-IT",{weekday:"long"})} {fmtDate(filtDay.date)}
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={exportDay} style={{...btnSt(th),fontSize:12,padding:"4px 10px"}}>📤 Esporta</button>
                  <button onClick={() => setFiltDay(null)} style={{...btnSt(th),fontSize:12,padding:"4px 10px"}}>✕ Tutti</button>
                </div>
              </div>
              {filtDay.events.map(e => <EventCard key={e.id} e={e} th={th} onOpen={openEvent} fav={favorites.has(e.id)} onToggleFav={toggleFav}/>)}
              {(() => {
                const df = ferieOnDay(ferie, filtDay.date);
                if (!df.length) return null;
                const nameOf = uid => { const u = allUsers.find(x => x.id === uid); return u?.full_name || u?.email || "Utente"; };
                return (
                  <div style={{...cardSt(th),marginTop:8}}>
                    <div style={{fontSize:13,fontWeight:700,color:th.text,marginBottom:8}}>🌴 In ferie questo giorno</div>
                    {df.map(f => (
                      <div key={f.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:"4px 0"}}>
                        <span style={{fontSize:14,color:th.text,fontWeight:600}}>👤 {nameOf(f.user_id)}</span>
                        <span style={{fontSize:12,color:th.sub}}>{fmtFerie(f.start_date)}{f.end_date!==f.start_date ? ` → ${fmtFerie(f.end_date)}` : ""}{f.note ? ` · ${f.note}` : ""}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </>
          ) : (
            <>
              <div style={{fontSize:13,fontWeight:600,color:th.sub,marginBottom:8,letterSpacing:1,textTransform:"uppercase"}}>Prossimi eventi</div>
              {loading && <div style={{color:th.sub,fontSize:13,textAlign:"center",padding:20}}>Caricamento...</div>}
              {!loading && future.length===0 && past.length===0 && (
                <div style={{color:th.sub,fontSize:14,textAlign:"center",padding:20}}>Nessun evento ancora.<br/>Creane uno! 🎉</div>
              )}
              {!loading && future.length===0 && past.length>0 && (
                <div style={{color:th.sub,fontSize:13,textAlign:"center",padding:"12px 0"}}>Nessun evento futuro.</div>
              )}
              {[...future].sort((a,b) => (favorites.has(b.id)?1:0)-(favorites.has(a.id)?1:0))
                .map(e => <EventCard key={e.id} e={e} th={th} onOpen={openEvent} fav={favorites.has(e.id)} onToggleFav={toggleFav}/>)}

              {!loading && past.length>0 && (
                <div style={{marginTop:12}}>
                  <button
                    onClick={() => setShowPast(p => !p)}
                    style={{...btnSt(th),width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:showPast?8:0}}>
                    <span style={{fontSize:12,fontWeight:600,color:th.sub,letterSpacing:1,textTransform:"uppercase"}}>
                      📁 Eventi passati ({past.length})
                    </span>
                    <span style={{fontSize:14,color:th.sub}}>{showPast?"▲":"▼"}</span>
                  </button>
                  {showPast && past.slice().reverse().map(e => (
                    <div key={e.id} style={{opacity:0.55}}>
                      <EventCard e={e} th={th} onOpen={openEvent} fav={favorites.has(e.id)} onToggleFav={toggleFav}/>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  const showNav = !["event","vote","edit","shopping","quote","profile","admin"].includes(view);

  const onPtrStart = e => {
    if (window.scrollY === 0 && !ptrLoading) {
      ptrStartY.current = e.touches[0].clientY;
      ptrActive.current = true;
    }
  };
  const onPtrMove = e => {
    if (!ptrActive.current) return;
    const dy = e.touches[0].clientY - ptrStartY.current;
    if (dy > 0) setPtrY(Math.min(dy * 0.5, PTR_THRESHOLD * 1.2));
    else { ptrActive.current = false; setPtrY(0); }
  };
  const onPtrEnd = async () => {
    if (!ptrActive.current) return;
    ptrActive.current = false;
    if (ptrY >= PTR_THRESHOLD) {
      setPtrLoading(true);
      setPtrY(PTR_THRESHOLD);
      await loadEvents();
      showToast("✅ Aggiornato!");
      setPtrLoading(false);
    }
    setPtrY(0);
  };

  return (
    <div onTouchStart={onPtrStart} onTouchMove={onPtrMove} onTouchEnd={onPtrEnd}
      style={{background:th.aurora,minHeight:"100vh",maxWidth:430,margin:"0 auto",position:"relative"}}>
      <div style={{background:th.card,backdropFilter:"blur(18px)",WebkitBackdropFilter:"blur(18px)",borderBottom:`1px solid ${th.border}`,padding:"14px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,zIndex:10}}>
        <div onClick={() => { setView("calendar"); setTab("cal"); }} style={{cursor:"pointer"}}>
          <div style={{fontFamily:"'Baloo 2','Outfit',sans-serif",fontWeight:700,fontSize:19,color:th.text}}>📅 Bacheca</div>
          <div style={{fontSize:11,color:th.sub}}>{MONTHS[calDate.m]} {calDate.y}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {profile?.role==="admin" && (
            <button onClick={() => { setView("admin"); setTab("cal"); }} style={{...btnSt(th),fontSize:12,padding:"6px 10px",position:"relative"}}>
              👑{pendingEvents.length>0 && <span style={{position:"absolute",top:-4,right:-4,background:th.danger,color:"#fff",fontSize:10,fontWeight:700,borderRadius:10,minWidth:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 4px"}}>{pendingEvents.length}</span>}
            </button>
          )}
          <button onClick={toggleDark} style={{background:th.input,border:`1px solid ${th.border}`,borderRadius:20,padding:"6px 12px",cursor:"pointer",fontSize:13,color:th.text}}>{dark?"☀️":"🌙"}</button>
          <div onClick={() => setView("profile")} style={{cursor:"pointer"}}>
            <Avatar name={profile?.full_name || user?.email} size={32}/>
          </div>
        </div>
      </div>

      {(ptrY > 0 || ptrLoading) && (
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:Math.max(ptrY,ptrLoading?PTR_THRESHOLD:0),overflow:"hidden",color:th.sub,fontSize:13,gap:6,transition:ptrLoading?"none":"height 0.1s"}}>
          {ptrLoading
            ? <span style={{animation:"spin 0.8s linear infinite",display:"inline-block"}}>🔄</span>
            : <span>{ptrY >= PTR_THRESHOLD ? "↑ Rilascia per aggiornare" : "↓ Aggiorna"}</span>}
        </div>
      )}
      <div style={{padding:16,paddingBottom:90}}>{mainContent()}</div>

      {toast && (
        <div style={{position:"fixed",bottom:80,left:"50%",transform:"translateX(-50%)",background:th.text,color:th.bg,padding:"10px 20px",borderRadius:20,fontSize:13,zIndex:100,whiteSpace:"nowrap",boxShadow:`0 4px 16px ${th.border}`}}>
          {toast}
        </div>
      )}

      {showNav && (
        <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:th.card,backdropFilter:"blur(18px)",WebkitBackdropFilter:"blur(18px)",borderTop:`1px solid ${th.border}`,display:"flex",padding:"10px 0 14px",zIndex:10}}>
          {[["cal","🗓️","Calendario"],["new","➕","Crea"],["ferie","🌴","Ferie"],["search","🔍","Cerca"]].map(([t, ic, lb]) => (
            <button key={t} onClick={() => { setTab(t); setView("calendar"); }}
              style={{flex:1,border:"none",background:"transparent",cursor:"pointer",color:tab===t&&view==="calendar"?th.accent:th.sub,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
              <span style={{fontSize:22}}>{ic}</span>
              <span style={{fontSize:10,fontWeight:tab===t&&view==="calendar"?700:400}}>{lb}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}