import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DeadlineBadge, Avatar, Toggle, ItemRow, EventCard, CalGrid } from '../components/SharedUI.jsx';
import { sb, SUPABASE_URL } from '../config/supabase.js';
import { LIGHT, DARK, STATUS_CONFIG, scColor, UNITS, MONTHS, DAYS, AVATAR_COLORS, cardSt, inputSt, labelSt, btnSt, primBtn, backBtn, dangerBtn, sectTitle, eventBadge } from '../theme/index.js';
import { orNull, fmtEur, fmtDateTime, enablePush, disablePush, pushSupported, getDaysInMonth, getFirstDay, toDateStr, openMaps, ferieOnDay, fmtDate, fmtFerie, WHOLE_PERIOD, isMultiDay, eventCoversDay, dateRange, dayOptLabel, buildMultiDayOptions, fmtDateRange, daysUntil, addDaysStr, calendarDates, googleCalUrl, outlookCalUrl, validatePassword, canSeeEvent } from '../utils/helpers.js';

export function ProfileView({ th, user, profile, onBack, onLogout }) {
  const [name,  setName]  = useState(profile?.full_name || "");
  const [saved, setSaved] = useState(false);
  const [pass,  setPass]  = useState({ new1:"", new2:"", err:"", ok:false });
  const [tg,    setTg]    = useState({ chatId:"", exists:false, saved:false, loading:true, err:"", prefs:{ eventi:true, voti:true, commenti:true } });
  const [push,  setPush]  = useState({ supported:true, enabled:false, busy:false, err:"" });
  const [pushPrefs, setPushPrefs] = useState({ eventi:true, voti:true, commenti:true });

  useEffect(() => {
    sb.from("notification_prefs").select("push").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => { if (data?.push) setPushPrefs(p => ({ ...p, ...data.push })); });
  }, [user.id]);

  const togglePushPref = async k => {
    const next = { ...pushPrefs, [k]: pushPrefs[k] === false };
    setPushPrefs(next);
    const { error } = await sb.from("notification_prefs")
      .upsert({ user_id: user.id, push: next, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) { setPushPrefs(pushPrefs); setPush(p => ({...p, err:"Errore preferenze push"})); }
  };

  useEffect(() => {
    if (!pushSupported()) { setPush(p => ({...p, supported:false})); return; }
    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => setPush(p => ({...p, enabled: !!sub})))
      .catch(() => {});
  }, []);

  const togglePush = async () => {
    setPush(p => ({...p, busy:true, err:""}));
    try {
      if (push.enabled) { await disablePush(); setPush(p => ({...p, enabled:false, busy:false})); }
      else { await enablePush(user.id); setPush(p => ({...p, enabled:true, busy:false})); }
    } catch (e) {
      setPush(p => ({...p, busy:false, err: e?.message || "Errore"}));
    }
  };

  useEffect(() => {
    sb.from("telegram_subscriptions").select("chat_id,prefs").eq("user_id", user.id).maybeSingle()
      .then(({ data, error }) => {
        if (!error && data) setTg(p => ({...p, chatId: data.chat_id, exists: true, prefs: { eventi:true, voti:true, ...(data.prefs||{}) }}));
        setTg(p => ({...p, loading: false}));
      });
  }, [user.id]);

  const saveProfile = async () => {
    await sb.from("profiles").update({ full_name: name }).eq("id", user.id);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const changePass = async () => {
    setPass(p => ({...p, err:"", ok:false}));
    const err = validatePassword(pass.new1);
    if (err) return setPass(p => ({...p, err}));
    if (pass.new1 !== pass.new2) return setPass(p => ({...p, err:"Le password non coincidono."}));
    const { error } = await sb.auth.updateUser({ password: pass.new1 });
    if (error) return setPass(p => ({...p, err:error.message}));
    setPass({ new1:"", new2:"", err:"", ok:true });
  };

  const saveTg = async () => {
    if (!tg.chatId.trim()) return;
    setTg(p => ({...p, err:""}));
    const op = tg.exists
      ? sb.from("telegram_subscriptions").update({ chat_id: tg.chatId, prefs: tg.prefs }).eq("user_id", user.id)
      : sb.from("telegram_subscriptions").insert({ user_id: user.id, chat_id: tg.chatId, prefs: tg.prefs });
    const { error } = await op;
    if (error) { setTg(p => ({...p, err:"Errore: " + error.message})); return; }
    setTg(p => ({...p, exists:true, saved:true}));
    setTimeout(() => setTg(p => ({...p, saved:false})), 2000);
  };

  // Preferenze per macro-funzionalità: salvataggio immediato se l'iscrizione esiste già
  const togglePref = async k => {
    const prefs = {...tg.prefs, [k]: tg.prefs[k] === false};
    setTg(p => ({...p, prefs}));
    if (tg.exists) {
      const { error } = await sb.from("telegram_subscriptions").update({ prefs }).eq("user_id", user.id);
      if (error) setTg(p => ({...p, err:"Errore: " + error.message}));
    }
  };

  const removeTg = async () => {
    await sb.from("telegram_subscriptions").delete().eq("user_id", user.id);
    setTg(p => ({...p, chatId:"", exists:false}));
  };

  return (
    <div>
      <button onClick={onBack} style={backBtn(th)}>← Indietro</button>
      <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:24}}>
        <Avatar name={profile?.full_name || user.email} size={52}/>
        <div>
          <div style={{fontWeight:700,fontSize:18,color:th.text}}>{profile?.full_name || "Utente"}</div>
          <div style={{fontSize:13,color:th.sub}}>{user.email}</div>
          <div style={{fontSize:11,marginTop:2,padding:"2px 8px",borderRadius:8,display:"inline-block",
            background:profile?.role==="admin"?th.accent+"33":th.ok+"33",
            color:profile?.role==="admin"?th.accent:th.ok,fontWeight:600}}>
            {profile?.role === "admin" ? "👑 Admin" : "👤 Utente"}
          </div>
        </div>
      </div>

      <div style={{...cardSt(th),marginBottom:16}}>
        <div style={sectTitle(th)}>Modifica profilo</div>
        <label style={labelSt(th)}>Nome</label>
        <input value={name} onChange={e => setName(e.target.value)} style={inputSt(th)}/>
        <button onClick={saveProfile} style={{...primBtn(th),width:"100%"}}>{saved ? "✅ Salvato!" : "Salva"}</button>
      </div>

      <div style={{...cardSt(th),marginBottom:16}}>
        <div style={sectTitle(th)}>🔔 Notifiche</div>
        <div style={{fontSize:12,color:th.sub,marginBottom:14,lineHeight:1.6}}>
          Scegli per ogni tipo di avviso su quale canale riceverlo.
        </div>

        {/* Canale Telegram: collegamento */}
        <div style={{marginBottom:12}}>
          <div style={{...labelSt(th),marginBottom:6}}>✈️ Telegram</div>
          {tg.loading ? <div style={{fontSize:13,color:th.sub}}>Caricamento…</div> : tg.exists ? (
            <div style={{fontSize:12,color:th.sub,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
              <span>✅ Collegato (Chat ID {tg.chatId})</span>
              <button onClick={removeTg} style={{...btnSt(th),fontSize:12,padding:"4px 10px",color:th.danger,border:`1px solid ${th.danger}`,background:"transparent"}}>Scollega</button>
            </div>
          ) : (
            <>
              <div style={{fontSize:12,color:th.sub,marginBottom:8,lineHeight:1.6}}>
                Apri <b>@bacheca_notifiche_bot</b> su Telegram, premi <b>START</b>, copia il <b>Chat ID</b> e incollalo qui.
              </div>
              <input value={tg.chatId} onChange={e => setTg(p => ({...p, chatId:e.target.value}))} placeholder="Es. 123456789" style={inputSt(th)}/>
              <button onClick={saveTg} style={{...primBtn(th),width:"100%"}}>{tg.saved ? "✅ Collegato!" : "Collega Telegram"}</button>
            </>
          )}
        </div>

        {/* Canale Push: attivazione sul dispositivo */}
        <div style={{marginBottom:14}}>
          <div style={{...labelSt(th),marginBottom:6}}>📲 Push (questo dispositivo)</div>
          {!push.supported ? (
            <div style={{fontSize:12,color:th.sub}}>Non supportate da questo browser/dispositivo.</div>
          ) : (
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
              <span style={{fontSize:12,color:th.sub}}>{push.enabled ? "✅ Attive su questo dispositivo" : "Disattivate · su iPhone installa prima l'app sulla Home (iOS 16.4+)"}</span>
              <button onClick={togglePush} disabled={push.busy}
                style={{...(push.enabled ? {...btnSt(th),fontSize:12,padding:"4px 10px",color:th.danger,border:`1px solid ${th.danger}`,background:"transparent"} : {...primBtn(th),fontSize:12,padding:"6px 12px"}),opacity:push.busy?0.6:1}}>
                {push.busy ? "…" : push.enabled ? "Disattiva" : "Attiva"}
              </button>
            </div>
          )}
        </div>

        {/* Matrice tipo × canale */}
        <div style={{borderTop:`1px solid ${th.border}`,paddingTop:12,display:"grid",gridTemplateColumns:"1fr auto auto",gap:"10px 16px",alignItems:"center"}}>
          <div/>
          <div style={{fontSize:11,color:th.sub,fontWeight:700,textAlign:"center"}}>✈️ TG</div>
          <div style={{fontSize:11,color:th.sub,fontWeight:700,textAlign:"center"}}>📲 Push</div>
          {[["eventi","📅 Eventi",true],["voti","🗳️ Voti",true],["commenti","💬 Commenti",true]].map(([k,l,pushOk]) => (
            <React.Fragment key={k}>
              <span style={{fontSize:13,color:th.text}}>{l}</span>
              <div style={{display:"flex",justifyContent:"center",opacity:tg.exists?1:0.35,pointerEvents:tg.exists?"auto":"none"}}>
                <Toggle value={tg.exists && tg.prefs[k] !== false} onChange={() => togglePref(k)} th={th}/>
              </div>
              <div style={{display:"flex",justifyContent:"center"}}>
                {pushOk ? (
                  <div style={{opacity:push.enabled?1:0.35,pointerEvents:push.enabled?"auto":"none"}}>
                    <Toggle value={push.enabled && pushPrefs[k] !== false} onChange={() => togglePushPref(k)} th={th}/>
                  </div>
                ) : <span style={{fontSize:13,color:th.sub}}>—</span>}
              </div>
            </React.Fragment>
          ))}
        </div>
        <div style={{fontSize:11,color:th.sub,marginTop:12,lineHeight:1.5}}>
          I toggle ✈️ TG si attivano dopo aver collegato Telegram; i toggle 📲 Push dopo averle attivate su questo dispositivo. Le push per eventi e voti escludono chi ha generato l'azione.
        </div>
        {tg.err && <div style={{color:th.danger,fontSize:13,marginTop:8}}>{tg.err}</div>}
        {push.err && <div style={{color:th.danger,fontSize:13,marginTop:8}}>{push.err}</div>}
      </div>

      <div style={{...cardSt(th),marginBottom:16}}>
        <div style={sectTitle(th)}>Cambia password</div>
        <label style={labelSt(th)}>Nuova password</label>
        <input type="password" value={pass.new1} onChange={e => setPass(p => ({...p, new1:e.target.value}))} placeholder="Min. 8 caratteri" style={inputSt(th)}/>
        <label style={labelSt(th)}>Conferma nuova password</label>
        <input type="password" value={pass.new2} onChange={e => setPass(p => ({...p, new2:e.target.value}))} placeholder="Ripeti" style={inputSt(th)}/>
        {pass.err && <div style={{color:th.danger,fontSize:13,marginBottom:12}}>{pass.err}</div>}
        {pass.ok  && <div style={{color:th.ok,fontSize:13,marginBottom:12}}>✅ Password aggiornata!</div>}
        <button onClick={changePass} style={{...primBtn(th),width:"100%"}}>Aggiorna password</button>
      </div>

      <button onClick={onLogout} style={{width:"100%",padding:12,borderRadius:10,border:`1.5px solid ${th.danger}`,background:"transparent",color:th.danger,fontWeight:600,cursor:"pointer",fontSize:14}}>
        🚪 Esci dall'account
      </button>
    </div>
  );
}
export function ApprovalQueue({ th, pendingEvents, onPublish, onEdit, onDelete }) {
  if (!pendingEvents.length)
    return <div style={{color:th.sub,fontSize:14,textAlign:"center",padding:20}}>Nessun evento in attesa di approvazione.</div>;
  return (
    <div>
      {pendingEvents.map(e => (
        <div key={e.id} style={{...cardSt(th),marginBottom:10,border:`1px solid ${th.warn}66`}}>
          <div style={{fontWeight:600,fontSize:14,color:th.text,marginBottom:6}}>{e.title}</div>
          <div style={{fontSize:12,color:th.sub,marginBottom:8,display:"flex",flexWrap:"wrap",gap:8}}>
            {e.date && <span>📅 {fmtDate(e.date)}{e.time?` 🕐 ${e.time}`:""}</span>}
            {e.address && <span>📍 {e.address}</span>}
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            <button onClick={() => onPublish(e.id, true)} style={{...primBtn(th),flex:1,minWidth:120,background:th.ok,fontSize:12}}>✅ Pubblica</button>
            <button onClick={() => onEdit(e)} style={{...btnSt(th),flex:1,minWidth:100,fontSize:12,color:th.accent,border:`1px solid ${th.accent}66`}}>✏️ Modifica</button>
            <button onClick={() => onDelete(e.id)} style={{...btnSt(th),flex:1,minWidth:100,fontSize:12,color:th.danger,border:`1px solid ${th.danger}66`}}>🗑️ Cestina</button>
          </div>
        </div>
      ))}
    </div>
  );
}
export function AdminView({ th, user, onBack, showToast, pendingEvents, onPublish, onEditEvent, onDeleteEvent, trashRefresh, initialSection, onSection }) {
  const [users,   setUsers]  = useState([]);
  const [logs,    setLogs]   = useState([]);
  const [trash,   setTrash]  = useState([]);
  const [section, setSectionState]= useState(initialSection || "users");
  const setSection = s => { setSectionState(s); onSection && onSection(s); };
  const [loading, setLoading]= useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);

  useEffect(() => {
    const load = async () => {
      const cutoff = new Date(Date.now() - 30*24*60*60*1000).toISOString();
      const [u, l, t] = await Promise.all([
        sb.from("profiles").select("*").order("created_at"),
        sb.from("activity_log").select("*").gte("created_at", cutoff).order("created_at",{ascending:false}).limit(200),
        sb.from("events").select("*").not("deleted_at","is",null).order("deleted_at",{ascending:false}),
      ]);
      await sb.from("activity_log").delete().lt("created_at", cutoff);
      setUsers(u.data||[]); setLogs(l.data||[]); setTrash(t.data||[]);
      setLoading(false);
    };
    load();
  }, [trashRefresh]);

  const nameFor = (l) => {
    const u = users.find(x => x.id === l.user_id);
    return u?.full_name || l.user_email || "Utente";
  };

  const toggleRole = async (id, role) => {
    const newRole = role === "admin" ? "user" : "admin";
    await sb.from("profiles").update({ role: newRole }).eq("id", id);
    setUsers(p => p.map(u => u.id===id ? {...u, role:newRole} : u));
    showToast("✅ Ruolo aggiornato");
  };

  const toggleBlock = async (id, blocked) => {
    await sb.from("profiles").update({ blocked: !blocked }).eq("id", id);
    setUsers(p => p.map(u => u.id===id ? {...u, blocked:!blocked} : u));
    showToast(!blocked ? "🚫 Utente bloccato" : "✅ Utente sbloccato");
  };

  const deleteUser = async u => {
    const { data:{ session } } = await sb.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-user`, {
      method: "POST",
      headers: { "Content-Type":"application/json", "Authorization":`Bearer ${session.access_token}` },
      body: JSON.stringify({ userId: u.id, voterName: u.full_name || u.email }),
    });
    const result = await res.json();
    if (!res.ok || result.error) { showToast("❌ " + (result.error || "Errore")); return; }
    setUsers(p => p.filter(x => x.id !== u.id));
    setConfirmDelete(null);
    showToast("🗑️ Utente eliminato");
  };

  const restoreEvent = async id => {
    await sb.from("events").update({ deleted_at: null }).eq("id", id);
    setTrash(p => p.filter(e => e.id !== id));
    showToast("✅ Evento ripristinato!");
  };

  const permanentDelete = async id => {
    await sb.from("events").delete().eq("id", id);
    setTrash(p => p.filter(e => e.id !== id));
    showToast("🗑️ Evento eliminato definitivamente");
  };

  const emptyTrash = async () => {
    const ids = trash.map(e => e.id);
    if (ids.length === 0) return;
    await sb.from("events").delete().in("id", ids);
    setTrash([]);
    setConfirmEmptyTrash(false);
    showToast("🗑️ Cestino svuotato");
  };

  const tabs = [["users","👥 Utenti"],["approve","✅ Approva"],["logs","📋 Attività"],["trash","🗑️ Cestino"]];

  return (
    <div>
      <button onClick={onBack} style={backBtn(th)}>← Indietro</button>
      <h2 style={{margin:"0 0 16px",fontSize:18,color:th.text}}>👑 Pannello Admin</h2>
      <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
        {tabs.map(([s,l]) => (
          <button key={s} onClick={() => setSection(s)}
            style={{padding:"7px 12px",borderRadius:10,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,
              background:section===s?th.accent:th.input,color:section===s?"#fff":th.sub}}>
            {l}{s==="users" && users.length>0 && ` (${users.length})`}{s==="trash" && trash.length>0 && ` (${trash.length})`}{s==="approve" && pendingEvents.length>0 && ` (${pendingEvents.length})`}
          </button>
        ))}
      </div>


      {section==="approve" && <ApprovalQueue th={th} pendingEvents={pendingEvents} onPublish={onPublish} onEdit={onEditEvent} onDelete={onDeleteEvent}/>}

      {loading && ["users","logs","trash"].includes(section) && <div style={{color:th.sub,textAlign:"center",padding:20}}>Caricamento...</div>}

      {!loading && section==="users" && users.map(u => (
        <div key={u.id} style={{...cardSt(th),marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
            <Avatar name={u.full_name||u.email} size={36}/>
            <div style={{flex:1}}>
              <div style={{fontWeight:600,fontSize:14,color:th.text}}>{u.full_name||"—"}</div>
              <div style={{fontSize:12,color:th.sub}}>{u.email}</div>
            </div>
            {u.blocked && <span style={{fontSize:11,padding:"2px 8px",borderRadius:8,fontWeight:600,background:th.danger+"22",color:th.danger}}>🚫 Bloccato</span>}
            <span style={{fontSize:11,padding:"2px 8px",borderRadius:8,fontWeight:600,
              background:u.role==="admin"?th.accent+"33":th.ok+"33",
              color:u.role==="admin"?th.accent:th.ok}}>
              {u.role==="admin"?"👑 Admin":"👤 User"}
            </span>
          </div>
          {u.id !== user.id ? (
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              <button onClick={() => toggleRole(u.id, u.role)} style={{...btnSt(th),fontSize:12,width:"100%"}}>
                {u.role==="admin"?"→ Utente":"→ Admin"}
              </button>
              {confirmDelete === u.id ? (
                <div style={{padding:"10px 12px",background:th.danger+"11",borderRadius:10,border:`1px solid ${th.danger}44`}}>
                  <div style={{fontSize:12,color:th.text,marginBottom:8}}>Eliminare <b>{u.full_name||u.email}</b>? Saranno rimossi anche tutti i suoi voti.</div>
                  <div style={{display:"flex",gap:6}}>
                    <button onClick={() => setConfirmDelete(null)} style={{...btnSt(th),fontSize:12,flex:1}}>Annulla</button>
                    <button onClick={() => deleteUser(u)} style={{...primBtn(th),fontSize:12,flex:1,background:th.danger}}>Sì, elimina</button>
                  </div>
                </div>
              ) : (
                <React.Fragment>
                  <button onClick={() => toggleBlock(u.id, u.blocked)} style={{...btnSt(th),fontSize:12,width:"100%",color:u.blocked?th.ok:th.warn,border:`1px solid ${u.blocked?th.ok:th.warn}44`,background:"transparent"}}>
                    {u.blocked ? "✅ Sblocca utente" : "🚫 Blocca utente"}
                  </button>
                  <button onClick={() => setConfirmDelete(u.id)} style={{...btnSt(th),fontSize:12,width:"100%",color:th.danger,border:`1px solid ${th.danger}44`,background:"transparent"}}>🗑️ Elimina utente</button>
                </React.Fragment>
              )}
            </div>
          ) : (
            <div style={{fontSize:11,color:th.sub,textAlign:"center"}}>Sei tu</div>
          )}
        </div>
      ))}

      {!loading && section==="logs" && (
        logs.length===0
          ? <div style={{color:th.sub,fontSize:14,textAlign:"center",padding:20}}>Nessuna attività registrata.</div>
          : logs.map(l => (
            <div key={l.id} style={{...cardSt(th),marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:13,fontWeight:600,color:th.text}}>{l.action}</span>
                <span style={{fontSize:11,color:th.sub}}>{fmtDate(l.created_at)}</span>
              </div>
              <div style={{fontSize:12,color:th.sub}}>{nameFor(l)} · {l.entity_title}</div>
              {l.details && <div style={{fontSize:11,color:th.sub,marginTop:4,fontStyle:"italic"}}>{l.details}</div>}
            </div>
          ))
      )}

      {!loading && section==="trash" && trash.length>0 && (
        !confirmEmptyTrash
          ? <button onClick={() => setConfirmEmptyTrash(true)} style={{...btnSt(th),width:"100%",marginBottom:12,color:th.danger,border:`1.5px solid ${th.danger}`,background:"transparent",fontWeight:600}}>🗑️ Svuota cestino ({trash.length})</button>
          : <div style={{...cardSt(th),marginBottom:12,border:`1.5px solid ${th.danger}`}}>
              <div style={{fontSize:14,color:th.text,marginBottom:6,fontWeight:600}}>Svuotare tutto il cestino?</div>
              <div style={{fontSize:12,color:th.sub,marginBottom:14}}>Tutti i {trash.length} eventi nel cestino verranno eliminati definitivamente. L'operazione è irreversibile.</div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={() => setConfirmEmptyTrash(false)} style={{...btnSt(th),flex:1}}>Annulla</button>
                <button onClick={emptyTrash} style={{...primBtn(th),flex:1,background:th.danger}}>Sì, svuota</button>
              </div>
            </div>
      )}

      {!loading && section==="trash" && (
        trash.length===0
          ? <div style={{color:th.sub,fontSize:14,textAlign:"center",padding:20}}>Il cestino è vuoto.</div>
          : trash.map(e => {
            const dLeft = e.deleted_at ? 30 - Math.floor((Date.now()-new Date(e.deleted_at))/(1000*60*60*24)) : 0;
            return (
              <div key={e.id} style={{...cardSt(th),marginBottom:10}}>
                <div style={{fontWeight:600,fontSize:14,color:th.text,marginBottom:4}}>{e.title}</div>
                <div style={{fontSize:12,color:th.sub,marginBottom:8}}>
                  Eliminato il {fmtDate(e.deleted_at)} ·{" "}
                  <span style={{color:dLeft<=3?th.danger:th.warn,fontWeight:600}}>{dLeft}gg rimasti</span>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={() => restoreEvent(e.id)} style={{...primBtn(th),fontSize:12,flex:1}}>↩️ Ripristina</button>
                  <button onClick={() => permanentDelete(e.id)} style={{...btnSt(th),fontSize:12,flex:1,color:th.danger}}>🗑️ Elimina</button>
                </div>
              </div>
            );
          })
      )}
    </div>
  );
}
export function SearchView({ events, th, onOpen, onBack }) {
  const [q, setQ] = useState("");
  const ql  = q.trim().toLowerCase();
  const res = useMemo(() =>
    ql ? events.filter(e => (e.title||"").toLowerCase().includes(ql) || (e.notes||"").toLowerCase().includes(ql)) : [],
  [ql, events]);

  return (
    <div>
      <button onClick={onBack} style={backBtn(th)}>← Indietro</button>
      <h2 style={{margin:"0 0 16px",fontSize:18,color:th.text}}>Cerca</h2>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Cerca per titolo o note..." style={inputSt(th)} autoFocus/>
      <div style={{fontSize:11,color:th.sub,marginBottom:16,marginTop:-8}}>La ricerca funziona sui campi <b>titolo</b> e <b>note</b>.</div>
      {ql && res.length===0 && <div style={{color:th.sub,fontSize:14,textAlign:"center",padding:20}}>Nessun risultato per "<b>{q}</b>"</div>}
      {res.map(e => <EventCard key={e.id} e={e} th={th} onOpen={onOpen}/>)}
    </div>
  );
}
export function FerieView({ th, user, ferie, users, onAdd, onDelete, onBack }) {
  const now = new Date();
  const [pick,  setPick]  = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [start, setStart] = useState(null);
  const [end,   setEnd]   = useState(null);
  const [note,  setNote]  = useState("");
  const [busy,  setBusy]  = useState(false);

  const { y, m } = pick;
  const days  = getDaysInMonth(y, m);
  const first = getFirstDay(y, m);
  const ts    = toDateStr(now.getFullYear(), now.getMonth(), now.getDate());
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);

  const nameOf = uid => { const u = users.find(x => x.id === uid); return u?.full_name || u?.email || "Utente"; };
  const inRange = ds => start && (end ? (ds >= start && ds <= end) : ds === start);

  const tapDay = ds => {
    if (!start || (start && end)) { setStart(ds); setEnd(null); }     // nuova selezione
    else if (ds < start)         { setStart(ds); }                    // sposta l'inizio
    else                         { setEnd(ds); }                      // imposta la fine
  };

  const save = async () => {
    if (!start) return;
    setBusy(true);
    await onAdd(start, end || start, note.trim());
    setBusy(false);
    setStart(null); setEnd(null); setNote("");
  };

  const mine   = ferie.filter(f => f.user_id === user.id).sort((a,b) => a.start_date.localeCompare(b.start_date));
  const others = ferie
    .filter(f => f.user_id !== user.id && f.end_date >= ts)
    .sort((a,b) => a.start_date.localeCompare(b.start_date));

  return (
    <div>
      <button onClick={onBack} style={backBtn(th)}>← Indietro</button>
      <h2 style={{margin:"0 0 4px",fontSize:18,color:th.text}}>🌴 Ferie</h2>
      <div style={{fontSize:13,color:th.sub,marginBottom:16}}>
        Seleziona il <b>primo</b> e l'<b>ultimo</b> giorno del periodo, poi salva. I tuoi periodi sono visibili a tutti per coordinarvi.
      </div>

      <div style={{...cardSt(th),marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <button onClick={() => setPick(p => p.m===0 ? {y:p.y-1,m:11} : {y:p.y,m:p.m-1})} style={btnSt(th)}>‹</button>
          <span style={{fontWeight:700,fontSize:16,color:th.text}}>{MONTHS[m]} {y}</span>
          <button onClick={() => setPick(p => p.m===11 ? {y:p.y+1,m:0} : {y:p.y,m:p.m+1})} style={btnSt(th)}>›</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
          {DAYS.map(d => <div key={d} style={{textAlign:"center",fontSize:11,color:th.sub,paddingBottom:4}}>{d}</div>)}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
          {cells.map((d, i) => {
            if (!d) return <div key={i}/>;
            const ds  = toDateStr(y, m, d);
            const sel = inRange(ds);
            const isT = ds === ts;
            return (
              <div key={i} onClick={() => tapDay(ds)}
                style={{borderRadius:10,padding:"8px 2px",textAlign:"center",cursor:"pointer",
                  background:sel?th.accent:"transparent",border:`2px solid ${isT&&!sel?th.accent:"transparent"}`}}>
                <span style={{fontSize:13,fontWeight:sel||isT?700:400,color:sel?"#fff":th.text}}>{d}</span>
              </div>
            );
          })}
        </div>
        {start && (
          <div style={{marginTop:12,fontSize:13,color:th.text}}>
            Periodo selezionato: <b>{fmtFerie(start)}</b>{end && end!==start ? <> → <b>{fmtFerie(end)}</b></> : ""}
          </div>
        )}
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Nota opzionale (es. destinazione)…"
          style={{...inputSt(th),marginTop:12,marginBottom:8}}/>
        <button onClick={save} disabled={!start||busy} style={{...primBtn(th),width:"100%",opacity:!start||busy?0.5:1}}>
          {busy ? "Salvataggio…" : "🌴 Aggiungi periodo"}
        </button>
      </div>

      <div style={sectTitle(th)}>I miei periodi</div>
      {mine.length===0 && <div style={{color:th.sub,fontSize:13,marginBottom:16}}>Non hai ancora inserito ferie.</div>}
      {mine.map(f => (
        <div key={f.id} style={{...cardSt(th),marginBottom:8,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:14,fontWeight:600,color:th.text}}>🌴 {fmtFerie(f.start_date)}{f.end_date!==f.start_date ? ` → ${fmtFerie(f.end_date)}` : ""}</div>
            {f.note && <div style={{fontSize:12,color:th.sub,marginTop:2}}>{f.note}</div>}
          </div>
          <button onClick={() => onDelete(f.id)} style={{...btnSt(th),fontSize:12,padding:"6px 10px"}}>🗑️</button>
        </div>
      ))}

      {others.length>0 && (
        <div style={{marginTop:20}}>
          <div style={sectTitle(th)}>Ferie del gruppo (in arrivo)</div>
          {others.map(f => (
            <div key={f.id} style={{...cardSt(th),marginBottom:8}}>
              <div style={{fontSize:14,fontWeight:600,color:th.text}}>👤 {nameOf(f.user_id)}</div>
              <div style={{fontSize:13,color:th.accent,fontWeight:600,marginTop:2}}>🌴 {fmtFerie(f.start_date)}{f.end_date!==f.start_date ? ` → ${fmtFerie(f.end_date)}` : ""}</div>
              {f.note && <div style={{fontSize:12,color:th.sub,marginTop:2}}>{f.note}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}