import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DeadlineBadge, Avatar, Toggle, ItemRow, EventCard, CalGrid } from '../components/SharedUI.jsx';
import { sb, SUPABASE_URL } from '../config/supabase.js';
import { LIGHT, DARK, STATUS_CONFIG, scColor, UNITS, MONTHS, DAYS, AVATAR_COLORS, cardSt, inputSt, labelSt, btnSt, primBtn, backBtn, dangerBtn, sectTitle, eventBadge } from '../theme/index.js';
import { orNull, fmtEur, fmtDateTime, enablePush, disablePush, pushSupported, getDaysInMonth, getFirstDay, toDateStr, openMaps, ferieOnDay, fmtDate, fmtFerie, WHOLE_PERIOD, isMultiDay, eventCoversDay, dateRange, dayOptLabel, buildMultiDayOptions, fmtDateRange, daysUntil, addDaysStr, calendarDates, googleCalUrl, outlookCalUrl, validatePassword, canSeeEvent } from '../utils/helpers.js';

export function ShoppingListView({ event, events, th, user, profile, onBack, onSave, onGoQuote }) {
  const e = events.find(x => x.id===event.id) || event;
  // Il travaso verso la gestione quote è riservato a owner, delegato o admin
  const canQuote = !!onGoQuote && e.gestione_quote && (e.created_by===user?.id || profile?.role==="admin" || e.quote_delegato===user?.id);
  const [items, setItems] = useState(e.shopping_list || []);
  const [ni,    setNi]    = useState({ name:"", qty:"", unit:"pz", assignee:"" });

  const addItem = () => {
    if (!ni.name.trim()) return;
    if (!ni.qty || isNaN(Number(ni.qty)) || Number(ni.qty) <= 0) return;
    const updated = [...items, { id: Date.now(), name: ni.name.trim(), qty: ni.qty, unit: ni.unit, assignee: ni.assignee.trim(), done: false }];
    setItems(updated); onSave(e.id, updated);
    setNi({ name:"", qty:"", unit:"pz", assignee:"" });
  };

  const toggleDone = id => { const u = items.map(i => i.id===id ? {...i, done:!i.done} : i); setItems(u); onSave(e.id, u); };
  const deleteItem = id => { const u = items.filter(i => i.id!==id); setItems(u); onSave(e.id, u); };
  const setCost    = (id, cost) => { const u = items.map(i => i.id===id ? {...i, cost} : i); setItems(u); onSave(e.id, u); };
  const pending = items.filter(i => !i.done);
  const done    = items.filter(i =>  i.done);
  // Il totale conta solo gli articoli acquistati con un costo inserito
  const withCost = done.filter(i => i.cost != null);
  const totSpeso = withCost.reduce((s, i) => s + (Number(i.cost)||0), 0);
  const participants = [...new Set(e.participants||[])].filter(Boolean);

  // Travaso verso la gestione quote: porta dentro i partecipanti all'evento e
  // tratta come anticipo ciò che ciascun assegnatario ha pagato per la spesa.
  const goQuote = () => {
    const speso = {};
    done.forEach(i => {
      const nm = (i.assignee||"").trim();
      if (!nm || i.cost == null) return;
      const k = nm.toLowerCase();
      speso[k] = { name: speso[k]?.name || nm, tot: (speso[k]?.tot||0) + (Number(i.cost)||0) };
    });
    const quote = (e.quote||[]).map(p => ({...p}));
    const have  = new Set(quote.map(p => (p.name||"").toLowerCase()));
    const addNew = nm => { const k = nm.toLowerCase(); if (!have.has(k)) { quote.push({ id: Date.now()+Math.random(), name:nm, paid:false }); have.add(k); } };
    participants.forEach(addNew);
    Object.values(speso).forEach(v => addNew(v.name));
    // Sovrascrive l'anticipo di chi ha pagato la spesa: il travaso è ripetibile senza doppi conteggi
    quote.forEach(p => { const v = speso[(p.name||"").toLowerCase()]; if (v) p.anticipo = v.tot; });
    // Il numero di partecipanti parte dalle persone in lista quote: si ritocca lì se serve
    onGoQuote(e.id, { quote, quota_tot: totSpeso, quota_num: quote.length });
  };

  return (
    <div>
      <button onClick={onBack} style={backBtn(th)}>← Indietro</button>
      <h2 style={{margin:"0 0 4px",fontSize:18,color:th.text}}>🛒 Lista Spesa</h2>
      <div style={{fontSize:13,color:th.sub,marginBottom:16}}>{e.title}</div>
      <div style={{...cardSt(th),marginBottom:16}}>
        <div style={sectTitle(th)}>Aggiungi articolo</div>
        <label style={labelSt(th)}>Prodotto *</label>
        <input value={ni.name} onChange={ev => setNi(p => ({...p, name:ev.target.value}))} placeholder="Es. Vino rosso..." style={inputSt(th)}/>
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          <div style={{flex:1}}>
            <label style={labelSt(th)}>Quantità *</label>
            <input type="number" min="0" step="any" value={ni.qty} onChange={ev => setNi(p => ({...p, qty:ev.target.value}))} placeholder="Es. 2" style={{...inputSt(th),marginBottom:0}}/>
          </div>
          <div style={{flex:1}}>
            <label style={labelSt(th)}>Unità</label>
            <select value={ni.unit} onChange={ev => setNi(p => ({...p, unit:ev.target.value}))} style={{...inputSt(th),marginBottom:0}}>
              {UNITS.map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <label style={labelSt(th)}>Assegnato a</label>
        <input value={ni.assignee} onChange={ev => setNi(p => ({...p, assignee:ev.target.value}))} placeholder="Nome persona..." style={inputSt(th)}/>
        {participants.length>0 && (
          <div style={{marginTop:-6,marginBottom:12}}>
            <div style={{fontSize:11,color:th.sub,marginBottom:6}}>Aggiunta rapida (partecipanti all'evento):</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {participants.map(n => (
                <button key={n} onClick={() => setNi(p => ({...p, assignee: p.assignee===n ? "" : n}))}
                  style={{padding:"5px 11px",borderRadius:20,fontSize:12,cursor:"pointer",border:`1px solid ${ni.assignee===n?th.accent:th.border}`,background:ni.assignee===n?th.accent+"22":th.input,color:ni.assignee===n?th.accent:th.text,fontWeight:ni.assignee===n?700:400}}>
                  {ni.assignee===n ? "✓" : "+"} {n}
                </button>
              ))}
            </div>
          </div>
        )}
        <button onClick={addItem} style={{...primBtn(th),width:"100%"}}>+ Aggiungi</button>
      </div>
      {pending.length>0 && (
        <div style={{marginBottom:16}}>
          <div style={{...sectTitle(th),marginBottom:8}}>Da acquistare ({pending.length})</div>
          {pending.map(item => <ItemRow key={item.id} item={item} th={th} onToggle={toggleDone} onDelete={deleteItem} onCost={setCost}/>)}
        </div>
      )}
      {done.length>0 && (
        <div>
          <div style={{...sectTitle(th),marginBottom:8}}>Acquistati ({done.length})</div>
          {done.map(item => <ItemRow key={item.id} item={item} th={th} onToggle={toggleDone} onDelete={deleteItem} onCost={setCost}/>)}
          {withCost.length>0 && (
            <div style={{...cardSt(th),marginTop:4,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:th.text}}>💶 Totale speso</div>
                {withCost.length<done.length && <div style={{fontSize:11,color:th.sub,marginTop:2}}>{withCost.length} su {done.length} articoli acquistati hanno un costo</div>}
              </div>
              <div style={{fontSize:18,fontWeight:800,color:th.ok}}>{fmtEur(totSpeso)}</div>
            </div>
          )}
          {canQuote && pending.length===0 && (
            <button onClick={goQuote} style={{...primBtn(th),width:"100%",marginTop:10}}>
              💶 Vai a gestione quote →
            </button>
          )}
        </div>
      )}
      {items.length===0 && <div style={{textAlign:"center",padding:30,color:th.sub,fontSize:14}}>Nessun articolo ancora.<br/>Aggiungi il primo! 🛒</div>}
    </div>
  );
}
export function QuoteView({ event, events, th, users = [], onBack, onSave }) {
  const e = events.find(x => x.id===event.id) || event;
  const [list, setList] = useState(e.quote || []);
  const [num,  setNum]  = useState(e.quota_num || "");
  const [tot,  setTot]  = useState(e.quota_tot || "");
  const [name, setName] = useState("");
  const [anticipiOpen, setAnticipiOpen] = useState(false);

  // Il numero di partecipanti segue le persone in lista, ma resta modificabile
  // a mano (l'avviso segnala le incongruenze). A lista vuota non si azzera:
  // può arrivare precompilato dalla lista della spesa.
  useEffect(() => {
    if (list.length) setNum(String(list.length));
  }, [list.length]);

  const quota = (Number(num) > 0 && Number(tot) > 0) ? Number(tot) / Number(num) : 0;
  const fmt = v => "€ " + (Number(v)||0).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const persist = arr => { setList(arr); onSave(e.id, { quote: arr }); };
  const saveCfg = () => onSave(e.id, { quota_num: Number(num)||0, quota_tot: Number(tot)||0 });

  const addPerson = n => {
    const nm = (n||"").trim();
    if (!nm) return;
    if (list.some(p => (p.name||"").toLowerCase() === nm.toLowerCase())) return; // niente doppioni
    persist([...list, { id: Date.now() + Math.random(), name: nm, paid: false }]); setName("");
  };
  const togglePaid   = id => persist(list.map(p => p.id===id ? {...p, paid:!p.paid} : p));
  const removePerson = id => persist(list.filter(p => p.id!==id));
  // Anticipi: aggiornamento locale durante la digitazione, salvataggio al blur
  const setAnticipo  = (id, v) => setList(l => l.map(p => p.id===id ? {...p, anticipo: v} : p));

  // Regola anticipi: l'anticipo copre la quota. Se la supera, la quota risulta pagata
  // e l'eccedenza è un credito da incassare (da chi è irrilevante).
  // Il toggle 💰 indica che la persona ha saldato a mano il dovuto residuo.
  const anticipoOf = p => Number(p.anticipo)||0;
  const isPagata   = p => !!p.paid || (quota>0 && anticipoOf(p) >= quota);
  const contributo = p => isPagata(p) ? Math.max(quota, anticipoOf(p)) : anticipoOf(p);
  const creditoOf  = p => Math.max(0, anticipoOf(p) - quota);
  const totAnticipi = list.reduce((s, p) => s + anticipoOf(p), 0);

  const already = new Set(list.map(p => (p.name||"").toLowerCase()));
  // Aggiunta rapida: solo chi ha partecipato al sondaggio (inclusi gli accompagnatori)
  const candidates = useMemo(() => {
    return [...new Set(e.participants || [])].filter(n => n && !already.has(n.toLowerCase()));
  }, [e.participants, list]);

  const paidList     = list.filter(isPagata);
  const unpaidList   = list.filter(p => !isPagata(p));
  const incassato    = quota>0 ? list.reduce((s, p) => s + contributo(p), 0) : 0;
  const daIncassare  = quota>0 ? unpaidList.reduce((s, p) => s + Math.max(0, quota - anticipoOf(p)), 0) : 0;
  const daRestituire = quota>0 ? list.reduce((s, p) => s + creditoOf(p), 0) : 0;

  return (
    <div>
      <button onClick={onBack} style={backBtn(th)}>← Indietro</button>
      <h2 style={{margin:"0 0 4px",fontSize:18,color:th.text}}>💶 Gestione quote</h2>
      <div style={{fontSize:13,color:th.sub,marginBottom:16}}>{e.title}</div>

      <div style={{...cardSt(th),marginBottom:16}}>
        <div style={sectTitle(th)}>Calcolo quota</div>
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          <div style={{flex:1}}>
            <label style={labelSt(th)}>Partecipanti</label>
            <input type="number" min="0" value={num} onChange={ev => setNum(ev.target.value)} placeholder="Es. 8" style={{...inputSt(th),marginBottom:0}}/>
          </div>
          <div style={{flex:1}}>
            <label style={labelSt(th)}>Totale spesa (€)</label>
            <input type="number" min="0" step="any" value={tot} onChange={ev => setTot(ev.target.value)} placeholder="Es. 200" style={{...inputSt(th),marginBottom:0}}/>
          </div>
        </div>
        <button onClick={saveCfg} style={{...primBtn(th),width:"100%",marginBottom:12}}>💾 Salva</button>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:10,background:th.accent+"18",border:`1px solid ${th.accent}44`}}>
          <span style={{fontSize:13,color:th.text,fontWeight:600}}>💰 Quota a persona</span>
          <span style={{fontSize:18,fontWeight:700,color:th.accent}}>{quota>0?fmt(quota):"—"}</span>
        </div>
        {Number(num)>0 && list.length>0 && Number(num)!==list.length && (
          <div style={{fontSize:11,color:th.warn,marginTop:8}}>⚠️ Hai indicato {num} partecipanti ma in lista ci sono {list.length} persone.</div>
        )}
      </div>

      {quota>0 && list.length>0 && (
        <div style={{...cardSt(th),marginBottom:16}}>
          <div style={sectTitle(th)}>Riepilogo</div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <span style={{fontSize:13,color:th.sub}}>Quote coperte</span>
            <span style={{fontSize:14,fontWeight:700,color:paidList.length===list.length?th.ok:th.text}}>{paidList.length}/{list.length}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <span style={{fontSize:13,color:th.sub}}>Incassato / anticipato</span>
            <span style={{fontSize:14,fontWeight:700,color:th.ok}}>{fmt(incassato)}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <span style={{fontSize:13,color:th.sub}}>Ancora da incassare</span>
            <span style={{fontSize:14,fontWeight:700,color:daIncassare>0?th.danger:th.sub}}>{fmt(daIncassare)}</span>
          </div>
          {daRestituire>0 && (
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <span style={{fontSize:13,color:th.sub}}>Da restituire (anticipi extra)</span>
              <span style={{fontSize:14,fontWeight:700,color:th.warn}}>{fmt(daRestituire)}</span>
            </div>
          )}
          {unpaidList.length>0 && (
            <div style={{paddingTop:10,borderTop:`1px solid ${th.border}`}}>
              <div style={{fontSize:11,color:th.sub,marginBottom:6}}>Mancano da:</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {unpaidList.map(p => (
                  <span key={p.id} style={{padding:"3px 10px",borderRadius:20,fontSize:12,background:th.danger+"22",color:th.danger,fontWeight:600}}>{p.name}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {quota>0 && list.length>0 && (
        <div style={{...cardSt(th),marginBottom:16}}>
          <div onClick={() => setAnticipiOpen(o => !o)} style={{...sectTitle(th),display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",userSelect:"none",marginBottom:0}}>
            <span>💸 Anticipi e saldi</span>
            <span style={{fontSize:12,color:th.sub,fontWeight:600}}>{anticipiOpen ? "Comprimi ▲" : (totAnticipi>0 ? fmt(totAnticipi)+" ▼" : "Espandi ▼")}</span>
          </div>
          {anticipiOpen && (<>
          <div style={{fontSize:11,color:th.sub,margin:"10px 0",lineHeight:1.5}}>
            Indica quanto ha <b>anticipato</b> ciascuno (es. chi ha pagato il ristorante). Se l'anticipo copre la quota, questa risulta pagata; l'eccedenza è da incassare.
          </div>
          {list.map(p => (
            <div key={p.id} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
              <span style={{flex:1,fontSize:13,color:th.text,fontWeight:600}}>{p.name}</span>
              <input type="number" min="0" step="any" value={p.anticipo ?? ""} placeholder="0"
                onChange={ev => setAnticipo(p.id, ev.target.value)} onBlur={() => persist(list)}
                style={{...inputSt(th),marginBottom:0,width:110,textAlign:"right"}}/>
              <span style={{fontSize:13,color:th.sub}}>€</span>
            </div>
          ))}
          {totAnticipi>0 && (
            <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${th.border}`}}>
              {list.filter(p => anticipoOf(p)>0).map(p => {
                const cr = creditoOf(p);
                return (
                  <div key={p.id} style={{fontSize:12,color:th.text,marginBottom:4}}>
                    <b>{p.name}</b>:{" "}
                    {cr>0
                      ? <>quota coperta ✓ · <span style={{color:th.warn,fontWeight:700}}>deve incassare ancora {fmt(cr)}</span></>
                      : anticipoOf(p)>=quota
                        ? <span style={{color:th.ok,fontWeight:600}}>quota coperta ✓</span>
                        : isPagata(p)
                          ? <span style={{color:th.ok,fontWeight:600}}>saldata (anticipo {fmt(anticipoOf(p))} + resto) ✓</span>
                          : <>restano <span style={{color:th.danger,fontWeight:700}}>{fmt(Math.max(0, quota - anticipoOf(p)))}</span> da versare</>}
                  </div>
                );
              })}
            </div>
          )}
          </>)}
        </div>
      )}

      <div style={{...cardSt(th),marginBottom:16}}>
        <div style={sectTitle(th)}>Aggiungi persona</div>
        <div style={{display:"flex",gap:8,marginBottom:candidates.length?12:0}}>
          <input value={name} onChange={ev => setName(ev.target.value)} onKeyDown={ev => ev.key==="Enter" && addPerson(name)}
            placeholder="Nome persona..." style={{...inputSt(th),marginBottom:0,flex:1}}/>
          <button onClick={() => addPerson(name)} style={{...primBtn(th),flexShrink:0}}>+ Aggiungi</button>
        </div>
        {candidates.length>0 && (
          <>
            <div style={{fontSize:11,color:th.sub,marginBottom:6}}>Aggiunta rapida (partecipanti al sondaggio):</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {candidates.map(n => (
                <button key={n} onClick={() => addPerson(n)}
                  style={{padding:"5px 11px",borderRadius:20,fontSize:12,cursor:"pointer",border:`1px solid ${th.border}`,background:th.input,color:th.text}}>
                  + {n}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {list.length===0
        ? <div style={{textAlign:"center",padding:30,color:th.sub,fontSize:14}}>Nessuna persona ancora.<br/>Aggiungi chi deve versare la quota 💶</div>
        : <div>
            <div style={{...sectTitle(th),marginBottom:8}}>Persone ({list.length})</div>
            {list.map(p => {
              const auto = quota>0 && anticipoOf(p) >= quota; // quota coperta dall'anticipo: non si toglie a mano
              const pg   = isPagata(p);
              return (
                <div key={p.id} style={{...cardSt(th),marginBottom:8,display:"flex",alignItems:"center",gap:12}}>
                  <div onClick={() => !auto && togglePaid(p.id)} title={auto?"Quota coperta dall'anticipo":pg?"Quota versata":"In attesa"}
                    style={{width:34,height:34,borderRadius:9,flexShrink:0,cursor:auto?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,
                      background:pg?th.ok:"transparent",border:`2px solid ${pg?th.ok:th.border}`,opacity:pg?1:0.4}}>💰</div>
                  <div style={{flex:1,fontSize:14,fontWeight:600,color:th.text}}>
                    {p.name}
                    {creditoOf(p)>0 && <div style={{fontSize:11,fontWeight:600,color:th.warn}}>deve incassare {fmt(creditoOf(p))}</div>}
                  </div>
                  <span style={{fontSize:13,fontWeight:700,color:pg?th.ok:th.sub}}>{quota>0?fmt(quota):""}</span>
                  <button onClick={() => removePerson(p.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:th.sub,padding:"4px"}}>✕</button>
                </div>
              );
            })}
          </div>
      }
    </div>
  );
}
export function CommentsSection({ event, th, user, profile }) {
  const [comments, setComments] = useState([]);
  const [text, setText]         = useState("");
  const [loading, setLoading]   = useState(true);
  const [posting, setPosting]   = useState(false);
  const isAdmin = profile?.role === "admin";

  const load = useCallback(async () => {
    const { data } = await sb.from("event_comments")
      .select("*").eq("event_id", event.id).is("deleted_at", null)
      .order("created_at", { ascending: true });
    setComments(data || []); setLoading(false);
  }, [event.id]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // Realtime: nuovi commenti (anche degli altri) compaiono da soli
  useEffect(() => {
    const ch = sb.channel(`comments-${event.id}`)
      .on("postgres_changes", { event:"*", schema:"public", table:"event_comments", filter:`event_id=eq.${event.id}` }, load)
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [event.id, load]);

  const post = async () => {
    const body = text.trim();
    if (!body || posting) return;
    setPosting(true);
    const author_name = profile?.full_name || user?.email || "Utente";
    const { data, error } = await sb.from("event_comments")
      .insert({ event_id: event.id, user_id: user.id, author_name, body })
      .select().single();
    setPosting(false);
    if (error) return;
    setText("");
    setComments(c => c.some(x => x.id===data.id) ? c : [...c, data]);
    // Notifica push agli altri che possono vedere l'evento (best effort)
    sb.functions.invoke("send-push", { body: { event_id: event.id, comment_id: data.id } }).catch(() => {});
  };

  const remove = async (c) => {
    setComments(cs => cs.filter(x => x.id !== c.id));
    await sb.from("event_comments").update({ deleted_at: new Date().toISOString() }).eq("id", c.id);
  };

  return (
    <div style={{...cardSt(th),marginBottom:16}}>
      <div style={sectTitle(th)}>💬 Commenti{comments.length>0 ? ` (${comments.length})` : ""}</div>
      {loading ? (
        <div style={{fontSize:13,color:th.sub,padding:"6px 0"}}>Caricamento…</div>
      ) : comments.length===0 ? (
        <div style={{fontSize:13,color:th.sub,padding:"6px 0"}}>Ancora nessun commento. Scrivi il primo!</div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:12}}>
          {comments.map(c => (
            <div key={c.id} style={{display:"flex",gap:10}}>
              <Avatar name={c.author_name} size={32}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:13,fontWeight:600,color:th.text}}>{c.author_name}</span>
                  <span style={{fontSize:11,color:th.sub}}>{fmtDateTime(c.created_at)}</span>
                  {(c.user_id===user?.id || isAdmin) && (
                    <button onClick={() => remove(c)} title="Elimina" style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",fontSize:12,color:th.sub,padding:0}}>🗑️</button>
                  )}
                </div>
                <div style={{fontSize:13,color:th.text,whiteSpace:"pre-wrap",wordBreak:"break-word",marginTop:2}}>{c.body}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Scrivi un commento…" rows={2}
        maxLength={2000} style={{...inputSt(th),resize:"vertical",marginBottom:8,fontFamily:"inherit"}}/>
      <button onClick={post} disabled={posting || !text.trim()} style={{...primBtn(th),width:"100%",opacity:(posting||!text.trim())?0.6:1}}>
        {posting ? "Invio…" : "Invia commento"}
      </button>
    </div>
  );
}
export function EventDetail({ event, events, th, user, profile, users = [], onBack, onVote, onToast, onStatusChange, onCancelVote, onDelete, onEdit, onShopping, onQuote, onPublish }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmVote,   setConfirmVote]   = useState(null);
  const e   = events.find(x => x.id===event.id) || event;
  const sc  = STATUS_CONFIG[e.status] || STATUS_CONFIG.open;
  const col = scColor(sc, th);
  const maxV      = Math.max(...(e.options||[]).map(o => (e.votes[o]||[]).length), 1);
  const isFull    = e.status === "full";
  const days      = daysUntil(e.deadline);
  const isExp     = days !== null && days < 0;
  const blocked   = isFull || isExp;
  const hasVoted  = Object.values(e.votes||{}).some(v => v.includes(profile?.full_name||user?.email));
  const isOwner   = e.created_by===user?.id || profile?.role==="admin";
  const canManageQuote = e.gestione_quote && (isOwner || e.quote_delegato===user?.id);
  const shCount   = (e.shopping_list||[]).length;
  const shDone    = (e.shopping_list||[]).filter(i => i.done).length;
  const shTot     = (e.shopping_list||[]).filter(i => i.done).reduce((s, i) => s + (Number(i.cost)||0), 0);
  const qCount    = (e.quote||[]).length;
  // Una quota è coperta se versata a mano (💰) o se l'anticipo la copre
  const evQuota   = (Number(e.quota_num)>0 && Number(e.quota_tot)>0) ? Number(e.quota_tot)/Number(e.quota_num) : 0;
  const qPaid     = (e.quote||[]).filter(q => q.paid || (evQuota>0 && (Number(q.anticipo)||0) >= evQuota)).length;
  const restricted = Array.isArray(e.visible_to) && e.visible_to.length > 0;
  const canManagePending = profile?.role==="admin" || e.created_by===user?.id;

  const vLabel = () => {
    if (isFull)   return "🔴 Al completo";
    if (isExp)    return "⏰ Scaduto";
    if (hasVoted) return "✅ Hai già votato";
    return "🗳️ Vota";
  };

  const copyResults = async () => {
    const images = Array.isArray(e.images) && e.images.length ? e.images : (e.flyer_url ? [e.flyer_url] : []);
    const lines = [
      `📅 ${e.title}`,
      e.date ? `🗓 ${fmtDate(e.date)}${e.time ? " alle "+e.time : ""}` : "",
      `Stato: ${sc.label}`, "",
      "Risultati sondaggio:",
      ...(e.options||[]).map(o => { const v = e.votes[o]||[]; return `• ${o}: ${v.length} vot${v.length===1?"o":"i"}${v.length>0?" ("+v.join(", ")+")":""}`; }),
      "", `👥 ${(e.participants||[]).length} partecipanti`,
      "", "🗳️ Vota su: https://rdvrdv-app.github.io/bacheca/"
    ].filter(Boolean);
    
    const textStr = lines.join("\n");
    let htmlStr = lines.join("<br>");
    if (images.length) {
      htmlStr += "<br><br>" + images.map(u => `<img src="${u}" style="max-width:300px;"><br>`).join("");
    }

    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const blobText = new Blob([textStr], { type: "text/plain" });
        const blobHtml = new Blob([htmlStr], { type: "text/html" });
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": blobText, "text/html": blobHtml })]);
      } else {
        await navigator.clipboard?.writeText(textStr);
      }
      onToast("📋 Copiato con immagini!");
    } catch (err) {
      navigator.clipboard?.writeText(textStr);
      onToast("📋 Risultati copiati!");
    }
  };

  return (
    <div>
      <button onClick={onBack} style={backBtn(th)}>← Indietro</button>

      {canManagePending && e.pending_approval && (
        <div style={{...cardSt(th),marginBottom:14,border:`1.5px solid ${th.warn}`,background:th.warn+"14"}}>
          <div style={{fontSize:13,color:th.text,fontWeight:600,marginBottom:6}}>🔍 Bozza / in pre-approvazione</div>
          <div style={{fontSize:12,color:th.sub,marginBottom:10}}>Bozza: visibile solo a te e agli admin. Pubblicala per renderla visibile {restricted ? "alle persone selezionate" : "a tutti"}.</div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={() => onPublish(e.id, true)} style={{...primBtn(th),flex:1,background:th.ok}}>✅ Pubblica</button>
            <button onClick={() => onEdit(e)} style={{...btnSt(th),flex:1,color:th.accent,border:`1px solid ${th.accent}`,background:"transparent",fontWeight:600}}>✏️ Modifica</button>
          </div>
        </div>
      )}

      {e.lista_spesa && (
        <button onClick={() => onShopping(e)} style={{...btnSt(th),width:"100%",marginBottom:8,display:"flex",alignItems:"center",justifyContent:"space-between",border:`1.5px solid ${th.border}`,padding:"12px 14px"}}>
          <span style={{fontWeight:600,color:th.text}}>🛒 Lista Spesa</span>
          <span style={{fontSize:12,color:th.sub}}>{shCount===0?"Nulla ancora":`${shDone}/${shCount} acquistati${shTot>0?` · ${fmtEur(shTot)}`:""}`}</span>
        </button>
      )}

      {canManageQuote && (
        <button onClick={() => onQuote(e)} style={{...btnSt(th),width:"100%",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",border:`1.5px solid ${th.border}`,padding:"12px 14px"}}>
          <span style={{fontWeight:600,color:th.text}}>💶 Gestione quote</span>
          <span style={{fontSize:12,color:th.sub}}>{qCount===0?"Nessuno ancora":`💰 ${qPaid}/${qCount}`}</span>
        </button>
      )}

      <h2 style={{margin:"0 0 6px",fontSize:20,color:th.text,display:"flex",alignItems:"center",gap:8}}>
        {e.title}{restricted && <span title="Visibilità limitata" style={{fontSize:14}}>🔒</span>}
      </h2>
      {restricted && (
        <div style={{fontSize:12,color:th.sub,marginBottom:8,padding:"6px 10px",background:th.input,borderRadius:8,display:"flex",flexWrap:"wrap",gap:4,alignItems:"center"}}>
          <span style={{fontWeight:600,marginRight:4}}>🔒 Visibile a:</span>
          {(e.visible_to||[]).map(uid => {
            const u = (users||[]).find(x => x.id===uid);
            return <span key={uid} style={{background:th.accent+"22",color:th.accent,borderRadius:10,padding:"2px 8px",fontSize:11,fontWeight:600}}>{u?.full_name||u?.email||uid.slice(0,8)}</span>;
          })}
        </div>
      )}
      {e.created_by && (
        <div style={{fontSize:12,color:th.sub,marginBottom:10}}>
          Creato da {e.organizer||"utente"}
          {isOwner && e.created_by!==user?.id && <span style={{marginLeft:6,color:th.accent,fontSize:11,fontWeight:600}}>👑 Sei admin</span>}
        </div>
      )}

      {isOwner ? (
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,color:th.sub,marginBottom:6,fontWeight:600,letterSpacing:0.5,textTransform:"uppercase"}}>Stato evento</div>
          <div style={{display:"flex",gap:8}}>
            {Object.entries(STATUS_CONFIG).map(([k,v]) => {
              const c = scColor(v, th);
              return (
                <button key={k} onClick={() => onStatusChange(e.id, k)}
                  style={{flex:1,padding:"8px 4px",borderRadius:12,cursor:"pointer",border:`2px solid ${e.status===k?c:th.border}`,background:e.status===k?c+"22":th.input,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                  <div style={{width:14,height:14,borderRadius:"50%",background:c,boxShadow:e.status===k?`0 0 8px ${c}88`:"none"}}/>
                  <span style={{fontSize:11,fontWeight:600,color:e.status===k?c:th.sub}}>{v.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,padding:"8px 14px",background:th.input,borderRadius:12,width:"fit-content",border:`1px solid ${th.border}`}}>
          {Object.entries(STATUS_CONFIG).map(([k,v]) => {
            const c = scColor(v, th);
            return <div key={k} style={{width:14,height:14,borderRadius:"50%",background:e.status===k?c:th.border,boxShadow:e.status===k?`0 0 8px ${c}88`:"none"}}/>;
          })}
          <span style={{fontSize:13,fontWeight:600,color:col,marginLeft:4}}>{sc.label}</span>
        </div>
      )}

      {e.organizer  && <div style={{fontSize:13,color:th.sub,marginBottom:4}}>👤 {e.organizer}</div>}
      {(e.date||e.time) && <div style={{fontSize:13,color:th.accent,fontWeight:600,marginBottom:4}}>{e.date&&`📅 ${fmtDateRange(e)}`}{e.date&&e.time&&"  "}{e.time&&`🕐 ${e.time}`}</div>}
      {e.deadline   && <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}><span style={{fontSize:13,color:th.sub}}>⏰ Scadenza: {fmtDate(e.deadline)}</span><DeadlineBadge deadline={e.deadline} th={th}/></div>}
      {e.last_edit  && <div style={{fontSize:12,color:th.warn,marginBottom:10,fontStyle:"italic",padding:"6px 10px",background:th.warn+"18",borderRadius:8}}>✏️ {e.last_edit}</div>}
      {e.address    && <div onClick={() => openMaps(e.address)} style={{...cardSt(th),display:"flex",alignItems:"center",gap:8,cursor:"pointer",marginBottom:12}}><span style={{fontSize:18}}>📍</span><div><div style={{fontSize:13,color:th.text}}>{e.address}</div><div style={{fontSize:11,color:th.accent}}>Apri in Google Maps →</div></div></div>}
      {e.notes      && <div style={{...cardSt(th),marginBottom:12}}><div style={{fontSize:12,color:th.sub,marginBottom:4}}>📝 Note</div><div style={{fontSize:13,color:th.text,whiteSpace:"pre-wrap"}}>{e.notes}</div></div>}
      {(e.images && e.images.length ? e.images : (e.flyer_url ? [e.flyer_url] : [])).map((url, i) => (
        <img key={i} src={url} alt={`Immagine ${i+1}`} style={{width:"100%",borderRadius:12,marginBottom:12,objectFit:"contain",maxHeight:320,background:th.input}}/>
      ))}
      {e.social     && <div style={{...cardSt(th),marginBottom:12}}><div style={{fontSize:12,color:th.sub,marginBottom:4}}>🔗 Link social</div><a href={e.social} target="_blank" rel="noreferrer" style={{fontSize:13,color:th.accent,wordBreak:"break-all"}}>{e.social}</a></div>}

      <div style={{...cardSt(th),marginBottom:12}}>
        <div style={sectTitle(th)}>Risultati sondaggio</div>
        {(e.options||[]).map(o => {
          const v = e.votes[o]||[];
          const pct = Math.round((v.length/maxV)*100);
          return (
            <div key={o} style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:13,color:th.text}}>{o}</span>
                <span style={{fontSize:13,color:th.sub}}>{v.length} voti</span>
              </div>
              <div style={{background:th.border,borderRadius:6,height:8,overflow:"hidden"}}>
                <div style={{width:`${pct}%`,height:"100%",background:col,borderRadius:6}}/>
              </div>
              {v.length>0 && <div style={{fontSize:11,color:th.sub,marginTop:3}}>{v.join(", ")}</div>}
            </div>
          );
        })}
        <div style={{fontSize:12,color:th.sub,marginTop:8}}>👥 {(e.participants||[]).length} partecipanti al sondaggio</div>
      </div>

      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
        <button onClick={() => { if (!blocked && !hasVoted) onVote(); }} disabled={blocked||hasVoted}
          style={{...primBtn(th),flex:1,opacity:(blocked||hasVoted)?.5:1,cursor:(blocked||hasVoted)?"not-allowed":"pointer",
            background:isFull?th.danger:isExp?th.sub:hasVoted?th.ok:th.accent}}>
          {vLabel()}
        </button>
        <button onClick={copyResults} style={{...btnSt(th),flex:1}}>📋 Copia risultati</button>
      </div>

      {e.date && (
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          <button onClick={() => window.open(googleCalUrl(e), "_blank")} style={{...btnSt(th),flex:1}}>📆 Google Calendar</button>
          <button onClick={() => window.open(outlookCalUrl(e), "_blank")} style={{...btnSt(th),flex:1}}>📧 Outlook</button>
        </div>
      )}

      {(e.participants||[]).length>0 && !blocked && (
        <div style={{marginBottom:16}}>
          <div style={{fontSize:11,color:th.sub,marginBottom:6,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5}}>Ritira un voto</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {(profile?.role==="admin" ? e.participants||[] : (e.participants||[]).filter(p => p===(profile?.full_name||user?.email))).map(p => (
              <button key={p} onClick={() => setConfirmVote(confirmVote===p ? null : p)}
                style={{padding:"4px 10px",borderRadius:20,fontSize:12,cursor:"pointer",border:`1px solid ${confirmVote===p?th.danger:th.border}`,background:confirmVote===p?th.danger+"22":th.input,color:confirmVote===p?th.danger:th.sub}}>
                ✕ {p}
              </button>
            ))}
          </div>
          {confirmVote && (
            <div style={{marginTop:10,padding:"10px 12px",background:th.danger+"11",borderRadius:10,border:`1px solid ${th.danger}44`,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
              <span style={{fontSize:12,color:th.text}}>Rimuovere il voto di <b>{confirmVote}</b>?</span>
              <div style={{display:"flex",gap:6}}>
                <button onClick={() => setConfirmVote(null)} style={{...btnSt(th),fontSize:12,padding:"4px 10px"}}>Annulla</button>
                <button onClick={() => { onCancelVote(e.id, confirmVote); setConfirmVote(null); }} style={{...primBtn(th),fontSize:12,padding:"4px 10px",background:th.danger}}>Rimuovi</button>
              </div>
            </div>
          )}
        </div>
      )}

      <CommentsSection event={e} th={th} user={user} profile={profile}/>

      {isOwner && (
        <div style={{borderTop:`1px solid ${th.border}`,paddingTop:16,display:"flex",flexDirection:"column",gap:8}}>
          {canManagePending && !e.pending_approval && (
            <button onClick={() => onPublish(e.id, false)} style={{...btnSt(th),width:"100%",color:th.warn,border:`1.5px solid ${th.warn}`,background:"transparent",fontWeight:600}}>🙈 Nascondi (rimetti in bozza)</button>
          )}
          <button onClick={() => onEdit(e)} style={{...btnSt(th),width:"100%",color:th.accent,border:`1.5px solid ${th.accent}`,background:"transparent",fontWeight:600}}>✏️ Modifica sondaggio</button>
          {!confirmDelete
            ? <button onClick={() => setConfirmDelete(true)} style={dangerBtn(th)}>🗑️ Elimina evento</button>
            : <div style={{...cardSt(th),border:`1.5px solid ${th.danger}`}}>
                <div style={{fontSize:14,color:th.text,marginBottom:6,fontWeight:600}}>Eliminare questo evento?</div>
                <div style={{fontSize:12,color:th.sub,marginBottom:14}}>Verrà spostato nel cestino. L'admin potrà recuperarlo entro 30 giorni.</div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={() => setConfirmDelete(false)} style={{...btnSt(th),flex:1}}>Annulla</button>
                  <button onClick={() => onDelete(e.id)} style={{...primBtn(th),flex:1,background:th.danger}}>Sì, elimina</button>
                </div>
              </div>
          }
        </div>
      )}
    </div>
  );
}
export function VoteView({ event, events, th, profile, user, onBack, onSubmit, saving }) {
  const [sel, setSel]             = useState([]);
  const [companions, setCompanions] = useState([]);
  const [compInput, setCompInput]   = useState("");
  const e    = events.find(x => x.id===event.id) || event;
  const isM  = e.multi_select === true || e.multiSelect === true;
  const multiDay = isMultiDay(e);
  const name = profile?.full_name || user?.email || "Utente";

  // Voto multi-giorno: «Tutto il periodo» e i singoli giorni si escludono a vicenda
  const toggleOpt = (o) => {
    if (!isM) return setSel([o]);
    if (o === WHOLE_PERIOD) return setSel(p => p.includes(o) ? [] : [o]);
    setSel(p => { const b = p.filter(x => x !== WHOLE_PERIOD); return b.includes(o) ? b.filter(x => x !== o) : [...b, o]; });
  };

  const addCompanion = () => {
    const n = compInput.trim();
    if (!n) return;
    setCompanions(p => [...p, n]);
    setCompInput("");
  };

  const removeCompanion = (i) => setCompanions(p => p.filter((_, idx) => idx !== i));

  const handleConfirm = () => {
    if (!sel.length) return;
    onSubmit([name, ...companions], sel);
  };

  return (
    <div>
      <button onClick={onBack} style={backBtn(th)}>← Indietro</button>
      <h2 style={{margin:"0 0 4px",fontSize:18,color:th.text}}>{e.title}</h2>
      <div style={{fontSize:13,color:th.sub,marginBottom:12}}>{multiDay ? "Seleziona i giorni in cui partecipi, oppure «Tutto il periodo»" : isM ? "Puoi selezionare più opzioni" : "Seleziona una sola opzione"}</div>
      <div style={{fontSize:13,color:th.accent,marginBottom:16}}>Stai votando come: <b>{name}</b></div>
      {(e.options||[]).map(o => {
        const s = sel.includes(o);
        return (
          <div key={o} onClick={() => toggleOpt(o)}
            style={{...cardSt(th),marginBottom:8,cursor:"pointer",border:`2px solid ${s?th.accent:th.border}`,background:s?th.accent+"18":th.card}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:14,color:th.text}}>{o}</span>
              <span style={{fontSize:18}}>{s?"✅":"⬜"}</span>
            </div>
          </div>
        );
      })}

      {/* ── Accompagnatori ── */}
      <div style={{...cardSt(th),marginTop:16,marginBottom:8,border:`1px solid ${th.border}`}}>
        <div style={{fontSize:13,fontWeight:600,color:th.text,marginBottom:10}}>
          👥 Accompagnatori
          <span style={{fontWeight:400,color:th.sub,marginLeft:6,fontSize:12}}>
            (opzionale — persone che vengono con te)
          </span>
        </div>
        {companions.map((c, i) => (
          <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
            <div style={{flex:1,padding:"6px 10px",background:th.input,borderRadius:8,fontSize:13,color:th.text}}>
              {c}
              <span style={{fontSize:11,color:th.sub,marginLeft:6}}>con {name}</span>
            </div>
            <button onClick={() => removeCompanion(i)}
              style={{background:"none",border:"none",cursor:"pointer",color:th.danger,fontSize:18,padding:"0 4px",lineHeight:1}}>
              ×
            </button>
          </div>
        ))}
        <div style={{display:"flex",gap:8,marginTop:4}}>
          <input
            value={compInput}
            onChange={ev => setCompInput(ev.target.value)}
            onKeyDown={ev => ev.key==="Enter" && addCompanion()}
            placeholder="Nome accompagnatore..."
            style={{flex:1,padding:"8px 10px",borderRadius:8,border:`1px solid ${th.border}`,background:th.input,color:th.text,fontSize:14}}
          />
          <button onClick={addCompanion} disabled={!compInput.trim()}
            style={{...primBtn(th),padding:"8px 14px",opacity:compInput.trim()?1:0.5}}>
            + Aggiungi
          </button>
        </div>
      </div>

      {companions.length > 0 && (
        <div style={{fontSize:12,color:th.sub,marginBottom:8,paddingLeft:4}}>
          Verranno registrati {1 + companions.length} voti: <b>{name}</b> + {companions.join(", ")}
        </div>
      )}

      <button onClick={handleConfirm} disabled={saving || !sel.length}
        style={{...primBtn(th),width:"100%",marginTop:8,opacity:(saving||!sel.length)?0.6:1}}>
        {saving ? "Salvataggio..." : companions.length > 0 ? `Conferma voto (${1+companions.length} persone)` : "Conferma voto"}
      </button>
    </div>
  );
}
export async function uploadFlyer(base64, mediaType, userId) {
  const ext = mediaType === "image/png" ? "png" : "jpg";
  const path = `${userId}/${Date.now()}.${ext}`;
  const blob = await fetch(`data:${mediaType};base64,${base64}`).then(r => r.blob());
  const { data, error } = await sb.storage.from("event-flyers").upload(path, blob, { contentType: mediaType, upsert: true });
  if (error) throw new Error("Upload locandina: " + error.message);
  const { data: { publicUrl } } = sb.storage.from("event-flyers").getPublicUrl(data.path);
  return publicUrl;
}
export function ImportFromPostCard({ th, onImport, userId }) {
  const [open,    setOpen]    = React.useState(false);
  const [text,    setText]    = React.useState("");
  const [imgData, setImgData] = React.useState(null); // {base64, mediaType, preview}
  const [loading, setLoading] = React.useState(false);
  const [msg,     setMsg]     = React.useState("");
  const fileRef = React.useRef(null);

  const resizeImage = (file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1024;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else       { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ base64: dataUrl.split(",")[1], mediaType: "image/jpeg", preview: dataUrl });
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImgData(await resizeImage(file));
    setMsg("");
  };

  const analyze = async () => {
    if (!text.trim() && !imgData) return setMsg("Incolla un testo o carica un'immagine.");
    setLoading(true); setMsg("");
    try {
      const { data:{ session } } = await sb.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/parse-event`, {
        method: "POST",
        headers: { "Content-Type":"application/json", "Authorization":`Bearer ${session?.access_token||""}` },
        body: JSON.stringify({ text: text.trim()||null, imageBase64: imgData?.base64||null, imageMediaType: imgData?.mediaType||null }),
      });
      const r = await res.json();
      if (!res.ok || r.error) { setMsg("❌ " + (r.error || "Errore")); }
      else {
        const patch = {};
        if (r.title)     patch.title     = r.title;
        if (r.organizer) patch.organizer = r.organizer;
        if (r.address)   patch.address   = r.address;
        if (r.date)      patch.date      = r.date;
        if (r.time)      patch.time      = r.time;
        if (r.notes)     patch.notes     = r.notes;
        if (r.social)    patch.social    = r.social;
        if (imgData && userId) {
          try {
            patch.flyer_url = await uploadFlyer(imgData.base64, imgData.mediaType, userId);
          } catch (uploadErr) {
            console.warn("Upload locandina fallito:", uploadErr.message);
          }
        }
        onImport(patch);
        setMsg("✅ Campi compilati! Controlla e modifica se necessario.");
      }
    } catch (e) { setMsg("❌ " + e.message); }
    setLoading(false);
  };

  return (
    <div style={{...cardSt(th), marginBottom:16, border:`1.5px solid ${th.accent}55`}}>
      <button onClick={() => setOpen(o => !o)}
        style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",background:"transparent",border:"none",cursor:"pointer",padding:0}}>
        <span style={{fontWeight:700,color:th.accent,fontSize:14}}>✨ Importa da post / locandina</span>
        <span style={{color:th.sub,fontSize:12}}>{open?"▲":"▼"}</span>
      </button>
      {open && (
        <div style={{marginTop:12}}>
          <label style={labelSt(th)}>Testo del post (Facebook, Instagram…)</label>
          <textarea value={text} onChange={e => setText(e.target.value)}
            placeholder="Incolla qui il testo del post social con i dettagli dell'evento…"
            style={{...inputSt(th),height:96,resize:"vertical"}}/>

          <label style={labelSt(th)}>Locandina (foto)</label>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{display:"none"}}/>
          <button onClick={() => fileRef.current?.click()}
            style={{...btnSt(th),marginBottom:8,border:`1.5px dashed ${th.border}`,background:"transparent",color:th.accent,width:"100%"}}>
            📷 {imgData ? "Cambia immagine" : "Carica locandina"}
          </button>
          {imgData && (
            <div style={{position:"relative",marginBottom:8}}>
              <img src={imgData.preview} style={{width:"100%",borderRadius:10,maxHeight:220,objectFit:"contain",background:th.input}}/>
              <button onClick={() => setImgData(null)}
                style={{position:"absolute",top:6,right:6,background:"#0008",border:"none",borderRadius:"50%",width:24,height:24,cursor:"pointer",color:"#fff",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            </div>
          )}

          <button onClick={analyze} disabled={loading || (!text.trim() && !imgData)}
            style={{...primBtn(th),width:"100%",opacity:loading?.6:1}}>
            {loading ? "✨ Analisi in corso…" : "✨ Analizza e compila il form"}
          </button>
          {msg && <div style={{color:msg.startsWith("✅")?th.ok:th.danger,fontSize:13,marginTop:8}}>{msg}</div>}
        </div>
      )}
    </div>
  );
}
export function EventForm({ event, th, onBack, onSubmit, saving, isEdit, profile, users = [], userId }) {
  const [form, setForm] = useState({
    title:       event?.title      || "",
    organizer:   event?.organizer  || profile?.full_name || "",
    address:     event?.address    || "",
    date:        event?.date       || "",
    multiDay:    !!(event?.end_date && event.date && event.end_date > event.date),
    endDate:     event?.end_date   || "",
    time:        event?.time       || "",
    deadline:    event?.deadline   || "",
    notes:       event?.notes      || "",
    social:      event?.social     || "",
    images:      (Array.isArray(event?.images) && event.images.length) ? [...event.images] : (event?.flyer_url ? [event.flyer_url] : []),
    status:      event?.status     || "open",
    multiSelect: event?.multiSelect || event?.multi_select || false,
    listaSpesa:  event?.lista_spesa || false,
    gestioneQuote: event?.gestione_quote || false,
    quoteDelegato: event?.quote_delegato || "",
    publishNow:  event ? !event.pending_approval : true,
    options:     event?.options?.length ? [...event.options] : [""],
    visMode:     (event?.visible_to && event.visible_to.length > 0) ? "some" : "all",
    visibleTo:   event?.visible_to || [],
  });
  const [flyerUploading, setFlyerUploading] = React.useState(false);
  const flyerRef = React.useRef(null);
  // Il creatore (o l'autore originale in modifica) è sempre incluso nella
  // visibilità ristretta e non può togliersi.
  const creatorId = event?.created_by || userId;

  const resizeToUpload = (file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1200;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else       { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
        resolve({ base64: dataUrl.split(",")[1], mediaType: "image/jpeg" });
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  const handleImageFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !userId) return;
    setFlyerUploading(true);
    try {
      for (const file of files) {
        const resized = await resizeToUpload(file);
        const url = await uploadFlyer(resized.base64, resized.mediaType, userId);
        setForm(f => ({...f, images: [...f.images, url]}));
      }
    } catch (err) {
      alert("Errore upload immagine: " + err.message);
    }
    setFlyerUploading(false);
    if (flyerRef.current) flyerRef.current.value = "";
  };

  const removeImage = (i) => setForm(f => ({...f, images: f.images.filter((_, idx) => idx !== i)}));
  const makeCover   = (i) => setForm(f => { if (i === 0) return f; const arr = [...f.images]; const [img] = arr.splice(i, 1); return {...f, images: [img, ...arr]}; });

  const updOpt  = (i, v) => setForm(f => { const o = [...f.options]; o[i] = v; return {...f, options:o}; });
  const toggleUser = id => { if (id === creatorId) return; setForm(f => ({...f, visibleTo: f.visibleTo.includes(id) ? f.visibleTo.filter(x=>x!==id) : [...f.visibleTo, id]})); };

  return (
    <div>
      <button onClick={onBack} style={backBtn(th)}>← Indietro</button>

      <div style={{display:"flex",gap:20,marginBottom:14,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:13,color:th.text}}>🛒 Lista Spesa</span>
          <Toggle value={form.listaSpesa} onChange={() => setForm(f => {
            const on = !f.listaSpesa;
            // La lista della spesa attiva sempre anche la gestione quote
            return {...f, listaSpesa: on, gestioneQuote: on ? true : f.gestioneQuote};
          })} th={th}/>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:13,color:th.text}}>💶 Gestione quote</span>
          <Toggle value={form.gestioneQuote} onChange={() => setForm(f => f.listaSpesa ? f : ({...f, gestioneQuote:!f.gestioneQuote, quoteDelegato:""}))} th={th}/>
        </div>
      </div>
      {form.gestioneQuote && (
        <div style={{marginBottom:14}}>
          <label style={labelSt(th)}>👤 Delegato raccolta quote <span style={{color:th.sub,fontWeight:400,textTransform:"none"}}>(opzionale)</span></label>
          <select value={form.quoteDelegato} onChange={e => setForm(f => ({...f, quoteDelegato:e.target.value}))} style={{...inputSt(th),marginBottom:0}}>
            <option value="">— Solo io (owner) —</option>
            {users.filter(u => u.id !== userId).map(u => (
              <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
            ))}
          </select>
        </div>
      )}

      <h2 style={{margin:"0 0 8px",fontSize:18,color:th.text}}>{isEdit ? "Modifica sondaggio" : "Nuovo sondaggio"}</h2>
      {isEdit && <div style={{fontSize:12,color:th.warn,marginBottom:16,padding:"6px 10px",background:th.warn+"18",borderRadius:8}}>⚠️ I voti esistenti verranno mantenuti.</div>}
      {!isEdit && <ImportFromPostCard th={th} userId={userId} onImport={patch => setForm(f => {
        const { flyer_url, ...rest } = patch;
        const next = {...f, ...rest};
        if (flyer_url) next.images = [...f.images, flyer_url];
        return next;
      })}/>}

      <label style={labelSt(th)}>Titolo evento *</label>
      <input value={form.title} onChange={e => setForm(f => ({...f, title:e.target.value}))} placeholder="Es. Concerto, Cena..." style={inputSt(th)}/>
      <label style={labelSt(th)}>Organizzatore</label>
      <input value={form.organizer} onChange={e => setForm(f => ({...f, organizer:e.target.value}))} placeholder="Il tuo nome" style={inputSt(th)}/>
      <label style={labelSt(th)}>Indirizzo / Luogo</label>
      <input value={form.address} onChange={e => setForm(f => ({...f, address:e.target.value}))} placeholder="Via, Città..." style={inputSt(th)}/>
      <label style={labelSt(th)}>{form.multiDay ? "Data inizio *" : "Data evento *"} <span style={{color:th.sub,fontWeight:400,textTransform:"none"}}>e ora</span></label>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <input type="date" value={form.date} onChange={e => setForm(f => ({...f, date:e.target.value}))} style={{...inputSt(th),marginBottom:0,flex:2}}/>
        <input type="time" value={form.time} onChange={e => setForm(f => ({...f, time:e.target.value}))} style={{...inputSt(th),marginBottom:0,flex:1}}/>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:form.multiDay?12:14}}>
        <span style={{fontSize:13,color:th.text}}>📆 Evento su più giorni</span>
        <Toggle value={form.multiDay} onChange={() => setForm(f => ({...f, multiDay:!f.multiDay}))} th={th}/>
      </div>
      {form.multiDay && (
        <>
          <label style={labelSt(th)}>Data fine *</label>
          <input type="date" value={form.endDate} min={form.date} onChange={e => setForm(f => ({...f, endDate:e.target.value}))} style={inputSt(th)}/>
        </>
      )}
      <label style={labelSt(th)}>Scadenza sondaggio</label>
      <input type="date" value={form.deadline} onChange={e => setForm(f => ({...f, deadline:e.target.value}))} style={inputSt(th)}/>
      <label style={labelSt(th)}>Note</label>
      <textarea value={form.notes} onChange={e => setForm(f => ({...f, notes:e.target.value}))} placeholder="Descrizione..." style={{...inputSt(th),height:72,resize:"vertical"}}/>
      <label style={labelSt(th)}>Link social</label>
      <input value={form.social} onChange={e => setForm(f => ({...f, social:e.target.value}))} placeholder="https://instagram.com/... o altro link" style={inputSt(th)}/>

      <label style={labelSt(th)}>Immagini {form.images.length > 0 && <span style={{color:th.sub,fontWeight:400,textTransform:"none"}}>({form.images.length}) · la 1ª è la copertina</span>}</label>
      <input ref={flyerRef} type="file" accept="image/*" multiple onChange={handleImageFiles} style={{display:"none"}}/>
      {form.images.length > 0 && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(96px,1fr))",gap:8,marginBottom:10}}>
          {form.images.map((url, i) => (
            <div key={i} style={{position:"relative"}}>
              <img src={url} onClick={() => makeCover(i)} title={i===0 ? "Copertina" : "Imposta come copertina"}
                style={{width:"100%",height:96,borderRadius:10,objectFit:"cover",background:th.input,cursor:i===0?"default":"pointer",border:i===0?`2px solid ${th.accent}`:`1px solid ${th.border}`}}/>
              {i===0 && <span style={{position:"absolute",bottom:5,left:5,background:th.accent,color:"#fff",fontSize:9,fontWeight:700,borderRadius:6,padding:"1px 6px"}}>COPERTINA</span>}
              <button onClick={() => removeImage(i)}
                style={{position:"absolute",top:4,right:4,background:"#000a",border:"none",borderRadius:"50%",width:22,height:22,cursor:"pointer",color:"#fff",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            </div>
          ))}
        </div>
      )}
      <button onClick={() => flyerRef.current?.click()} disabled={flyerUploading}
        style={{...btnSt(th),marginBottom:14,border:`1.5px dashed ${th.border}`,background:"transparent",color:th.accent,width:"100%"}}>
        {flyerUploading ? "⏳ Upload in corso…" : form.images.length > 0 ? "📷 Aggiungi altre immagini" : "📷 Aggiungi immagini"}
      </button>

      <label style={labelSt(th)}>Stato evento</label>
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        {(isEdit ? Object.entries(STATUS_CONFIG) : Object.entries(STATUS_CONFIG).filter(([k]) => k!=="full")).map(([k,v]) => {
          const c = scColor(v, th);
          return (
            <button key={k} onClick={() => setForm(f => ({...f, status:k}))}
              style={{flex:1,padding:"8px 4px",borderRadius:12,cursor:"pointer",border:`2px solid ${form.status===k?c:th.border}`,background:form.status===k?c+"22":th.input,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
              <div style={{width:14,height:14,borderRadius:"50%",background:c,boxShadow:form.status===k?`0 0 8px ${c}88`:"none"}}/>
              <span style={{fontSize:11,fontWeight:600,color:form.status===k?c:th.sub}}>{v.label}</span>
            </button>
          );
        })}
      </div>

      {!form.multiDay ? (
        <>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
            <span style={{fontSize:13,color:th.text}}>Selezione multipla</span>
            <Toggle value={form.multiSelect} onChange={() => setForm(f => ({...f, multiSelect:!f.multiSelect}))} th={th}/>
          </div>

          <label style={labelSt(th)}>Opzioni * {isEdit && <span style={{color:th.sub,fontWeight:400,textTransform:"none"}}>(voti conservati)</span>}</label>
          {form.options.map((o, i) => (
            <div key={i} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
              <div style={{width:22,height:22,borderRadius:"50%",background:th.accent,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,flexShrink:0}}>{i+1}</div>
              <input value={o} onChange={e => updOpt(i, e.target.value)} placeholder={`Opzione ${i+1}…`} style={{...inputSt(th),marginBottom:0,flex:1}}/>
              {form.options.length > (form.multiSelect ? 2 : 1) && (
                <button onClick={() => setForm(f => ({...f, options:f.options.filter((_,idx) => idx!==i)}))} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:th.sub}}>✕</button>
              )}
            </div>
          ))}
          <button onClick={() => setForm(f => ({...f, options:[...f.options,""]}))} style={{...btnSt(th),width:"100%",marginBottom:16,border:`1.5px dashed ${th.border}`,background:"transparent",color:th.accent,fontWeight:600}}>+ Aggiungi opzione</button>
        </>
      ) : (
        <div style={{...cardSt(th),marginBottom:16}}>
          <div style={sectTitle(th)}>🗳️ Voto sui giorni</div>
          <div style={{fontSize:12,color:th.sub,marginBottom:(form.endDate && form.endDate>form.date)?10:0}}>I partecipanti potranno votare i singoli giorni o l'intero periodo.</div>
          {form.endDate && form.endDate>form.date && (
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {dateRange(form.date, form.endDate).map(ds => (
                <span key={ds} style={{background:th.accent+"22",color:th.accent,borderRadius:10,padding:"3px 8px",fontSize:11,fontWeight:600}}>{dayOptLabel(ds)}</span>
              ))}
              <span style={{background:th.ok+"22",color:th.ok,borderRadius:10,padding:"3px 8px",fontSize:11,fontWeight:600}}>{WHOLE_PERIOD}</span>
            </div>
          )}
        </div>
      )}

      <div style={{...cardSt(th),marginBottom:16}}>
          <div style={sectTitle(th)}>👁️ Chi può vederlo</div>
          <div style={{display:"flex",gap:8,marginBottom:form.visMode==="some"?12:0}}>
            {[["all","🌍 Tutti"],["some","🔒 Solo selezionati"]].map(([k,l]) => {
              const on = form.visMode===k;
              return (
                <button key={k} onClick={() => setForm(f => ({...f, visMode:k, visibleTo: k==="some" && !f.visibleTo.includes(creatorId) ? [...f.visibleTo, creatorId] : f.visibleTo}))}
                  style={{flex:1,padding:"9px",borderRadius:10,cursor:"pointer",fontWeight:600,fontSize:13,
                    border:`1.5px solid ${on?th.accent:th.border}`,background:on?th.accent:th.input,color:on?"#fff":th.text}}>
                  {l}
                </button>
              );
            })}
          </div>
          {form.visMode==="some" && (
            <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:240,overflowY:"auto",marginTop:4}}>
              {users.length===0 && <div style={{fontSize:12,color:th.sub,padding:"6px 0"}}>Nessun utente disponibile.</div>}
              {users.map(u => {
                const isCreator = u.id === creatorId;
                const on = isCreator || form.visibleTo.includes(u.id);
                return (
                  <div key={u.id} onClick={() => toggleUser(u.id)}
                    style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:10,cursor:isCreator?"default":"pointer",opacity:isCreator?0.85:1,
                      border:`1px solid ${on?th.accent:th.border}`,background:on?th.accent+"18":th.input}}>
                    <div style={{width:20,height:20,borderRadius:6,flexShrink:0,border:`2px solid ${on?th.accent:th.sub}`,background:on?th.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
                      {on && <span style={{color:"#fff",fontSize:12,fontWeight:700}}>{isCreator?"🔒":"✓"}</span>}
                    </div>
                    <Avatar name={u.full_name||u.email} size={26}/>
                    <span style={{fontSize:13,color:th.text}}>{u.full_name||u.email}{isCreator && <span style={{color:th.sub}}> (tu · sempre incluso)</span>}</span>
                  </div>
                );
              })}
              <div style={{fontSize:11,color:th.sub,marginTop:4}}>Selezionati: {new Set([...form.visibleTo, creatorId]).size}. Tu (creatore) sei sempre incluso e non puoi toglierti; gli admin vedono sempre tutto.</div>
            </div>
          )}
      </div>

      {!isEdit && (
        <div style={{...cardSt(th),marginBottom:16}}>
          <div style={sectTitle(th)}>📣 Pubblicazione</div>
          <div style={{display:"flex",gap:8}}>
            {[["now","✅ Pubblica subito"],["later","🔍 Non pubblicare ora"]].map(([k,l]) => {
              const on = (form.publishNow ? "now" : "later") === k;
              return (
                <button key={k} onClick={() => setForm(f => ({...f, publishNow: k==="now"}))}
                  style={{flex:1,padding:"9px",borderRadius:10,cursor:"pointer",fontWeight:600,fontSize:13,
                    border:`1.5px solid ${on?th.accent:th.border}`,background:on?th.accent:th.input,color:on?"#fff":th.text}}>
                  {l}
                </button>
              );
            })}
          </div>
          <div style={{fontSize:11,color:th.sub,marginTop:8,lineHeight:1.5}}>
            "Non pubblicare ora" salva l'evento come bozza: lo vedi solo tu (e gli admin) finché non lo pubblichi.
          </div>
        </div>
      )}

      <button onClick={() => onSubmit(form)} disabled={saving} style={{...primBtn(th),width:"100%",opacity:saving?.6:1}}>
        {saving ? "Salvataggio..." : isEdit ? "Salva modifiche ✏️" : "Crea sondaggio 🎉"}
      </button>
    </div>
  );
}