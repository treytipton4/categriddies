/* =====================================================================
   Categriddies Online
   One page, two roles:
     - HOST  (iPad or TV): owns the game state, shows the big board.
     - PHONE (each player): joins with a room code, gives clues, guesses.
   Phones talk straight to the host through PeerJS. The host is the
   single source of truth: phones send actions, the host sends each
   phone its own view of the game back.
   ===================================================================== */

const PREFIX = "categriddies-v1-";              // keeps our room IDs apart from other PeerJS apps
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ";     // no I, L, O: easy to read aloud
const COLORS = [
  "#e5484d","#e54d2e","#f76b15","#f5a524","#ffdc00","#99d52a","#46a758","#30a46c","#12a594","#00a2c7","#4cb4e7","#0090ff",
  "#3e63dd","#6e56cf","#8e4ec6","#d6409f","#e93d82","#c2185b","#a35829","#a18072","#978365","#5b6574","#2b2e36","#111318"
];
const DEFAULT_ORDER = ["#e5484d","#0090ff","#30a46c","#f5a524","#8e4ec6","#e93d82","#12a594","#f76b15","#ffdc00","#a35829","#5b6574","#99d52a"];
const STAR_SVG = `<svg viewBox="0 0 48 48"><defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe27a"/><stop offset=".55" stop-color="#ffc21a"/><stop offset="1" stop-color="#f29a00"/></linearGradient></defs>
  <path d="M24 3.5l6.1 13.2 14.4 1.7-10.6 9.9 2.8 14.3L24 35.4l-12.7 7.2 2.8-14.3L3.5 18.4l14.4-1.7z" fill="url(#sg)" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
  <path d="M24 9.5l4.3 9.3 10.1 1.2" fill="none" stroke="#fff6cf" stroke-width="2" stroke-linecap="round" opacity=".8"/></svg>`;
Object.assign(ICONS, {
  tv2:'<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  mobile:'<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  wifi:'<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0"/><circle cx="12" cy="19.5" r=".8"/>',
});

/* ---------------- helpers ---------------- */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const rnd = n => Math.floor(Math.random()*n);
const now = () => Date.now();
const cheb = (a,b) => Math.max(Math.abs(a[0]-b[0]), Math.abs(a[1]-b[1]));
const ptsFor = d => d===0?5:d===1?3:d===2?1:0;
const key = s => s.join("|");
const pool = t => TOPICS[t].scales.concat(GENERIC);
function textOn(hex){ const n = parseInt(hex.slice(1),16), r=n>>16, g=(n>>8)&255, b=n&255; return (.299*r+.587*g+.114*b) > 168 ? "#111318" : "#ffffff"; }
const store = {
  get(k, area="local"){ try { const v = (area==="session"?sessionStorage:localStorage).getItem(k); return v ? JSON.parse(v) : null; } catch(e){ return null; } },
  set(k, v, area="local"){ try { (area==="session"?sessionStorage:localStorage).setItem(k, JSON.stringify(v)); } catch(e){} },
  del(k){ try { localStorage.removeItem(k); } catch(e){} },
};
const brand = () => `<div class="brand"><div class="mark">${[0,1,2,3,4,5,6,7,8].map(i=>`<i class="${i===2?"on":i===4?"on2":i===6?"on3":""}"></i>`).join("")}</div>Categriddies</div>`;
let toastT;
function toast(msg){ const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(()=>t.hidden = true, 2600); }
const joinUrl = code => location.origin + location.pathname + "#" + code;

/* ---------------- sound (host only) ---------------- */
let actx;
function tone(f,d=.15,type="sine",v=.1,w=0,f2){ try{actx=actx||new (window.AudioContext||window.webkitAudioContext)();const t=actx.currentTime+w,o=actx.createOscillator(),g=actx.createGain();o.type=type;o.frequency.setValueAtTime(f,t);if(f2)o.frequency.exponentialRampToValueAtTime(f2,t+d);g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.001,t+d);o.connect(g).connect(actx.destination);o.start(t);o.stop(t+d);}catch(e){} }
const sfx = {
  join: () => [660,880].forEach((f,i)=>tone(f,.14,"sine",.08,i*.08)),
  plink: () => tone(740,.09,"sine",.08),
  go: () => [523,784].forEach((f,i)=>tone(f,.2,"triangle",.08,i*.1)),
  drop: () => { tone(1400,.6,"sine",.05,0,300); tone(90,.25,"sine",.35,.63,45); [523,659,784].forEach((f,i)=>tone(f,.4,"sine",.07,.8+i*.08)); },
  win: () => [523,659,784,1047].forEach((f,i)=>tone(f,.35,"sine",.09,i*.09)),
};

/* =====================================================================
   SHARED: the grid
   ===================================================================== */
// opts: cat, target (or null), guesses [{pid,x,y,locked}], players (pid -> player),
//       mode 'plain' | 'reveal', clickable, edit (giver shuffle buttons), compact (phone), me (pid), drop, takenFor (pid allowed)
function gridHTML(o){
  const C = o.cat, T = o.target;
  const byCell = {};
  for (const g of o.guesses || []) (byCell[g.x+","+g.y] = byCell[g.x+","+g.y] || []).push(g);
  let cells = "";
  for (let y=10; y>=1; y--) for (let x=1; x<=10; x++){
    const here = byCell[x+","+y] || [];
    let cls = "cell" + ((x+y)%2 ? " alt" : ""), style = "", inner = "";
    if (o.mode === "reveal" && T){ const d = cheb([x,y],T); if (d===1) cls += " ring1"; else if (d===2) cls += " ring2"; }
    const ps = here.map(g => o.players[g.pid]).filter(Boolean);
    const label = p => o.compact ? (p.pid === o.me ? "You" : esc(p.name.slice(0,3))) : esc(p.name);
    if (ps.length === 1){
      style = `background:${ps[0].color};color:${textOn(ps[0].color)}`;
      inner = `<span class="nm ${!o.compact && ps[0].name.length>7?"long":""}">${label(ps[0])}</span>`; cls += " fill";
    } else if (ps.length > 1){
      const step = 100/ps.length;
      style = `background:linear-gradient(135deg,${ps.map((p,k)=>`${p.color} ${k*step}% ${(k+1)*step}%`).join(",")});text-shadow:0 1px 2px rgba(0,0,0,.5)`;
      inner = ps.slice(0,3).map(p=>`<span class="nm">${label(p)}</span>`).join("") + (ps.length>3?`<span class="nm">+${ps.length-3}</span>`:"");
      cls += " fill multi";
    }
    if (here.some(g => g.pid === o.me)) cls += " mine";
    if (here.some(g => g.pid === o.me && !g.locked)) cls += " tentative";
    if (o.raceBlock && here.some(g => g.pid !== o.me)) cls += " taken";
    if (T && T[0]===x && T[1]===y) cls += " tgt";
    if (o.pop && o.pop[0]===x && o.pop[1]===y) cls += " pop";
    cells += `<div class="${cls}" data-x="${x}" data-y="${y}" style="${style}">${inner}</div>`;
  }
  let star = "";
  if (T){
    const L = (T[0]-.5)*10, Tp = (10-T[1]+.5)*10, pos = `left:${L}%;top:${Tp}%`;
    const filled = (byCell[T.join()] || []).length > 0;
    const settle = filled ? "--dx:3.4cqi;--dy:-3.4cqi;--s:.55;" : "";
    star = (o.mode === "reveal" && o.drop ? `<div class="ripple go" style="${pos}"></div><div class="ripple go2" style="${pos}"></div>
        <div class="burst" style="${pos}">${[0,1,2,3,4,5,6,7].map(k=>`<i style="--a:${k*45}deg"></i>`).join("")}</div>` : "")
      + `<div class="pin ${o.drop?"drop":""}" style="${pos}${settle}">${STAR_SVG}</div>`;
  }
  const sh = id => o.edit ? `<button class="mini" data-act="${id}" aria-label="Shuffle this scale">${ic("shuffle")}</button>` : "";
  return `<div class="board-wrap ${o.mode==="reveal"?"reveal":""} ${o.mode==="reveal"&&!o.drop?"still":""}">
    <div class="ylab"><span class="edge">${esc(C.y[0])}</span>${sh("ry")}<span class="edge">${esc(C.y[1])} ↑</span></div>
    <div class="ynums">${[10,9,8,7,6,5,4,3,2,1].map(n=>`<div>${n}</div>`).join("")}</div>
    <div class="board ${o.clickable?"clickable":""}" data-board>${cells}${star}</div>
    <div class="xnums">${[1,2,3,4,5,6,7,8,9,10].map(n=>`<div>${n}</div>`).join("")}</div>
    <div class="xlab"><span class="edge">${esc(C.x[0])}</span>${sh("rx")}<span class="edge">${esc(C.x[1])} →</span></div>
  </div>`;
}
function topicHTML(t){ const T = TOPICS[t]; return `<div class="topic"><div class="ico">${ic(T.ic)}</div><h2>${esc(T.name)}</h2></div>`; }

/* =====================================================================
   HOST
   ===================================================================== */
let H = null;            // host game state (saved to localStorage)
let hostPeer = null, hostOnline = false, hostRetry = 0;
const conns = new Map(); // pid -> DataConnection
let hostTick = null, hostDrop = false, hostPop = null, kickArmed = null, wakeLock = null;

function newCode(){ let c=""; for (let i=0;i<4;i++) c += CODE_CHARS[rnd(CODE_CHARS.length)]; return c; }
function freshHost(){
  return { code:newCode(), phase:"lobby", players:[], settings:{ rounds:2, mode:"free", limit:0, pick:false },
           order:[], turn:0, total:0, cat:null, target:null, clue:"", guesses:{}, gains:null, bonus:0, deadline:null };
}
const saveHost = () => store.set("cgo.host", H);
const P = pid => H.players.find(p => p.pid === pid);
const giverPid = () => H.order.length ? H.order[H.turn % H.order.length] : null;
const nextGiverPid = () => H.order.length ? H.order[(H.turn+1) % H.order.length] : null;
const guesserPids = () => H.players.map(p=>p.pid).filter(pid => pid !== giverPid());
const isOnline = pid => conns.has(pid) && conns.get(pid).open;
const freeColor = () => DEFAULT_ORDER.concat(COLORS).find(c => !H.players.some(p=>p.color===c)) || COLORS[rnd(COLORS.length)];

function newScale(t, avoid){ const bad = new Set(avoid.filter(Boolean).map(key)); const ok = pool(t).filter(s => !bad.has(key(s))); return ok[rnd(ok.length)]; }
function newCategory(t){
  if (t === undefined){ let n; do { n = rnd(TOPICS.length); } while (H.cat && n === H.cat.t); t = n; }
  const x = newScale(t, []); H.cat = { t, x, y: newScale(t, [x]) };
}
function randomTarget(){ let t; do { t = [rnd(10)+1, rnd(10)+1]; } while (H.target && t[0]===H.target[0] && t[1]===H.target[1]); H.target = t; }

function startHosting(resume){
  if (!resume) H = freshHost();
  saveHost(); renderHost(); connectHost();
  requestWake();
}
function connectHost(){
  if (hostPeer && !hostPeer.destroyed) hostPeer.destroy();
  hostOnline = false;
  hostPeer = new Peer(PREFIX + H.code, { debug: 1 });
  hostPeer.on("open", () => { hostOnline = true; hostRetry = 0; renderHost(); });
  hostPeer.on("connection", c => {
    c.on("data", m => onHostMsg(c, m));
    c.on("close", () => dropConn(c));
    c.on("error", () => dropConn(c));
  });
  hostPeer.on("disconnected", () => { hostOnline = false; renderHost(); setTimeout(() => { try { if (hostPeer && !hostPeer.destroyed) hostPeer.reconnect(); } catch(e){} }, 1500); });
  hostPeer.on("error", e => {
    if (e.type === "unavailable-id"){
      // the room code is still held (usually our own old session after a refresh): wait and retry,
      // and if this is a brand-new lobby with nobody in it, just pick another code
      if (H.phase === "lobby" && !H.players.length){ H.code = newCode(); saveHost(); }
      hostRetry++; setTimeout(connectHost, Math.min(2000 + hostRetry*1000, 6000));
    } else if (["network","server-error","socket-error","socket-closed","disconnected"].includes(e.type)){
      hostOnline = false; renderHost(); setTimeout(connectHost, 3000);
    }
  });
}
async function requestWake(){ try { if ("wakeLock" in navigator){ wakeLock = await navigator.wakeLock.request("screen"); } } catch(e){} }
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (H && mode === "host"){ requestWake(); if (!hostOnline) connectHost(); }
  if (mode === "phone" && !phoneConnected && PH.code) phoneConnect();
});

function dropConn(c){
  if (c.pid && conns.get(c.pid) === c){ conns.delete(c.pid); hostBroadcast(); }
}
function renamePid(oldPid, newPid){
  const p = P(oldPid); if (p) p.pid = newPid;
  H.order = H.order.map(x => x === oldPid ? newPid : x);
  if (H.guesses[oldPid]){ H.guesses[newPid] = H.guesses[oldPid]; delete H.guesses[oldPid]; }
  if (H.gains && H.gains[oldPid] !== undefined){ H.gains[newPid] = H.gains[oldPid]; delete H.gains[oldPid]; }
}

function onHostMsg(c, m){
  if (!m || typeof m !== "object") return;
  if (m.t === "join"){
    const name = String(m.name || "").trim().slice(0,16);
    if (!name) return c.send({ t:"error", msg:"Type a name to join." });
    let p = P(m.pid);
    if (!p){
      // same name coming back on a new device/tab: take over that seat if it's offline
      const twin = H.players.find(q => q.name.toLowerCase() === name.toLowerCase());
      if (twin && isOnline(twin.pid)) return c.send({ t:"error", msg:`Someone named ${name} is already in this game. Pick another name.` });
      if (twin){ renamePid(twin.pid, m.pid); p = twin; }
    }
    if (!p){
      if (H.players.length >= 12) return c.send({ t:"error", msg:"This game is full (12 players)." });
      const color = m.color && COLORS.includes(m.color) && !H.players.some(q=>q.color===m.color) ? m.color : freeColor();
      p = { pid:m.pid, name, color, score:0 };
      H.players.push(p);
      if (H.phase !== "lobby") H.order.push(p.pid);   // late joiners get a clue turn at the end of the order
      sfx.join();
    }
    const old = conns.get(p.pid); if (old && old !== c) try { old.close(); } catch(e){}
    c.pid = p.pid; conns.set(p.pid, c);
    return hostBroadcast();
  }
  const pid = c.pid; const p = P(pid); if (!p) return;
  const amGiver = pid === giverPid();
  switch (m.t){
    case "color":
      if (COLORS.includes(m.color) && !H.players.some(q=>q.color===m.color && q.pid!==pid)) p.color = m.color;
      break;
    case "act":
      if (!amGiver || H.phase !== "giver") return;
      if (m.a === "rx") H.cat.x = newScale(H.cat.t,[H.cat.x,H.cat.y]);
      else if (m.a === "ry") H.cat.y = newScale(H.cat.t,[H.cat.y,H.cat.x]);
      else if (m.a === "rb"){ const ox=H.cat.x, oy=H.cat.y; H.cat.x = newScale(H.cat.t,[ox,oy]); H.cat.y = newScale(H.cat.t,[ox,oy,H.cat.x]); }
      else if (m.a === "rt") newCategory();
      else if (m.a === "topic" && TOPICS[m.v]) newCategory(+m.v);
      else if (m.a === "square") randomTarget();
      else if (m.a === "cell" && H.settings.pick && m.x>=1 && m.x<=10 && m.y>=1 && m.y<=10) H.target = [m.x, m.y];
      else if (m.a === "go"){ H.clue = String(m.clue || "").trim().slice(0,60); H.phase = "guess"; H.guesses = {};
        H.deadline = H.settings.limit ? now() + H.settings.limit*1000 : null; sfx.go(); }
      break;
    case "guess": {
      if (H.phase !== "guess" || amGiver) return;
      const x = +m.x, y = +m.y; if (!(x>=1&&x<=10&&y>=1&&y<=10)) return;
      const cur = H.guesses[pid];
      if (cur && cur.locked) return;
      if (H.settings.mode === "race"){
        if (Object.entries(H.guesses).some(([q,g]) => q!==pid && g.x===x && g.y===y)) return c.send({ t:"error", msg:"Someone already grabbed that square." });
        H.guesses[pid] = { x, y, locked:true };
      } else H.guesses[pid] = { x, y, locked:false };
      hostPop = [x,y]; sfx.plink();
      break;
    }
    case "lock":
      if (H.phase === "guess" && H.guesses[pid]) H.guesses[pid].locked = true;
      break;
    case "unlock":
      if (H.phase === "guess" && H.settings.mode === "free" && H.guesses[pid]) H.guesses[pid].locked = false;
      break;
    case "reveal":
      if (H.phase === "guess" && amGiver) return doReveal();
      break;
    case "next":
      if (H.phase === "reveal" && (pid === nextGiverPid() || amGiver)) return nextTurn();
      break;
  }
  // everyone locked in? reveal automatically after a beat
  if (H.phase === "guess"){
    const gs = guesserPids();
    if (gs.length && gs.every(q => H.guesses[q] && H.guesses[q].locked)){
      const turn = H.turn; setTimeout(() => { if (H.phase === "guess" && H.turn === turn) doReveal(); }, 900);
    }
  }
  hostBroadcast();
}

function viewFor(pid){
  const isGiver = pid === giverPid();
  const showT = H.phase === "reveal" || (isGiver && (H.phase === "giver" || H.phase === "guess"));
  const guesses = Object.entries(H.guesses)
    .filter(([q,g]) => g.locked || q === pid || H.phase === "reveal")
    .map(([q,g]) => ({ pid:q, x:g.x, y:g.y, locked:g.locked }));
  return { t:"state", code:H.code, phase:H.phase, you:pid, settings:H.settings, turn:H.turn, total:H.total,
    players:H.players.map(p => ({ pid:p.pid, name:p.name, color:p.color, score:p.score, online:isOnline(p.pid) })),
    giver:giverPid(), next:nextGiverPid(), cat:H.cat, clue:H.phase==="giver"?"":H.clue,
    target: showT ? H.target : null, guesses, gains:H.gains, bonus:H.bonus,
    left: H.deadline ? Math.max(0, H.deadline - now()) : null };
}
function hostBroadcast(){
  for (const [pid, c] of conns){ if (c.open) try { c.send(viewFor(pid)); } catch(e){} }
  saveHost(); renderHost();
}

function startGame(){
  H.order = H.players.map(p => p.pid);
  H.turn = 0; H.total = H.order.length * H.settings.rounds;
  H.players.forEach(p => p.score = 0);
  startTurn();
}
function startTurn(){
  newCategory(); H.target = null; randomTarget();
  Object.assign(H, { clue:"", guesses:{}, gains:null, bonus:0, deadline:null, phase:"giver" });
  hostBroadcast();
}
function doReveal(){
  if (H.phase !== "guess") return;
  const g = giverPid(), gains = {}; let giverPts = 0, within = 0;
  for (const [pid, gs] of Object.entries(H.guesses)){
    const p = P(pid); if (!p) continue;
    const d = cheb([gs.x,gs.y], H.target), pts = ptsFor(d);
    gains[pid] = pts; p.score += pts;
    if (d <= 1){ within++; giverPts += d === 0 ? 2 : 1; }
  }
  const need = Math.min(guesserPids().length, 9);
  H.bonus = within >= need && need > 0 ? 3 : 0;
  gains[g] = giverPts + H.bonus; const gp = P(g); if (gp) gp.score += gains[g];
  H.gains = gains; H.phase = "reveal"; H.deadline = null;
  hostDrop = true; hostBroadcast(); sfx.drop();
}
function nextTurn(){
  if (H.turn >= H.total - 1){ H.phase = "end"; hostBroadcast(); sfx.win(); confetti(H.players.map(p=>p.color)); return; }
  H.turn++; startTurn();
}

/* ---------- host rendering ---------- */
function renderHost(){
  if (mode !== "host") return;
  clearInterval(hostTick); hostTick = null;
  if (H.phase === "lobby") return renderLobby();
  if (H.phase === "end") return renderHostEnd();
  renderHostGame();
}
function statusDot(){ return `<span class="status ${hostOnline?"on":""}"><i></i>${hostOnline?"Room open":"Connecting…"}</span>`; }

function renderLobby(){
  const url = joinUrl(H.code), s = H.settings, can = H.players.length >= 3;
  let qr = "";
  try { const q = qrcode(0, "M"); q.addData(url); q.make(); qr = q.createSvgTag({ cellSize:6, margin:2, scalable:true }); } catch(e){}
  $("#app").innerHTML = `<section class="lobby">
    <div class="card joinbox">
      ${brand()}
      <div class="how">Grab your phone and go to</div>
      <div class="url">${esc(url.replace(/^https?:\/\//,"").replace(/#.*$/,""))}</div>
      <div class="how">and enter the room code</div>
      <div class="code">${H.code}</div>
      ${qr ? `<div class="qr" aria-label="QR code to join">${qr}</div><div class="muted">or scan to join</div>` : ""}
      ${statusDot()}
    </div>
    <div class="stack" style="min-width:0">
      <div class="card">
        <div class="label">Players · ${H.players.length}/12</div>
        <div class="plist">${H.players.map(p=>`<div class="pl ${isOnline(p.pid)?"":"off"}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}
          <span class="st">${isOnline(p.pid)?"Joined":"Offline"}</span>
          <button class="kick ${kickArmed===p.pid?"armed":""}" data-kick="${p.pid}" aria-label="Remove ${esc(p.name)}">${ic("x")}</button></div>`).join("")
          || `<div class="empty">Waiting for players to join…</div>`}</div>
      </div>
      <div class="card">
        <div class="label">Settings</div>
        <div class="toggle"><div><b>Turns per player</b><small>How many times each person gives a clue.</small></div>
          <select id="rounds">${[1,2,3].map(n=>`<option value="${n}" ${s.rounds==n?"selected":""}>${n}</option>`).join("")}</select></div>
        <div class="toggle"><div><b>Guessing style</b><small>${s.mode==="race"?"Race: first to tap a square gets it, and taps lock in instantly.":"Free-for-all: share squares, change your mind, then lock in."}</small></div>
          <div class="seg"><button data-mode="free" class="${s.mode==="free"?"on":""}">Free-for-all</button><button data-mode="race" class="${s.mode==="race"?"on":""}">Race</button></div></div>
        <div class="toggle"><div><b>Guess timer</b><small>Reveal automatically when time runs out.</small></div>
          <select id="limit">${[[0,"Off"],[20,"20s"],[30,"30s"],[45,"45s"],[60,"60s"]].map(([v,l])=>`<option value="${v}" ${s.limit==v?"selected":""}>${l}</option>`).join("")}</select></div>
        <div class="toggle"><div><b>Clue giver picks the square</b><small>Off: random square, which they can re-roll.</small></div>
          <label class="sw"><input type="checkbox" id="pick" ${s.pick?"checked":""}><span></span></label></div>
      </div>
      <button class="btn primary lg block" id="start" ${can?"":"disabled"}>${can?`Start game with ${H.players.length} players`:"Need at least 3 players"} ${ic("arrowr")}</button>
      <button class="btn block" id="endhost">Close this room</button>
    </div>
  </section>`;
  $$("[data-kick]").forEach(b => b.onclick = () => {
    const pid = b.dataset.kick;
    if (kickArmed !== pid){ kickArmed = pid; renderLobby(); setTimeout(()=>{ if (kickArmed===pid){ kickArmed=null; renderLobby(); } }, 3000); return; }
    kickArmed = null; const c = conns.get(pid); if (c) { try { c.send({ t:"kicked" }); } catch(e){} setTimeout(()=>{ try{c.close()}catch(e){} }, 200); conns.delete(pid); }
    H.players = H.players.filter(p => p.pid !== pid); hostBroadcast();
  });
  $("#rounds").onchange = e => { s.rounds = +e.target.value; hostBroadcast(); };
  $("#limit").onchange = e => { s.limit = +e.target.value; hostBroadcast(); };
  $("#pick").onchange = e => { s.pick = e.target.checked; hostBroadcast(); };
  $$("[data-mode]").forEach(b => b.onclick = () => { s.mode = b.dataset.mode; hostBroadcast(); });
  $("#start").onclick = () => { tone(1,.01); startGame(); };
  armTwoTap($("#endhost"), "Tap again to close the room", () => { try { hostPeer.destroy(); } catch(e){} store.del("cgo.host"); H = null; mode = "landing"; renderLanding(); });
}

function armTwoTap(btn, armedText, fn){
  if (!btn) return;
  btn.onclick = () => {
    if (btn.dataset.armed) return fn();
    btn.dataset.armed = "1"; const old = btn.innerHTML; btn.textContent = armedText; btn.classList.add("primary");
    setTimeout(() => { if (btn.isConnected){ delete btn.dataset.armed; btn.innerHTML = old; btn.classList.remove("primary"); } }, 3000);
  };
}

function hostStandings(){
  const g = giverPid();
  const order = H.players.slice().sort((a,b)=>b.score-a.score);
  return `<div class="card"><div class="label">Standings</div>
    ${order.map((p,k)=>`<div class="sr ${isOnline(p.pid)?"":"off"}"><div class="rk">${k+1}</div><span class="dot" style="background:${p.color}"></span>
      <div class="nm">${esc(p.name)}${p.pid===g?`<small>clue giver</small>`:""}${isOnline(p.pid)?"":`<small>offline</small>`}</div>
      <div class="gain">${H.phase==="reveal" && H.gains && H.gains[p.pid] ? "+"+H.gains[p.pid] : ""}</div><div class="sc">${p.score}</div></div>`).join("")}
  </div>`;
}

function renderHostGame(){
  const g = giverPid(), G = P(g) || { name:"?", color:"#999" }, ph = H.phase;
  const players = Object.fromEntries(H.players.map(p => [p.pid, p]));
  const shown = Object.entries(H.guesses).filter(([,x]) => x.locked || ph === "reveal").map(([pid,x]) => ({ pid, x:x.x, y:x.y, locked:true }));
  let head, side;
  if (ph === "giver"){
    head = `<div class="waiting"><span class="dot" style="width:12px;height:12px;border-radius:4px;background:${G.color}"></span>${esc(G.name)} is picking a clue <span class="dots"><i></i><i></i><i></i></span></div>`;
    side = `<div class="card"><div class="label">Clue giver</div>
      <p style="margin:0 0 12px;font-size:1.05rem"><b>${esc(G.name)}</b> sees the secret square on their phone. The topic and scales change here as they shuffle.</p>
      ${isOnline(g) ? "" : `<p class="conn">${ic("wifi")} ${esc(G.name)} is offline</p>`}
      <button class="btn block" id="skip">Skip ${esc(G.name)}’s turn</button></div>`;
  } else if (ph === "guess"){
    head = H.clue ? `<div class="clue"><small>Clue</small><div class="t">${esc(H.clue)}</div></div>`
                  : `<div class="waiting">${esc(G.name)} is saying the clue out loud</div>`;
    const gs = guesserPids(), done = gs.filter(q => H.guesses[q] && H.guesses[q].locked).length;
    side = `<div class="card">
      <div class="row" style="justify-content:space-between;margin-bottom:10px"><div class="label" style="margin:0">Locked in · ${done}/${gs.length}</div>${H.deadline?`<div class="timer" id="htimer"></div>`:""}</div>
      <div class="plist">${gs.map(q => { const p = P(q), gg = H.guesses[q];
        return `<div class="pl ${isOnline(q)?"":"off"}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}<span class="st">${gg&&gg.locked?`<span class="badge ok">Locked</span>`:gg?"Deciding…":"Thinking…"}</span></div>`; }).join("")}</div>
      <button class="btn primary lg block" id="reveal" style="margin-top:12px" ${done?"":"disabled"}>Drop the star ${done<gs.length?`(${done}/${gs.length})`:""}</button></div>`;
  } else {
    head = H.clue ? `<div class="clue"><small>Clue</small><div class="t">${esc(H.clue)}</div></div>` : "";
    const rows = guesserPids().map((q,k) => { const p = P(q), gg = H.guesses[q], d = gg ? cheb([gg.x,gg.y],H.target) : null;
      const b = d===0?`<span class="badge b0">Exact</span>`:d===1?`<span class="badge b1">1 away</span>`:d===2?`<span class="badge b2">2 away</span>`:`<span class="badge">${gg?"Miss":"No guess"}</span>`;
      return `<div class="sr" style="animation-delay:${.95+k*.07}s"><div></div><span class="dot" style="background:${p.color}"></span><div class="nm">${esc(p.name)}</div>${b}<div class="sc" style="color:${H.gains[q]?"var(--ok)":"var(--faint)"}">+${H.gains[q]||0}</div></div>`; }).join("");
    const base = (H.gains[g]||0) - H.bonus, nx = P(nextGiverPid()), last = H.turn >= H.total-1;
    side = `<div class="card res"><div class="label">The answer · ${H.target[0]}, ${H.target[1]}</div>${rows}
      <div class="sr" style="animation-delay:${.95+guesserPids().length*.07}s"><div></div><span class="dot" style="background:${G.color}"></span><div class="nm">${esc(G.name)}<small>clue giver</small></div>
        <span>${H.bonus?`<span class="badge bonus">Bonus +${H.bonus}</span> `:""}<span class="badge">${base} close</span></span><div class="sc" style="color:${H.gains[g]?"var(--ok)":"var(--faint)"}">+${H.gains[g]||0}</div></div>
      <button class="btn primary lg block" id="next" style="margin-top:14px">${last?"Final results":`Next: ${esc(nx?nx.name:"")} gives a clue`} ${ic("arrowr")}</button></div>`;
  }
  const pct = Math.round((H.turn + (ph==="reveal"?1:0)) / Math.max(1,H.total) * 100);
  $("#app").innerHTML = `<section id="game">
    <div class="card main">
      <div class="cathead">${topicHTML(H.cat.t)}${head}</div>
      <div class="board-area">${gridHTML({ cat:H.cat, target: ph==="reveal" ? H.target : null, guesses:shown, players, mode: ph==="reveal"?"reveal":"plain", drop:hostDrop, pop:hostPop })}</div>
    </div>
    <div class="side">
      <div class="card joinchip"><div><small>Join on your phone · ${esc(location.host + location.pathname)}</small><div class="c">${H.code}</div></div>${statusDot()}</div>
      <div class="row" style="font-weight:600;color:var(--muted);font-size:.85rem;padding:0 2px">Turn ${Math.min(H.turn+1,H.total)} of ${H.total}
        <div style="flex:1;height:5px;border-radius:9px;background:#e1e1dc;overflow:hidden"><i style="display:block;height:100%;width:${pct}%;background:var(--ink)"></i></div></div>
      ${side}${hostStandings()}
      <button class="btn sm" id="tolobby">${ic("x")} End game</button>
    </div>
  </section>`;
  hostDrop = false; hostPop = null;
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on("#reveal", doReveal);
  on("#next", nextTurn);
  armTwoTap($("#skip"), "Tap again to skip", () => nextTurn());
  armTwoTap($("#tolobby"), "Tap again to end the game", () => { H.phase = "lobby"; H.players.forEach(p=>p.score=0); hostBroadcast(); });
  if (ph === "guess" && H.deadline){
    const tickFn = () => { const left = Math.max(0, H.deadline - now()), el = $("#htimer");
      if (el){ el.textContent = Math.ceil(left/1000) + "s"; el.classList.toggle("low", left < 6000); }
      if (left <= 0 && H.phase === "guess"){ clearInterval(hostTick); doReveal(); } };
    tickFn(); hostTick = setInterval(tickFn, 250);
  }
}

function renderHostEnd(){
  const order = H.players.slice().sort((a,b)=>b.score-a.score);
  const tied = order.filter(p => p.score === order[0].score);
  const pod = (p,h,m) => p ? `<div class="pod"><div class="n">${esc(p.name)}</div><div class="s">${p.score}</div><div class="b" style="height:${h}px;background:${p.color};color:${textOn(p.color)}">${m}</div></div>` : "";
  $("#app").innerHTML = `<section class="landing" style="text-align:center;max-width:820px">
    <div style="display:flex;justify-content:center">${brand()}</div>
    <div class="label" style="margin-top:30px">Final results</div>
    <h1 style="font-size:clamp(2rem,6vw,3.2rem);margin:0">${tied.length>1?`Tie: ${tied.map(p=>esc(p.name)).join(" & ")}`:`${esc(order[0].name)} wins`}</h1>
    <div class="podium">${pod(order[1],130,"2")}${pod(order[0],190,"1")}${pod(order[2],95,"3")}</div>
    ${order.length>3?`<div class="card" style="max-width:420px;margin:0 auto;text-align:left">${order.slice(3).map((p,k)=>`<div class="sr"><div class="rk">${k+4}</div><span class="dot" style="background:${p.color}"></span><div class="nm">${esc(p.name)}</div><div></div><div class="sc">${p.score}</div></div>`).join("")}</div>`:""}
    <div class="row" style="justify-content:center;margin-top:26px"><button class="btn primary lg" id="again">Play again</button><button class="btn lg" id="lobbyb">Back to lobby</button></div>
  </section>`;
  $("#again").onclick = startGame;
  $("#lobbyb").onclick = () => { H.phase = "lobby"; H.players.forEach(p=>p.score=0); hostBroadcast(); };
}
function confetti(colors){
  for (let i=0;i<90;i++){ const c=document.createElement("div"); c.className="confetti"; c.style.left=Math.random()*100+"vw"; c.style.background=colors[i%colors.length]||"#f5b301";
    c.style.animationDuration=2.6+Math.random()*2.4+"s"; c.style.animationDelay=Math.random()*1.2+"s"; document.body.appendChild(c); setTimeout(()=>c.remove(),7000); }
}

/* =====================================================================
   PHONE
   ===================================================================== */
const PH = {
  pid: store.get("cgo.pid","session") || (() => { const id = "p" + Math.random().toString(36).slice(2,10); store.set("cgo.pid", id, "session"); return id; })(),
  name: store.get("cgo.name") || "", color: store.get("cgo.color") || null, code: "",
};
let V = null;                    // last view from the host
let phonePeer = null, phoneConn = null, phoneConnected = false, everJoined = false, phoneRetryT = null, joinTimeout = null;
let phoneKey = "", localDeadline = null, phoneTick = null, clueDraft = "", lastPhase = "";

function phoneConnect(){
  clearTimeout(phoneRetryT);
  const open = () => {
    try { if (phoneConn) phoneConn.close(); } catch(e){}
    phoneConn = phonePeer.connect(PREFIX + PH.code, { reliable:true });
    clearTimeout(joinTimeout);
    joinTimeout = setTimeout(() => { if (!phoneConnected) retryOrFail(); }, 9000);
    phoneConn.on("open", () => {
      phoneConnected = true; clearTimeout(joinTimeout);
      phoneConn.send({ t:"join", pid:PH.pid, name:PH.name, color:PH.color });
    });
    phoneConn.on("data", onPhoneMsg);
    phoneConn.on("close", () => { phoneConnected = false; renderPhone(true); scheduleRetry(); });
    phoneConn.on("error", () => {});
  };
  if (!phonePeer || phonePeer.destroyed){
    phonePeer = new Peer({ debug: 1 });
    phonePeer.on("open", open);
    phonePeer.on("disconnected", () => { try { phonePeer.reconnect(); } catch(e){} });
    phonePeer.on("error", e => { if (e.type === "peer-unavailable") retryOrFail(); else scheduleRetry(); });
  } else if (phonePeer.open) open();
  else { try { phonePeer.reconnect(); } catch(e){} }
}
function retryOrFail(){
  if (!everJoined){ mode = "join"; renderJoin(`No game found with code ${PH.code}. Check the code on the big screen.`); return; }
  scheduleRetry();
}
function scheduleRetry(){ clearTimeout(phoneRetryT); phoneRetryT = setTimeout(() => { if (!phoneConnected && mode === "phone") phoneConnect(); }, 2500); }
const psend = m => { if (phoneConn && phoneConn.open) phoneConn.send(m); else toast("Reconnecting… try again in a moment"); };

function onPhoneMsg(m){
  if (!m) return;
  if (m.t === "error"){ if (!everJoined){ mode = "join"; phoneConnected = false; try{phoneConn.close()}catch(e){} renderJoin(m.msg); } else toast(m.msg); return; }
  if (m.t === "kicked"){ everJoined = false; mode = "join"; try{phoneConn.close()}catch(e){} renderJoin("The host removed you from this game."); return; }
  if (m.t === "state"){
    everJoined = true; mode = "phone";
    if (V && V.phase === "guess" && m.phase === "reveal") PH.justRevealed = true;
    V = m;
    localDeadline = m.left !== null ? now() + m.left : null;
    const me = V.players.find(p => p.pid === V.you); if (me){ PH.color = me.color; store.set("cgo.color", me.color); }
    store.set("cgo.code", V.code);
    renderPhone();
  }
}

/* ---------- join screen ---------- */
function renderJoin(err){
  mode = "join";
  const code = PH.code || (location.hash.slice(1).toUpperCase().replace(/[^A-Z]/g,"").slice(0,4)) || "";
  $("#app").innerHTML = `<section class="phone">
    <div class="hero">${brand()}<p style="margin-top:10px">Join the game on the big screen.</p></div>
    <form class="card stack" id="joinf">
      <label class="stack" style="gap:6px"><span class="label" style="margin:0">Room code</span>
        <input type="text" id="code" value="${esc(code)}" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" style="font-family:var(--display);font-weight:800;font-size:1.8rem;letter-spacing:.2em;text-transform:uppercase;text-align:center"></label>
      <label class="stack" style="gap:6px"><span class="label" style="margin:0">Your name</span>
        <input type="text" id="name" value="${esc(PH.name)}" maxlength="16" autocomplete="nickname" placeholder="Name"></label>
      ${err ? `<p class="conn" style="margin:0">${esc(err)}</p>` : ""}
      <button class="btn primary lg block" id="joinb">Join game ${ic("arrowr")}</button>
    </form>
    <button class="btn block" id="back">Back</button>
  </section>`;
  $("#joinf").onsubmit = e => {
    e.preventDefault();
    const c = $("#code").value.toUpperCase().replace(/[^A-Z]/g,""), n = $("#name").value.trim();
    if (c.length !== 4) return toast("Room codes are 4 letters.");
    if (!n) return toast("Type your name.");
    PH.code = c; PH.name = n; store.set("cgo.name", n);
    $("#joinb").disabled = true; $("#joinb").textContent = "Joining…";
    everJoined = false; mode = "phone"; phoneConnect();
  };
  $("#back").onclick = () => { history.replaceState(null, "", location.pathname); renderLanding(); };
}

/* ---------- phone game ---------- */
function renderPhone(connChanged){
  if (mode !== "phone" || !V) return;
  const me = V.players.find(p => p.pid === V.you) || { name:PH.name, color:"#999", score:0 };
  const isGiver = V.giver === V.you;
  const role = V.phase === "lobby" || V.phase === "end" ? "" : isGiver ? "giver" : "guesser";
  const k = [V.phase, V.turn, role, V.code].join("|");
  const header = `<div class="phead"><div class="me"><span class="dot" style="background:${me.color}"></span><span>${esc(me.name)}</span></div>
      ${phoneConnected ? `<div class="pscore">${me.score} pts</div>` : `<div class="conn">${ic("wifi")} Reconnecting…</div>`}</div>`;
  if (k !== phoneKey){
    // build the screen shell; later updates only patch the parts that change (keeps the clue box focused)
    phoneKey = k;
    $("#app").innerHTML = `<section class="phone"><div id="ph-head"></div><div id="ph-body" class="stack"></div></section>`;
    shellFor(role);
  }
  patch("#ph-head", header);
  updatePhone(role, me, isGiver);
  if (PH.justRevealed) PH.justRevealed = false;
}
const patch = (sel, html) => { const el = $(sel); if (el && el.innerHTML !== html) el.innerHTML = html; };
const playersMap = () => Object.fromEntries(V.players.map(p => [p.pid, p]));

function shellFor(role){
  const b = $("#ph-body"), ph = V.phase;
  clearInterval(phoneTick); phoneTick = null;
  if (ph === "lobby"){
    b.innerHTML = `<div class="card hero" style="padding:20px"><div class="label">Room ${esc(V.code)}</div><h1>You’re in</h1><p>Waiting for the host to start the game.</p></div>
      <div class="card"><div class="label">Your color</div><div class="palette" id="pal"></div></div>
      <div class="card"><div class="label">Players</div><div class="plist" id="plist"></div></div>`;
    return;
  }
  if (ph === "end"){
    b.innerHTML = `<div class="card result" id="endbox"></div><div class="card" id="stand"></div>`;
    return;
  }
  if (ph === "giver" && role === "giver"){
    clueDraft = "";
    b.innerHTML = `<div class="card" style="padding:14px"><div class="label">You’re the clue giver</div><div id="g-cat"></div></div>
      <div class="card" style="padding:12px 10px"><div id="g-grid"></div>
        <p class="muted" style="font-size:.85rem;margin:10px 4px 0" id="g-hint"></p></div>
      <div class="card stack">
        <div class="rr">
          <button class="btn sm" data-act="rb">${ic("shuffle")} Both scales</button>
          <button class="btn sm" data-act="rt">${ic("dice")} New topic</button>
          <button class="btn sm" data-act="square" style="grid-column:1/-1">${ic("target")} New random square</button>
        </div>
        <select id="tsel"></select>
        <input type="text" id="clue" maxlength="60" placeholder="Type your clue (or say it out loud)">
        <button class="btn primary lg block" id="go">Send clue &amp; start guessing</button>
      </div>`;
    $("#clue").oninput = e => clueDraft = e.target.value;
    $("#go").onclick = () => psend({ t:"act", a:"go", clue: clueDraft });
    $("#tsel").onchange = e => psend({ t:"act", a:"topic", v:+e.target.value });
    $("#ph-body").addEventListener("click", e => {
      const a = e.target.closest("[data-act]"); if (a){ psend({ t:"act", a:a.dataset.act }); return; }
      const c = e.target.closest(".cell"); if (c && V.settings.pick) psend({ t:"act", a:"cell", x:+c.dataset.x, y:+c.dataset.y });
    });
    return;
  }
  if (ph === "giver"){
    b.innerHTML = `<div class="card hero" style="padding:20px"><div class="label">Get ready</div><h1 id="w-name"></h1><p>is picking a clue <span class="dots"><i></i><i></i><i></i></span></p></div>
      <div class="card"><div class="label">Category so far</div><div id="w-cat"></div></div>`;
    return;
  }
  if (ph === "guess" && role === "giver"){
    b.innerHTML = `<div class="card" style="padding:14px"><div class="label">Your clue is out</div><div id="gg-clue" class="big-clue"></div></div>
      <div class="card" style="padding:12px 10px"><div id="gg-grid"></div></div>
      <div class="card"><div class="row" style="justify-content:space-between"><div class="label" style="margin:0" id="gg-count"></div><div class="timer" id="ptimer"></div></div>
        <button class="btn primary lg block" id="rev" style="margin-top:12px">Drop the star now</button></div>`;
    $("#rev").onclick = () => psend({ t:"reveal" });
    startPhoneTimer();
    return;
  }
  if (ph === "guess"){
    b.innerHTML = `<div class="card" style="padding:14px"><div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:nowrap">
        <div style="min-width:0"><div class="label" id="q-who"></div><div id="q-clue" class="big-clue" style="text-align:left"></div></div><div class="timer" id="ptimer"></div></div></div>
      <div class="card" style="padding:12px 10px"><div id="q-grid"></div></div>
      <div id="q-act"></div>`;
    $("#ph-body").addEventListener("click", e => {
      const c = e.target.closest(".cell");
      if (c){
        const mine = V.guesses.find(g => g.pid === V.you);
        if (mine && mine.locked) return toast(V.settings.mode === "race" ? "Your square is locked in." : "Tap Change to move your guess.");
        if (c.classList.contains("taken")) return toast("Someone already grabbed that square.");
        psend({ t:"guess", x:+c.dataset.x, y:+c.dataset.y }); return;
      }
      if (e.target.closest("#lockb")) psend({ t:"lock" });
      if (e.target.closest("#unlockb")) psend({ t:"unlock" });
    });
    startPhoneTimer();
    return;
  }
  if (ph === "reveal"){
    b.innerHTML = `<div class="card result" id="r-box"></div><div class="card" style="padding:12px 10px"><div id="r-grid"></div></div><div id="r-next"></div><div class="card" id="stand"></div>`;
    $("#ph-body").addEventListener("click", e => { if (e.target.closest("#nextb")) psend({ t:"next" }); });
  }
}

function startPhoneTimer(){
  clearInterval(phoneTick);
  const f = () => { const el = $("#ptimer"); if (!el) return;
    if (!localDeadline){ el.textContent = ""; return; }
    const left = Math.max(0, localDeadline - now()); el.textContent = Math.ceil(left/1000) + "s"; el.classList.toggle("low", left < 6000); };
  f(); phoneTick = setInterval(f, 250);
}

function standingsHTML(){
  const order = V.players.slice().sort((a,b)=>b.score-a.score);
  return `<div class="label">Standings</div>` + order.map((p,k)=>`<div class="sr ${p.online?"":"off"}"><div class="rk">${k+1}</div><span class="dot" style="background:${p.color}"></span>
    <div class="nm">${esc(p.name)}${p.pid===V.you?"<small>you</small>":""}</div><div class="gain">${V.phase==="reveal"&&V.gains&&V.gains[p.pid]?"+"+V.gains[p.pid]:""}</div><div class="sc">${p.score}</div></div>`).join("");
}
const catMini = () => `${topicHTML(V.cat.t)}<div class="cat-mini" style="margin-top:10px">
  <div class="axis x">${ic("h")}${esc(V.cat.x[0])} → ${esc(V.cat.x[1])}</div><div class="axis y">${ic("v")}${esc(V.cat.y[0])} → ${esc(V.cat.y[1])}</div></div>`;

function updatePhone(role, me, isGiver){
  const ph = V.phase, players = playersMap(), G = players[V.giver] || { name:"" };
  if (ph === "lobby"){
    const taken = new Set(V.players.filter(p=>p.pid!==V.you).map(p=>p.color));
    patch("#pal", COLORS.map(c => `<button data-c="${c}" class="${c===me.color?"cur":""} ${taken.has(c)?"used":""}" style="background:${c}" aria-label="Color ${c}"></button>`).join(""));
    $$("#pal [data-c]").forEach(b => b.onclick = () => { if (!b.classList.contains("used")) psend({ t:"color", color:b.dataset.c }); });
    patch("#plist", V.players.map(p => `<div class="pl ${p.online?"":"off"}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${p.pid===V.you?`<span class="st">you</span>`:""}</div>`).join(""));
    return;
  }
  if (ph === "end"){
    const order = V.players.slice().sort((a,b)=>b.score-a.score), rank = order.findIndex(p=>p.pid===V.you) + 1;
    patch("#endbox", `<div class="label">Final results</div><div class="pts">#${rank}</div><p class="muted">${me.score} points · ${esc(order[0].name)} wins</p>`);
    patch("#stand", standingsHTML());
    return;
  }
  if (ph === "giver" && role === "giver"){
    patch("#g-cat", catMini());
    patch("#g-grid", gridHTML({ cat:V.cat, target:V.target, guesses:[], players, mode:"plain", compact:true, edit:true, clickable:V.settings.pick }));
    patch("#g-hint", `Your secret square is <b>${V.target[0]}, ${V.target[1]}</b>.${V.settings.pick?" Tap the grid to move it.":""} Shuffle a scale with the buttons on the edges.`);
    const ts = $("#tsel"); const opts = TOPICS.map((t,i)=>`<option value="${i}" ${i===V.cat.t?"selected":""}>${esc(t.name)}</option>`).join("");
    if (ts && ts.dataset.t !== String(V.cat.t)){ ts.innerHTML = opts; ts.dataset.t = String(V.cat.t); }
    return;
  }
  if (ph === "giver"){
    patch("#w-name", `<span style="color:${G.color}">${esc(G.name)}</span>`);
    patch("#w-cat", catMini());
    return;
  }
  if (ph === "guess" && role === "giver"){
    const gs = V.players.filter(p => p.pid !== V.you), locked = V.guesses.filter(g => g.locked).length;
    patch("#gg-clue", V.clue ? esc(V.clue) : `<span class="muted" style="font-size:1rem">Say your clue out loud</span>`);
    patch("#gg-grid", gridHTML({ cat:V.cat, target:V.target, guesses:V.guesses, players, mode:"plain", compact:true }));
    patch("#gg-count", `Locked in · ${locked}/${gs.length}`);
    return;
  }
  if (ph === "guess"){
    const mine = V.guesses.find(g => g.pid === V.you), race = V.settings.mode === "race";
    patch("#q-who", `Clue from ${esc(G.name)}`);
    patch("#q-clue", V.clue ? esc(V.clue) : `<span class="muted" style="font-size:1rem">Listen for the clue</span>`);
    patch("#q-grid", gridHTML({ cat:V.cat, target:null, guesses:V.guesses, players, me:V.you, mode:"plain", compact:true, clickable:!(mine&&mine.locked), raceBlock:race }));
    let act;
    if (race) act = mine ? `<div class="card"><span class="badge ok">${ic("check")} Locked in at ${mine.x}, ${mine.y}</span><p class="muted" style="margin:8px 0 0">Waiting for the others.</p></div>`
                         : `<div class="card"><b>Race mode.</b> <span class="muted">Your first tap locks in. Grabbed squares are blocked.</span></div>`;
    else if (!mine) act = `<div class="card muted">Tap a square on the grid to place your guess.</div>`;
    else if (!mine.locked) act = `<button class="btn primary lg block" id="lockb">${ic("check")} Lock in ${mine.x}, ${mine.y}</button>`;
    else act = `<div class="card row" style="justify-content:space-between"><span class="badge ok">${ic("check")} Locked in at ${mine.x}, ${mine.y}</span><button class="btn sm" id="unlockb">Change</button></div>`;
    patch("#q-act", act);
    return;
  }
  if (ph === "reveal"){
    const mine = V.guesses.find(g => g.pid === V.you), gain = (V.gains && V.gains[V.you]) || 0;
    let line;
    if (isGiver) line = `${V.bonus ? `Includes a +${V.bonus} bonus. ` : ""}You earned points for guesses close to your square.`;
    else if (!mine) line = "You didn’t place a guess.";
    else { const d = cheb([mine.x,mine.y], V.target); line = d===0 ? "Exact square!" : d===1 ? "One square away." : d===2 ? "Two squares away." : "Not close this time."; }
    patch("#r-box", `<div class="label">Answer ${V.target[0]}, ${V.target[1]}</div><div class="pts" style="color:${gain?"var(--ok)":"var(--faint)"}">+${gain}</div><p class="muted" style="margin:6px 0 0">${line}</p>`);
    const rg = $("#r-grid");
    if (rg && !rg.dataset.done){ rg.innerHTML = gridHTML({ cat:V.cat, target:V.target, guesses:V.guesses, players, me:V.you, mode:"reveal", compact:true, drop:true }); rg.dataset.done = "1"; }
    const last = V.turn >= V.total - 1, nx = players[V.next];
    patch("#r-next", V.next === V.you || isGiver
      ? `<button class="btn primary lg block" id="nextb">${last ? "Show final results" : V.next === V.you ? "Start my turn as clue giver" : `Next: ${esc(nx?nx.name:"")}`} ${ic("arrowr")}</button>`
      : `<div class="card muted" style="text-align:center">${last ? "Final results are coming up." : `${esc(nx?nx.name:"")} gives the next clue.`}</div>`);
    patch("#stand", standingsHTML());
  }
}

/* =====================================================================
   LANDING
   ===================================================================== */
let mode = "landing";   // landing | host | join | phone
function renderLanding(){
  mode = "landing";
  const saved = store.get("cgo.host");
  $("#app").innerHTML = `<section class="landing">
    ${brand()}
    <p class="lead">The big screen shows the board. Everyone plays from their own phone.</p>
    <div class="choices">
      <button class="choice" id="hostb"><div class="ic">${ic("tv2")}</div><b>Host on this screen</b><span>Use the iPad or TV everyone can see. It shows the room code and the board.</span></button>
      <button class="choice" id="joinb2"><div class="ic">${ic("mobile")}</div><b>Join with a code</b><span>On your phone. Type the 4-letter code from the big screen.</span></button>
    </div>
    ${saved && saved.players && saved.players.length ? `<div class="card row" style="margin-top:16px;justify-content:space-between"><div><b>Room ${esc(saved.code)}</b> <span class="muted">· ${saved.players.length} players${saved.phase!=="lobby"?" · game in progress":""}</span></div><button class="btn primary" id="resume">Resume hosting</button></div>` : ""}
  </section>`;
  $("#hostb").onclick = () => { mode = "host"; tone(1,.01); startHosting(false); };
  $("#joinb2").onclick = () => renderJoin();
  const r = $("#resume"); if (r) r.onclick = () => { H = saved; mode = "host"; tone(1,.01); startHosting(true); };
}

/* ---------------- boot ---------------- */
(function boot(){
  if (typeof Peer === "undefined"){
    $("#app").innerHTML = `<section class="landing"><div style="display:flex;justify-content:center">${brand()}</div><p class="lead">Couldn’t load the connection library. Check that this device is online, then reload the page.</p></section>`;
    return;
  }
  const hashCode = location.hash.slice(1).toUpperCase().replace(/[^A-Z]/g,"");
  if (hashCode.length === 4){ PH.code = hashCode; return renderJoin(); }
  renderLanding();
})();
