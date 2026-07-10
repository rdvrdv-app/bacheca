import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DeadlineBadge, Avatar, Toggle, ItemRow, EventCard, CalGrid } from '../components/SharedUI.jsx';
import { sb, SUPABASE_URL } from '../config/supabase.js';
import { LIGHT, DARK, STATUS_CONFIG, scColor, UNITS, MONTHS, DAYS, AVATAR_COLORS, cardSt, inputSt, labelSt, btnSt, primBtn, backBtn, dangerBtn, sectTitle, eventBadge } from '../theme/index.js';
import { orNull, fmtEur, fmtDateTime, enablePush, disablePush, pushSupported, getDaysInMonth, getFirstDay, toDateStr, openMaps, ferieOnDay, fmtDate, fmtFerie, WHOLE_PERIOD, isMultiDay, eventCoversDay, dateRange, dayOptLabel, buildMultiDayOptions, fmtDateRange, daysUntil, addDaysStr, calendarDates, googleCalUrl, outlookCalUrl, validatePassword, canSeeEvent } from '../utils/helpers.js';

export function PasswordRecoveryView({ th, onDone }) {
  const [f, setF]       = useState({ new1: "", new2: "", err: "", ok: false });
  const [loading, setL] = useState(false);

  const save = async () => {
    const err = validatePassword(f.new1);
    if (err) return setF(p => ({...p, err}));
    if (f.new1 !== f.new2) return setF(p => ({...p, err: "Le password non coincidono."}));
    setL(true);
    const { error } = await sb.auth.updateUser({ password: f.new1 });
    setL(false);
    if (error) return setF(p => ({...p, err: error.message}));
    setF(p => ({...p, ok: true, err: ""}));
    setTimeout(onDone, 2000);
  };

  return (
    <div style={{minHeight:"100vh",background:th.aurora,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{width:"100%",maxWidth:380}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:40,marginBottom:8}}>🔑</div>
          <h1 style={{fontSize:22,fontWeight:700,color:th.text}}>Nuova password</h1>
          <p style={{fontSize:13,color:th.sub,marginTop:4}}>Scegli una nuova password per il tuo account.</p>
        </div>
        <div style={cardSt(th)}>
          <label style={labelSt(th)}>Nuova password</label>
          <input type="password" value={f.new1} onChange={e => setF(p => ({...p, new1: e.target.value}))} placeholder="Es. Ciao123!" style={inputSt(th)}/>
          <label style={labelSt(th)}>Conferma password</label>
          <input type="password" value={f.new2} onChange={e => setF(p => ({...p, new2: e.target.value}))} placeholder="Ripeti la password" style={inputSt(th)}/>
          {f.err && <div style={{color:th.danger,fontSize:13,marginBottom:12}}>{f.err}</div>}
          {f.ok  && <div style={{color:th.ok,fontSize:13,marginBottom:12}}>✅ Password aggiornata! Reindirizzamento...</div>}
          <button onClick={save} disabled={loading} style={{...primBtn(th),width:"100%",opacity:loading?.6:1}}>
            {loading ? "Salvataggio..." : "Salva nuova password"}
          </button>
        </div>
      </div>
    </div>
  );
}
export function LoginView({ th, onGoRegister, onRecovery }) {
  const [email, setEmail]   = useState("");
  const [pass,  setPass]    = useState("");
  const [err,   setErr]     = useState("");
  const [loading, setL]     = useState(false);
  const [step,  setStep]    = useState("login");
  const [resetEmail, setRE] = useState("");
  const [otp,   setOtp]     = useState("");

  const login = async () => {
    setErr(""); setL(true);
    const { error } = await sb.auth.signInWithPassword({ email, password: pass });
    setL(false);
    if (!error) return;
    if (error.message.toLowerCase().includes("email not confirmed"))
      setErr("📧 Devi confermare la tua email prima di accedere.");
    else if (error.message.toLowerCase().includes("invalid login"))
      setErr("Email o password errati.");
    else setErr(error.message);
  };

  const sendOtp = async () => {
    if (!resetEmail.trim()) return setErr("Inserisci la tua email.");
    setErr(""); setL(true);
    const { error } = await sb.auth.resetPasswordForEmail(resetEmail.trim());
    setL(false);
    if (error) return setErr(error.message);
    setStep("forgot_otp");
  };

  const verifyOtp = async () => {
    if (otp.trim().length < 8) return setErr("Inserisci il codice a 8 cifre.");
    setErr(""); setL(true);
    const { data, error } = await sb.auth.verifyOtp({ email: resetEmail.trim(), token: otp.trim(), type: "recovery" });
    setL(false);
    if (error) return setErr("Codice non valido o scaduto. Riprova.");
    if (data?.session) onRecovery(data.session.user);
  };

  const back = () => { setStep("login"); setErr(""); setOtp(""); };

  if (step === "forgot_email") return (
    <div style={{minHeight:"100vh",background:th.aurora,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{width:"100%",maxWidth:380}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:40,marginBottom:8}}>🔑</div>
          <h1 style={{fontSize:22,fontWeight:700,color:th.text}}>Reset password</h1>
          <p style={{fontSize:13,color:th.sub,marginTop:4}}>Riceverai un codice a 8 cifre via email.</p>
        </div>
        <div style={cardSt(th)}>
          <label style={labelSt(th)}>La tua email</label>
          <input type="email" value={resetEmail} onChange={e => setRE(e.target.value)} placeholder="la-tua@email.com" style={inputSt(th)} onKeyDown={e => e.key==="Enter" && sendOtp()}/>
          {err && <div style={{color:th.danger,fontSize:13,marginBottom:12}}>{err}</div>}
          <button onClick={sendOtp} disabled={loading} style={{...primBtn(th),width:"100%",opacity:loading?.6:1}}>{loading ? "Invio..." : "Invia codice"}</button>
        </div>
        <div style={{textAlign:"center",marginTop:16}}>
          <button onClick={back} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:th.accent,fontWeight:600}}>← Torna al login</button>
        </div>
      </div>
    </div>
  );

  if (step === "forgot_otp") return (
    <div style={{minHeight:"100vh",background:th.aurora,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{width:"100%",maxWidth:380}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:40,marginBottom:8}}>📧</div>
          <h1 style={{fontSize:22,fontWeight:700,color:th.text}}>Controlla la tua email</h1>
          <p style={{fontSize:13,color:th.sub,marginTop:4}}>Inserisci il codice a 8 cifre ricevuto su <b>{resetEmail}</b></p>
        </div>
        <div style={cardSt(th)}>
          <label style={labelSt(th)}>Codice di verifica</label>
          <input value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g,""))} placeholder="12345678" maxLength={8}
            style={{...inputSt(th),letterSpacing:8,fontSize:22,textAlign:"center"}} onKeyDown={e => e.key==="Enter" && verifyOtp()}/>
          {err && <div style={{color:th.danger,fontSize:13,marginBottom:12}}>{err}</div>}
          <button onClick={verifyOtp} disabled={loading} style={{...primBtn(th),width:"100%",opacity:loading?.6:1}}>{loading ? "Verifica..." : "Verifica codice"}</button>
          <button onClick={sendOtp} disabled={loading} style={{...btnSt(th),width:"100%",marginTop:8,fontSize:12}}>Non hai ricevuto il codice? Invia di nuovo</button>
        </div>
        <div style={{textAlign:"center",marginTop:16}}>
          <button onClick={back} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:th.accent,fontWeight:600}}>← Torna al login</button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:th.aurora,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{width:"100%",maxWidth:380}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:40,marginBottom:8}}>📅</div>
          <h1 style={{fontSize:26,fontWeight:700,color:th.text}}>Bacheca</h1>
          <p style={{fontSize:14,color:th.sub,marginTop:4}}>Accedi per continuare</p>
        </div>
        <div style={cardSt(th)}>
          <label style={labelSt(th)}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="la-tua@email.com" style={inputSt(th)}/>
          <label style={labelSt(th)}>Password</label>
          <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="••••••••" style={inputSt(th)} onKeyDown={e => e.key==="Enter" && login()}/>
          {err && <div style={{color:th.danger,fontSize:13,marginBottom:12}}>{err}</div>}
          <button onClick={login} disabled={loading} style={{...primBtn(th),width:"100%",opacity:loading?.6:1}}>{loading ? "Accesso in corso..." : "Accedi"}</button>
          <div style={{textAlign:"center",marginTop:12}}>
            <button onClick={() => { setStep("forgot_email"); setErr(""); }} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:th.sub}}>Hai dimenticato la password?</button>
          </div>
        </div>
        <div style={{textAlign:"center",marginTop:16}}>
          <span style={{fontSize:13,color:th.sub}}>Non hai un account? </span>
          <button onClick={onGoRegister} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:th.accent,fontWeight:600}}>Registrati</button>
        </div>
      </div>
    </div>
  );
}
export function RegisterView({ th, onGoLogin }) {
  const [f, setF]       = useState({ name:"", email:"", pass:"", pass2:"" });
  const [err, setErr]   = useState("");
  const [ok,  setOk]    = useState(false);
  const [loading, setL] = useState(false);

  const register = async () => {
    setErr("");
    if (!f.name.trim())  return setErr("Inserisci il tuo nome.");
    if (!f.email.trim()) return setErr("Inserisci l'email.");
    const pwErr = validatePassword(f.pass);
    if (pwErr) return setErr(pwErr);
    if (f.pass !== f.pass2) return setErr("Le password non coincidono.");
    setL(true);
    const { data: nameTaken } = await sb.rpc("is_name_taken", { check_name: f.name.trim() });
    if (nameTaken) { setL(false); return setErr("Questo nome è già in uso, scegline un altro."); }
    const { error } = await sb.auth.signUp({ email: f.email, password: f.pass, options: { data: { full_name: f.name.trim() } } });
    setL(false);
    if (error) return setErr(error.message);
    setOk(true);
  };

  if (ok) return (
    <div style={{minHeight:"100vh",background:th.aurora,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{...cardSt(th),maxWidth:380,width:"100%",textAlign:"center"}}>
        <div style={{fontSize:48,marginBottom:12}}>✅</div>
        <h2 style={{color:th.text,marginBottom:8}}>Registrazione completata!</h2>
        <p style={{fontSize:14,color:th.sub,marginBottom:20}}>Ora puoi accedere con le tue credenziali.</p>
        <button onClick={onGoLogin} style={{...primBtn(th),width:"100%"}}>Vai al login</button>
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:th.aurora,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{width:"100%",maxWidth:380}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:40,marginBottom:8}}>📅</div>
          <h1 style={{fontSize:26,fontWeight:700,color:th.text}}>Crea account</h1>
        </div>
        <div style={cardSt(th)}>
          <label style={labelSt(th)}>Nome completo</label>
          <input value={f.name} onChange={e => setF(p => ({...p, name: e.target.value}))} placeholder="Mario Rossi" style={inputSt(th)}/>
          <label style={labelSt(th)}>Email</label>
          <input type="email" value={f.email} onChange={e => setF(p => ({...p, email: e.target.value}))} placeholder="la-tua@email.com" style={inputSt(th)}/>
          <label style={labelSt(th)}>Password</label>
          <div style={{fontSize:11,color:th.sub,marginBottom:6,lineHeight:1.5}}>Min. 8 caratteri con almeno: 1 maiuscola, 1 minuscola, 1 numero e 1 carattere speciale (es. !@#$%)</div>
          <input type="password" value={f.pass} onChange={e => setF(p => ({...p, pass: e.target.value}))} placeholder="Es. Ciao123!" style={inputSt(th)}/>
          <label style={labelSt(th)}>Conferma password</label>
          <input type="password" value={f.pass2} onChange={e => setF(p => ({...p, pass2: e.target.value}))} placeholder="Ripeti la password" style={inputSt(th)}/>
          {err && <div style={{color:th.danger,fontSize:13,marginBottom:12}}>{err}</div>}
          <button onClick={register} disabled={loading} style={{...primBtn(th),width:"100%",opacity:loading?.6:1}}>{loading ? "Registrazione..." : "Crea account"}</button>
        </div>
        <div style={{textAlign:"center",marginTop:16}}>
          <span style={{fontSize:13,color:th.sub}}>Hai già un account? </span>
          <button onClick={onGoLogin} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:th.accent,fontWeight:600}}>Accedi</button>
        </div>
      </div>
    </div>
  );
}