'use strict';

/* ============================================================= *
 *  CARGO JAM  —  full game: menus, 30 levels, save, dock, juice  *
 * ============================================================= */

/* ---------- Save / progress ---------- */
const SAVE_KEY = 'cargojam_v1';
let save = loadSave();
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && typeof s === 'object') return Object.assign({ unlocked: 1, stars: {}, coins: 0, sfx: true, music: true }, s);
  } catch (e) {}
  return { unlocked: 1, stars: {}, coins: 0, sfx: true, music: true };
}
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }
function totalStars() { return Object.values(save.stars).reduce((a, b) => a + b, 0); }

/* ---------- Materials ---------- */
const MATERIALS = {
  wood:  { color: '#a8703a', dark: '#754c22', icon: '🪵', name: 'خشب',   cargo: 'logs' },
  oil:   { color: '#3a4150', dark: '#242a34', icon: '🛢️', name: 'نفط',   cargo: 'oil' },
  food:  { color: '#e8524a', dark: '#b83a33', icon: '🍎', name: 'غذاء',  cargo: 'produce' },
  steel: { color: '#7d8ea6', dark: '#576578', icon: '🔩', name: 'حديد',  cargo: 'metal' },
  goods: { color: '#d79a5c', dark: '#a5733c', icon: '📦', name: 'بضائع', cargo: 'boxes' },
  water: { color: '#2bb8e6', dark: '#1689b3', icon: '💧', name: 'ماء',   cargo: 'liquid' },
};
const UNIT_COINS = 10, ORDER_BONUS = 25, LOAD_INTERVAL = 0.6, DRIVE_SPEED = 7.5;
// power-up tools (spent from the persistent coin wallet, save.coins)
const TOOL_COST = { hint: 0, refresh: 25, shuffle: 40, eject: 60 };
// golden "rush" orders: shorter timer, double reward — a quick-decision opportunity
const RUSH_CHANCE = 0.16, RUSH_TIME = 0.5, RUSH_MULT = 2;

/* ---------- Canvas ---------- */
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const PAD = 14;
let CELL = 60, DPR = 1, L = {};

/* ---------- State ---------- */
let levelIndex = 0;
let cols, rows, SLOTS, BAYS, maxLives;
let trucks = [], bays = [], orders = [];
let lives = 3, coins = 0, earned = 0;
let running = false, paused = false, orderSeq = 0;
let armedTool = null;      // 'eject' while the player is choosing a truck to send off
let floaters = [], particles = [];
// coin wallet is persistent (save.coins); earn banks live, tools spend live
function earn(n) { save.coins += n; earned += n; }
let patienceBase = 20;
const TIME_FACTOR = 1.8;   // strategy tuning: stretch every order's patience so play is about thinking
let lastTs = 0;
let doorAnim = [];     // per-bay door open amount 0..1

/* ---------- DOM ---------- */
const el = {};
['levelValue','livesValue','livesBox','coinsValue','leftValue'].forEach(id => el[id] = document.getElementById(id));
const screens = ['menu','levels','settings','game','profile'];
function $(id){ return document.getElementById(id); }

/* ---------- Screen manager ---------- */
let musicTimer = null;
function showScreen(name) {
  screens.forEach(s => $(s).classList.toggle('hidden', s !== name));
  hideOverlay('pauseOverlay'); hideOverlay('resultOverlay'); hideOverlay('startOverlay');
  if (name === 'menu') { $('menuStars').textContent = '⭐ ' + totalStars() + ' / ' + (LEVELS.length * 3); $('menuCoins').textContent = '🪙 ' + save.coins; }
  if (name === 'levels') buildLevelSelect();
  if (name === 'profile') buildProfile();
  if (name === 'game') updateMusic(); else updateMusic();
}
function showOverlay(id) { $(id).classList.remove('hidden'); }
function hideOverlay(id) { $(id).classList.add('hidden'); }

/* ---------- Level select ---------- */
function buildLevelSelect() {
  const grid = $('levelsGrid'); grid.innerHTML = '';
  $('levelsStars').textContent = '⭐ ' + totalStars();
  const TEST_FROM = 30;   // the obstacle test levels (31+) are always open
  for (let i = 0; i < LEVELS.length; i++) {
    const isTest = i >= TEST_FROM;
    const unlocked = i < save.unlocked || isTest;
    const st = save.stars[i] || 0;
    const d = document.createElement('div');
    d.className = 'lvl' + (unlocked ? '' : ' locked') + (isTest ? ' test' : '') + (i === levelIndex ? ' current' : '');
    d.innerHTML = `<span class="num">${i + 1}</span><span class="lvl-stars">${isTest ? '🧪' : (st ? '★'.repeat(st) + '☆'.repeat(3 - st) : '')}</span>`;
    if (unlocked) d.addEventListener('click', () => startLevel(i));
    grid.appendChild(d);
  }
}

/* ---------- Profile / player card ---------- */
const CAMPAIGN = 30;   // levels 0..29 are the campaign; 30+ are the always-open test levels
// rank ladder, keyed by total stars earned
const RANKS = [
  { min: 0,   name: 'مبتدئ الشحن',     icon: '🚚' },
  { min: 8,   name: 'سائق نشيط',       icon: '🚛' },
  { min: 20,  name: 'منسّق المستودع',   icon: '📦' },
  { min: 40,  name: 'قبطان الأرصفة',    icon: '⚓' },
  { min: 65,  name: 'خبير اللوجستيات',  icon: '🎯' },
  { min: 90,  name: 'سيّد المستودع',    icon: '👑' },
];
function profileMetrics() {
  let levels = 0, perfect = 0, campaignDone = 0;
  for (const k in save.stars) { const v = save.stars[k] || 0; if (v > 0) { levels++; if (v >= 3) perfect++; if (+k < CAMPAIGN) campaignDone++; } }
  return { stars: totalStars(), coins: save.coins, levels, perfect, campaignDone };
}
function profileBadges(m) {
  return [
    { icon: '🎉', name: 'أول توصيلة', desc: 'أكملت أول مرحلة',        got: m.levels >= 1 },
    { icon: '🔟', name: 'عشر مراحل',  desc: 'أكملت ١٠ مراحل',          got: m.levels >= 10 },
    { icon: '🌟', name: 'نجمة كاملة', desc: '٣ نجوم في مرحلة',         got: m.perfect >= 1 },
    { icon: '✨', name: 'إتقان',      desc: '٣ نجوم في ٥ مراحل',       got: m.perfect >= 5 },
    { icon: '💫', name: 'نجم ساطع',   desc: '٥٠ نجمة',                 got: m.stars >= 50 },
    { icon: '💰', name: 'ثري',        desc: 'جمعت ٥٠٠ عملة',           got: m.coins >= 500 },
    { icon: '🏆', name: 'بطل الحملة', desc: 'أنهيت الـ٣٠ مرحلة',       got: m.campaignDone >= CAMPAIGN },
    { icon: '👑', name: 'أسطورة',     desc: '٩٠ نجمة',                 got: m.stars >= 90 },
  ];
}
function buildProfile() {
  const s = totalStars();
  let cur = RANKS[0]; for (const r of RANKS) if (s >= r.min) cur = r;
  const next = RANKS[RANKS.indexOf(cur) + 1];
  $('pfAvatar').textContent = cur.icon;
  $('pfRank').textContent = cur.name;
  if (next) {
    const frac = Math.max(0, Math.min(1, (s - cur.min) / (next.min - cur.min)));
    $('pfRankFill').style.width = (frac * 100) + '%';
    $('pfNext').textContent = `التالي: ${next.name} — باقي ${next.min - s} ⭐`;
  } else { $('pfRankFill').style.width = '100%'; $('pfNext').textContent = 'أعلى رتبة — أنت الأسطورة! 👑'; }

  const m = profileMetrics();
  $('pfStars').textContent = s;
  $('pfCoins').textContent = save.coins;
  $('pfLevels').textContent = m.levels;
  $('pfPerfect').textContent = m.perfect;

  // mastery map for the 30 campaign levels
  const mg = $('pfMastery'); mg.innerHTML = '';
  for (let i = 0; i < CAMPAIGN; i++) {
    const st = save.stars[i] || 0, reached = i < save.unlocked;
    const d = document.createElement('div');
    d.className = 'pf-cell ' + (st ? 's' + st : reached ? 'open' : 'locked');
    d.textContent = st ? '★'.repeat(st) : (i + 1);
    mg.appendChild(d);
  }
  $('pfMasteryCount').textContent = m.campaignDone + ' / ' + CAMPAIGN;

  // achievement badges
  const badges = profileBadges(m), bg = $('pfBadges'); bg.innerHTML = '';
  let got = 0;
  for (const b of badges) {
    if (b.got) got++;
    const d = document.createElement('div');
    d.className = 'pf-badge' + (b.got ? ' got' : '');
    d.innerHTML = `<span class="pf-b-ic">${b.got ? b.icon : '🔒'}</span><b>${b.name}</b><small>${b.desc}</small>`;
    bg.appendChild(d);
  }
  $('pfBadgeCount').textContent = got + ' / ' + badges.length;
}

/* ---------- Audio ---------- */
let audioCtx = null;
function actx() { if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } return audioCtx; }
function beep(freq, dur = 0.08, type = 'sine', vol = 0.12) {
  if (!save.sfx) return; const a = actx(); if (!a) return;
  try {
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    o.connect(g); g.connect(a.destination); o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.stop(a.currentTime + dur);
  } catch (e) {}
}
// ---- richer synthesis layer: master bus, filtered noise, swept tones ----
let master = null;
function mgain() { const a = actx(); if (!a) return null; if (!master) { master = a.createGain(); master.gain.value = 0.85; master.connect(a.destination); } return master; }
let _noise = null;
function noiseBuf() { const a = actx(); if (!a) return null; if (_noise) return _noise; const n = Math.floor(a.sampleRate * 0.6); const b = a.createBuffer(1, n, a.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; _noise = b; return b; }
function tone(freq, dur, type, vol, sweepTo, when) {
  if (!save.sfx) return; const a = actx(); if (!a) return; try {
    const o = a.createOscillator(), g = a.createGain(), t0 = a.currentTime + (when || 0);
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol || 0.1, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(mgain()); o.start(t0); o.stop(t0 + dur + 0.03);
  } catch (e) {}
}
function noise(dur, filter, freq, q, vol, sweepTo) {
  if (!save.sfx) return; const a = actx(); if (!a) return; try {
    const s = a.createBufferSource(); s.buffer = noiseBuf();
    const f = a.createBiquadFilter(); f.type = filter || 'bandpass'; f.frequency.value = freq; if (q) f.Q.value = q;
    const g = a.createGain(); g.gain.setValueAtTime(vol || 0.1, a.currentTime);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), a.currentTime + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    s.connect(f); f.connect(g); g.connect(mgain()); s.start(); s.stop(a.currentTime + dur + 0.02);
  } catch (e) {}
}
const sndDrive  = () => { tone(70, 0.22, 'sawtooth', 0.05, 150); tone(120, 0.22, 'square', 0.03, 210); };        // engine revs up
const sndLoad   = () => { tone(240, 0.05, 'square', 0.05, 180); noise(0.05, 'bandpass', 1400, 4, 0.05); };        // cargo clunk
const sndDepart = () => { noise(0.28, 'highpass', 1800, 0.7, 0.09, 500); tone(150, 0.16, 'triangle', 0.05, 110); }; // air-brake hiss + pull away
const sndDock   = () => { tone(520, 0.05, 'sine', 0.05); setTimeout(() => tone(390, 0.06, 'sine', 0.05), 60); };  // reverse confirm
const sndDoor   = () => noise(0.4, 'lowpass', 520, 0.8, 0.05, 300);                                               // roll-up door rumble
const sndBlocked= () => tone(110, 0.16, 'sawtooth', 0.09, 80);                                                    // low honk
const sndExpire = () => { tone(330, 0.18, 'sawtooth', 0.1, 190); setTimeout(() => tone(196, 0.24, 'sawtooth', 0.09, 120), 110); };
const sndStar   = () => tone(1046, 0.14, 'triangle', 0.12, 1568);
const sndCoin   = () => { tone(988, 0.05, 'square', 0.08, 1318); setTimeout(() => tone(1318, 0.09, 'square', 0.07, 1568), 55); noise(0.05, 'highpass', 6000, 1, 0.03); }; // cha-ching
const sndWin    = () => [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'triangle', 0.12), i * 110));
const sndLose   = () => [440, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'sawtooth', 0.11, f * 0.92), i * 150));

// gentle ambient music loop
const MUSIC_NOTES = [196, 261.6, 329.6, 392, 329.6, 261.6, 220, 261.6];
let musicStep = 0;
function musicTick() {
  if (!save.music || !running || paused) return;
  const a = actx(); if (!a) return;
  try {
    const f = MUSIC_NOTES[musicStep % MUSIC_NOTES.length]; musicStep++;
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'triangle'; o.frequency.value = f; g.gain.value = 0.0;
    o.connect(g); g.connect(mgain()); o.start();
    g.gain.linearRampToValueAtTime(0.045, a.currentTime + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 1.1);
    o.stop(a.currentTime + 1.2);
    // a soft fifth for warmth
    const h = a.createOscillator(), hg = a.createGain();
    h.type = 'sine'; h.frequency.value = f * 1.5; hg.gain.value = 0;
    h.connect(hg); hg.connect(mgain()); h.start();
    hg.gain.linearRampToValueAtTime(0.02, a.currentTime + 0.2); hg.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 1); h.stop(a.currentTime + 1.1);
    // soft bass every 4 steps
    if (musicStep % 4 === 0) {
      const b = a.createOscillator(), bg = a.createGain();
      b.type = 'triangle'; b.frequency.value = 98; bg.gain.value = 0.06;
      b.connect(bg); bg.connect(mgain()); b.start();
      bg.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.9); b.stop(a.currentTime + 1);
    }
    // gentle hi-hat on the off-beat for a little groove
    if (musicStep % 2 === 1) { const s = a.createBufferSource(); s.buffer = noiseBuf(); const hf = a.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 7000; const g2 = a.createGain(); g2.gain.value = 0.015; s.connect(hf); hf.connect(g2); g2.connect(mgain()); s.start(); g2.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.06); s.stop(a.currentTime + 0.08); }
  } catch (e) {}
}
function updateMusic() {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  if (save.music) musicTimer = setInterval(musicTick, 620);
}

/* ---------- Truck geometry / jam ---------- */
function truckCells(t) { const o = []; for (let i = 0; i < t.size; i++) o.push(t.o === 'h' ? [t.c + i, t.r] : [t.c, t.r + i]); return o; }
function frontCell(t) {
  if (t.o === 'v') return t.dir === 'up' ? [t.c, t.r] : [t.c, t.r + t.size - 1];
  return t.dir === 'left' ? [t.c, t.r] : [t.c + t.size - 1, t.r];
}
let obstacles = new Set();     // "c,r" impassable terrain cells (rock / water / building)
let obstacleRects = [];        // [{x,y,w,h,kind}] for rendering
function isObstacle(c, r) { return obstacles.has(c + ',' + r); }
function occupied(c, r) { return trucks.find(t => t.state === 'depot' && truckCells(t).some(([x, y]) => x === c && y === r)) || null; }
function canExit(t) {
  let [c, r] = frontCell(t);
  const s = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[t.dir];
  c += s[0]; r += s[1];
  while (c >= 0 && c < cols && r >= 0 && r < rows) {
    if (isObstacle(c, r)) return false;              // terrain blocks the straight-line pull-out
    const o = occupied(c, r); if (o && o !== t) return false;
    c += s[0]; r += s[1];
  }
  return true;
}
// a truck's straight path (in one dir) to the edge, clear of OBSTACLES only (trucks move; terrain doesn't)
function exitObstacleClear(c, r, o, size, dir) {
  let fc, fr;
  if (o === 'v') { fc = c; fr = dir === 'up' ? r : r + size - 1; }
  else           { fr = r; fc = dir === 'left' ? c : c + size - 1; }
  const s = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir];
  fc += s[0]; fr += s[1];
  while (fc >= 0 && fc < cols && fr >= 0 && fr < rows) { if (isObstacle(fc, fr)) return false; fc += s[0]; fr += s[1]; }
  return true;
}
// face the nearest edge whose straight path is clear of obstacles (so terrain never traps a truck)
function autoDir(c, r, o, size) {
  const cands = o === 'v' ? ['up','down'] : o === 'h' ? ['left','right'] : ['up','down','left','right'];
  const dist = { up: r, down: rows - 1 - (r + (o === 'v' ? size - 1 : 0)), left: c, right: cols - 1 - (c + (o === 'h' ? size - 1 : 0)) };
  const clear = cands.filter(d => exitObstacleClear(c, r, o || (d === 'up' || d === 'down' ? 'v' : 'h'), size, d));
  const pool = (clear.length ? clear : cands).slice().sort((a, b) => dist[a] - dist[b]);
  return pool[0];
}

/* ---------- Start / load a level ---------- */
/* Analytics: custom event to GoatCounter. No-op if the script is blocked/offline. */
function track(name) {
  try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: name, title: name, event: true }); } catch (e) {}
}

function startLevel(i) {
  levelIndex = i;
  track('level-' + (i + 1) + '-start');
  showScreen('game');
  loadLevel(i);
  paused = true;                         // brief intro
  $('startTitle').textContent = 'المرحلة ' + (i + 1);
  showOverlay('startOverlay');
}
function loadLevel(i) {
  const lv = LEVELS[i];
  cols = lv.cols; rows = lv.rows; SLOTS = lv.slots; BAYS = lv.bays;
  maxLives = lv.lives; lives = lv.lives; coins = 0; earned = 0; armedTool = null;
  patienceBase = Math.round(lv.patience * TIME_FACTOR);   // longer time = room to think, not race
  bays = new Array(BAYS).fill(null);
  doorAnim = new Array(BAYS).fill(0);
  obstacles = new Set(); obstacleRects = lv.obstacles || [];
  for (const o of obstacleRects) for (let dy = 0; dy < o.h; dy++) for (let dx = 0; dx < o.w; dx++) obstacles.add((o.x + dx) + ',' + (o.y + dy));
  trucks = lv.trucks.map((t, idx) => {
    const size = t.size || 1;
    const dir = t.dir || autoDir(t.c, t.r, size > 1 ? t.o : null, size);
    const o = size > 1 ? t.o : (dir === 'left' || dir === 'right' ? 'h' : 'v');
    return { id: idx, c: t.c, r: t.r, o, dir, mat: t.mat, size, load: size, loadLeft: size,
      state: 'depot', done: false, shake: 0, loadTimer: 0, bayIndex: -1,
      x: 0, y: 0, homeX: 0, homeY: 0, anim: null, route: null, routeI: 0, routeOnFinish: null, heading: 0, smokeT: 0 };
  });
  orders = []; floaters = []; particles = []; paused = false; running = true;
  resize();
  for (let s = 0; s < SLOTS; s++) orders.push(makeOrder());
  ensureSolvableSeed(); updateHUD(); updateMusic(); render();
}
function updateHUD() {
  el.levelValue.textContent = levelIndex + 1;
  el.livesValue.textContent = lives <= 0 ? '💔' : (lives <= 3 ? '❤️'.repeat(lives) : '❤️×' + lives);
  el.livesBox.classList.toggle('low', lives <= 1);
  el.coinsValue.textContent = save.coins;      // live persistent wallet
  el.leftValue.textContent = trucks.filter(t => !t.done).length;
  updateToolBar();
}
// dim tools the player can't afford; highlight the armed tool
function updateToolBar() {
  for (const k of Object.keys(TOOL_COST)) {
    const b = $('tool' + k[0].toUpperCase() + k.slice(1)); if (!b) continue;
    b.classList.toggle('cant', save.coins < TOOL_COST[k]);
    b.classList.toggle('armed', armedTool === k);
  }
}

/* ---------- Supply / demand ---------- */
function remainingByMat(m) { return trucks.filter(t => t.mat === m && !t.done && t.state !== 'leaving').reduce((s, t) => s + t.loadLeft, 0); }
function committedByMat(m) { return orders.filter(o => o && o.mat === m).reduce((s, o) => s + (o.qty - o.done), 0); }
function availableSupply(m) { return remainingByMat(m) - committedByMat(m); }
function makeOrder() {
  const pool = [];
  for (const m of Object.keys(MATERIALS)) { const a = availableSupply(m); for (let k = 0; k < a; k++) pool.push(m); }
  if (!pool.length) return null;
  const mat = pool[Math.floor(Math.random() * pool.length)];
  const maxQ = Math.min(3, availableSupply(mat));
  const qty = 1 + Math.floor(Math.random() * Math.max(1, maxQ));
  const rush = qty <= 2 && Math.random() < RUSH_CHANCE;   // small quick orders can go golden
  const p = patienceBase * (rush ? RUSH_TIME : 1) * (0.85 + Math.random() * 0.3);
  return { id: ++orderSeq, mat, qty, done: 0, patience: p, maxP: p, flash: 0, rush };
}
function respawnSlot(idx, unclog) {
  // On an expiry while the dock is fully clogged, aim the new order at a parked
  // truck so the clog clears — a clog costs exactly one heart, never a spiral.
  if (unclog) {
    const emptyBay = bays.some(b => b === null);
    const bayT = trucks.filter(t => t.state === 'bay' || t.state === 'toBay');
    const canLoad = bayT.some(t => orders.some(o => o && o.mat === t.mat && (o.qty - o.done) > 0));
    if (!emptyBay && !canLoad && bayT.length) {
      const t = bayT[Math.floor(Math.random() * bayT.length)];
      const q = Math.min(3, Math.max(t.loadLeft, remainingByMat(t.mat)));
      const p = patienceBase * (0.85 + Math.random() * 0.3);
      orders[idx] = { id: ++orderSeq, mat: t.mat, qty: q, done: 0, patience: p, maxP: p, flash: 0 };
      return;
    }
  }
  orders[idx] = makeOrder();
}
function matchingOrderFor(mat, load) { return orders.find(o => o && o.mat === mat && (o.qty - o.done) >= load) || null; }
// STRATEGY MODE: no ongoing auto-rescue. Filling your limited bays with trucks that
// aren't demanded now clogs the dock and lets orders expire (costing hearts) — so
// which truck you stage is a real decision. Demand is still drawn from remaining
// supply, so a solution always exists; you win by planning, not racing.
function fixDeadlock() {}
// one-time fairness: guarantee the opening board has at least one deliverable truck
function ensureSolvableSeed() {
  const reach = trucks.filter(t => t.state === 'depot' && canExit(t));
  if (!reach.length) return;
  if (reach.some(t => orders.some(o => o && o.mat === t.mat && (o.qty - o.done) > 0))) return;
  const t = reach[Math.floor(Math.random() * reach.length)];
  const q = Math.min(3, Math.max(t.loadLeft, remainingByMat(t.mat)));
  const p = patienceBase * (0.85 + Math.random() * 0.3);
  orders[0] = { id: ++orderSeq, mat: t.mat, qty: q, done: 0, patience: p, maxP: p, flash: 0 };
}

/* ---------- Geometry / layout ---------- */
function cellPos(c, r) { return { x: L.lotX + c * CELL + CELL / 2, y: L.lotY + r * CELL + CELL / 2 }; }
function truckCenter(t) { const cs = truckCells(t); let sx = 0, sy = 0; for (const [c, r] of cs) { const p = cellPos(c, r); sx += p.x; sy += p.y; } return { x: sx / cs.length, y: sy / cs.length }; }
function cardRect(i) { return { x: L.cardStartX + i * L.cardW, y: L.boardY, w: L.cardW - 8, h: L.boardH }; }
function bayPos(i) { return { x: L.bayStartX + i * L.bayW + L.bayW / 2, y: L.bayY + L.bayH * 0.62 }; }

function resize() {
  const stage = $('stage'); if (!stage) return;
  const availW = Math.max(200, stage.clientWidth), availH = Math.max(200, stage.clientHeight);
  const vRows = rows + 5.0;
  const laneAllow = availW < 520 ? 1.25 : 1.7;      // slimmer ring road on phones
  const maxCols = Math.max(cols + laneAllow, SLOTS, BAYS);
  CELL = Math.max(24, Math.floor(Math.min((availW - PAD * 2) / maxCols, (availH - PAD * 2) / vRows)));
  L.w = maxCols * CELL + PAD * 2;
  L.boardH = CELL * 1.5; L.boardY = PAD;
  L.dockH = CELL * 1.7; L.dockY = L.boardY + L.boardH + CELL * 0.3;
  L.bayY = L.dockY + CELL * 0.35; L.bayH = L.dockH - CELL * 0.35;
  L.lotY = L.dockY + L.dockH + CELL * 0.85;
  L.collectorY = L.lotY - CELL * 0.45;
  L.lotX = (L.w - cols * CELL) / 2;
  L.laneW = CELL * 0.72;
  L.leftLaneX = L.lotX - L.laneW * 0.55;
  L.rightLaneX = L.lotX + cols * CELL + L.laneW * 0.55;
  L.bottomLaneY = L.lotY + rows * CELL + L.laneW * 0.6;
  L.h = L.bottomLaneY + L.laneW * 0.5 + PAD;
  L.cardW = Math.min(CELL * 1.7, (L.w - PAD * 2) / SLOTS);
  L.cardStartX = (L.w - L.cardW * SLOTS) / 2;
  L.bayW = Math.min(CELL * 1.6, (L.w - PAD * 2) / BAYS);
  L.bayStartX = (L.w - L.bayW * BAYS) / 2;

  DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = L.w + 'px'; canvas.style.height = L.h + 'px';
  canvas.width = Math.round(L.w * DPR); canvas.height = Math.round(L.h * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  trucks.forEach(t => {
    if (t.state === 'depot') { const c = truckCenter(t); t.homeX = c.x; t.homeY = c.y; if (!t.anim) { t.x = c.x; t.y = c.y; } }
    else if (t.state === 'bay' && t.bayIndex >= 0 && !t.anim) { const p = bayPos(t.bayIndex); t.x = p.x; t.y = p.y; }
  });
}

/* ---------- Routing ---------- */
function tween(o, tx, ty, dur, onDone) { return { fromX: o.x, fromY: o.y, toX: tx, toY: ty, t: 0, dur, onDone }; }
function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function startRoute(t, wps, onFinish) { t.route = wps; t.routeI = 0; t.routeOnFinish = onFinish; startSeg(t); }
function startSeg(t) {
  const wp = t.route[t.routeI];
  const dx = wp.x - t.x, dy = wp.y - t.y;
  t.heading = (wp.face !== undefined) ? wp.face : (Math.hypot(dx, dy) > 1 ? Math.atan2(dx, -dy) : t.heading);
  const dur = Math.max(0.1, Math.hypot(dx, dy) / (CELL * DRIVE_SPEED));
  t.anim = tween(t, wp.x, wp.y, dur, () => advanceRoute(t)); t.anim.linear = true;
}
function advanceRoute(t) { t.routeI++; if (t.routeI >= t.route.length) { const cb = t.routeOnFinish; t.route = null; t.routeOnFinish = null; if (cb) cb(); return; } startSeg(t); }
function routeToBay(t, bi) {
  const bp = bayPos(bi), aY = L.collectorY, mid = L.lotX + cols * CELL / 2, wps = [];
  if (t.dir === 'up') wps.push({ x: t.x, y: aY });
  else if (t.dir === 'down') { wps.push({ x: t.x, y: L.bottomLaneY }); const s = t.x < mid ? L.leftLaneX : L.rightLaneX; wps.push({ x: s, y: L.bottomLaneY }); wps.push({ x: s, y: aY }); }
  else if (t.dir === 'left') { wps.push({ x: L.leftLaneX, y: t.y }); wps.push({ x: L.leftLaneX, y: aY }); }
  else { wps.push({ x: L.rightLaneX, y: t.y }); wps.push({ x: L.rightLaneX, y: aY }); }
  wps.push({ x: bp.x, y: aY });
  wps.push({ x: bp.x, y: bp.y });
  return wps;
}

/* ---------- Input ---------- */
function handleTap(evt) {
  if (!running || paused) return;
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / DPR / rect.width, sy = canvas.height / DPR / rect.height;
  const px = (evt.clientX - rect.left) * sx, py = (evt.clientY - rect.top) * sy;
  const c = Math.floor((px - L.lotX) / CELL), r = Math.floor((py - L.lotY) / CELL);
  const t = occupied(c, r);
  // eject tool armed: next depot truck tapped drives straight off to the street
  if (armedTool === 'eject') {
    armedTool = null; updateToolBar();
    if (t) { if (buyTool('eject')) ejectTruck(t); } else sndBlocked();
    return;
  }
  if (!t) return;
  if (!canExit(t)) { t.shake = 0.3; sndBlocked(); return; }
  const bi = bays.indexOf(null);
  if (bi < 0) { t.shake = 0.3; sndBlocked(); return; }
  bays[bi] = t; t.bayIndex = bi; t.state = 'toBay';
  startRoute(t, routeToBay(t, bi), () => { t.state = 'bay'; t.loadTimer = 0; t.heading = 0; t.braked = 0.35; sndDock(); });
  sndDrive(); sndDoor(); fixDeadlock();
}
canvas.addEventListener('pointerdown', handleTap);

/* ---------- Power-up tools (spent from the persistent wallet) ---------- */
const sndTool = () => { tone(660, 0.06, 'square', 0.06, 900); noise(0.05, 'highpass', 5200, 1, 0.03); };
function buyTool(key) {
  const cost = TOOL_COST[key] || 0;
  if (save.coins < cost) { sndBlocked(); return false; }
  if (cost) { save.coins -= cost; persist(); sndTool(); }
  updateHUD();
  return true;
}
function doHint() {
  const t = trucks.find(x => x.state === 'depot' && canExit(x) && orders.some(o => o && o.mat === x.mat && (o.qty - o.done) > 0) && bays.includes(null));
  if (t) { t.shake = 0.6; beep(880, 0.1, 'sine', 0.1); } else beep(300, 0.15, 'sawtooth', 0.1);
}
function doRefresh() {
  for (let i = 0; i < SLOTS; i++) orders[i] = makeOrder();
  ensureSolvableSeed(); updateHUD();
  for (let i = 0; i < SLOTS; i++) { const rc = cardRect(i); burst(rc.x + rc.w / 2, rc.y + rc.h / 2, '#ffd166', 4); }
}
// swap the cargo around the yard: positions & facings stay identical, so reachability
// (and thus solvability) is unchanged — only which material sits on each truck moves.
function doShuffle() {
  const depot = trucks.filter(t => t.state === 'depot' && t.loadLeft > 0);
  if (depot.length < 2) return false;
  const mats = depot.map(t => t.mat);
  let order;
  for (let tries = 0; tries < 8; tries++) {
    order = depot.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    if (order.some((src, i) => mats[src] !== mats[i])) break;   // ensure a visible change
  }
  if (!order.some((src, i) => mats[src] !== mats[i])) return false;
  depot.forEach((t, i) => { t.mat = mats[order[i]]; t.shake = 0.3; });   // only the cargo moves; size/load/facing stay
  // demand is per-material; a swap can leave an order over-committed — regenerate those, keep winnable
  for (let i = 0; i < SLOTS; i++) { const o = orders[i]; if (o && (o.qty - o.done) > remainingByMat(o.mat)) orders[i] = makeOrder(); }
  ensureSolvableSeed(); updateHUD(); shakeMag = Math.min(6, shakeMag + 5);
  return true;
}
// send a depot truck straight off to the street: bonus-deliver what matches, then leave
function ejectTruck(t) {
  if (t.state !== 'depot') return;
  let guard = 0;
  while (t.loadLeft > 0 && guard++ < 12) {
    let idx = -1, least = Infinity;
    for (let i = 0; i < orders.length; i++) { const o = orders[i]; if (o && o.mat === t.mat && (o.qty - o.done) > 0 && o.patience < least) { least = o.patience; idx = i; } }
    if (idx < 0) break;
    const o = orders[idx], rc = cardRect(idx), mult = o.rush ? RUSH_MULT : 1;
    o.done++; t.loadLeft--; earn(UNIT_COINS * mult); spawnFloater(idx, t.mat, t.x, t.y);
    burst(rc.x + rc.w / 2, rc.y + rc.h / 2, MATERIALS[t.mat].color, 5);
    if (o.done >= o.qty) { earn(ORDER_BONUS * mult); o.flash = 0.4; confetti(rc.x + rc.w / 2, rc.y + rc.h / 2); respawnSlot(idx); }
  }
  t.state = 'leaving'; t.heading = 0; t.bayIndex = -1; burst(t.x, t.y, '#cdd6ea', 8);
  startRoute(t, [{ x: t.x, y: -CELL * 2.5 }], () => { t.state = 'done'; t.done = true; afterDepart(); });
  sndDepart();
  // keep it winnable: regenerate any order the remaining supply can no longer meet
  for (let i = 0; i < SLOTS; i++) { const o = orders[i]; if (o && (o.qty - o.done) > remainingByMat(o.mat)) orders[i] = makeOrder(); }
  ensureSolvableSeed(); persist(); updateHUD();
}
function drawArmedBanner() {
  const txt = '👆 اختر شاحنة لإخراجها إلى الشارع';
  ctx.save();
  ctx.font = `bold ${Math.floor(CELL * 0.3)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(txt).width + CELL * 0.7, h = CELL * 0.66, x = L.w / 2 - w / 2, y = Math.max(2, L.lotY - CELL * 0.95);
  ctx.fillStyle = 'rgba(255,183,3,0.96)'; roundRect(x, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = '#241500'; ctx.fillText(txt, L.w / 2, y + h / 2);
  ctx.restore();
}

/* ---------- Loading ---------- */
function tryLoad(t) {
  // deliver to the MOST URGENT matching order (least time left), not whichever
  // sits first on the board — so an older order about to expire is served first
  let idx = -1, least = Infinity;
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    if (o && o.mat === t.mat && (o.qty - o.done) > 0 && o.patience < least) { least = o.patience; idx = i; }
  }
  if (idx < 0) return;
  const o = orders[idx], rc = cardRect(idx), mult = o.rush ? RUSH_MULT : 1;
  o.done++; t.loadLeft--; earn(UNIT_COINS * mult);
  spawnFloater(idx, t.mat, t.x, t.y);
  addText(rc.x + rc.w / 2, rc.y + rc.h * 0.2, '+' + (UNIT_COINS * mult));
  burst(rc.x + rc.w / 2, rc.y + rc.h / 2, o.rush ? '#ffd166' : MATERIALS[t.mat].color, o.rush ? 8 : 5);
  sndLoad();
  if (o.done >= o.qty) { earn(ORDER_BONUS * mult); o.flash = 0.4; sndCoin(); shakeMag = Math.min(6, shakeMag + 4); confetti(rc.x + rc.w / 2, rc.y + rc.h / 2); coinArc(rc.x + rc.w / 2, rc.y + rc.h / 2); addText(rc.x + rc.w / 2, rc.y + rc.h * 0.5, '+' + (ORDER_BONUS * mult)); persist(); respawnSlot(idx); }
  if (t.loadLeft <= 0) {
    bays[t.bayIndex] = null; t.state = 'leaving'; t.heading = 0; burst(t.x, t.y, '#cdd6ea', 8);
    startRoute(t, [{ x: t.x, y: -CELL * 2.5 }], () => { t.state = 'done'; t.done = true; afterDepart(); });
    sndDepart();
  }
  updateHUD(); fixDeadlock();
}
function afterDepart() { if (trucks.every(x => x.done)) endWin(); }
function spawnFloater(cardIdx, mat, fx, fy) { const rc = cardRect(cardIdx); floaters.push({ x: fx, y: fy, tx: rc.x + rc.w / 2, ty: rc.y + rc.h / 2, t: 0, mat }); }

/* ---------- Particles & juice ---------- */
const rnd = () => Math.random();
let shakeMag = 0;
const CONFETTI_COLORS = ['#ff5c5c','#ffd166','#2bb8e6','#38d29a','#c77dff','#ff9e12'];
function addSmoke(x, y) { particles.push({ type:'smoke', x, y, vx:(rnd()-.5)*16, vy:-12-rnd()*14, life:0, max:.55+rnd()*.5, r:CELL*.06, r1:CELL*.20 }); }
function addSpark(x, y, color) { particles.push({ type:'spark', x, y, vx:(rnd()-.5)*150, vy:-50-rnd()*110, life:0, max:.45+rnd()*.35, color, r:CELL*.055 }); }
function addText(x, y, txt) { particles.push({ type:'text', x, y, vy:-46, life:0, max:.9, txt }); }
function burst(x, y, color, n) { for (let i = 0; i < n; i++) addSpark(x, y, color); }
function confetti(x, y) { for (let i = 0; i < 22; i++) particles.push({ type:'confetti', x, y, vx:(rnd()-.5)*260, vy:-90-rnd()*180, life:0, max:.9+rnd()*.6, color:CONFETTI_COLORS[(i*7)%CONFETTI_COLORS.length], rot:rnd()*6.28, vr:(rnd()-.5)*14, s:CELL*.12 }); }
function coinArc(x, y) { for (let i = 0; i < 6; i++) particles.push({ type:'coin', x, y, vx:(rnd()-.5)*90, vy:-140-rnd()*90, life:0, max:.7+rnd()*.3, s:CELL*.16 }); }
function updateParticles(dt) {
  for (const p of particles) { p.life += dt; p.x += (p.vx||0)*dt; p.y += (p.vy||0)*dt;
    if (p.type==='smoke'){ p.r += (p.r1)*dt*2.2; p.vy*=.94; p.vx*=.96; }
    else if (p.type==='spark'){ p.vy += 340*dt; }
    else if (p.type==='confetti'){ p.vy += 520*dt; p.vx*=.98; p.rot += p.vr*dt; }
    else if (p.type==='coin'){ p.vy += 640*dt; }
    else if (p.type==='text'){ p.vy*=.94; } }
  particles = particles.filter(p => p.life < p.max);
}

/* ---------- Main loop ---------- */
function render() {
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let dt = lastTs ? (now - lastTs) / 1000 : 0; lastTs = now;
  if (paused) { draw(); return; }
  dt = Math.min(0.05, Math.max(0, dt));

  for (const t of trucks) {
    if (t.anim) { t.anim.t += dt / t.anim.dur; const k = t.anim.linear ? Math.min(1, t.anim.t) : ease(Math.min(1, t.anim.t));
      t.x = t.anim.fromX + (t.anim.toX - t.anim.fromX) * k; t.y = t.anim.fromY + (t.anim.toY - t.anim.fromY) * k;
      if (t.anim.t >= 1) { const cb = t.anim.onDone; t.anim = null; if (cb) cb(); } }
    if (t.state === 'toBay' || t.state === 'leaving') { t.smokeT += dt; if (t.smokeT > 0.07) { t.smokeT = 0; const fx = Math.sin(t.heading||0), fy = -Math.cos(t.heading||0); addSmoke(t.x - fx*CELL*.4, t.y - fy*CELL*.4); } }
    if (t.state === 'bay' && running) { t.loadTimer += dt; if (t.loadTimer >= LOAD_INTERVAL) { t.loadTimer = 0; tryLoad(t); } }
    const mvd = Math.hypot(t.x - (t._px == null ? t.x : t._px), t.y - (t._py == null ? t.y : t._py));
    t.spin = (t.spin || 0) + mvd; t._px = t.x; t._py = t.y;   // wheels roll with distance travelled
    if (t.braked > 0) t.braked = Math.max(0, t.braked - dt);
    if (t.shake > 0) t.shake = Math.max(0, t.shake - dt);
  }
  // doors: open when a truck occupies the bay
  for (let i = 0; i < BAYS; i++) { const target = bays[i] ? 1 : 0; doorAnim[i] += (target - doorAnim[i]) * Math.min(1, dt * 6); }
  updateParticles(dt);
  if (shakeMag > 0) shakeMag = Math.max(0, shakeMag - dt * 22);
  if (running) {
    for (let i = 0; i < orders.length; i++) { const o = orders[i]; if (!o) continue;
      if (o.flash > 0) o.flash = Math.max(0, o.flash - dt);
      o.patience -= dt;
      if (o.patience <= 0) { lives--; sndExpire(); respawnSlot(i, true); updateHUD(); if (lives <= 0) { endLose(); break; } } }
  }
  for (const f of floaters) f.t = Math.min(1, f.t + dt / 0.4);
  floaters = floaters.filter(f => f.t < 1);
  draw();
}
function rafLoop() { try { render(); } catch (e) { console.error('render error:', e); } requestAnimationFrame(rafLoop); }
requestAnimationFrame(rafLoop);
setInterval(() => { if (document.hidden) { try { render(); } catch (e) {} } }, 250);
document.addEventListener('visibilitychange', () => { lastTs = 0; render(); });

/* ---------- Rendering ---------- */
function draw() {
  if (!L.w || !cols) return;
  ctx.clearRect(0, 0, L.w, L.h);
  const shaking = shakeMag > 0.2;
  if (shaking) { ctx.save(); ctx.translate((rnd() - 0.5) * shakeMag, (rnd() - 0.5) * shakeMag); }
  drawGround();
  drawBoard();
  drawDock();
  drawDockGlow();
  drawRoads();
  drawYard();
  drawCloudShadows();
  drawObstacles();
  for (const t of trucks) if (t.state === 'depot') drawTruck(t);
  for (const t of trucks) if (t.state !== 'depot' && !t.done) drawTruck(t);
  drawParticles();
  drawFloaters();
  if (shaking) ctx.restore();
  drawVignette();
  if (armedTool === 'eject') drawArmedBanner();
}

function drawGround() {
  const g = ctx.createLinearGradient(0, 0, 0, L.h);
  g.addColorStop(0, '#20305a'); g.addColorStop(0.5, '#2a3550'); g.addColorStop(1, '#232b42');
  ctx.fillStyle = g; ctx.fillRect(0, 0, L.w, L.h);
}

// custom order-card / floater icon per material — glossy cartoon "sticker" style
function drawMatIcon(key, cx, cy, S) {
  ctx.save(); ctx.translate(cx, cy);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const r = S*0.5, OL = r*0.13;
  if (key === 'wood') {
    const lw = r*1.55, lh = r*0.98;
    const g = ctx.createLinearGradient(0,-lh/2,0,lh/2); g.addColorStop(0,'#cf975f'); g.addColorStop(0.5,'#a8703a'); g.addColorStop(1,'#7c5024');
    roundRect(-lw/2,-lh/2,lw,lh,lh/2); ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = OL; ctx.strokeStyle = '#3a2712'; ctx.stroke();
    const ex = -lw/2+lh*0.5, er = lh*0.42;
    ctx.fillStyle = '#e9c088'; ctx.beginPath(); ctx.arc(ex,0,er,0,7); ctx.fill(); ctx.lineWidth = OL*0.8; ctx.strokeStyle = '#3a2712'; ctx.stroke();
    ctx.strokeStyle = '#a9773f'; ctx.lineWidth = r*0.07; ctx.beginPath(); ctx.arc(ex,0,er*0.55,0,7); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; roundRect(0,-lh*0.36,lw*0.42,lh*0.15,lh*0.07); ctx.fill();
  } else if (key === 'steel') {
    const w = r*1.5, h = r*1.5, fh = h*0.28, wt = w*0.3, xo = w/2, xi = wt/2, yt = h/2, yf = h/2-fh;
    ctx.beginPath();
    ctx.moveTo(-xo,-yt); ctx.lineTo(xo,-yt); ctx.lineTo(xo,-yf); ctx.lineTo(xi,-yf); ctx.lineTo(xi,yf); ctx.lineTo(xo,yf);
    ctx.lineTo(xo,yt); ctx.lineTo(-xo,yt); ctx.lineTo(-xo,yf); ctx.lineTo(-xi,yf); ctx.lineTo(-xi,-yf); ctx.lineTo(-xo,-yf); ctx.closePath();
    const g = ctx.createLinearGradient(-w/2,0,w/2,0); g.addColorStop(0,'#7c8698'); g.addColorStop(0.4,'#f4f8fc'); g.addColorStop(0.6,'#cdd5df'); g.addColorStop(1,'#68727f');
    ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = OL; ctx.strokeStyle = '#2a3242'; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; roundRect(-xo+r*0.12,-yt+r*0.06,w*0.42,fh*0.42,2); ctx.fill();
  } else if (key === 'oil') {
    const w = r*1.15, h = r*1.5;
    const g = ctx.createLinearGradient(-w/2,0,w/2,0); g.addColorStop(0,'#2b3038'); g.addColorStop(0.5,'#586170'); g.addColorStop(1,'#1c2027');
    roundRect(-w/2,-h/2,w,h,w*0.22); ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = OL; ctx.strokeStyle = '#12151b'; ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = r*0.06; for (const f of [0.3,0.7]) { const yy = -h/2+h*f; line(-w/2+2,yy,w/2-2,yy); }
    ctx.fillStyle = '#f39423'; roundRect(-w/2+2,-h*0.1,w-4,h*0.2,2); ctx.fill(); ctx.lineWidth = r*0.05; ctx.strokeStyle = '#8a4d08'; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; roundRect(-w*0.3,-h/2+r*0.12,w*0.15,h-r*0.24,w*0.07); ctx.fill();
  } else if (key === 'food') {
    const ar = r*0.82;
    ctx.strokeStyle = '#5b3a1a'; ctx.lineWidth = r*0.12; ctx.beginPath(); ctx.moveTo(0,-ar*0.5); ctx.lineTo(ar*0.06,-ar*1.02); ctx.stroke();
    ctx.save(); ctx.translate(ar*0.36,-ar*0.92); ctx.rotate(-0.5); ctx.fillStyle = '#57b23a'; ctx.beginPath(); ctx.ellipse(0,0,ar*0.36,ar*0.18,0,0,7); ctx.fill(); ctx.lineWidth = r*0.06; ctx.strokeStyle = '#2f6f1f'; ctx.stroke(); ctx.restore();
    const g = ctx.createRadialGradient(-ar*0.3,-ar*0.2,ar*0.1,0,ar*0.2,ar*1.25); g.addColorStop(0,'#ff9384'); g.addColorStop(0.5,'#ec4a3f'); g.addColorStop(1,'#bd2b22');
    ctx.beginPath(); ctx.arc(0,ar*0.2,ar,0,7); ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = OL; ctx.strokeStyle = '#6e1f18'; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.ellipse(-ar*0.34,-ar*0.02,ar*0.2,ar*0.3,-0.5,0,7); ctx.fill();
  } else if (key === 'goods') {
    const s = r*1.42, topH = s*0.3;
    const g = ctx.createLinearGradient(0,-s/2+topH,0,s/2); g.addColorStop(0,'#e9c48d'); g.addColorStop(1,'#c48f4c');
    roundRect(-s/2,-s/2+topH,s,s-topH,3); ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = OL; ctx.strokeStyle = '#6e451c'; ctx.stroke();
    ctx.fillStyle = '#f4d7a6'; roundRect(-s/2,-s/2,s,topH+3,3); ctx.fill(); ctx.lineWidth = OL*0.85; ctx.strokeStyle = '#6e451c'; ctx.stroke();
    ctx.fillStyle = 'rgba(150,110,60,0.55)'; roundRect(-s*0.12,-s/2+topH,s*0.24,s-topH,1); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; roundRect(-s/2+r*0.12,-s/2+topH+r*0.06,s*0.32,r*0.12,2); ctx.fill();
  } else if (key === 'water') {
    const ds = r*0.9, dy = r*0.14;
    const g = ctx.createRadialGradient(-ds*0.3,dy-ds*0.3,ds*0.1,0,dy,ds*1.3); g.addColorStop(0,'#c4f2ff'); g.addColorStop(0.5,'#2bb8e6'); g.addColorStop(1,'#1483b0');
    ctx.beginPath(); ctx.moveTo(0,dy-ds*1.35); ctx.bezierCurveTo(ds*1.15,dy-ds*0.05,ds*0.9,dy+ds,0,dy+ds); ctx.bezierCurveTo(-ds*0.9,dy+ds,-ds*1.15,dy-ds*0.05,0,dy-ds*1.35); ctx.closePath();
    ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = OL; ctx.strokeStyle = '#0d5f82'; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.beginPath(); ctx.ellipse(-ds*0.28,dy+ds*0.2,ds*0.15,ds*0.3,0,0,7); ctx.fill();
  }
  ctx.restore();
}

function drawBoard() {
  // "shipping orders" ticket rail
  for (let i = 0; i < SLOTS; i++) {
    const o = orders[i], rc = cardRect(i);
    const rush = o && o.rush && !(o.flash > 0);
    const g = ctx.createLinearGradient(0, rc.y, 0, rc.y + rc.h);
    if (o && o.flash > 0) { g.addColorStop(0, '#2ec27e'); g.addColorStop(1, '#1f9e63'); }
    else if (rush) { g.addColorStop(0, '#ffe27a'); g.addColorStop(1, '#f0a91a'); }
    else { g.addColorStop(0, '#f4f1e6'); g.addColorStop(1, '#e2ddcb'); }
    ctx.fillStyle = g; roundRect(rc.x, rc.y, rc.w, rc.h, 10); ctx.fill();
    if (rush) { ctx.strokeStyle = 'rgba(255,214,84,0.95)'; ctx.lineWidth = 3; roundRect(rc.x + 1.5, rc.y + 1.5, rc.w - 3, rc.h - 3, 9); ctx.stroke(); }
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; roundRect(rc.x, rc.y, rc.w, rc.h * 0.16, 6); ctx.fill(); // clip strip
    ctx.fillStyle = '#c9c2a8'; ctx.fillRect(rc.x + rc.w * 0.44, rc.y - 3, rc.w * 0.12, 6); // clip
    if (!o) { ctx.fillStyle = '#9a9482'; ctx.font = `${Math.floor(CELL*0.4)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('✓', rc.x + rc.w/2, rc.y + rc.h/2); continue; }
    drawMatIcon(o.mat, rc.x + rc.w/2, rc.y + rc.h*0.42, CELL*0.66);
    ctx.fillStyle = rush ? '#3a2a00' : '#2a2a2a'; ctx.font = `bold ${Math.floor(CELL*0.32)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('× ' + (o.qty - o.done), rc.x + rc.w/2, rc.y + rc.h*0.72);
    if (o.rush) {  // golden urgent badge
      const pw = rc.w*0.56, ph = CELL*0.26, px = rc.x + rc.w/2 - pw/2, py = rc.y + 2.5;
      ctx.fillStyle = '#c0392b'; roundRect(px, py, pw, ph, ph/2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.floor(CELL*0.19)}px system-ui`; ctx.textBaseline = 'middle';
      ctx.fillText('⚡ ×2', rc.x + rc.w/2, py + ph/2);
    }
    const bx = rc.x + rc.w*0.12, bw = rc.w*0.76, by = rc.y + rc.h - 11, bh = 5;
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; roundRect(bx, by, bw, bh, 3); ctx.fill();
    const frac = Math.max(0, o.patience / o.maxP);
    ctx.fillStyle = frac > .5 ? '#2ec27e' : frac > .25 ? '#e0a91a' : '#e0453a';
    roundRect(bx, by, bw*frac, bh, 3); ctx.fill();
  }
}

function drawDock() {
  const x = PAD - 2, w = L.w - PAD*2 + 4;
  const roofY = L.dockY - CELL*0.02, roofH = CELL*0.3;
  // warehouse wall (corrugated)
  const wallTop = roofY + roofH, wallBot = L.dockY + L.dockH;
  const wg = ctx.createLinearGradient(0, wallTop, 0, wallBot);
  wg.addColorStop(0, '#5a6685'); wg.addColorStop(1, '#3e4767');
  ctx.fillStyle = wg; roundRect(x, wallTop, w, wallBot - wallTop, 8); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 1;
  for (let vx = x + 10; vx < x + w; vx += 12) line(vx, wallTop + 4, vx, wallBot - 4);
  // roof
  ctx.fillStyle = '#2c3350'; roundRect(x - 4, roofY, w + 8, roofH, 7); ctx.fill();
  ctx.fillStyle = '#ffd166'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.floor(CELL*0.26)}px system-ui`;
  ctx.fillText('🏭  مركز الشحن', L.w/2, roofY + roofH/2);
  // pulsing amber beacon on the roof edge — a little sign of life
  const bcx = x + CELL * 0.45, bcy = roofY + roofH * 0.5, pulse = 0.5 + 0.5 * Math.sin(lastTs * 0.006);
  const bg = ctx.createRadialGradient(bcx, bcy, 0, bcx, bcy, CELL * 0.3);
  bg.addColorStop(0, `rgba(255,120,60,${0.35 + 0.45 * pulse})`); bg.addColorStop(1, 'rgba(255,120,60,0)');
  ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(bcx, bcy, CELL * 0.3, 0, 7); ctx.fill();
  ctx.fillStyle = `rgba(255,${120 + 80 * pulse | 0},80,${0.65 + 0.3 * pulse})`;
  ctx.beginPath(); ctx.arc(bcx, bcy, CELL * 0.055, 0, 7); ctx.fill();
  // bay doors + platform
  for (let i = 0; i < BAYS; i++) {
    const bx = L.bayStartX + i * L.bayW + 5, bw = L.bayW - 10;
    const doorTop = wallTop + 5, doorBot = L.bayY + L.bayH * 0.5;
    const open = doorAnim[i] || 0;
    // dark opening
    ctx.fillStyle = '#12151f'; roundRect(bx, doorTop, bw, doorBot - doorTop, 5); ctx.fill();
    if (bays[i]) { // interior glow when occupied
      ctx.fillStyle = 'rgba(255,209,102,0.10)'; roundRect(bx, doorTop, bw, doorBot - doorTop, 5); ctx.fill();
    }
    // rolling door (slides up as it opens)
    const doorH = (doorBot - doorTop) * (1 - open);
    if (doorH > 2) {
      const dg = ctx.createLinearGradient(0, doorTop, 0, doorTop + doorH);
      dg.addColorStop(0, '#aab2c8'); dg.addColorStop(1, '#79839e');
      ctx.fillStyle = dg; roundRect(bx, doorTop, bw, doorH, 5); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1.5;
      for (let yy = doorTop + 7; yy < doorTop + doorH - 2; yy += 7) line(bx + 2, yy, bx + bw - 2, yy);
    }
    // bay number
    ctx.fillStyle = '#ffd166'; ctx.font = `900 ${Math.floor(CELL*0.22)}px system-ui`;
    ctx.fillText(String(i + 1), bx + bw/2, doorTop + CELL*0.16);
    // dock platform ledge + hazard chevrons
    const pY = L.bayY + L.bayH * 0.5;
    ctx.fillStyle = '#39415f'; roundRect(bx - 2, pY, bw + 4, CELL*0.16, 3); ctx.fill();
    for (let hx = bx; hx < bx + bw; hx += CELL*0.18) { ctx.fillStyle = ((hx/CELL)|0) % 2 ? '#ffd166' : '#1b1e2a'; ctx.fillRect(hx, pY + 2, CELL*0.09, CELL*0.12); }
  }
}

// warm light spilling from the lit warehouse onto the apron below it
function drawDockGlow() {
  const y = L.bayY + L.bayH * 0.5, yb = L.collectorY + L.laneW * 0.4;
  if (yb <= y) return;
  const g = ctx.createLinearGradient(0, y, 0, yb);
  g.addColorStop(0, 'rgba(255,209,102,0.11)'); g.addColorStop(1, 'rgba(255,209,102,0)');
  ctx.fillStyle = g; ctx.fillRect(PAD, y, L.w - PAD * 2, yb - y);
}
// soft cloud shadows drifting over the depot floor — outdoor life, beneath the trucks
function drawCloudShadows() {
  const gx = L.lotX - 6, gy = L.lotY - 6, gw = cols * CELL + 12, gh = rows * CELL + 12;
  ctx.save();
  roundRect(gx, gy, gw, gh, 18); ctx.clip();
  const tsec = lastTs / 1000, span = gw + CELL * 6;
  for (let i = 0; i < 3; i++) {
    const cx = gx - CELL * 3 + (((tsec * (9 + i * 4)) + i * span * 0.4) % span + span) % span;
    const cy = gy + gh * (0.22 + i * 0.29), rr = CELL * (1.7 + i * 0.5);
    const g = ctx.createRadialGradient(cx, cy, rr * 0.15, cx, cy, rr);
    g.addColorStop(0, 'rgba(0,0,0,0.11)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * 0.62, 0, 0, 7); ctx.fill();
  }
  ctx.restore();
}
function drawRoads() {
  const lw = L.laneW, x0 = L.leftLaneX - lw/2, x1 = L.rightLaneX + lw/2, yT = L.collectorY - lw/2, yB = L.bottomLaneY + lw/2;
  ctx.fillStyle = 'rgba(15,18,30,0.6)';
  roundRect(x0, yT, x1-x0, lw, 6); ctx.fill();
  roundRect(x0, yB-lw, x1-x0, lw, 6); ctx.fill();
  roundRect(x0, yT, lw, yB-yT, 6); ctx.fill();
  roundRect(x1-lw, yT, lw, yB-yT, 6); ctx.fill();
  ctx.strokeStyle = 'rgba(255,209,102,0.30)'; ctx.lineWidth = 2; ctx.setLineDash([9, 9]);
  line(x0+lw/2, L.collectorY, x1-lw/2, L.collectorY); line(x0+lw/2, L.bottomLaneY, x1-lw/2, L.bottomLaneY);
  line(L.leftLaneX, L.collectorY, L.leftLaneX, L.bottomLaneY); line(L.rightLaneX, L.collectorY, L.rightLaneX, L.bottomLaneY);
  ctx.setLineDash([]);
}

function drawYard() {
  const gx = L.lotX - 6, gy = L.lotY - 6, gw = cols*CELL + 12, gh = rows*CELL + 12;
  const g = ctx.createLinearGradient(0, gy, 0, gy+gh); g.addColorStop(0, '#363c4e'); g.addColorStop(1, '#2b3040');
  ctx.fillStyle = g; roundRect(gx, gy, gw, gh, 18); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  for (let i = 0; i < cols*rows; i++) ctx.fillRect(L.lotX + (i*53)%(cols*CELL), L.lotY + (i*97)%(rows*CELL), 2, 2);
  // faint oil stains for a used-depot texture (deterministic, so they don't flicker)
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  for (let i = 0; i < 5; i++) { const p = cellPos((i*3+1)%cols, (i*2+2)%rows);
    ctx.beginPath(); ctx.ellipse(p.x, p.y, CELL*0.22, CELL*0.15, i, 0, 7); ctx.fill(); }
  ctx.strokeStyle = 'rgba(255,209,102,0.15)'; ctx.lineWidth = 2;
  for (let c = 1; c < cols; c++) line(L.lotX+c*CELL, L.lotY+6, L.lotX+c*CELL, L.lotY+rows*CELL-6);
  for (let r = 1; r < rows; r++) line(L.lotX+6, L.lotY+r*CELL, L.lotX+cols*CELL-6, L.lotY+r*CELL);
}

function drawObstacles() {
  for (const o of obstacleRects) {
    const x = L.lotX + o.x * CELL, y = L.lotY + o.y * CELL, w = o.w * CELL, h = o.h * CELL;
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; roundRect(x + 4, y + 5, w - 6, h - 6, 10); ctx.fill();  // shadow
    if (o.kind === 'water') {
      ctx.fillStyle = '#1487b0'; roundRect(x + 3, y + 3, w - 6, h - 6, CELL * 0.32); ctx.fill();
      ctx.fillStyle = '#2bb8e6'; roundRect(x + 4, y + 4, w - 8, h - 11, CELL * 0.30); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 2;
      const n = Math.max(2, Math.round(h / CELL) + 1);
      for (let i = 1; i <= n; i++) { const yy = y + h * i / (n + 1); ctx.beginPath(); ctx.moveTo(x + 9, yy); ctx.quadraticCurveTo(x + w / 2, yy - CELL * 0.13, x + w - 9, yy); ctx.stroke(); }
    } else if (o.kind === 'rock') {
      ctx.fillStyle = '#5f3d1c'; roundRect(x + 3, y + 3, w - 6, h - 6, 10); ctx.fill();
      const peaks = Math.max(1, Math.round(w / CELL));
      for (let p = 0; p < peaks; p++) { const px = x + w * (p + 0.5) / peaks;
        ctx.fillStyle = '#8a5a2b'; ctx.beginPath(); ctx.moveTo(px, y + h * 0.18); ctx.lineTo(px + CELL * 0.34, y + h * 0.86); ctx.lineTo(px - CELL * 0.34, y + h * 0.86); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.42)'; ctx.beginPath(); ctx.moveTo(px, y + h * 0.18); ctx.lineTo(px + CELL * 0.11, y + h * 0.36); ctx.lineTo(px - CELL * 0.11, y + h * 0.36); ctx.closePath(); ctx.fill();
      }
    } else { // building / warehouse block
      const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#5a6685'); g.addColorStop(1, '#3e4767');
      ctx.fillStyle = g; roundRect(x + 3, y + 3, w - 6, h - 6, 8); ctx.fill();
      ctx.fillStyle = '#2b3350'; roundRect(x + 3, y + 3, w - 6, CELL * 0.3, 8); ctx.fill();  // roof
      const wc = Math.max(1, Math.round(w / CELL)), wr = Math.max(1, Math.round(h / CELL) - 0);
      ctx.fillStyle = 'rgba(255,209,102,0.5)';
      for (let a = 0; a < wc; a++) for (let b = 0; b < wr; b++) { if ((a + b) % 2) continue; ctx.fillRect(x + w * (a + 0.32) / wc, y + CELL * 0.42 + (h - CELL * 0.42) * (b + 0.15) / wr, CELL * 0.2, CELL * 0.24); }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.32)'; ctx.lineWidth = 1.5;
    roundRect(x + 3, y + 3, w - 6, h - 6, o.kind === 'water' ? CELL * 0.32 : 9); ctx.stroke();
  }
}

const DIR_ANGLE = { up: 0, right: Math.PI/2, down: Math.PI, left: -Math.PI/2 };
function drawTruck(t) {
  const mat = MATERIALS[t.mat] || MATERIALS.wood;
  const inDepot = t.state === 'depot';
  const moving = t.state === 'toBay' || t.state === 'leaving';
  const angle = moving ? (t.heading || 0) : (inDepot ? DIR_ANGLE[t.dir] : 0);
  const shakeX = t.shake > 0 ? Math.sin(t.shake*45)*3 : 0;
  const bob = inDepot ? Math.sin(lastTs * 0.002 + (t.id % 7)) * 0.7 : 0;   // subtle idle bob
  ctx.save(); ctx.translate(t.x + shakeX, t.y + bob); ctx.rotate(angle);
  drawTruckBody(mat, t.size, { moving, spin: t.spin || 0, braked: t.braked || 0 });
  const w = CELL*0.6, h = t.size*CELL*0.9;
  if (inDepot) {
    const reach = canExit(t), need = reach && orders.some(o => o && o.mat === t.mat && (o.qty - o.done) > 0);
    if (need && bays.includes(null)) { ctx.strokeStyle = 'rgba(46,194,126,0.95)'; ctx.lineWidth = 3; roundRect(-w/2-2,-h/2-2,w+4,h+4,CELL*0.18); ctx.stroke(); }
    else if (reach) { ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 2; roundRect(-w/2-2,-h/2-2,w+4,h+4,CELL*0.18); ctx.stroke(); }
  }
  ctx.restore();
  if (t.state === 'bay' || t.state === 'toBay') {
    const pw = CELL*0.16, gap = CELL*0.05, total = t.load*pw + (t.load-1)*gap; let sx = t.x - total/2;
    const py = t.y - t.size*CELL*0.5 - CELL*0.12;
    for (let i = 0; i < t.load; i++) { ctx.fillStyle = i < t.loadLeft ? mat.color : 'rgba(255,255,255,0.22)'; roundRect(sx, py, pw, pw*0.7, 2); ctx.fill(); sx += pw + gap; }
  }
}

function drawTruckBody(mat, size, opt) {
  opt = opt || {};
  const w = CELL*0.56, h = size*CELL*0.88, hw = w/2, hh = h/2, cab = Math.min(CELL*0.34, h*0.34), rad = w*0.24;
  // soft ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.24)'; roundRect(-hw+2, -hh+6, w, h, rad); ctx.fill();
  // wheels with rolling tread
  const ww = w*0.16, wl = CELL*0.2, spin = opt.spin || 0, period = wl*0.5, off = ((spin*0.6) % period + period) % period;
  const axles = size > 1 ? [-hh+cab+CELL*0.15, 0, hh-CELL*0.2] : [-hh+cab+CELL*0.05, hh-CELL*0.18];
  for (const wy of axles) for (const wx of [-hw-ww*0.45, hw-ww*0.55]) {
    ctx.fillStyle = '#15171d'; roundRect(wx, wy-wl/2, ww, wl, ww*0.35); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    for (let k = -1; k < 3; k++) { const ty = wy - wl/2 + off + k*period; if (ty > wy-wl/2+1 && ty < wy+wl/2-1) ctx.fillRect(wx+ww*0.22, ty, ww*0.56, 1.5); }
  }
  // cargo bed
  drawCargo(mat, -hh+cab, hh, w);
  // cab
  ctx.fillStyle = '#2b303c'; roundRect(-hw, -hh, w, cab+rad, rad); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.10)'; roundRect(-hw+2, -hh+2, w-4, cab*0.28, rad*0.6); ctx.fill();  // cab rim light
  ctx.fillStyle = 'rgba(150,205,235,0.92)'; roundRect(-hw+w*0.16, -hh+cab*0.42, w*0.68, cab*0.34, 3); ctx.fill(); // windshield
  // headlights + forward glow when moving
  ctx.fillStyle = '#ffe08a'; const hlr = w*0.09;
  ctx.beginPath(); ctx.arc(-hw+w*0.22, -hh+hlr+1, hlr, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(hw-w*0.22, -hh+hlr+1, hlr, 0, 7); ctx.fill();
  if (opt.moving) {
    const gl = ctx.createRadialGradient(0, -hh, 1, 0, -hh, CELL*0.6);
    gl.addColorStop(0, 'rgba(255,240,180,0.26)'); gl.addColorStop(1, 'rgba(255,240,180,0)');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.moveTo(-w*0.42,-hh); ctx.lineTo(w*0.42,-hh); ctx.lineTo(w*0.95,-hh-CELL*0.55); ctx.lineTo(-w*0.95,-hh-CELL*0.55); ctx.closePath(); ctx.fill();
  }
  // colour tab on cab roof
  ctx.fillStyle = mat.color; roundRect(-w*0.16, -hh+cab*0.04, w*0.32, cab*0.2, 2); ctx.fill();
  // brake lights (rear) when braking to dock
  if (opt.braked > 0.02) { ctx.globalAlpha = Math.min(1, opt.braked*3); ctx.fillStyle = '#ff3b30';
    ctx.beginPath(); ctx.arc(-hw+w*0.2, hh-2, w*0.085, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(hw-w*0.2, hh-2, w*0.085, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
  // depth gradient overlay (top-light → bottom-shade)
  const gg = ctx.createLinearGradient(0, -hh, 0, hh);
  gg.addColorStop(0, 'rgba(255,255,255,0.17)'); gg.addColorStop(0.45, 'rgba(255,255,255,0)'); gg.addColorStop(1, 'rgba(0,0,0,0.20)');
  ctx.fillStyle = gg; roundRect(-hw, -hh, w, h, rad); ctx.fill();
}

function drawCargo(mat, bedTop, bedBot, w) {
  const bw = w*0.9, bx = -bw/2, bl = bedBot - bedTop, col = mat.color, dk = mat.dark, cat = mat.cargo;
  if (cat === 'oil') {
    // metallic hazmat tanker: shaded steel cylinder, ribs, hatch, orange hazard placard
    ctx.fillStyle = '#20242c'; roundRect(bx, bedTop, bw, bl, bw*0.46); ctx.fill();
    const tg = ctx.createLinearGradient(bx, 0, bx+bw, 0);
    tg.addColorStop(0, '#20242c'); tg.addColorStop(0.28, '#525a68'); tg.addColorStop(0.44, '#828b9b');
    tg.addColorStop(0.6, '#4a515e'); tg.addColorStop(1, '#191d24');
    ctx.fillStyle = tg; roundRect(bx+bw*0.05, bedTop+bl*0.02, bw*0.9, bl*0.96, bw*0.4); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; roundRect(bx+bw*0.34, bedTop+bl*0.05, bw*0.08, bl*0.9, bw*0.05); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.30)'; ctx.lineWidth = Math.max(1.5, bw*0.03);
    for (let i = 1; i <= 3; i++) { const yy = bedTop+bl*(i/4); line(bx+bw*0.05, yy, bx+bw*0.95, yy); }
    const hy = bedTop+bl*0.16, hr = bw*0.15;
    ctx.fillStyle = '#3a4150'; ctx.beginPath(); ctx.arc(0, hy, hr, 0, 7); ctx.fill();
    ctx.strokeStyle = '#767f8f'; ctx.lineWidth = Math.max(1, bw*0.03); ctx.beginPath(); ctx.arc(0, hy, hr*0.72, 0, 7); ctx.stroke();
    const ph = bw*0.3*0.7, py = bedTop+bl*0.66;
    ctx.save(); ctx.translate(0, py); ctx.rotate(Math.PI/4);
    ctx.fillStyle = '#e8871e'; roundRect(-ph/2, -ph/2, ph, ph, ph*0.14); ctx.fill();
    ctx.strokeStyle = '#1b1e2a'; ctx.lineWidth = Math.max(1, bw*0.03); ctx.stroke(); ctx.restore();
  } else if (cat === 'liquid') {
    // clean glossy water tank
    ctx.fillStyle = dk; roundRect(bx, bedTop, bw, bl, bw*0.46); ctx.fill();
    const tg = ctx.createLinearGradient(bx, 0, bx+bw, 0);
    tg.addColorStop(0, dk); tg.addColorStop(0.3, col); tg.addColorStop(0.46, '#9be3fb'); tg.addColorStop(0.62, col); tg.addColorStop(1, dk);
    ctx.fillStyle = tg; roundRect(bx+bw*0.05, bedTop+bl*0.02, bw*0.9, bl*0.96, bw*0.4); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; roundRect(bx+bw*0.32, bedTop+bl*0.05, bw*0.09, bl*0.9, bw*0.05); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = Math.max(1.5, bw*0.03);
    for (let i = 1; i <= 3; i++) { const yy = bedTop+bl*(i/4); line(bx+bw*0.05, yy, bx+bw*0.95, yy); }
    const hr = bw*0.15, hy = bedTop+bl*0.16;
    ctx.fillStyle = '#1689b3'; ctx.beginPath(); ctx.arc(0, hy, hr, 0, 7); ctx.fill();
    ctx.strokeStyle = '#bdeeff'; ctx.lineWidth = Math.max(1, bw*0.03); ctx.beginPath(); ctx.arc(0, hy, hr*0.72, 0, 7); ctx.stroke();
    ctx.fillStyle = '#eaf9ff'; const dy = bedTop+bl*0.64, ds = bw*0.13;               // water droplet mark
    ctx.beginPath(); ctx.moveTo(0, dy-ds); ctx.bezierCurveTo(ds, dy-ds*0.1, ds*0.8, dy+ds, 0, dy+ds); ctx.bezierCurveTo(-ds*0.8, dy+ds, -ds, dy-ds*0.1, 0, dy-ds); ctx.fill();
  } else if (cat === 'logs') {
    // flatbed of round timber: cylindrical logs, sawn ring-ends, binding straps
    ctx.fillStyle = '#2f2a24'; roundRect(bx, bedTop, bw, bl, 4); ctx.fill();
    ctx.fillStyle = '#241f1a'; roundRect(bx, bedTop, bw*0.06, bl, 2); ctx.fill(); roundRect(bx+bw*0.94, bedTop, bw*0.06, bl, 2); ctx.fill();
    const n = 4, lw = (bw*0.9)/n, x0 = bx + bw*0.05, endH = lw*0.9, light = '#c98f52';
    for (let i = 0; i < n; i++) { const lx = x0 + i*lw;
      const g = ctx.createLinearGradient(lx, 0, lx+lw, 0);
      g.addColorStop(0, dk); g.addColorStop(0.34, col); g.addColorStop(0.46, light); g.addColorStop(0.62, col); g.addColorStop(1, dk);
      ctx.fillStyle = g; roundRect(lx+0.5, bedTop, lw-1, bl, lw*0.28); ctx.fill();
      const ex = lx+lw/2, ey = bedTop+endH*0.5, er = lw*0.4;
      ctx.fillStyle = '#caa066'; ctx.beginPath(); ctx.arc(ex, ey, er, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(90,60,30,0.7)'; ctx.lineWidth = Math.max(1, lw*0.05);
      ctx.beginPath(); ctx.arc(ex, ey, er*0.62, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(ex, ey, er*0.3, 0, 7); ctx.stroke();
      ctx.fillStyle = '#8a5f30'; ctx.beginPath(); ctx.arc(ex, ey, er*0.12, 0, 7); ctx.fill();
    }
    ctx.fillStyle = 'rgba(20,16,12,0.9)';
    for (const f of [0.45, 0.8]) { const sy = bedTop + bl*f; roundRect(bx, sy-lw*0.06, bw, lw*0.12, 2); ctx.fill(); }
  } else if (cat === 'metal') {
    // bundle of shiny steel pipes with open hollow ends
    ctx.fillStyle = '#22262e'; roundRect(bx, bedTop, bw, bl, 4); ctx.fill();
    const n = 4, lw = (bw*0.92)/n, x0 = bx + bw*0.04, endH = lw;
    for (let i = 0; i < n; i++) { const lx = x0 + i*lw;
      const g = ctx.createLinearGradient(lx, 0, lx+lw, 0);
      g.addColorStop(0, '#3f4757'); g.addColorStop(0.32, '#8b95a7'); g.addColorStop(0.46, '#dfe6ef'); g.addColorStop(0.62, '#7c8698'); g.addColorStop(1, '#2c333f');
      ctx.fillStyle = g; roundRect(lx+0.5, bedTop, lw-1, bl, lw*0.32); ctx.fill();
      const ex = lx+lw/2, ey = bedTop+endH*0.5, er = lw*0.4;
      ctx.fillStyle = '#c2cad6'; ctx.beginPath(); ctx.arc(ex, ey, er, 0, 7); ctx.fill();
      ctx.fillStyle = '#161a20'; ctx.beginPath(); ctx.arc(ex, ey, er*0.62, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(ex-er*0.28, ey-er*0.3, er*0.18, 0, 7); ctx.fill();
    }
    ctx.fillStyle = 'rgba(18,20,26,0.85)'; { const sy = bedTop + bl*0.82; roundRect(bx, sy-lw*0.06, bw, lw*0.12, 2); ctx.fill(); }
  } else if (cat === 'boxes') {
    ctx.fillStyle = '#2b303c'; roundRect(bx, bedTop, bw, bl, 4); ctx.fill();
    const rN = Math.max(2, Math.round(bl/(bw*0.55))), cN = 2, cw = bw/cN, ch = bl/rN;
    for (let ri = 0; ri < rN; ri++) for (let ci = 0; ci < cN; ci++) { const xx = bx+ci*cw+2, yy = bedTop+ri*ch+2, ww2 = cw-4, hh2 = ch-4;
      ctx.fillStyle = col; roundRect(xx, yy, ww2, hh2, 3); ctx.fill();
      ctx.strokeStyle = dk; ctx.lineWidth = 1.3; line(xx+ww2/2, yy+1, xx+ww2/2, yy+hh2-1); line(xx+1, yy+hh2/2, xx+ww2-1, yy+hh2/2);
      ctx.fillStyle = 'rgba(255,255,255,0.16)'; roundRect(xx+2, yy+2, ww2*0.42, hh2*0.42, 2); ctx.fill(); }
  } else {
    // crates of assorted produce: box-truck layout, each crate a different fruit
    ctx.fillStyle = '#2b303c'; roundRect(bx, bedTop, bw, bl, 4); ctx.fill();
    const cN = 2, rN = Math.max(2, Math.round(bl/(bw*0.55))), cw = bw/cN, ch = bl/rN;
    const fruits = [['#e8524a','#ff8a7a','#b83a33'],   // red apples
                    ['#ef8b2c','#ffb15e','#c26a12'],   // oranges
                    ['#6ab04c','#93d36f','#478032'],   // green apples
                    ['#8e6fd0','#b79bec','#654a9c'],   // grapes/plums
                    ['#f2c53d','#ffe27a','#c79a17']];  // lemons
    let fi = 0;
    for (let ri = 0; ri < rN; ri++) for (let ci = 0; ci < cN; ci++) {
      const xx = bx+ci*cw+2, yy = bedTop+ri*ch+2, ww2 = cw-4, hh2 = ch-4;
      ctx.fillStyle = '#6f4a22'; roundRect(xx, yy, ww2, hh2, 3); ctx.fill();
      ctx.fillStyle = '#9a6c34'; roundRect(xx+ww2*0.08, yy+hh2*0.08, ww2*0.84, hh2*0.84, 2); ctx.fill();
      const F = fruits[fi % fruits.length]; fi++;
      const fr = Math.min(ww2, hh2)*0.21, off = fr*1.02, cx0 = xx+ww2/2, cy0 = yy+hh2/2;
      for (const [dx, dy] of [[-off,-off],[off,-off],[-off,off],[off,off]]) {
        const px = cx0+dx, py = cy0+dy;
        const g = ctx.createRadialGradient(px-fr*0.3, py-fr*0.35, fr*0.1, px, py, fr);
        g.addColorStop(0, F[1]); g.addColorStop(0.55, F[0]); g.addColorStop(1, F[2]);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, fr, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(px-fr*0.3, py-fr*0.32, fr*0.28, 0, 7); ctx.fill();
      }
      ctx.strokeStyle = '#4a2f15'; ctx.lineWidth = Math.max(1, ww2*0.06); roundRect(xx, yy, ww2, hh2, 3); ctx.stroke();
    }
  }
}

function drawParticles() {
  for (const p of particles) { const t = p.life/p.max;
    if (p.type === 'smoke') { ctx.globalAlpha = (1-t)*0.28; ctx.fillStyle = '#c7d1e6'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      ctx.globalAlpha = (1-t)*0.14; ctx.beginPath(); ctx.arc(p.x - p.r*0.3, p.y - p.r*0.2, p.r*0.7, 0, 7); ctx.fill(); }
    else if (p.type === 'spark') { ctx.globalAlpha = 1-t; ctx.fillStyle = p.color || '#ffd166'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r*(1-t*0.4), 0, 7); ctx.fill(); }
    else if (p.type === 'confetti') { ctx.globalAlpha = 1 - t*t; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color; ctx.fillRect(-p.s/2, -p.s*0.3, p.s, p.s*0.6); ctx.restore(); }
    else if (p.type === 'coin') { ctx.globalAlpha = 1 - t*0.4; ctx.fillStyle = '#ffcf3f'; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.s*(0.6+0.4*Math.abs(Math.sin(p.life*16))), p.s, 0, 0, 7); ctx.fill(); ctx.strokeStyle = '#c98f16'; ctx.lineWidth = 1.5; ctx.stroke(); }
    else { ctx.globalAlpha = 1-t; ctx.fillStyle = '#ffd166'; ctx.font = `bold ${Math.floor(CELL*0.32)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.txt, p.x, p.y); } }
  ctx.globalAlpha = 1;
}
function drawFloaters() {
  for (const f of floaters) { const k = ease(f.t); const x = f.x+(f.tx-f.x)*k, y = f.y+(f.ty-f.y)*k;
    ctx.globalAlpha = 1-f.t*0.5; drawMatIcon(f.mat, x, y, CELL*0.58); ctx.globalAlpha = 1; }
}
function drawVignette() {
  const g = ctx.createRadialGradient(L.w/2, L.h*0.42, L.h*0.18, L.w/2, L.h*0.5, L.h*0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.32)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, L.w, L.h);
}

/* ---------- canvas helpers ---------- */
function roundRect(x, y, w, h, r) { r = Math.min(r, w/2, h/2); ctx.beginPath(); ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r); ctx.arcTo(x+w, y+h, x, y+h, r); ctx.arcTo(x, y+h, x, y, r); ctx.arcTo(x, y, x+w, y, r); ctx.closePath(); }
function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

/* ---------- Win / Lose ---------- */
function computeStars() { const lost = maxLives - lives; return lost <= 0 ? 3 : lost === 1 ? 2 : 1; }
function endWin() {
  if (!running) return; running = false;
  track('level-' + (levelIndex + 1) + '-win');
  const stars = computeStars();
  if ((save.stars[levelIndex] || 0) < stars) save.stars[levelIndex] = stars;
  if (save.unlocked < Math.min(LEVELS.length, levelIndex + 2)) save.unlocked = Math.min(LEVELS.length, levelIndex + 2);
  persist();   // coins already banked live into save.coins during play
  sndWin();
  const s = $('resultStars').children;
  for (let i = 0; i < 3; i++) { s[i].classList.remove('on'); if (i < stars) setTimeout(() => { s[i].classList.add('on'); sndStar(); }, 300 + i * 260); }
  $('resultTitle').textContent = levelIndex >= LEVELS.length - 1 ? '🏆 أنهيت كل المراحل!' : 'مستودع نظيف!';
  $('resultSub').textContent = `ربحت ${earned} عملة  •  ${'⭐'.repeat(stars)}`;
  $('nextBtn').style.display = levelIndex >= LEVELS.length - 1 ? 'none' : '';
  showOverlay('resultOverlay');
}
function endLose() {
  if (!running) return; running = false;
  track('level-' + (levelIndex + 1) + '-lose');
  sndLose();
  const s = $('resultStars').children; for (let i = 0; i < 3; i++) s[i].classList.remove('on');
  $('resultTitle').textContent = '💔 نفد صبر الزبائن';
  $('resultSub').textContent = 'حاول مرة ثانية — رتّب الشاحنات بذكاء!';
  $('nextBtn').style.display = 'none';
  showOverlay('resultOverlay');
}

/* ---------- Buttons / navigation ---------- */
function unlockAudio() { const a = actx(); if (a && a.state === 'suspended') a.resume(); }
document.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => showScreen(b.dataset.nav)));
$('playBtn').addEventListener('click', () => { unlockAudio(); startLevel(Math.min(save.unlocked - 1, LEVELS.length - 1)); });
$('levelsBtn').addEventListener('click', () => { unlockAudio(); showScreen('levels'); });
$('settingsBtn').addEventListener('click', () => showScreen('settings'));
$('startBtn').addEventListener('click', () => { unlockAudio(); paused = false; hideOverlay('startOverlay'); lastTs = 0; });
$('pauseBtn').addEventListener('click', () => { if (running) { paused = true; showOverlay('pauseOverlay'); } });
$('resumeBtn').addEventListener('click', () => { paused = false; lastTs = 0; hideOverlay('pauseOverlay'); });
$('pauseRestartBtn').addEventListener('click', () => { hideOverlay('pauseOverlay'); loadLevel(levelIndex); });
$('pauseMenuBtn').addEventListener('click', () => { running = false; paused = false; showScreen('menu'); });
$('restartBtn').addEventListener('click', () => { unlockAudio(); loadLevel(levelIndex); });
$('toolHint').addEventListener('click', () => { if (!running || paused) return; armedTool = null; if (buyTool('hint')) doHint(); updateToolBar(); });
$('toolRefresh').addEventListener('click', () => { if (!running || paused) return; armedTool = null; if (buyTool('refresh')) doRefresh(); updateToolBar(); });
$('toolShuffle').addEventListener('click', () => {
  if (!running || paused) return; armedTool = null;
  if (save.coins < TOOL_COST.shuffle) { sndBlocked(); updateToolBar(); return; }
  if (doShuffle()) { save.coins -= TOOL_COST.shuffle; persist(); sndTool(); }  // charge only if it actually re-shuffled
  updateToolBar();
});
$('toolEject').addEventListener('click', () => {
  if (!running || paused) return;
  if (armedTool === 'eject') { armedTool = null; updateToolBar(); return; }   // toggle off
  if (save.coins < TOOL_COST.eject) { sndBlocked(); return; }
  armedTool = 'eject'; updateToolBar();
});
$('nextBtn').addEventListener('click', () => { hideOverlay('resultOverlay'); startLevel(Math.min(levelIndex + 1, LEVELS.length - 1)); });
$('retryBtn').addEventListener('click', () => { hideOverlay('resultOverlay'); loadLevel(levelIndex); });
$('resultMenuBtn').addEventListener('click', () => { showScreen('menu'); });
$('sfxToggle').addEventListener('change', e => { save.sfx = e.target.checked; persist(); });
$('musicToggle').addEventListener('change', e => { save.music = e.target.checked; persist(); updateMusic(); });
$('resetBtn').addEventListener('click', () => { save = { unlocked: 1, stars: {}, coins: 0, sfx: save.sfx, music: save.music }; persist(); buildLevelSelect(); });

/* ---------- Boot ---------- */
window.addEventListener('resize', () => { if (running) resize(); });
$('sfxToggle').checked = save.sfx; $('musicToggle').checked = save.music;
showScreen('menu');
