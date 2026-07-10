import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { sb, SUPABASE_URL } from '../config/supabase.js';
import { LIGHT, DARK, STATUS_CONFIG, scColor, UNITS, MONTHS, DAYS, AVATAR_COLORS, cardSt, inputSt, labelSt, btnSt, primBtn, backBtn, dangerBtn, sectTitle, eventBadge } from '../theme/index.js';
import { orNull, fmtEur, fmtDateTime, enablePush, disablePush, pushSupported, getDaysInMonth, getFirstDay, toDateStr, openMaps, ferieOnDay, fmtDate, fmtFerie, WHOLE_PERIOD, isMultiDay, eventCoversDay, dateRange, dayOptLabel, buildMultiDayOptions, fmtDateRange, daysUntil, addDaysStr, calendarDates, googleCalUrl, outlookCalUrl, validatePassword, canSeeEvent } from '../utils/helpers.js';

export function DeadlineBadge({ deadline, th }) {
  const d = daysUntil(deadline);
  if (d === null) return null;
  if (d < 0)  return <span style={{background:th.border,color:th.sub,borderRadius:8,padding:"2px 8px",fontSize:11,fontWeight:600}}>⏰ Scaduto</span>;
  if (d === 0) return <span style={{background:th.danger+"33",color:th.danger,borderRadius:8,padding:"2px 8px",fontSize:11,fontWeight:600}}>🔴 Scade oggi!</span>;
  if (d <= 3)  return <span style={{background:th.warn+"33",color:th.warn,borderRadius:8,padding:"2px 8px",fontSize:11,fontWeight:600}}>⚠️ Scade tra {d}gg</span>;
  return null;
}
export function Avatar({ name, size = 32 }) {
  const initials = (name || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const color = AVATAR_COLORS[(name || "").charCodeAt(0) % AVATAR_COLORS.length];
  return (
    <div style={{width:size,height:size,borderRadius:"50%",background:color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.38,fontWeight:700,color:"#fff",flexShrink:0}}>
      {initials}
    </div>
  );
}
export function Toggle({ value, onChange, th }) {
  return (
    <div onClick={onChange} style={{width:42,height:24,borderRadius:12,background:value?th.accent:th.border,cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
      <div style={{position:"absolute",top:3,left:value?20:3,width:18,height:18,borderRadius:"50%",background:"#fff",transition:"left .2s",boxShadow:"0 1px 3px rgba(0,0,0,.15)"}}/>
    </div>
  );
}
export function ItemRow({ item, th, onToggle, onDelete, onCost }) {
  const [confirm, setConfirm]   = useState(false);
  const [editCost, setEditCost] = useState(false);
  const [costVal, setCostVal]   = useState("");

  const openCost = () => { setCostVal(item.cost != null ? String(item.cost) : ""); setEditCost(true); setConfirm(false); };
  const saveCost = () => {
    const n = Number(costVal);
    onCost(item.id, costVal.trim() === "" || isNaN(n) || n < 0 ? null : n);
    setEditCost(false);
  };
  // Appena un articolo viene segnato come acquistato si chiede il costo (facoltativo)
  const handleToggle = () => { onToggle(item.id); if (!item.done) openCost(); else setEditCost(false); };
  const metaSep = (item.qty || item.assignee) ? " · " : "";

  return (
    <div style={{...cardSt(th), marginBottom: 8}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <div onClick={handleToggle} style={{width:22,height:22,borderRadius:6,flexShrink:0,cursor:"pointer",border:`2px solid ${item.done?th.ok:th.accent}`,background:item.done?th.ok:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
          {item.done && <span style={{color:"#fff",fontSize:13,fontWeight:700}}>✓</span>}
        </div>
        <div style={{flex:1}}>
          <div style={{fontSize:14,fontWeight:600,color:item.done?th.sub:th.text,textDecoration:item.done?"line-through":"none"}}>{item.name}</div>
          <div style={{fontSize:12,color:th.sub,marginTop:2}}>
            {item.qty && `${item.qty} ${item.unit}`}{item.qty && item.assignee && " · "}{item.assignee && `👤 ${item.assignee}`}
            {item.done && (item.cost != null
              ? <span onClick={openCost} style={{cursor:"pointer",color:th.ok,fontWeight:700}}>{metaSep}💶 {fmtEur(item.cost)}</span>
              : <span onClick={openCost} style={{cursor:"pointer",color:th.accent}}>{metaSep}💶 aggiungi costo</span>)}
          </div>
        </div>
        <button onClick={() => setConfirm(true)} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:th.sub,padding:"4px"}}>✕</button>
      </div>
      {editCost && (
        <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${th.border}`}}>
          <div style={{fontSize:12,color:th.text,marginBottom:6}}>💶 Quanto è costato? <span style={{color:th.sub}}>(facoltativo)</span></div>
          <div style={{display:"flex",gap:6}}>
            <input type="number" min="0" step="any" inputMode="decimal" value={costVal} onChange={ev => setCostVal(ev.target.value)} placeholder="Es. 12.50" autoFocus style={{...inputSt(th),marginBottom:0,flex:1}}/>
            <button onClick={saveCost} style={{...primBtn(th),fontSize:12,padding:"4px 12px"}}>Salva</button>
            <button onClick={() => setEditCost(false)} style={{...btnSt(th),fontSize:12,padding:"4px 12px"}}>{item.cost != null ? "Annulla" : "Salta"}</button>
          </div>
        </div>
      )}
      {confirm && (
        <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${th.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
          <span style={{fontSize:12,color:th.text}}>Eliminare <b>{item.name}</b>?</span>
          <div style={{display:"flex",gap:6}}>
            <button onClick={() => setConfirm(false)} style={{...btnSt(th),fontSize:12,padding:"4px 10px"}}>Annulla</button>
            <button onClick={() => onDelete(item.id)} style={{...primBtn(th),fontSize:12,padding:"4px 10px",background:th.danger}}>Elimina</button>
          </div>
        </div>
      )}
    </div>
  );
}
export function EventCard({ e, th, onOpen, fav = false, onToggleFav }) {
  const sc    = STATUS_CONFIG[e.status] || STATUS_CONFIG.open;
  const col   = scColor(sc, th);
  const days  = daysUntil(e.deadline);
  const badge = eventBadge(e.date, th);
  const restricted = Array.isArray(e.visible_to) && e.visible_to.length > 0;
  return (
    <div onClick={() => onOpen(e)} style={{...cardSt(th),position:"relative",display:"flex",alignItems:"center",gap:12,cursor:"pointer",marginBottom:10}}>
      {onToggleFav && (
        <button onClick={ev => { ev.stopPropagation(); onToggleFav(e.id); }}
          title={fav ? "Togli dai preferiti" : "Aggiungi ai preferiti"}
          style={{position:"absolute",top:6,right:8,background:"none",border:"none",cursor:"pointer",fontSize:18,lineHeight:1,padding:2,color:fav?th.warn:th.sub}}>
          {fav ? "★" : "☆"}
        </button>
      )}
      <div style={{width:12,height:12,borderRadius:"50%",background:col,flexShrink:0,boxShadow:`0 0 6px ${col}88`}}/>
      <div style={{flex:1}}>
        <div style={{fontWeight:600,fontSize:14,color:th.text,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          {e.title}{restricted && <span title="Visibilità limitata" style={{fontSize:11}}>🔒</span>}{e.pending_approval && <span title="Bozza non pubblicata" style={{fontSize:10,padding:"1px 6px",borderRadius:8,background:th.warn+"33",color:th.warn,fontWeight:700}}>BOZZA</span>}
        </div>
        <div style={{fontSize:12,color:th.sub}}>{e.organizer}</div>
        {(e.date||e.time) && (
          <div style={{display:"flex",alignItems:"center",gap:6,marginTop:2,flexWrap:"wrap"}}>
            <span style={{fontSize:12,color:th.accent,fontWeight:600}}>
              {e.date&&`📅 ${fmtDateRange(e)}`}{e.date&&e.time&&"  "}{e.time&&`🕐 ${e.time}`}
            </span>
            {badge && (
              <span style={{background:badge.bg,color:badge.color,borderRadius:8,padding:"2px 8px",fontSize:11,fontWeight:600}}>
                {badge.label}
              </span>
            )}
          </div>
        )}
        <div style={{display:"flex",alignItems:"center",gap:6,marginTop:2,flexWrap:"wrap"}}>
          <span style={{fontSize:12,color:th.sub}}>👥 {(e.participants||[]).length} partecipanti</span>
          {days!==null && days<=3 && <DeadlineBadge deadline={e.deadline} th={th}/>}
        </div>
        {e.last_edit && <div style={{fontSize:11,color:th.sub,marginTop:2,fontStyle:"italic"}}>✏️ {e.last_edit}</div>}
      </div>
      <div style={{fontSize:11,fontWeight:600,color:col,flexShrink:0,marginTop:8}}>{sc.label}</div>
    </div>
  );
}
export function CalGrid({ calDate, setCalDate, events, ferie, th, onDayClick, selDate }) {
  const { y, m } = calDate;
  const days  = getDaysInMonth(y, m);
  const first = getFirstDay(y, m);
  const today = new Date();
  const ts    = toDateStr(today.getFullYear(), today.getMonth(), today.getDate());

  const cells = useMemo(() => {
    const arr = [];
    for (let i = 0; i < first; i++) arr.push(null);
    for (let d = 1; d <= days; d++) arr.push(d);
    return arr;
  }, [y, m, first, days]);

  // Mappa giorno → eventi del mese (un evento multi-giorno copre tutto l'intervallo)
  const eventsByDay = useMemo(() => {
    const map = new Map();
    for (let d = 1; d <= days; d++) {
      const ds = toDateStr(y, m, d);
      const evs = events.filter(e => eventCoversDay(e, ds));
      if (evs.length) map.set(ds, evs);
    }
    return map;
  }, [events, y, m, days]);

  // Giorni del mese in cui almeno una persona è in ferie (per la palma 🌴)
  const ferieDays = useMemo(() => {
    const s = new Set();
    for (let d = 1; d <= days; d++) {
      const ds = toDateStr(y, m, d);
      if ((ferie||[]).some(f => f.start_date <= ds && ds <= f.end_date)) s.add(ds);
    }
    return s;
  }, [ferie, y, m, days]);

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <button onClick={() => setCalDate(p => p.m===0 ? {y:p.y-1,m:11} : {y:p.y,m:p.m-1})} style={btnSt(th)}>‹</button>
        <span style={{fontWeight:700,fontSize:16,color:th.text}}>{MONTHS[m]} {y}</span>
        <button onClick={() => setCalDate(p => p.m===11 ? {y:p.y+1,m:0} : {y:p.y,m:p.m+1})} style={btnSt(th)}>›</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
        {DAYS.map(d => <div key={d} style={{textAlign:"center",fontSize:11,color:th.sub,paddingBottom:4}}>{d}</div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
        {cells.map((d, i) => {
          if (!d) return <div key={i}/>;
          const ds  = toDateStr(y, m, d);
          const isT = ds === ts;
          const isSel = ds === selDate;
          const evs    = eventsByDay.get(ds) || [];
          const spans  = evs.filter(isMultiDay);
          const single = evs.filter(e => !isMultiDay(e));
          const hasF = ferieDays.has(ds);
          const clickable = evs.length || hasF;
          return (
            <div key={i} onClick={() => clickable && onDayClick(ds, evs)}
              style={{borderRadius:10,padding:"6px 2px",textAlign:"center",cursor:clickable?"pointer":"default",
                background:isT?th.accent:isSel?th.accent+"22":"transparent",
                border:`2px solid ${isT?th.accent:isSel?th.accent:"transparent"}`}}>
              <span style={{fontSize:13,fontWeight:isT||isSel?700:400,color:isT?"#fff":isSel?th.accent:th.text}}>{d}</span>
              {spans.slice(0,3).map(e => {
                const c = scColor(STATUS_CONFIG[e.status]||STATUS_CONFIG.open, th);
                const isStart = ds === e.date, isEnd = ds === (e.end_date || e.date);
                return <div key={e.id} title={e.title} style={{height:4,background:c,marginTop:2,
                  marginLeft:isStart?2:-3, marginRight:isEnd?2:-3,
                  borderTopLeftRadius:isStart?3:0, borderBottomLeftRadius:isStart?3:0,
                  borderTopRightRadius:isEnd?3:0, borderBottomRightRadius:isEnd?3:0}}/>;
              })}
              {(single.length>0 || hasF) && (
                <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:2,marginTop:3,flexWrap:"wrap"}}>
                  {single.slice(0,4).map(e => <div key={e.id} style={{width:6,height:6,borderRadius:"50%",background:scColor(STATUS_CONFIG[e.status]||STATUS_CONFIG.open,th)}}/>)}
                  {hasF && <span style={{fontSize:9,lineHeight:1}}>🌴</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}