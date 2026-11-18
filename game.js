/* =====================================================================
   Categriddies Online
   One page, three ways in:
     - Big-screen host (iPad or TV): owns the game, shows the board.
     - Host and play (a phone): owns the game AND plays on the same phone.
     - Join (a phone): connects to the host with a room code.
   Phones talk straight to the host through PeerJS. The host is the single
   source of truth: phones send actions, the host sends each phone its own
   view of the game. A host-and-play phone talks to its own host in memory.

   Game types
     Classic: one clue giver per turn, everyone else votes where the clue lands.
     Plot It: everyone names something for the category and places it, then
              everyone votes for the best-placed answer.
   ===================================================================== */

const PREFIX = "categriddies-v1-";
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ";
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

// ---- tunable rules ----
const RULES = {
  classic: { exact:5, one:3, two:1, giverPer:1, giverExact:2, giverBonus:3, betWin:1 },
  plot:    { perVote:2, nailed:3, pickedWinner:1 },
  pvoteSeconds: 45,
};
const GAME_LABEL = { classic:"Classic", plot:"Plot It" };
const VOTE_INFO = {
  open:   ["Open",   "Share squares and see everyone’s votes live."],
  claim:  ["Claim",  "One player per square. See votes live, and move to any free square."],
  secret: ["Secret", "Votes stay hidden until the star drops. Squares can be shared."],
};

/* ---------------- helpers ---------------- */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const rnd = n => Math.floor(Math.random()*n);
const now = () => Date.now();
const cheb = (a,b) => Math.max(Math.abs(a[0]-b[0]), Math.abs(a[1]-b[1]));
const key = s => s.join("|");
const shuffle = a => { a = a.slice(); for (let i=a.length-1;i>0;i--){ const j=rnd(i+1); [a[i],a[j]]=[a[j],a[i]]; } return a; };
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
const shortUrl = () => (location.host + location.pathname).replace(/index\.html$/,"");
const patch = (sel, html) => { const el = $(sel); if (el && el.innerHTML !== html) el.innerHTML = html; };
const secs = ms => Math.max(0, Math.ceil(ms/1000));
function qrSvg(text){ try { const q = qrcode(0, "M"); q.addData(text); q.make(); return q.createSvgTag({ cellSize:6, margin:2, scalable:true }); } catch(e){ return ""; } }
function armTwoTap(btn, armedText, fn){
  if (!btn || btn.dataset.wired) return; btn.dataset.wired = "1";
  btn.addEventListener("click", () => {
    if (btn.dataset.armed) return fn();
    btn.dataset.armed = "1"; const old = btn.innerHTML; btn.textContent = armedText; btn.classList.add("danger");
    setTimeout(() => { if (btn.isConnected){ delete btn.dataset.armed; btn.innerHTML = old; btn.classList.remove("danger"); } }, 3000);
  });
}
function chipFor(p, cls=""){ return `<span class="pchip ${cls}" style="background:${p.color};color:${textOn(p.color)}">${avSvg(p.av)}</span>`; }

/* ---------------- sound (host device only) ---------------- */
let actx;
function tone(f,d=.15,type="sine",v=.1,w=0,f2){ try{actx=actx||new (window.AudioContext||window.webkitAudioContext)();const t=actx.currentTime+w,o=actx.createOscillator(),g=actx.createGain();o.type=type;o.frequency.setValueAtTime(f,t);if(f2)o.frequency.exponentialRampToValueAtTime(f2,t+d);g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.001,t+d);o.connect(g).connect(actx.destination);o.start(t);o.stop(t+d);}catch(e){} }
const sfx = {
  join: () => [660,880].forEach((f,i)=>tone(f,.14,"sine",.08,i*.08)),
  plink: () => tone(740,.09,"sine",.07),
  go: () => [523,784].forEach((f,i)=>tone(f,.2,"triangle",.08,i*.1)),
  drop: () => { tone(1400,.6,"sine",.05,0,300); tone(90,.25,"sine",.35,.63,45); [523,659,784].forEach((f,i)=>tone(f,.4,"sine",.07,.8+i*.08)); },
  pop: () => tone(520,.12,"triangle",.07),
  win: () => [523,659,784,1047].forEach((f,i)=>tone(f,.35,"sine",.09,i*.09)),
};

/* =====================================================================
   SHARED: the grid
   items: [{x, y, color, html, mine, tentative, chips:[{color,av}]}]
   ===================================================================== */
function gridHTML(o){
  const C = o.cat, T = o.target, byCell = {};
  for (const it of o.items || []) (byCell[it.x+","+it.y] = byCell[it.x+","+it.y] || []).push(it);
  let cells = "";
  for (let y=10; y>=1; y--) for (let x=1; x<=10; x++){
    const here = byCell[x+","+y] || [];
    let cls = "cell" + ((x+y)%2 ? " alt" : ""), style = "", inner = "";
    if (o.mode === "reveal" && T){ const d = cheb([x,y],T); if (d===1) cls += " ring1"; else if (d===2) cls += " ring2"; }
    if (here.length === 1){
      const it = here[0]; style = `background:${it.color};color:${textOn(it.color)}`; inner = it.html; cls += " fill";
    } else if (here.length > 1){
      const step = 100/here.length;
      style = `background:linear-gradient(135deg,${here.map((it,k)=>`${it.color} ${k*step}% ${(k+1)*step}%`).join(",")});color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.55)`;
      inner = here.slice(0,3).map(it => it.html).join("") + (here.length>3?`<span class="nm">+${here.length-3}</span>`:"");
      cls += " fill multi";
    }
    const chips = here.flatMap(it => it.chips || []);
    if (chips.length) inner += `<span class="chips">${chips.map(c=>`<i style="background:${c.color}"></i>`).join("")}</span>`;
    if (here.some(it => it.mine)) cls += " mine";
    if (here.some(it => it.mine && it.tentative)) cls += " tentative";
    if (o.blocked && o.blocked.has(x+","+y)) cls += " taken";
    if (T && T[0]===x && T[1]===y) cls += " tgt";
    if (o.pop && o.pop[0]===x && o.pop[1]===y) cls += " pop";
    cells += `<div class="${cls}" data-x="${x}" data-y="${y}" style="${style}">${inner}</div>`;
  }
  let star = "";
  if (T){
    const L = (T[0]-.5)*10, Tp = (10-T[1]+.5)*10, pos = `left:${L}%;top:${Tp}%`;
    const settle = (byCell[T.join()] || []).length ? "--dx:3.4cqi;--dy:-3.4cqi;--s:.55;" : "";
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
const topicHTML = cat => `<div class="topic"><div class="ico">${ic(cat.ic)}</div><h2>${esc(cat.name)}</h2></div>`;
const axesHTML = cat => `<div class="cat-mini"><div class="axis x">${ic("h")}${esc(cat.x[0])} → ${esc(cat.x[1])}</div><div class="axis y">${ic("v")}${esc(cat.y[0])} → ${esc(cat.y[1])}</div></div>`;
// label inside a square: character + name (big screen) or character only (phone)
const personLabel = (p, compact) => compact ? `<span class="nm">${avSvg(p.av)}</span>` : `<span class="nm">${avSvg(p.av)} <span>${esc(p.name)}</span></span>`;

/* =====================================================================
   HOST
   ===================================================================== */
let H = null;
let hostKind = null;               // "screen" | "play"
let hostPeer = null, hostOnline = false, hostRetry = 0;
const conns = new Map();           // pid -> connection (a PeerJS DataConnection, or the local in-memory one)
let hostTickT = null, hostDrop = false, hostPop = null, kickArmed = null, wakeLock = null, lastReadOpen = false;
let revealStep = 0, revealT = null; // Plot It: answers appear one by one on the big screen

function newCode(){ let c=""; for (let i=0;i<4;i++) c += CODE_CHARS[rnd(CODE_CHARS.length)]; return c; }
function freshHost(){
  return { code:newCode(), phase:"lobby", hostPid:null, players:[], custom:[],
    settings:{ game:"classic", rounds:2, vote:"claim", limit:0, read:10, pick:false, plotLimit:60, packs:PACKS.map(p=>p.id) },
    order:[], turn:0, total:0, cat:null, target:null, clue:"", votes:{}, bets:{}, gains:null, bonus:0, closest:[], betWinners:[],
    readUntil:null, deadline:null, answers:{}, aorder:[], pv:{}, hot:{}, tally:null, history:[], awards:null };
}
const saveHost = () => store.set("cgo.host", H);
const P = pid => H.players.find(p => p.pid === pid);
const leaderPid = () => H.order.length ? H.order[H.turn % H.order.length] : null;
const nextLeaderPid = () => H.order.length ? H.order[(H.turn+1) % H.order.length] : null;
const guesserPids = () => H.players.map(p=>p.pid).filter(pid => pid !== leaderPid());
const isOnline = pid => conns.has(pid) && conns.get(pid).open;
const freeColor = () => DEFAULT_ORDER.concat(COLORS).find(c => !H.players.some(p=>p.color===c)) || COLORS[rnd(COLORS.length)];
const freeAv = () => shuffle(AV_KEYS).find(a => !H.players.some(p=>p.av===a)) || AV_KEYS[rnd(AV_KEYS.length)];

// Topics in the packs the host switched on. Custom topics use every scale on both axes.
function allTopics(){
  const custom = H.custom.map(c => ({ name:c.name, ic:"pencil", pack:"custom", x:c.scales, y:c.scales }));
  const packs = H.settings.packs || PACKS.map(p => p.id);
  const list = TOPICS.concat(custom).filter(t => packs.includes(t.pack));
  return list.length ? list : TOPICS.concat(custom);
}
// pick a scale for one axis ("x" bottom, "y" side), avoiding the ones in `avoid`
function newScale(t, axis, avoid){
  const T = allTopics()[t], bad = new Set(avoid.filter(Boolean).map(key));
  const ok = T[axis].filter(s => !bad.has(key(s)));
  return ok.length ? ok[rnd(ok.length)] : T[axis][0];
}
function newCategory(t){
  const n = allTopics().length;
  if (t === undefined){ let k; do { k = rnd(n); } while (n > 1 && H.cat && k === H.cat.t); t = k; }
  const x = newScale(t, "x", []); H.cat = { t, x, y: newScale(t, "y", [x]) };
}
const catView = () => H.cat ? { name: allTopics()[H.cat.t].name, ic: allTopics()[H.cat.t].ic, x:H.cat.x, y:H.cat.y } : null;
function randomTarget(){ let t; do { t = [rnd(10)+1, rnd(10)+1]; } while (H.target && t[0]===H.target[0] && t[1]===H.target[1]); H.target = t; }

/* ---------- connection ---------- */
function startHosting(kind, resume, me){
  hostKind = kind;
  if (!resume) H = freshHost();
  store.set("cgo.hostKind", kind);
  if (kind === "play"){
    // this device is also a player: plug a local connection straight into the host
    mode = "phone"; phoneLocal = true; phoneConnected = true;
    PH.code = H.code;
    const local = { pid:PH.pid, open:true, local:true, send: m => setTimeout(() => onPhoneMsg(m), 0), close(){} };
    if (!resume){ H.players.push({ pid:PH.pid, name:me.name, color:me.color || freeColor(), av:me.av || freeAv(), score:0 }); }
    H.hostPid = PH.pid; conns.set(PH.pid, local);
  }
  saveHost(); connectHost(); requestWake();
  clearInterval(hostTickT); hostTickT = setInterval(hostTick, 250);
  hostBroadcast();
}
function connectHost(){
  if (hostPeer && !hostPeer.destroyed) hostPeer.destroy();
  hostOnline = false;
  hostPeer = new Peer(PREFIX + H.code, { debug: 1 });
  hostPeer.on("open", () => { hostOnline = true; hostRetry = 0; hostBroadcast(); });
  hostPeer.on("connection", c => {
    c.on("data", m => onHostMsg(c, m));
    c.on("close", () => dropConn(c));
    c.on("error", () => dropConn(c));
  });
  hostPeer.on("disconnected", () => { hostOnline = false; renderHostScreen(); setTimeout(() => { try { if (hostPeer && !hostPeer.destroyed) hostPeer.reconnect(); } catch(e){} }, 1500); });
  hostPeer.on("error", e => {
    if (e.type === "unavailable-id"){
      if (H.phase === "lobby" && H.players.length <= (hostKind==="play"?1:0)){ H.code = newCode(); PH.code = H.code; saveHost(); }
      hostRetry++; setTimeout(connectHost, Math.min(2000 + hostRetry*1000, 6000));
    } else if (["network","server-error","socket-error","socket-closed","disconnected"].includes(e.type)){
      hostOnline = false; renderHostScreen(); setTimeout(connectHost, 3000);
    }
  });
}
async function requestWake(){ try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch(e){} }
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (H && hostKind){ requestWake(); if (!hostOnline) connectHost(); }
  if (mode === "phone" && !phoneLocal && !phoneConnected && PH.code) phoneConnect();
});
function dropConn(c){ if (c.pid && conns.get(c.pid) === c){ conns.delete(c.pid); hostBroadcast(); } }
function renamePid(oldPid, newPid){
  const p = P(oldPid); if (p) p.pid = newPid;
  H.order = H.order.map(x => x === oldPid ? newPid : x);
  for (const obj of [H.votes, H.bets, H.answers, H.pv, H.hot, H.gains || {}]) if (obj[oldPid] !== undefined){ obj[newPid] = obj[oldPid]; delete obj[oldPid]; }
  for (const obj of [H.bets, H.pv, H.hot]) for (const k in obj) if (obj[k] === oldPid) obj[k] = newPid;
  H.aorder = H.aorder.map(x => x === oldPid ? newPid : x);
}

/* ---------- the game ---------- */
function startGame(){
  H.order = shuffle(H.players.map(p => p.pid));
  H.turn = 0; H.total = H.order.length * H.settings.rounds;
  H.players.forEach(p => p.score = 0);
  H.history = []; H.awards = null;
  startTurn();
}
function startTurn(){
  H.lastGains = H.gains || null;   // shown next to the standings while the next turn gets going
  newCategory(); H.target = null; randomTarget();
  Object.assign(H, { clue:"", votes:{}, bets:{}, gains:null, bonus:0, closest:[], betWinners:[], readUntil:null, deadline:null,
    answers:{}, aorder:[], pv:{}, hot:{}, tally:null, phase:"pick" });
  hostBroadcast();
}
function lockCategory(){
  H.phase = "read"; H.readUntil = now() + H.settings.read*1000; lastReadOpen = H.settings.read === 0;
  if (H.settings.read === 0 && H.settings.game === "plot") return startPlotting();
  sfx.go(); hostBroadcast();
}
function startPlotting(){ H.phase = "plot"; H.deadline = now() + H.settings.plotLimit*1000; sfx.go(); hostBroadcast(); }
function readDone(){ return !H.readUntil || now() >= H.readUntil; }

function doReveal(){
  if (H.phase !== "guess") return;
  const R = RULES.classic, g = leaderPid(), gains = {}; let giverPts = 0, within = 0;
  const dist = {};
  for (const [pid, v] of Object.entries(H.votes)){
    const p = P(pid); if (!p) continue;
    const d = cheb([v.x,v.y], H.target); dist[pid] = d;
    const pts = d===0?R.exact:d===1?R.one:d===2?R.two:0;
    gains[pid] = pts; p.score += pts;
    if (d <= 1){ within++; giverPts += d === 0 ? R.giverExact : R.giverPer; }
  }
  const need = Math.min(guesserPids().length, 9);
  H.bonus = within >= need && need > 0 ? R.giverBonus : 0;
  gains[g] = giverPts + H.bonus; const gp = P(g); if (gp) gp.score += gains[g];
  // side bets: who will be closest?
  const best = Math.min(...Object.values(dist), 99);
  H.closest = Object.keys(dist).filter(pid => dist[pid] === best);
  H.betWinners = Object.keys(H.bets).filter(pid => H.bets[pid] && H.closest.includes(H.bets[pid]));
  for (const pid of H.betWinners){ const p = P(pid); if (p){ p.score += R.betWin; gains[pid] = (gains[pid]||0) + R.betWin; } }
  H.gains = gains; H.phase = "reveal"; H.deadline = null;
  H.history.push({ type:"classic", turn:H.turn, leader:g, clue:H.clue, cat:catView(), target:H.target.slice(),
    votes:Object.fromEntries(Object.entries(H.votes).map(([k,v])=>[k,[v.x,v.y]])), dist, gains:{...gains}, bonus:H.bonus, betWinners:H.betWinners.slice(), ratings:{} });
  hostDrop = true; hostBroadcast(); sfx.drop();
}

function startPlotVote(){
  if (H.phase !== "plot") return;
  // keep only answers that have both a name and a square
  for (const pid in H.answers){ const a = H.answers[pid]; if (!a.text || !a.x) delete H.answers[pid]; }
  H.aorder = shuffle(Object.keys(H.answers));
  if (H.aorder.length < 2){ H.phase = "presult"; H.tally = { votes:{}, hot:{}, top:[], hotTop:[], nailed:[] }; H.gains = {}; H.deadline = null; hostBroadcast(); return; }
  H.phase = "pvote"; H.deadline = now() + RULES.pvoteSeconds*1000; H.pv = {}; H.hot = {};
  revealStep = 0; clearInterval(revealT);
  revealT = setInterval(() => { revealStep++; sfx.pop(); renderHostScreen(); if (revealStep >= H.aorder.length) clearInterval(revealT); }, 650);
  hostBroadcast();
}
function plotVoters(){ return H.players.map(p=>p.pid).filter(pid => H.aorder.some(a => a !== pid)); }
function finishPlotVote(){
  if (H.phase !== "pvote") return;
  const R = RULES.plot, votes = {}, hot = {}, gains = {};
  for (const [v, a] of Object.entries(H.pv)) if (H.answers[a]) votes[a] = (votes[a]||0) + 1;
  for (const [v, a] of Object.entries(H.hot)) if (H.answers[a]) hot[a] = (hot[a]||0) + 1;
  const max = Math.max(0, ...Object.values(votes)), top = max ? Object.keys(votes).filter(a => votes[a] === max) : [];
  const hmax = Math.max(0, ...Object.values(hot)), hotTop = hmax ? Object.keys(hot).filter(a => hot[a] === hmax) : [];
  const nailed = [];
  for (const a of H.aorder){
    const n = votes[a] || 0; let pts = n * R.perVote;
    const possible = Object.keys(H.pv).filter(v => v !== a).length;
    if (n >= 2 && n === possible){ pts += R.nailed; nailed.push(a); }
    gains[a] = (gains[a]||0) + pts;
  }
  for (const [v, a] of Object.entries(H.pv)) if (top.includes(a)) gains[v] = (gains[v]||0) + R.pickedWinner;
  for (const [pid, pts] of Object.entries(gains)){ const p = P(pid); if (p) p.score += pts; }
  H.tally = { votes, hot, top, hotTop, nailed };
  H.gains = gains; H.phase = "presult"; H.deadline = null; clearInterval(revealT); revealStep = 99;
  H.history.push({ type:"plot", turn:H.turn, leader:leaderPid(), cat:catView(),
    answers:Object.fromEntries(H.aorder.map(a => [a, { ...H.answers[a] }])), votes, hot, top, hotTop, nailed, gains:{...gains} });
  hostBroadcast(); sfx.win();
}
function nextTurn(){
  if (H.turn >= H.total - 1){ H.phase = "end"; H.awards = computeAwards(); hostBroadcast(); sfx.win(); if (hostKind === "screen") confetti(H.players.map(p=>p.color)); return; }
  H.turn++; startTurn();
}
function skipTurn(){ H.history.push({ type:"skip", turn:H.turn }); nextTurn(); }

function hostTick(){
  if (!H) return;
  const t = now();
  if (H.phase === "read"){
    if (H.settings.game === "plot" && t >= H.readUntil) return startPlotting();
    if (!lastReadOpen && t >= H.readUntil){ lastReadOpen = true; hostBroadcast(); }
  }
  if (H.deadline && t >= H.deadline){
    if (H.phase === "guess") return doReveal();
    if (H.phase === "plot") return startPlotVote();
    if (H.phase === "pvote") return finishPlotVote();
  }
  const el = $("#htimer");
  if (el){ const end = H.phase === "read" ? H.readUntil : H.deadline; el.textContent = end ? secs(end - t) + "s" : ""; el.classList.toggle("low", end && end - t < 6000); }
}

function checkAutoEnd(){
  const turn = H.turn, phase = H.phase;
  const later = fn => setTimeout(() => { if (H.turn === turn && H.phase === phase) fn(); }, 900);
  if (phase === "guess"){ const gs = guesserPids(); if (gs.length && gs.every(q => H.votes[q] && H.votes[q].locked)) later(doReveal); }
  if (phase === "plot"){ if (H.players.every(p => H.answers[p.pid] && H.answers[p.pid].locked)) later(startPlotVote); }
  if (phase === "pvote"){ const vs = plotVoters(); if (vs.length && vs.every(v => H.pv[v])) later(finishPlotVote); }
}
const allVotesPlaced = () => { const gs = guesserPids(); return gs.length > 0 && gs.every(q => H.votes[q]); };
const allAnswersPlaced = () => H.players.every(p => H.answers[p.pid] && H.answers[p.pid].text && H.answers[p.pid].x);

/* ---------- messages from phones ---------- */
function onHostMsg(c, m){
  if (!m || typeof m !== "object" || !H) return;
  if (m.t === "join") return handleJoin(c, m);
  const pid = c.pid, p = P(pid); if (!p) return;
  const isLeader = pid === leaderPid(), isHost = c.local === true, S = H.settings;
  switch (m.t){
    case "look":
      if (m.color && COLORS.includes(m.color) && !H.players.some(q=>q.color===m.color && q.pid!==pid)) p.color = m.color;
      if (m.av && AVATARS[m.av] && !H.players.some(q=>q.av===m.av && q.pid!==pid)) p.av = m.av;
      break;
    case "act": {
      if (!isLeader || H.phase !== "pick") return;
      const a = m.a;
      if (a === "rx") H.cat.x = newScale(H.cat.t,"x",[H.cat.x,H.cat.y]);
      else if (a === "ry") H.cat.y = newScale(H.cat.t,"y",[H.cat.y,H.cat.x]);
      else if (a === "rb"){ const ox=H.cat.x, oy=H.cat.y; H.cat.x = newScale(H.cat.t,"x",[ox,oy]); H.cat.y = newScale(H.cat.t,"y",[ox,oy,H.cat.x]); }
      else if (a === "rt") newCategory();
      else if (a === "topic" && allTopics()[m.v]) newCategory(+m.v);
      else if (a === "square") randomTarget();
      else if (a === "cell" && S.pick && S.game === "classic" && m.x>=1 && m.x<=10 && m.y>=1 && m.y<=10) H.target = [m.x, m.y];
      else if (a === "lockcat") return lockCategory();
      break;
    }
    case "clue":
      if (!isLeader || H.phase !== "read" || S.game !== "classic" || !readDone()) return;
      H.clue = String(m.clue || "").trim().slice(0,60); H.phase = "guess"; H.votes = {}; H.bets = {};
      H.deadline = S.limit ? now() + S.limit*1000 : null; sfx.go();
      break;
    case "vote": {
      if (H.phase !== "guess" || isLeader) return;
      const x = +m.x, y = +m.y; if (!(x>=1&&x<=10&&y>=1&&y<=10)) return;
      const cur = H.votes[pid]; if (cur && cur.locked) return;
      if (S.vote === "claim" && Object.entries(H.votes).some(([q,v]) => q!==pid && v.x===x && v.y===y))
        return c.send({ t:"error", msg:"Someone already has that square." });
      H.votes[pid] = { x, y, locked:false }; hostPop = [x,y]; sfx.plink();
      break;
    }
    case "lock": if (H.phase === "guess" && H.votes[pid]) H.votes[pid].locked = true; break;
    case "unlock": if (H.phase === "guess" && H.votes[pid]) H.votes[pid].locked = false; break;
    case "bet": if (H.phase === "guess" && !isLeader && (m.on === null || (P(m.on) && m.on !== pid && m.on !== leaderPid()))) H.bets[pid] = m.on; break;
    case "rate": {
      const last = H.history[H.history.length-1];
      if (H.phase === "pick" && last && last.type === "classic" && last.leader !== pid && [1,2,3].includes(m.stars)) last.ratings[pid] = m.stars;
      break;
    }
    case "drop":
      if (H.phase === "guess" && (isHost || (isLeader && allVotesPlaced()))) return doReveal();
      if (H.phase === "plot" && (isHost || (isLeader && allAnswersPlaced()))) return startPlotVote();
      if (H.phase === "pvote" && (isHost || isLeader)) return finishPlotVote();
      return;
    case "answer": {
      if (H.phase !== "plot") return;
      const a = H.answers[pid] || { text:"", x:0, y:0, locked:false }; if (a.locked) return;
      if (typeof m.text === "string") a.text = m.text.trim().slice(0,40);
      if (m.x>=1 && m.x<=10 && m.y>=1 && m.y<=10){ a.x = +m.x; a.y = +m.y; }
      H.answers[pid] = a;
      break;
    }
    case "plock": { const a = H.answers[pid]; if (H.phase === "plot" && a && a.text && a.x) a.locked = true; break; }
    case "punlock": { const a = H.answers[pid]; if (H.phase === "plot" && a) a.locked = false; break; }
    case "pvote": if (H.phase === "pvote" && H.answers[m.on] && m.on !== pid) H.pv[pid] = m.on; break;
    case "phot": if (H.phase === "pvote" && (m.on === null || (H.answers[m.on] && m.on !== pid))) { if (m.on === null) delete H.hot[pid]; else H.hot[pid] = m.on; } break;
    case "next":
      if ((H.phase === "reveal" || H.phase === "presult") && (pid === nextLeaderPid() || isLeader || isHost)) return nextTurn();
      return;
    case "host":
      if (!isHost) return;
      return hostAction(m.a, m);
  }
  checkAutoEnd();
  hostBroadcast();
}
function handleJoin(c, m){
  const name = String(m.name || "").trim().slice(0,16);
  if (!name) return c.send({ t:"error", msg:"Type a name to join." });
  let p = P(m.pid);
  if (!p){
    const twin = H.players.find(q => q.name.toLowerCase() === name.toLowerCase());
    if (twin && isOnline(twin.pid)) return c.send({ t:"error", msg:`Someone named ${name} is already in this game. Pick another name.` });
    if (twin){ renamePid(twin.pid, m.pid); p = twin; }
  }
  if (!p){
    if (H.players.length >= 12) return c.send({ t:"error", msg:"This game is full (12 players)." });
    const color = COLORS.includes(m.color) && !H.players.some(q=>q.color===m.color) ? m.color : freeColor();
    const av = AVATARS[m.av] && !H.players.some(q=>q.av===m.av) ? m.av : freeAv();
    p = { pid:m.pid, name, color, av, score:0 };
    H.players.push(p);
    if (H.phase !== "lobby") H.order.push(p.pid);
    sfx.join();
  }
  const old = conns.get(p.pid); if (old && old !== c) try { old.close(); } catch(e){}
  c.pid = p.pid; conns.set(p.pid, c);
  hostBroadcast();
}
function hostAction(a, m){
  if (a === "start" && H.phase === "lobby" && H.players.length >= 3) return startGame();
  if (a === "set" && H.phase === "lobby"){ applySetting(m.k, m.v); return hostBroadcast(); }
  if (a === "custom-add" && H.phase === "lobby"){ addCustom(m.topic); return hostBroadcast(); }
  if (a === "custom-del" && H.phase === "lobby"){
    H.custom.splice(+m.i, 1);
    if (!H.custom.length && H.settings.packs){ H.settings.packs = H.settings.packs.filter(p => p !== "custom"); if (!H.settings.packs.length) H.settings.packs = PACKS.map(p=>p.id); }
    return hostBroadcast();
  }
  if (a === "kick" && H.phase === "lobby") return kickPlayer(m.pid);
  if (a === "drop"){ if (H.phase === "guess") return doReveal(); if (H.phase === "plot") return startPlotVote(); if (H.phase === "pvote") return finishPlotVote(); }
  if (a === "skip" && !["lobby","end"].includes(H.phase)) return skipTurn();
  if (a === "next" && ["reveal","presult"].includes(H.phase)) return nextTurn();
  if (a === "lobby"){ H.phase = "lobby"; H.players.forEach(p=>p.score=0); return hostBroadcast(); }
  if (a === "again" && H.phase === "end") return startGame();
  if (a === "close") return closeRoom();
}
function applySetting(k, v){
  const S = H.settings;
  if (k === "game" && ["classic","plot"].includes(v)) S.game = v;
  if (k === "vote" && VOTE_INFO[v]) S.vote = v;
  if (k === "rounds" && [1,2,3].includes(+v)) S.rounds = +v;
  if (k === "limit" && [0,20,30,45,60].includes(+v)) S.limit = +v;
  if (k === "read" && [0,5,10,15].includes(+v)) S.read = +v;
  if (k === "plotLimit" && [45,60,90,120].includes(+v)) S.plotLimit = +v;
  if (k === "pick") S.pick = !!v;
  if (k === "pack"){
    const all = PACKS.map(p=>p.id).concat(H.custom.length ? ["custom"] : []);
    const cur = new Set(S.packs || all);
    if (cur.has(v)) cur.delete(v); else if (all.includes(v)) cur.add(v);
    if (cur.size) S.packs = all.filter(id => cur.has(id));   // always keep at least one pack on
  }
  if (k === "packs-all") S.packs = PACKS.map(p=>p.id).concat(H.custom.length ? ["custom"] : []);
}
function addCustom(t){
  if (!t) return;
  const name = String(t.name || "").trim().slice(0,40);
  const scales = (t.scales || []).map(s => [String(s[0]||"").trim().slice(0,32), String(s[1]||"").trim().slice(0,32)]).filter(s => s[0] && s[1]);
  if (!name || scales.length < 2) return;
  H.custom.push({ name, scales });
  const S = H.settings; S.packs = S.packs || PACKS.map(p=>p.id);
  if (!S.packs.includes("custom")) S.packs.push("custom");   // new custom topics are switched on
}
function kickPlayer(pid){
  if (pid === H.hostPid) return;
  const c = conns.get(pid); if (c){ try { c.send({ t:"kicked" }); } catch(e){} setTimeout(()=>{ try{c.close()}catch(e){} }, 200); conns.delete(pid); }
  H.players = H.players.filter(p => p.pid !== pid); hostBroadcast();
}
function closeRoom(){
  try { hostPeer.destroy(); } catch(e){} clearInterval(hostTickT);
  store.del("cgo.host"); store.del("cgo.hostKind"); H = null; hostKind = null; conns.clear();
  phoneLocal = false; V = null; phoneKey = ""; renderLanding();
}

/* ---------- what each phone gets to see ---------- */
function viewFor(pid){
  const S = H.settings, lead = leaderPid(), isLeader = pid === lead, ph = H.phase;
  const v = { t:"state", code:H.code, phase:ph, you:pid, hostPid:H.hostPid, settings:S, turn:H.turn, total:H.total,
    players:H.players.map(p => ({ pid:p.pid, name:p.name, color:p.color, av:p.av, score:p.score, online:isOnline(p.pid) })),
    leader:lead, next:nextLeaderPid(), cat:catView(), clue:["guess","reveal"].includes(ph) ? H.clue : "",
    readLeft: ph==="read" && H.readUntil ? Math.max(0, H.readUntil - now()) : null,
    left: H.deadline ? Math.max(0, H.deadline - now()) : null,
    gains:H.gains, lastGains:H.lastGains || null, bonus:H.bonus, custom:H.phase==="lobby" ? H.custom : null };
  if (S.game === "classic"){
    v.target = ph === "reveal" || (isLeader && ["pick","read","guess"].includes(ph)) ? H.target : null;
    const showAll = ph === "reveal" || (S.vote !== "secret" && ph === "guess");
    v.votes = Object.entries(H.votes).filter(([q]) => showAll || q === pid).map(([q,x]) => ({ pid:q, x:x.x, y:x.y, locked:x.locked }));
    v.voteCount = Object.keys(H.votes).length; v.lockCount = Object.values(H.votes).filter(x=>x.locked).length;
    v.allPlaced = allVotesPlaced();
    v.myBet = H.bets[pid] === undefined ? undefined : H.bets[pid];
    if (ph === "reveal"){ v.closest = H.closest; v.betWinners = H.betWinners; }
    const last = H.history[H.history.length-1];
    if (ph === "pick" && last && last.type === "classic" && last.leader !== pid && !isLeader)
      v.rate = { clue:last.clue, giver:last.leader, mine:last.ratings[pid] || 0 };
  } else {
    if (ph === "plot"){ const a = H.answers[pid]; v.myAnswer = a || null; v.answerCount = Object.values(H.answers).filter(a=>a.locked).length; v.allPlaced = allAnswersPlaced(); }
    if (ph === "pvote" || ph === "presult"){
      v.answers = H.aorder.map((a, i) => ({ id:a, n:i+1, text:H.answers[a].text, x:H.answers[a].x, y:H.answers[a].y, mine:a===pid,
        author: ph === "presult" ? a : null }));
      v.myVote = H.pv[pid] || null; v.myHot = H.hot[pid] || null;
      v.voteCount = Object.keys(H.pv).length; v.voterCount = plotVoters().length;
      if (ph === "presult") v.tally = H.tally;
    }
  }
  if (ph === "pick" && isLeader) v.topics = allTopics().map(t => t.name);
  if (ph === "end") v.awards = H.awards;
  if (pid === H.hostPid){ v.isHost = true; v.joinUrl = joinUrl(H.code); v.online = hostOnline; }
  return v;
}
function hostBroadcast(){
  if (!H) return;
  for (const [pid, c] of conns){ if (c.open) try { c.send(viewFor(pid)); } catch(e){} }
  saveHost(); renderHostScreen();
}

/* ---------- awards ---------- */
function computeAwards(){
  const out = [], name = pid => (P(pid) || {}).name || "?";
  const classic = H.history.filter(h => h.type === "classic"), plot = H.history.filter(h => h.type === "plot");
  const add = (title, who, why) => { if (who) out.push({ title, who, name:name(who), why }); };
  const bestBy = (scores, min=1) => { let best = null, bv = -Infinity; for (const [k,v] of Object.entries(scores)) if (v > bv){ bv = v; best = k; } return bv >= min ? [best, bv] : [null, 0]; };
  if (classic.length){
    const exact = {}, giver = {}, bets = {};
    let wild = null;
    for (const h of classic){
      for (const [pid,d] of Object.entries(h.dist)){ if (d === 0) exact[pid] = (exact[pid]||0) + 1; if (!wild || d > wild.d) wild = { pid, d, h }; }
      giver[h.leader] = (giver[h.leader]||0) + (h.gains[h.leader]||0);
      for (const w of h.betWinners) bets[w] = (bets[w]||0) + 1;
    }
    let [b, bv] = bestBy(exact); add("Bullseye", b, `${bv} exact hit${bv>1?"s":""}`);
    [b, bv] = bestBy(giver); add("Best Clue Giver", b, `${bv} points from clues`);
    // Clue of the Night: best average rating
    let cl = null;
    for (const h of classic){ const r = Object.values(h.ratings); if (!r.length) continue; const avg = r.reduce((a,c)=>a+c,0)/r.length; if (!cl || avg > cl.avg) cl = { h, avg }; }
    if (cl) add("Clue of the Night", cl.h.leader, `${cl.h.clue ? `“${cl.h.clue}”` : "a spoken clue"} · ${cl.avg.toFixed(1)} stars`);
    // Mind Readers: two players whose votes landed closest to each other on average
    const pair = {};
    for (const h of classic){ const ks = Object.keys(h.votes); for (let i=0;i<ks.length;i++) for (let j=i+1;j<ks.length;j++){ const k = [ks[i],ks[j]].sort().join("~"); const d = cheb(h.votes[ks[i]], h.votes[ks[j]]); (pair[k] = pair[k] || []).push(d); } }
    let mr = null; for (const [k, ds] of Object.entries(pair)){ if (ds.length < 2) continue; const avg = ds.reduce((a,c)=>a+c,0)/ds.length; if (!mr || avg < mr.avg) mr = { k, avg }; }
    if (mr){ const [a, c] = mr.k.split("~"); out.push({ title:"Mind Readers", who:a, who2:c, name:`${name(a)} & ${name(c)}`, why:`votes ${mr.avg.toFixed(1)} squares apart on average` }); }
    if (wild && wild.d >= 4) add("Wildest Guess", wild.pid, `${wild.d} squares off on “${wild.h.clue || wild.h.cat.name}”`);
    [b, bv] = bestBy(bets); add("Oracle", b, `${bv} winning side bet${bv>1?"s":""}`);
  }
  if (plot.length){
    const votes = {}, hot = {}, nailed = {};
    for (const h of plot){ for (const [a,n] of Object.entries(h.votes)) votes[a] = (votes[a]||0) + n; for (const [a,n] of Object.entries(h.hot)) hot[a] = (hot[a]||0) + n; for (const a of h.nailed) nailed[a] = (nailed[a]||0) + 1; }
    let [b, bv] = bestBy(votes); add("Crowd Favorite", b, `${bv} vote${bv>1?"s":""} for best placement`);
    [b, bv] = bestBy(nailed); add("Nailed It", b, `${bv} unanimous win${bv>1?"s":""}`);
    [b, bv] = bestBy(hot); add("Hot Take", b, `${bv} “most misplaced” vote${bv>1?"s":""}`);
  }
  return out;
}

/* ---------- big-screen rendering ---------- */
function renderHostScreen(){
  if (hostKind !== "screen" || !H) return;
  if (H.phase === "lobby") return renderLobbyScreen();
  if (H.phase === "end") return renderEndScreen();
  renderGameScreen();
}
function statusDot(){ return `<span class="status ${hostOnline?"on":""}"><i></i>${hostOnline?"Room open":"Connecting…"}</span>`; }

function settingsHTML(){
  const S = H.settings, sel = (k, opts) => `<select data-set="${k}">${opts.map(([v,l])=>`<option value="${v}" ${String(S[k])===String(v)?"selected":""}>${l}</option>`).join("")}</select>`;
  const seg = (k, opts) => `<div class="seg">${opts.map(([v,l])=>`<button data-set="${k}" data-v="${v}" class="${S[k]===v?"on":""}">${l}</button>`).join("")}</div>`;
  const plot = S.game === "plot";
  const packs = PACKS.concat(H.custom.length ? [{ id:"custom", name:"Custom" }] : []), on = S.packs || packs.map(p=>p.id);
  const count = id => id === "custom" ? H.custom.length : TOPICS.filter(t => t.pack === id).length;
  const total = packs.filter(p => on.includes(p.id)).reduce((a,p) => a + count(p.id), 0);
  return `
    <div class="toggle" style="display:block"><div><b>Topic packs</b><small>${total} topics switched on. Tap a pack to turn it on or off.</small></div>
      <div class="packs">${packs.map(p=>`<button data-set="pack" data-v="${p.id}" class="${on.includes(p.id)?"on":""}">${esc(p.name)} <span>${count(p.id)}</span></button>`).join("")}
        ${on.length < packs.length ? `<button data-set="packs-all" data-v="1" class="all">All packs</button>` : ""}</div></div>
    <div class="toggle"><div><b>Game type</b><small>${plot ? "Plot It: everyone names something for the category and places it, then votes for the best placement." : "Classic: one clue giver, everyone else finds the secret square."}</small></div>${seg("game", [["classic","Classic"],["plot","Plot It"]])}</div>
    <div class="toggle"><div><b>Turns per player</b><small>${plot ? "Each player picks the category this many times." : "Each player gives a clue this many times."}</small></div>${sel("rounds", [[1,"1"],[2,"2"],[3,"3"]])}</div>
    ${plot ? "" : `<div class="toggle"><div><b>Voting style</b><small>${VOTE_INFO[S.vote][1]}</small></div>${seg("vote", Object.entries(VOTE_INFO).map(([k,v])=>[k,v[0]]))}</div>`}
    <div class="toggle"><div><b>Reading time</b><small>Pause to read the category before ${plot ? "plotting" : "the clue"}.</small></div>${sel("read", [[0,"None"],[5,"5s"],[10,"10s"],[15,"15s"]])}</div>
    ${plot ? `<div class="toggle"><div><b>Time to plot</b><small>How long everyone has to name and place an answer.</small></div>${sel("plotLimit", [[45,"45s"],[60,"60s"],[90,"90s"],[120,"2 min"]])}</div>`
           : `<div class="toggle"><div><b>Vote timer</b><small>Drop the star automatically when time runs out.</small></div>${sel("limit", [[0,"Off"],[20,"20s"],[30,"30s"],[45,"45s"],[60,"60s"]])}</div>
              <div class="toggle"><div><b>Clue giver picks the square</b><small>Off: random square, which they can re-roll.</small></div><label class="sw"><input type="checkbox" data-set="pick" ${S.pick?"checked":""}><span></span></label></div>`}`;
}
function customHTML(){
  return `<div class="label">Custom topics</div>
    <div class="plist" id="customlist">${customListHTML()}</div>
    <details class="customform" ${H.custom.length?"":"open"}>
      <summary>${ic("plus")} Add a topic</summary>
      <div class="stack" style="margin-top:10px">
        <input type="text" id="ct-name" maxlength="40" placeholder="Topic, e.g. People in this room">
        ${[0,1,2,3].map(i=>`<div class="scale-row"><input type="text" id="ct-lo${i}" maxlength="32" placeholder="${["Least likely to text back","Worst cook","",""][i] || "Low end (optional)"}"><span>→</span><input type="text" id="ct-hi${i}" maxlength="32" placeholder="${["Replies instantly","Should open a restaurant","",""][i] || "High end (optional)"}"></div>`).join("")}
        <p class="muted" style="margin:0;font-size:.82rem">Needs a name and at least two scales.</p>
        <button class="btn" id="ct-add">${ic("plus")} Add topic</button>
      </div>
    </details>
    ${H.custom.length ? `<p class="muted small customnote" style="margin:8px 0 0">Your topics are in the <b>Custom</b> pack. To play only these, turn the other packs off in Settings.</p>` : ""}`;
}
const customListHTML = () => H.custom.map((c,i)=>`<div class="pl"><span class="ico-sm">${ic("pencil")}</span><div style="min-width:0"><div>${esc(c.name)}</div><small class="muted">${c.scales.map(s=>`${esc(s[0])} → ${esc(s[1])}`).join(" · ")}</small></div>
  <button class="kick" data-cdel="${i}" aria-label="Remove topic">${ic("x")}</button></div>`).join("");
function readCustomForm(){
  const name = ($("#ct-name")||{}).value || "";
  const scales = [0,1,2,3].map(i => [($("#ct-lo"+i)||{}).value || "", ($("#ct-hi"+i)||{}).value || ""]);
  return { name, scales };
}
function clearCustomForm(){ ["#ct-name","#ct-lo0","#ct-hi0","#ct-lo1","#ct-hi1","#ct-lo2","#ct-hi2","#ct-lo3","#ct-hi3"].forEach(s => { const el = $(s); if (el) el.value = ""; }); }

// settings and custom-topic controls work the same on the big screen and on a host-and-play phone
function hostControl(a, extra={}){
  if (hostKind === "screen") hostAction(a, extra);
  else psend({ t:"host", a, ...extra });
}
document.addEventListener("click", e => {
  if (!hostKind) return;
  const segB = e.target.closest("button[data-set]");
  if (segB){ hostControl("set", { k:segB.dataset.set, v:segB.dataset.v }); return; }
  if (e.target.closest("#ct-add")){
    const t = readCustomForm(), ok = t.name.trim() && t.scales.filter(s=>s[0].trim()&&s[1].trim()).length >= 2;
    if (!ok) return toast("Add a topic name and at least two scales.");
    hostControl("custom-add", { topic:t }); clearCustomForm(); toast("Topic added");
    return;
  }
  const del = e.target.closest("[data-cdel]"); if (del) return hostControl("custom-del", { i:+del.dataset.cdel });
});
document.addEventListener("change", e => {
  if (!hostKind) return;
  const el = e.target.closest("select[data-set], input[data-set]");
  if (el) hostControl("set", { k:el.dataset.set, v: el.type === "checkbox" ? el.checked : el.value });
});

function renderLobbyScreen(){
  if (!$("#lobby-shell")){
    $("#app").innerHTML = `<section class="lobby" id="lobby-shell">
      <div class="card joinbox" id="joinbox"></div>
      <div class="stack" style="min-width:0">
        <div class="card"><div class="label" id="pcount"></div><div class="plist" id="lplayers"></div></div>
        <div class="card"><div class="label">Settings</div><div id="lsettings"></div></div>
        <div class="card" id="lcustom"></div>
        <button class="btn primary lg block" id="start"></button>
        <button class="btn block" id="endhost">Close this room</button>
      </div></section>`;
    $("#start").onclick = () => { tone(1,.01); hostAction("start"); };
    armTwoTap($("#endhost"), "Tap again to close the room", closeRoom);
    $("#lplayers").addEventListener("click", e => {
      const b = e.target.closest("[data-kick]"); if (!b) return;
      const pid = b.dataset.kick;
      if (kickArmed !== pid){ kickArmed = pid; renderLobbyScreen(); setTimeout(()=>{ if (kickArmed===pid){ kickArmed=null; renderLobbyScreen(); } }, 3000); return; }
      kickArmed = null; kickPlayer(pid);
    });
    $("#lcustom").innerHTML = customHTML();
  }
  const url = joinUrl(H.code), qr = qrSvg(url), can = H.players.length >= 3;
  patch("#joinbox", `${brand()}<div class="how">Grab your phone and go to</div><div class="url">${esc(shortUrl())}</div>
    <div class="how">and enter the room code</div><div class="code">${H.code}</div>
    ${qr ? `<div class="qr">${qr}</div><div class="muted">or scan to join</div>` : ""}${statusDot()}`);
  patch("#pcount", `Players · ${H.players.length}/12`);
  patch("#lplayers", H.players.map(p=>`<div class="pl ${isOnline(p.pid)?"":"off"}">${chipFor(p)}${esc(p.name)}
      <span class="st">${isOnline(p.pid)?"Joined":"Offline"}</span>
      <button class="kick ${kickArmed===p.pid?"armed":""}" data-kick="${p.pid}" aria-label="Remove ${esc(p.name)}">${ic("x")}</button></div>`).join("")
      || `<div class="empty">Waiting for players to join…</div>`);
  patch("#lsettings", settingsHTML());
  patch("#customlist", customListHTML());
  const lc = $("#lcustom"); if (lc && (!!H.custom.length) !== !!lc.querySelector(".customnote")) lc.innerHTML = customHTML();
  const st = $("#start"); st.disabled = !can;
  st.innerHTML = can ? `Start ${GAME_LABEL[H.settings.game]} with ${H.players.length} players ${ic("arrowr")}` : "Need at least 3 players";
}

const ordinal = n => n + (n%100>=11&&n%100<=13 ? "th" : ["th","st","nd","rd"][n%10] || "th");
// players tied on points share a place
function rankOf(players, pid){ const me = players.find(p=>p.pid===pid); return me ? players.filter(p => p.score > me.score).length + 1 : 0; }
function standingsHTML(players, gains, leader, you, label="Standings"){
  const order = players.slice().sort((a,b)=>b.score-a.score);
  return `<div class="label">${label}</div>` + order.map((p,k)=>`<div class="sr ${p.online===false?"off":""} ${p.pid===you?"is-me":""}"><div class="rk">${rankOf(players,p.pid)}</div>${chipFor(p,"sm")}
    <div class="nm">${esc(p.name)}${p.pid===you?"<small>you</small>":""}${p.pid===leader?`<small>${H && H.settings.game==="plot"?"picker":"clue giver"}</small>`:""}${p.online===false?"<small>offline</small>":""}</div>
    <div class="gain">${gains && gains[p.pid] ? "+"+gains[p.pid] : ""}</div><div class="sc">${p.score}</div></div>`).join("");
}
const hostPlayersView = () => H.players.map(p => ({ ...p, online:isOnline(p.pid) }));

function renderGameScreen(){
  const S = H.settings, lead = leaderPid(), L = P(lead) || { name:"?", color:"#999", av:"fox" }, ph = H.phase, cat = catView();
  const plot = S.game === "plot";
  let head = "", side = "", grid;
  const timer = `<div class="timer" id="htimer"></div>`;
  if (ph === "pick"){
    head = `<div class="waiting">${chipFor(L,"sm")} ${esc(L.name)} is choosing the category <span class="dots"><i></i><i></i><i></i></span></div>`;
    const last = H.history[H.history.length-1];
    side = `<div class="card"><div class="label">${plot?"Category picker":"Clue giver"}</div>
      <p style="margin:0 0 12px;font-size:1.05rem"><b>${esc(L.name)}</b> is shuffling the category on their phone. Everyone sees it once they lock it in.</p>
      ${last && last.type==="classic" ? `<p class="muted" style="margin:0 0 12px">Meanwhile, rate the last clue on your phone.</p>` : ""}
      ${isOnline(lead) ? "" : `<p class="conn">${ic("wifi")} ${esc(L.name)} is offline</p>`}
      <button class="btn block" id="skip">Skip ${esc(L.name)}’s turn</button></div>`;
    grid = gridHTML({ cat:{ x:["",""], y:["",""] }, items:[], mode:"plain" });
  } else if (ph === "read"){
    head = `<div class="waiting">Read the scales… ${plot ? "plotting starts in" : `${esc(L.name)} gives the clue in`} ${timer}</div>`;
    side = `<div class="card"><div class="label">Get ready</div>${axesHTML(cat)}</div>`;
    grid = gridHTML({ cat, items:[], mode:"plain" });
  } else if (ph === "guess" || ph === "reveal"){
    const showAll = ph === "reveal" || S.vote !== "secret";
    const items = showAll ? Object.entries(H.votes).filter(([q])=>P(q)).map(([q,v]) => ({ x:v.x, y:v.y, color:P(q).color, html:personLabel(P(q)), tentative:!v.locked })) : [];
    head = H.clue ? `<div class="clue"><small>Clue</small><div class="t">${esc(H.clue)}</div></div>` : `<div class="waiting">${esc(L.name)} is saying the clue out loud</div>`;
    if (ph === "guess"){
      const gs = guesserPids(), done = gs.filter(q => H.votes[q] && H.votes[q].locked).length;
      side = `<div class="card">
        <div class="row" style="justify-content:space-between;margin-bottom:10px"><div class="label" style="margin:0">${VOTE_INFO[S.vote][0]} voting · ${done}/${gs.length} locked</div>${H.deadline?timer:""}</div>
        <div class="plist">${gs.map(q => { const p = P(q), v = H.votes[q];
          return `<div class="pl ${isOnline(q)?"":"off"}">${chipFor(p)}${esc(p.name)}<span class="st">${v&&v.locked?`<span class="badge ok">Locked</span>`:v?"Deciding…":"Thinking…"}</span></div>`; }).join("")}</div>
        <button class="btn primary lg block" id="drop" style="margin-top:12px" ${Object.keys(H.votes).length?"":"disabled"}>Drop the star</button></div>`;
    } else {
      const R = RULES.classic;
      const rows = guesserPids().map((q,k) => { const p = P(q), v = H.votes[q], d = v ? cheb([v.x,v.y],H.target) : null;
        const b = d===0?`<span class="badge b0">Exact</span>`:d===1?`<span class="badge b1">1 away</span>`:d===2?`<span class="badge b2">2 away</span>`:`<span class="badge">${v?"Miss":"No vote"}</span>`;
        const bet = H.betWinners.includes(q) ? `<span class="badge bonus">Bet +${R.betWin}</span>` : "";
        return `<div class="sr" style="animation-delay:${.95+k*.07}s"><div></div>${chipFor(p,"sm")}<div class="nm">${esc(p.name)}</div><span>${bet} ${b}</span><div class="sc" style="color:${H.gains[q]?"var(--ok)":"var(--faint)"}">+${H.gains[q]||0}</div></div>`; }).join("");
      const base = (H.gains[lead]||0) - H.bonus, nx = P(nextLeaderPid()), last = H.turn >= H.total-1;
      side = `<div class="card res"><div class="label">The answer · ${H.target[0]}, ${H.target[1]}</div>${rows}
        <div class="sr" style="animation-delay:${.95+guesserPids().length*.07}s"><div></div>${chipFor(L,"sm")}<div class="nm">${esc(L.name)}<small>clue giver</small></div>
          <span>${H.bonus?`<span class="badge bonus">Bonus +${H.bonus}</span> `:""}<span class="badge">${base} close</span></span><div class="sc" style="color:${H.gains[lead]?"var(--ok)":"var(--faint)"}">+${H.gains[lead]||0}</div></div>
        <button class="btn primary lg block" id="next" style="margin-top:14px">${last?"Final results":`Next: ${esc(nx?nx.name:"")}`} ${ic("arrowr")}</button></div>`;
    }
    grid = gridHTML({ cat, target: ph==="reveal" ? H.target : null, items, mode: ph==="reveal"?"reveal":"plain", drop:hostDrop, pop:hostPop });
  } else if (ph === "plot"){
    const locked = H.players.filter(p => H.answers[p.pid] && H.answers[p.pid].locked).length;
    head = `<div class="waiting">Everyone is naming something and placing it <span class="dots"><i></i><i></i><i></i></span></div>`;
    side = `<div class="card"><div class="row" style="justify-content:space-between;margin-bottom:10px"><div class="label" style="margin:0">Plotting · ${locked}/${H.players.length} locked</div>${timer}</div>
      <div class="plist">${H.players.map(p => { const a = H.answers[p.pid];
        return `<div class="pl ${isOnline(p.pid)?"":"off"}">${chipFor(p)}${esc(p.name)}<span class="st">${a&&a.locked?`<span class="badge ok">Locked</span>`:a&&a.text?"Placing…":"Thinking…"}</span></div>`; }).join("")}</div>
      <button class="btn primary lg block" id="drop" style="margin-top:12px" ${Object.keys(H.answers).length?"":"disabled"}>Reveal answers now</button></div>`;
    grid = gridHTML({ cat, items:[], mode:"plain" });
  } else if (ph === "pvote" || ph === "presult"){
    const res = ph === "presult", T = H.tally || {};
    const shown = res ? H.aorder : H.aorder.slice(0, revealStep);
    const items = shown.map((a, i) => { const an = H.answers[a], p = P(a) || { color:"#111318", av:"fox", name:"?" };
      const voters = res ? Object.entries(H.pv).filter(([,t]) => t === a).map(([v]) => P(v)).filter(Boolean) : [];
      return { x:an.x, y:an.y, color: res ? p.color : "#2b2e36", html:`<span class="nm ans">${res?"":`<b>${H.aorder.indexOf(a)+1}</b> `}${esc(an.text)}</span>`, chips: voters.map(v=>({ color:v.color })) }; });
    head = `<div class="waiting">${res ? "The votes are in" : "Vote on your phone: which answer is placed best?"} ${res?"":timer}</div>`;
    if (!res){
      side = `<div class="card"><div class="label">Answers · ${Object.keys(H.pv).length}/${plotVoters().length} voted</div>
        <ol class="alist">${shown.map((a,i)=>`<li><b>${i+1}</b> ${esc(H.answers[a].text)} <span class="muted">· ${H.answers[a].x}, ${H.answers[a].y}</span></li>`).join("")}</ol>
        <button class="btn primary lg block" id="drop" style="margin-top:12px">End voting</button></div>`;
    } else {
      const rank = H.aorder.slice().sort((a,b)=>(T.votes[b]||0)-(T.votes[a]||0));
      const nx = P(nextLeaderPid()), last = H.turn >= H.total-1;
      side = `<div class="card res"><div class="label">Best placed</div>
        ${rank.map((a,k)=>{ const p = P(a); if (!p) return ""; const n = T.votes[a]||0;
          return `<div class="sr" style="animation-delay:${.2+k*.08}s"><div class="rk">${k+1}</div>${chipFor(p,"sm")}<div class="nm">${esc(H.answers[a].text)}<small>${esc(p.name)}</small></div>
            <span>${T.nailed.includes(a)?`<span class="badge bonus">Nailed it</span> `:""}${T.hotTop.includes(a)?`<span class="badge hot">Hot take</span> `:""}<span class="badge">${n} vote${n===1?"":"s"}</span></span><div class="sc" style="color:${H.gains[a]?"var(--ok)":"var(--faint)"}">+${H.gains[a]||0}</div></div>`; }).join("")}
        <button class="btn primary lg block" id="next" style="margin-top:14px">${last?"Final results":`Next picker: ${esc(nx?nx.name:"")}`} ${ic("arrowr")}</button></div>`;
    }
    grid = gridHTML({ cat, items, mode:"plain" });
  }
  const pct = Math.round((H.turn + (["reveal","presult"].includes(ph)?1:0)) / Math.max(1,H.total) * 100);
  $("#app").innerHTML = `<section id="game">
    <div class="card main">
      <div class="cathead">${ph==="pick" ? `<div class="topic"><div class="ico">${ic("dice")}</div><h2>${GAME_LABEL[S.game]}</h2></div>` : topicHTML(cat)}${head}</div>
      <div class="board-area">${grid}</div>
    </div>
    <div class="side">
      <div class="card joinchip"><div><small>Join · ${esc(shortUrl())}</small><div class="c">${H.code}</div></div>${statusDot()}</div>
      <div class="row prog">Turn ${Math.min(H.turn+1,H.total)} of ${H.total}<div class="bar"><i style="width:${pct}%"></i></div></div>
      ${side}<div class="card">${standingsHTML(hostPlayersView(), ["reveal","presult"].includes(ph) ? H.gains : H.lastGains, lead, null, ["reveal","presult"].includes(ph) || !H.lastGains ? "Standings" : "Standings · last round")}</div>
      <button class="btn sm" id="tolobby">${ic("x")} End game</button>
    </div>
  </section>`;
  hostDrop = false; hostPop = null;
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on("#drop", () => hostAction("drop"));
  on("#next", nextTurn);
  armTwoTap($("#skip"), "Tap again to skip", skipTurn);
  armTwoTap($("#tolobby"), "Tap again to end the game", () => hostAction("lobby"));
  hostTick();
}

function awardsHTML(awards, players){
  if (!awards || !awards.length) return "";
  const byPid = Object.fromEntries(players.map(p=>[p.pid,p]));
  return `<div class="awards">${awards.map(a => { const p = byPid[a.who], q = a.who2 ? byPid[a.who2] : null;
    return `<div class="award"><div class="aw-ic">${ic("award")}</div><div style="min-width:0"><div class="label" style="margin:0 0 2px">${esc(a.title)}</div>
      <div class="aw-who">${p?chipFor(p,"sm"):""}${q?chipFor(q,"sm"):""} ${esc(a.name)}</div><small class="muted">${esc(a.why)}</small></div></div>`; }).join("")}</div>`;
}
function podiumHTML(players){
  const order = players.slice().sort((a,b)=>b.score-a.score);
  const pod = (p,h,m) => p ? `<div class="pod"><div class="n">${chipFor(p,"sm")} ${esc(p.name)}</div><div class="s">${p.score}</div><div class="b" style="height:${h}px;background:${p.color};color:${textOn(p.color)}">${m}</div></div>` : "";
  return `<div class="podium">${pod(order[1],120,"2")}${pod(order[0],170,"1")}${pod(order[2],85,"3")}</div>`;
}
function renderEndScreen(){
  const order = H.players.slice().sort((a,b)=>b.score-a.score), tied = order.filter(p => p.score === order[0].score);
  $("#app").innerHTML = `<section class="landing endwrap">
    <div style="display:flex;justify-content:center">${brand()}</div>
    <div class="label" style="margin-top:26px;text-align:center">Final results</div>
    <h1 style="font-size:clamp(2rem,6vw,3.2rem);margin:0;text-align:center">${tied.length>1?`Tie: ${tied.map(p=>esc(p.name)).join(" & ")}`:`${esc(order[0].name)} wins`}</h1>
    ${podiumHTML(H.players)}
    ${awardsHTML(H.awards, H.players)}
    <div class="row" style="justify-content:center;margin-top:26px"><button class="btn primary lg" id="again">Play again</button><button class="btn lg" id="lobbyb">Back to lobby</button></div>
  </section>`;
  $("#again").onclick = () => hostAction("again");
  $("#lobbyb").onclick = () => hostAction("lobby");
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
  name: store.get("cgo.name") || "", color: store.get("cgo.color") || null, av: store.get("cgo.av") || null, code: "",
};
let V = null, phoneLocal = false;
let phonePeer = null, phoneConn = null, phoneConnected = false, everJoined = false, phoneRetryT = null, joinTimeout = null;
let phoneKey = "", readEnd = null, leftEnd = null, phoneTickT = null, drafts = {}, dropAnim = false, hostToolsOpen = false;

function phoneConnect(){
  clearTimeout(phoneRetryT);
  const open = () => {
    try { if (phoneConn) phoneConn.close(); } catch(e){}
    phoneConn = phonePeer.connect(PREFIX + PH.code, { reliable:true });
    clearTimeout(joinTimeout);
    joinTimeout = setTimeout(() => { if (!phoneConnected) retryOrFail(); }, 9000);
    phoneConn.on("open", () => { phoneConnected = true; clearTimeout(joinTimeout); phoneConn.send({ t:"join", pid:PH.pid, name:PH.name, color:PH.color, av:PH.av }); });
    phoneConn.on("data", onPhoneMsg);
    phoneConn.on("close", () => { phoneConnected = false; renderPhone(); scheduleRetry(); });
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
function retryOrFail(){ if (!everJoined){ renderJoin(`No game found with code ${PH.code}. Check the code on the host’s screen.`); return; } scheduleRetry(); }
function scheduleRetry(){ clearTimeout(phoneRetryT); phoneRetryT = setTimeout(() => { if (!phoneConnected && mode === "phone") phoneConnect(); }, 2500); }
function psend(m){
  if (phoneLocal){ const c = conns.get(PH.pid); if (c) onHostMsg(c, m); return; }
  if (phoneConn && phoneConn.open) phoneConn.send(m); else toast("Reconnecting… try again in a moment");
}
function onPhoneMsg(m){
  if (!m) return;
  if (m.t === "error"){ if (!everJoined){ phoneConnected = false; try{phoneConn.close()}catch(e){} renderJoin(m.msg); } else toast(m.msg); return; }
  if (m.t === "kicked"){ everJoined = false; try{phoneConn.close()}catch(e){} renderJoin("The host removed you from this game."); return; }
  if (m.t !== "state") return;
  everJoined = true; mode = "phone";
  if (V && ((V.phase === "guess" && m.phase === "reveal"))) dropAnim = true;
  V = m;
  readEnd = m.readLeft !== null ? now() + m.readLeft : null;
  leftEnd = m.left !== null ? now() + m.left : null;
  const me = V.players.find(p => p.pid === V.you);
  if (me){ PH.color = me.color; PH.av = me.av; store.set("cgo.color", me.color); store.set("cgo.av", me.av); }
  if (!phoneLocal) store.set("cgo.code", V.code);
  renderPhone();
}

/* ---------- join / host-and-play setup ---------- */
function renderJoin(err, hosting){
  mode = "join";
  const code = PH.code || (location.hash.slice(1).toUpperCase().replace(/[^A-Z]/g,"").slice(0,4)) || "";
  $("#app").innerHTML = `<section class="phone">
    <div class="hero">${brand()}<p style="margin-top:10px">${hosting ? "You’ll host the game from this phone and play too." : "Join the game on the host’s screen."}</p></div>
    <form class="card stack" id="joinf">
      ${hosting ? "" : `<label class="stack" style="gap:6px"><span class="label" style="margin:0">Room code</span>
        <input type="text" id="code" value="${esc(code)}" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" class="codein"></label>`}
      <label class="stack" style="gap:6px"><span class="label" style="margin:0">Your name</span>
        <input type="text" id="name" value="${esc(PH.name)}" maxlength="16" autocomplete="nickname" placeholder="Name"></label>
      ${err ? `<p class="conn" style="margin:0">${esc(err)}</p>` : ""}
      <button class="btn primary lg block" id="joinb">${hosting ? "Create room" : "Join game"} ${ic("arrowr")}</button>
    </form>
    <p class="muted" style="text-align:center;margin:0">You can pick your character and color in the lobby.</p>
    <button class="btn block" id="back">Back</button>
  </section>`;
  $("#joinf").onsubmit = e => {
    e.preventDefault();
    const n = $("#name").value.trim(); if (!n) return toast("Type your name.");
    PH.name = n; store.set("cgo.name", n);
    if (hosting){ tone(1,.01); startHosting("play", false, { name:n, color:PH.color, av:PH.av }); return; }
    const c = $("#code").value.toUpperCase().replace(/[^A-Z]/g,"");
    if (c.length !== 4) return toast("Room codes are 4 letters.");
    PH.code = c; $("#joinb").disabled = true; $("#joinb").textContent = "Joining…";
    everJoined = false; mode = "phone"; phoneConnect();
  };
  $("#back").onclick = () => { history.replaceState(null, "", location.pathname); renderLanding(); };
}

/* ---------- phone screens ----------
   Each screen is built once (its "shell"), then later updates only patch the parts that change,
   so typing in a text box isn't interrupted when someone else does something. */
function renderPhone(){
  if (mode !== "phone" || !V) return;
  const me = V.players.find(p => p.pid === V.you) || { name:PH.name, color:"#999", av:"fox", score:0 };
  const isLeader = V.leader === V.you, plot = V.settings.game === "plot";
  const role = ["lobby","end"].includes(V.phase) ? "" : isLeader ? "lead" : "play";
  const k = [V.phase, V.turn, role, V.code, V.settings.game].join("|");
  if (k !== phoneKey){
    phoneKey = k; drafts = {};
    $("#app").innerHTML = `<section class="phone"><div id="ph-head"></div><div id="ph-host"></div><div id="ph-body" class="stack"></div></section>`;
    shellFor(role, plot);
  }
  const playing = !["lobby"].includes(V.phase), rank = rankOf(V.players, V.you);
  patch("#ph-head", `<div class="phead"><div class="me">${chipFor(me)}<span>${esc(me.name)}</span></div>
    ${!phoneConnected ? `<div class="conn">${ic("wifi")} Reconnecting…</div>`
      : playing ? `<div class="pscore"><span class="place">${ordinal(rank)} of ${V.players.length}</span> ${me.score} pts</div>` : ""}</div>`);
  updateHostCard();
  updatePhone(me, isLeader, plot);
  // standings stay at the bottom of every in-game screen (results screens have their own, with this round's points)
  const body = $("#ph-body");
  if (body && playing && !$("#stand")){
    if (!$("#stand-w")) body.insertAdjacentHTML("beforeend", `<div class="card" id="stand-w"></div>`);
    patch("#stand-w", standingsHTML(V.players, V.lastGains, V.leader, V.you, V.lastGains ? "Standings · last round" : "Standings"));
  }
  dropAnim = false;
}
const pmap = () => Object.fromEntries(V.players.map(p => [p.pid, p]));
const leaderP = () => pmap()[V.leader] || { name:"", color:"#999", av:"fox" };

function updateHostCard(){
  const box = $("#ph-host"); if (!box) return;
  if (!V.isHost){ box.innerHTML = ""; return; }
  if (V.phase === "lobby"){
    if (!box.querySelector("#hc-lobby")){
      box.innerHTML = `<div class="card stack" id="hc-lobby"><div class="label" style="margin:0">You’re hosting</div><div id="hc-join"></div>
        <div id="hc-settings"></div><div id="hc-custom"></div>
        <button class="btn primary lg block" id="hc-start"></button>
        <button class="btn block" id="hc-close">Close this room</button></div>`;
      $("#hc-start").onclick = () => psend({ t:"host", a:"start" });
      armTwoTap($("#hc-close"), "Tap again to close the room", () => psend({ t:"host", a:"close" }));
      $("#hc-custom").innerHTML = customHTML();
    }
    const qr = qrSvg(V.joinUrl);
    patch("#hc-join", `<div class="hostjoin"><div><div class="muted">Friends go to</div><div class="url sm">${esc(shortUrl())}</div><div class="muted">and enter</div><div class="code sm">${esc(V.code)}</div>
      <span class="status ${V.online?"on":""}"><i></i>${V.online?"Room open":"Connecting…"}</span></div>${qr?`<div class="qr sm">${qr}</div>`:""}</div>`);
    patch("#hc-settings", settingsHTML());
    patch("#customlist", customListHTML());
    const hc = $("#hc-custom"); if (hc && (!!H.custom.length) !== !!hc.querySelector(".customnote")) hc.innerHTML = customHTML();
    const can = V.players.length >= 3, st = $("#hc-start");
    st.disabled = !can; st.innerHTML = can ? `Start ${GAME_LABEL[V.settings.game]} with ${V.players.length} players ${ic("arrowr")}` : `Need at least 3 players (${V.players.length} joined)`;
    return;
  }
  if (V.phase === "end"){
    box.innerHTML = `<div class="card row" style="justify-content:space-between"><span class="label" style="margin:0">Host</span>
      <div class="row"><button class="btn primary" id="hc-again">Play again</button><button class="btn" id="hc-lobby">Lobby</button></div></div>`;
    $("#hc-again").onclick = () => psend({ t:"host", a:"again" });
    $("#hc-lobby").onclick = () => psend({ t:"host", a:"lobby" });
    return;
  }
  if (!box.querySelector("#hc-tools")){
    box.innerHTML = `<details class="card hosttools" id="hc-tools" ${hostToolsOpen?"open":""}><summary>${ic("menu")} Host tools · room <b>${esc(V.code)}</b></summary>
      <div class="rr" style="margin-top:10px"><button class="btn sm" id="hc-drop">End this step now</button><button class="btn sm" id="hc-skip">Skip turn</button>
      <button class="btn sm" id="hc-end" style="grid-column:1/-1">End game</button></div></details>`;
    $("#hc-tools").addEventListener("toggle", e => hostToolsOpen = e.target.open);
    $("#hc-drop").onclick = () => psend({ t:"host", a:"drop" });
    armTwoTap($("#hc-skip"), "Tap again to skip", () => psend({ t:"host", a:"skip" }));
    armTwoTap($("#hc-end"), "Tap again to end the game", () => psend({ t:"host", a:"lobby" }));
  }
}

function shellFor(role, plot){
  const b = $("#ph-body"), ph = V.phase;
  clearInterval(phoneTickT); phoneTickT = setInterval(phoneTick, 250);
  const card = (inner, cls="") => `<div class="card ${cls}">${inner}</div>`;
  if (ph === "lobby"){
    b.innerHTML = card(`<div class="label">${V.isHost ? "Lobby" : `Room ${esc(V.code)}`}</div><h1 class="ph-title">You’re in</h1><p class="muted" style="margin:0">${V.isHost ? "Start the game when everyone has joined." : "Waiting for the host to start the game."}</p>`, "hero")
      + card(`<div class="label">Your character</div><div class="avgrid" id="avs"></div><div class="label" style="margin-top:16px">Your color</div><div class="palette" id="pal"></div>`)
      + card(`<div class="label" id="pl-count"></div><div class="plist" id="plist"></div>`);
    b.addEventListener("click", e => {
      const a = e.target.closest("[data-av]"); if (a && !a.classList.contains("used")) return psend({ t:"look", av:a.dataset.av });
      const c = e.target.closest("[data-c]"); if (c && !c.classList.contains("used")) return psend({ t:"look", color:c.dataset.c });
      const k = e.target.closest("[data-kick]"); if (k && V.isHost) psend({ t:"host", a:"kick", pid:k.dataset.kick });
    });
    return;
  }
  if (ph === "end"){ b.innerHTML = card("", "result") .replace('class="card result"', 'class="card result" id="endbox"') + `<div id="awards"></div>` + card(`<div id="stand"></div>`); return; }

  if (ph === "pick" && role === "lead"){
    b.innerHTML = card(`<div class="label">${plot ? "You pick the category" : "You’re the clue giver"}</div><div id="l-cat"></div>`)
      + card(`<div id="l-grid"></div><p class="muted small" id="l-hint"></p>`, "gridcard")
      + card(`<div class="rr"><button class="btn sm" data-act="rb">${ic("shuffle")} Both scales</button><button class="btn sm" data-act="rt">${ic("dice")} New topic</button>
          ${plot ? "" : `<button class="btn sm" data-act="square" style="grid-column:1/-1">${ic("target")} New random square</button>`}</div>
          <select id="tsel" style="margin-top:10px"></select>
          <button class="btn primary lg block" data-act="lockcat" style="margin-top:12px">${ic("check")} Lock this category</button>`);
    $("#tsel").onchange = e => psend({ t:"act", a:"topic", v:+e.target.value });
    b.addEventListener("click", e => {
      const a = e.target.closest("[data-act]"); if (a){ psend({ t:"act", a:a.dataset.act }); return; }
      const c = e.target.closest(".cell"); if (c && V.settings.pick && !plot) psend({ t:"act", a:"cell", x:+c.dataset.x, y:+c.dataset.y });
    });
    return;
  }
  if (ph === "pick"){
    b.innerHTML = card(`<div class="label">Get ready</div><h1 class="ph-title" id="w-name"></h1><p class="muted" style="margin:0">is choosing the category <span class="dots"><i></i><i></i><i></i></span></p>`, "hero")
      + `<div id="rate"></div>`;
    b.addEventListener("click", e => { const s = e.target.closest("[data-star]"); if (s) psend({ t:"rate", stars:+s.dataset.star }); });
    return;
  }
  if (ph === "read"){
    b.innerHTML = card(`<div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:nowrap"><div id="r-cat" style="min-width:0"></div><div class="timer" id="ptimer"></div></div>`)
      + card(`<div id="r-grid"></div>`, "gridcard")
      + (role === "lead" && !plot ? card(`<div class="label">Your clue</div>
          <input type="text" id="clue" maxlength="60" placeholder="Type it, or just say it out loud">
          <button class="btn primary lg block" id="sendclue" style="margin-top:10px"></button>`) : card(`<p class="muted" style="margin:0" id="r-msg"></p>`));
    const cl = $("#clue"); if (cl) cl.oninput = e => drafts.clue = e.target.value;
    const sc = $("#sendclue"); if (sc) sc.onclick = () => psend({ t:"clue", clue: drafts.clue || "" });
    return;
  }
  if (ph === "guess" && role === "lead"){
    b.innerHTML = card(`<div class="label">Your clue is out</div><div id="gg-clue" class="big-clue"></div>`)
      + card(`<div id="gg-grid"></div>`, "gridcard")
      + card(`<div class="row" style="justify-content:space-between"><div class="label" style="margin:0" id="gg-count"></div><div class="timer" id="ptimer"></div></div>
          <button class="btn primary lg block" id="dropb" style="margin-top:12px">Drop the star</button><p class="muted small" id="gg-note" style="margin:8px 0 0"></p>`);
    $("#dropb").onclick = () => psend({ t:"drop" });
    return;
  }
  if (ph === "guess"){
    b.innerHTML = card(`<div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:nowrap"><div style="min-width:0"><div class="label" id="q-who"></div><div id="q-clue" class="big-clue left"></div></div><div class="timer" id="ptimer"></div></div><div id="q-axes" style="margin-top:10px"></div>`)
      + card(`<div id="q-grid"></div>`, "gridcard") + `<div id="q-act"></div><div id="q-bet"></div>`;
    b.addEventListener("click", e => {
      const c = e.target.closest(".cell");
      if (c){
        const mine = (V.votes||[]).find(v => v.pid === V.you);
        if (mine && mine.locked) return toast("Tap Change to move your vote.");
        if (c.classList.contains("taken")) return toast("Someone already has that square.");
        return psend({ t:"vote", x:+c.dataset.x, y:+c.dataset.y });
      }
      if (e.target.closest("#lockb")) return psend({ t:"lock" });
      if (e.target.closest("#unlockb")) return psend({ t:"unlock" });
      const bet = e.target.closest("[data-bet]"); if (bet) return psend({ t:"bet", on: bet.dataset.bet === "none" ? null : bet.dataset.bet });
    });
    return;
  }
  if (ph === "reveal"){
    b.innerHTML = card(`<div id="rv-box"></div>`, "result") + card(`<div id="rv-grid"></div>`, "gridcard") + `<div id="rv-next"></div>` + card(`<div id="stand"></div>`);
    b.addEventListener("click", e => { if (e.target.closest("#nextb")) psend({ t:"next" }); });
    return;
  }
  if (ph === "plot"){
    b.innerHTML = card(`<div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:nowrap"><div id="p-cat" style="min-width:0"></div><div class="timer" id="ptimer"></div></div>`)
      + card(`<div class="label">Your answer</div><input type="text" id="ptext" maxlength="40" placeholder="Name something that fits">
          <p class="muted small" style="margin:8px 0 0">Then tap where it belongs on the grid.</p>`)
      + card(`<div id="p-grid"></div>`, "gridcard") + `<div id="p-act"></div>`;
    const t = $("#ptext"); let tT;
    t.oninput = e => { drafts.ptext = e.target.value; clearTimeout(tT); tT = setTimeout(() => psend({ t:"answer", text:drafts.ptext }), 350); };
    b.addEventListener("click", e => {
      const c = e.target.closest(".cell");
      if (c){ if (V.myAnswer && V.myAnswer.locked) return toast("Tap Change to edit your answer."); return psend({ t:"answer", text: drafts.ptext ?? (V.myAnswer && V.myAnswer.text) ?? "", x:+c.dataset.x, y:+c.dataset.y }); }
      if (e.target.closest("#plockb")){ if (drafts.ptext !== undefined) psend({ t:"answer", text:drafts.ptext }); return psend({ t:"plock" }); }
      if (e.target.closest("#punlockb")) return psend({ t:"punlock" });
      if (e.target.closest("#pdropb")) return psend({ t:"drop" });
    });
    return;
  }
  if (ph === "pvote"){
    b.innerHTML = card(`<div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:nowrap"><div id="v-cat" style="min-width:0"></div><div class="timer" id="ptimer"></div></div>`)
      + card(`<div id="v-grid"></div>`, "gridcard")
      + card(`<div class="label">Which answer is placed best?</div><div class="vlist" id="v-best"></div>`)
      + card(`<div class="label">Most misplaced? (optional)</div><div class="vlist" id="v-hot"></div>`) + `<div id="v-end"></div>`;
    b.addEventListener("click", e => {
      const v = e.target.closest("[data-vbest]"); if (v) return psend({ t:"pvote", on:v.dataset.vbest });
      const h = e.target.closest("[data-vhot]"); if (h) return psend({ t:"phot", on: h.dataset.vhot === "none" ? null : h.dataset.vhot });
      if (e.target.closest("#vendb")) psend({ t:"drop" });
    });
    return;
  }
  if (ph === "presult"){
    b.innerHTML = card(`<div id="pr-box"></div>`, "result") + card(`<div id="pr-grid"></div>`, "gridcard") + card(`<div id="pr-list"></div>`) + `<div id="rv-next"></div>` + card(`<div id="stand"></div>`);
    b.addEventListener("click", e => { if (e.target.closest("#nextb")) psend({ t:"next" }); });
  }
}

function phoneTick(){
  const el = $("#ptimer"); if (!el || !V) return;
  const end = V.phase === "read" ? readEnd : leftEnd;
  if (!end){ el.textContent = ""; }
  else { const left = end - now(); el.textContent = secs(left) + "s"; el.classList.toggle("low", left < 6000); }
  const sc = $("#sendclue");
  if (sc){ const left = readEnd ? readEnd - now() : 0; sc.disabled = left > 0; sc.innerHTML = left > 0 ? `Send clue in ${secs(left)}s` : `Send clue &amp; open voting ${ic("arrowr")}`; }
}

function nextButton(me, isLeader){
  const last = V.turn >= V.total - 1, nx = pmap()[V.next], mine = V.next === V.you;
  return mine || isLeader || V.isHost
    ? `<button class="btn primary lg block" id="nextb">${last ? "Show final results" : mine ? (V.settings.game==="plot" ? "Start my turn picking" : "Start my turn as clue giver") : `Next: ${esc(nx?nx.name:"")}`} ${ic("arrowr")}</button>`
    : `<div class="card muted" style="text-align:center">${last ? "Final results are coming up." : `${esc(nx?nx.name:"")} is up next.`}</div>`;
}

function updatePhone(me, isLeader, plot){
  const ph = V.phase, players = pmap(), L = leaderP(), cat = V.cat;
  if (ph === "lobby"){
    const others = V.players.filter(p => p.pid !== V.you);
    patch("#avs", AV_KEYS.map(a => `<button data-av="${a}" class="${a===me.av?"cur":""} ${others.some(p=>p.av===a)?"used":""}" style="--pc:${me.color};--fg:${textOn(me.color)}" aria-label="${a}">${avSvg(a)}</button>`).join(""));
    patch("#pal", COLORS.map(c => `<button data-c="${c}" class="${c===me.color?"cur":""} ${others.some(p=>p.color===c)?"used":""}" style="background:${c}" aria-label="Color ${c}"></button>`).join(""));
    patch("#pl-count", `Players · ${V.players.length}`);
    patch("#plist", V.players.map(p => `<div class="pl ${p.online?"":"off"}">${chipFor(p)}${esc(p.name)}<span class="st">${p.pid===V.you?"you":p.pid===V.hostPid?"host":""}</span>
      ${V.isHost && p.pid !== V.you ? `<button class="kick" data-kick="${p.pid}" aria-label="Remove ${esc(p.name)}">${ic("x")}</button>` : ""}</div>`).join(""));
    return;
  }
  if (ph === "end"){
    const order = V.players.slice().sort((a,b)=>b.score-a.score), rank = order.findIndex(p=>p.pid===V.you) + 1;
    patch("#endbox", `<div class="label">Final results</div><div class="pts">#${rank}</div><p class="muted" style="margin:6px 0 0">${me.score} points · ${esc(order[0].name)} wins</p>`);
    patch("#awards", V.awards && V.awards.length ? `<div class="card"><div class="label">Awards</div>${awardsHTML(V.awards, V.players)}</div>` : "");
    patch("#stand", standingsHTML(V.players, null, null, V.you));
    return;
  }
  if (ph === "pick" && isLeader){
    patch("#l-cat", topicHTML(cat) + `<div style="margin-top:10px">${axesHTML(cat)}</div>`);
    patch("#l-grid", gridHTML({ cat, target: plot ? null : V.target, items:[], mode:"plain", edit:true, clickable: V.settings.pick && !plot }));
    patch("#l-hint", plot ? "Shuffle a scale with the buttons on the grid’s edges. When it looks good, lock it in and everyone gets to read it."
                          : `Your secret square is <b>${V.target[0]}, ${V.target[1]}</b>.${V.settings.pick?" Tap the grid to move it.":""} Nobody sees the category until you lock it in.`);
    const ts = $("#tsel");
    if (ts && ts.dataset.t !== cat.name){ ts.innerHTML = (V.topics||[]).map((t,i)=>`<option value="${i}" ${t===cat.name?"selected":""}>${esc(t)}</option>`).join(""); ts.dataset.t = cat.name; }
    return;
  }
  if (ph === "pick"){
    patch("#w-name", `${chipFor(L)} <span style="color:${L.color}">${esc(L.name)}</span>`);
    patch("#rate", V.rate ? `<div class="card"><div class="label">While you wait: rate the last clue</div>
      <div class="big-clue left" style="margin-bottom:10px">${V.rate.clue ? `“${esc(V.rate.clue)}”` : `<span class="muted" style="font-size:1rem">${esc((players[V.rate.giver]||{}).name||"")}’s spoken clue</span>`}</div>
      <div class="stars">${[1,2,3].map(s=>`<button data-star="${s}" class="${V.rate.mine>=s?"on":""}" aria-label="${s} stars">${ic("star2")}</button>`).join("")}</div>
      <p class="muted small" style="margin:8px 0 0">The best-rated clue wins Clue of the Night.</p></div>`
      : `<div class="card muted">Think about what’s coming: a topic and two scales. ${plot ? "You’ll each name something and place it." : "Then a clue."}</div>`);
    return;
  }
  if (ph === "read"){
    patch("#r-cat", topicHTML(cat) + `<div style="margin-top:10px">${axesHTML(cat)}</div>`);
    patch("#r-grid", gridHTML({ cat, target: isLeader && !plot ? V.target : null, items:[], mode:"plain" }));
    const m = $("#r-msg"); if (m) m.textContent = plot ? "Plotting starts when the timer ends. Think of something that fits." : `${L.name} sends the clue when the timer ends. Voting opens then.`;
    phoneTick();
    return;
  }
  if (ph === "guess" && isLeader){
    const n = V.players.length - 1;
    patch("#gg-clue", V.clue ? esc(V.clue) : `<span class="muted" style="font-size:1rem">Say your clue out loud</span>`);
    patch("#gg-grid", gridHTML({ cat, target:V.target, items: voteItems(true), mode:"plain" }));
    patch("#gg-count", `${V.voteCount}/${n} voted · ${V.lockCount} locked`);
    const d = $("#dropb"); if (d) d.disabled = !V.allPlaced;
    patch("#gg-note", V.allPlaced ? "Everyone has voted. You can drop the star now, or wait for everyone to lock in." : "You can drop the star once everyone has placed a vote. It drops by itself when everyone locks in.");
    return;
  }
  if (ph === "guess"){
    const mine = (V.votes||[]).find(v => v.pid === V.you), mode_ = V.settings.vote;
    patch("#q-who", `Clue from ${esc(L.name)} · ${VOTE_INFO[mode_][0]} voting`);
    patch("#q-clue", V.clue ? esc(V.clue) : `<span class="muted" style="font-size:1rem">Listen for the clue</span>`);
    patch("#q-axes", axesHTML(cat));
    const blocked = mode_ === "claim" ? new Set((V.votes||[]).filter(v => v.pid !== V.you).map(v => v.x+","+v.y)) : null;
    patch("#q-grid", gridHTML({ cat, items: voteItems(false), mode:"plain", clickable: !(mine && mine.locked), blocked }));
    let act;
    if (!mine) act = `<div class="card muted">Tap a square to vote.${mode_==="claim"?" Squares other people are on are blocked.":mode_==="secret"?" Nobody can see your vote until the star drops.":""}</div>`;
    else if (!mine.locked) act = `<button class="btn primary lg block" id="lockb">${ic("check")} Lock in ${mine.x}, ${mine.y}</button><p class="muted small" style="text-align:center;margin:6px 0 0">Tap another square to move your vote.</p>`;
    else act = `<div class="card row" style="justify-content:space-between"><span class="badge ok">${ic("check")} Locked in at ${mine.x}, ${mine.y}</span><button class="btn sm" id="unlockb">Change</button></div>`;
    patch("#q-act", act);
    const others = V.players.filter(p => p.pid !== V.you && p.pid !== V.leader);
    patch("#q-bet", mine && mine.locked && others.length ? `<div class="card"><div class="label">Side bet: who will be closest?</div>
      <div class="betlist">${others.map(p=>`<button data-bet="${p.pid}" class="${V.myBet===p.pid?"on":""}">${chipFor(p,"sm")}${esc(p.name)}</button>`).join("")}
      <button data-bet="none" class="${V.myBet===null?"on":""}">No bet</button></div><p class="muted small" style="margin:8px 0 0">Right call: +${RULES.classic.betWin} point.</p></div>` : "");
    return;
  }
  if (ph === "reveal"){
    const mine = (V.votes||[]).find(v => v.pid === V.you), gain = (V.gains && V.gains[V.you]) || 0;
    let line;
    if (isLeader) line = `${V.bonus ? `Includes a +${V.bonus} bonus for everyone landing close. ` : ""}Points for votes near your square.`;
    else if (!mine) line = "You didn’t vote this time.";
    else { const d = cheb([mine.x,mine.y], V.target); line = d===0 ? "Exact square!" : d===1 ? "One square away." : d===2 ? "Two squares away." : "Not close this time."; }
    if (V.betWinners && V.betWinners.includes(V.you)) line += ` Your side bet paid off (+${RULES.classic.betWin}).`;
    patch("#rv-box", `<div class="label">Answer ${V.target[0]}, ${V.target[1]}</div><div class="pts" style="color:${gain?"var(--ok)":"var(--faint)"}">+${gain}</div><p class="muted" style="margin:6px 0 0">${line}</p>`);
    const rg = $("#rv-grid"); if (rg && !rg.dataset.done){ rg.innerHTML = gridHTML({ cat, target:V.target, items: voteItems(false), mode:"reveal", drop:true }); rg.dataset.done = "1"; }
    patch("#rv-next", nextButton(me, isLeader));
    patch("#stand", standingsHTML(V.players, V.gains, V.leader, V.you));
    return;
  }
  if (ph === "plot"){
    const a = V.myAnswer;
    patch("#p-cat", topicHTML(cat) + `<div style="margin-top:10px">${axesHTML(cat)}</div>`);
    const t = $("#ptext"); if (t && document.activeElement !== t && drafts.ptext === undefined && a) t.value = a.text || "";
    if (t) t.disabled = !!(a && a.locked);
    patch("#p-grid", gridHTML({ cat, items: a && a.x ? [{ x:a.x, y:a.y, color:me.color, html:`<span class="nm">${avSvg(me.av)}</span>`, mine:true, tentative:!a.locked }] : [], mode:"plain", clickable: !(a && a.locked) }));
    const text = drafts.ptext ?? (a && a.text) ?? "";
    let act;
    if (a && a.locked) act = `<div class="card row" style="justify-content:space-between"><span class="badge ok">${ic("check")} “${esc(a.text)}” at ${a.x}, ${a.y}</span><button class="btn sm" id="punlockb">Change</button></div>`;
    else act = `<button class="btn primary lg block" id="plockb" ${text.trim() && a && a.x ? "" : "disabled"}>${ic("check")} Lock in my answer</button>`;
    if (isLeader) act += `<button class="btn block" id="pdropb" style="margin-top:8px" ${V.allPlaced?"":"disabled"}>Reveal answers now</button>
      <p class="muted small" style="text-align:center;margin:6px 0 0">${V.allPlaced ? "Everyone has an answer placed." : "Available once everyone has placed an answer."} ${V.answerCount}/${V.players.length} locked.</p>`;
    patch("#p-act", act);
    const pl = $("#plockb"); if (pl && t) t.oninput = (e => { drafts.ptext = e.target.value; pl.disabled = !(e.target.value.trim() && a && a.x); clearTimeout(t._tt); t._tt = setTimeout(() => psend({ t:"answer", text:drafts.ptext }), 350); });
    return;
  }
  if (ph === "pvote"){
    patch("#v-cat", topicHTML(cat) + `<div style="margin-top:10px">${axesHTML(cat)}</div>`);
    const items = V.answers.map(a => ({ x:a.x, y:a.y, color: a.mine ? me.color : "#2b2e36", html:`<span class="nm"><b>${a.n}</b></span>`, mine:a.mine }));
    patch("#v-grid", gridHTML({ cat, items, mode:"plain" }));
    const opts = V.answers.filter(a => !a.mine);
    patch("#v-best", opts.map(a => `<button data-vbest="${a.id}" class="${V.myVote===a.id?"on":""}"><b>${a.n}</b> ${esc(a.text)} <span class="muted">${a.x}, ${a.y}</span></button>`).join("") || `<p class="muted">No other answers to vote on.</p>`);
    patch("#v-hot", opts.map(a => `<button data-vhot="${a.id}" class="${V.myHot===a.id?"on hot":""}"><b>${a.n}</b> ${esc(a.text)}</button>`).join("") + `<button data-vhot="none" class="${!V.myHot?"on":""}">No pick</button>`);
    patch("#v-end", (isLeader || V.isHost) ? `<button class="btn block" id="vendb">End voting (${V.voteCount}/${V.voterCount})</button>` : `<p class="muted small" style="text-align:center;margin:0">${V.voteCount}/${V.voterCount} voted</p>`);
    return;
  }
  if (ph === "presult"){
    const T = V.tally || { votes:{}, hot:{}, top:[], hotTop:[], nailed:[] }, gain = (V.gains && V.gains[V.you]) || 0;
    const mineA = V.answers.find(a => a.mine), myVotes = mineA ? (T.votes[mineA.id]||0) : 0;
    patch("#pr-box", `<div class="label">Round results</div><div class="pts" style="color:${gain?"var(--ok)":"var(--faint)"}">+${gain}</div>
      <p class="muted" style="margin:6px 0 0">${mineA ? `“${esc(mineA.text)}” got ${myVotes} vote${myVotes===1?"":"s"}.` : "You didn’t place an answer."}${T.top.includes(V.myVote) ? ` You backed the winner (+${RULES.plot.pickedWinner}).` : ""}</p>`);
    const items = V.answers.map(a => { const p = players[a.author] || { color:"#2b2e36" };
      return { x:a.x, y:a.y, color:p.color, html:`<span class="nm">${avSvg(p.av||"fox")}</span>`, mine:a.mine, chips: Array.from({length:T.votes[a.id]||0}, () => ({ color:"#fff" })) }; });
    const pg = $("#pr-grid"); if (pg && !pg.dataset.done){ pg.innerHTML = gridHTML({ cat, items, mode:"plain" }); pg.dataset.done = "1"; }
    const rank = V.answers.slice().sort((a,b)=>(T.votes[b.id]||0)-(T.votes[a.id]||0));
    patch("#pr-list", `<div class="label">Best placed</div>` + rank.map((a,k) => { const p = players[a.author]; const n = T.votes[a.id]||0;
      return `<div class="sr"><div class="rk">${k+1}</div>${p?chipFor(p,"sm"):""}<div class="nm">${esc(a.text)}<small>${p?esc(p.name):""}</small></div>
        <span>${T.nailed.includes(a.id)?`<span class="badge bonus">Nailed it</span> `:""}${T.hotTop.includes(a.id)?`<span class="badge hot">Hot take</span> `:""}<span class="badge">${n}</span></span><div class="sc">+${(V.gains||{})[a.id]||0}</div></div>`; }).join(""));
    patch("#rv-next", nextButton(me, isLeader));
    patch("#stand", standingsHTML(V.players, V.gains, V.leader, V.you));
  }
}
function voteItems(forLeader){
  const players = pmap();
  return (V.votes||[]).filter(v => players[v.pid]).map(v => { const p = players[v.pid];
    return { x:v.x, y:v.y, color:p.color, html:`<span class="nm">${avSvg(p.av)}</span>`, mine: v.pid === V.you, tentative: !v.locked }; });
}

/* =====================================================================
   LANDING
   ===================================================================== */
let mode = "landing";   // landing | host | join | phone
function renderLanding(){
  mode = "landing";
  const saved = store.get("cgo.host"), savedKind = store.get("cgo.hostKind");
  $("#app").innerHTML = `<section class="landing">
    ${brand()}
    <p class="lead">Give a clue, find the square. Everyone plays from their own phone.</p>
    <div class="choices three">
      <button class="choice" id="hostb"><div class="ic">${ic("tv2")}</div><b>Host on a big screen</b><span>An iPad or TV everyone can see shows the board and the room code.</span></button>
      <button class="choice" id="playb"><div class="ic">${ic("users")}</div><b>Host and play</b><span>No big screen? Start the room on your phone and play along. Everyone sees the board on their own phone.</span></button>
      <button class="choice" id="joinb2"><div class="ic">${ic("mobile")}</div><b>Join with a code</b><span>Type the 4-letter code from the host’s screen.</span></button>
    </div>
    ${saved && saved.players && saved.players.length ? `<div class="card row" style="margin-top:16px;justify-content:space-between"><div><b>Room ${esc(saved.code)}</b> <span class="muted">· ${saved.players.length} players${saved.phase!=="lobby"?" · game in progress":""}</span></div><button class="btn primary" id="resume">Resume hosting</button></div>` : ""}
  </section>`;
  $("#hostb").onclick = () => { mode = "host"; tone(1,.01); startHosting("screen", false); };
  $("#playb").onclick = () => renderJoin(null, true);
  $("#joinb2").onclick = () => renderJoin();
  const r = $("#resume"); if (r) r.onclick = () => {
    H = saved; tone(1,.01);
    if (savedKind === "play"){ PH.pid = H.hostPid; store.set("cgo.pid", PH.pid, "session"); startHosting("play", true); }
    else { mode = "host"; startHosting("screen", true); }
  };
}

// opening a link to a different room (only the #CODE part changes, so the page doesn't reload)
window.addEventListener("hashchange", () => {
  const c = location.hash.slice(1).toUpperCase().replace(/[^A-Z]/g,"");
  if (c.length !== 4 || hostKind || (mode === "phone" && c === PH.code && phoneConnected)) return;
  try { if (phoneConn) phoneConn.close(); } catch(e){}
  phoneConnected = false; everJoined = false; V = null; phoneKey = ""; PH.code = c; renderJoin();
});

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
