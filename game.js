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
  oil:   { color: '#3a4150', dark: '#242a34', icon: '🛢️', name: 'نفط',   cargo: 'liquid' },
  food:  { color: '#e8524a', dark: '#b83a33', icon: '🍎', name: 'غذاء',  cargo: 'produce' },
  steel: { color: '#7d8ea6', dark: '#576578', icon: '🔩', name: 'حديد',  cargo: 'metal' },
  goods: { color: '#d79a5c', dark: '#a5733c', icon: '📦', name: 'بضائع', cargo: 'boxes' },
  water: { color: '#2bb8e6', dark: '#1689b3', icon: '💧', name: 'ماء',   cargo: 'liquid' },
};
const UNIT_COINS = 10, ORDER_BONUS = 25, LOAD_INTERVAL = 0.6, DRIVE_SPEED = 7.5;

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
let floaters = [], particles = [];
let patienceBase = 20;
const TIME_FACTOR = 1.8;   // strategy tuning: stretch every order's patience so play is about thinking
let lastTs = 0;
let doorAnim = [];     // per-bay door open amount 0..1

/* ---------- DOM ---------- */
const el = {};
['levelValue','livesValue','livesBox','coinsValue','leftValue'].forEach(id => el[id] = document.getElementById(id));
const screens = ['menu','levels','settings','game'];
function $(id){ return document.getElementById(id); }

/* ---------- Screen manager ---------- */
let musicTimer = null;
function showScreen(name) {
  screens.forEach(s => $(s).classList.toggle('hidden', s !== name));
  hideOverlay('pauseOverlay'); hideOverlay('resultOverlay'); hideOverlay('startOverlay');
  if (name === 'menu') { $('menuStars').textContent = '⭐ ' + totalStars() + ' / ' + (LEVELS.length * 3); $('menuCoins').textContent = '🪙 ' + save.coins; }
  if (name === 'levels') buildLevelSelect();
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
const sndDrive = () => { beep(520,.09,'triangle',.11); setTimeout(()=>beep(720,.09,'triangle',.09),55); };
const sndLoad = () => beep(680,.05,'sine',.09);
const sndDepart = () => { beep(440,.12,'triangle',.12); setTimeout(()=>beep(640,.12,'triangle',.1),90); };
const sndBlocked = () => beep(150,.13,'sawtooth',.09);
const sndExpire = () => { beep(300,.18,'sawtooth',.13); setTimeout(()=>beep(200,.2,'sawtooth',.11),120); };
const sndStar = () => beep(1000,.12,'triangle',.14);
const sndWin = () => [523,659,784,1047].forEach((f,i)=>setTimeout(()=>beep(f,.14,'triangle',.15),i*110));
const sndLose = () => [400,300,200].forEach((f,i)=>setTimeout(()=>beep(f,.2,'sawtooth',.13),i*150));

// gentle ambient music loop
const MUSIC_NOTES = [196, 261.6, 329.6, 392, 329.6, 261.6, 220, 261.6];
let musicStep = 0;
function musicTick() {
  if (!save.music || !running || paused) return;
  const a = actx(); if (!a) return;
  try {
    const f = MUSIC_NOTES[musicStep % MUSIC_NOTES.length]; musicStep++;
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.value = f; g.gain.value = 0.0;
    o.connect(g); g.connect(a.destination); o.start();
    g.gain.linearRampToValueAtTime(0.05, a.currentTime + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 1.1);
    o.stop(a.currentTime + 1.2);
    // soft bass every 4 steps
    if (musicStep % 4 === 0) {
      const b = a.createOscillator(), bg = a.createGain();
      b.type = 'triangle'; b.frequency.value = 98; bg.gain.value = 0.06;
      b.connect(bg); bg.connect(a.destination); b.start();
      bg.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.9); b.stop(a.currentTime + 1);
    }
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
  maxLives = lv.lives; lives = lv.lives; coins = 0; earned = 0;
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
  el.coinsValue.textContent = coins;
  el.leftValue.textContent = trucks.filter(t => !t.done).length;
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
  const p = patienceBase * (0.85 + Math.random() * 0.3);
  return { id: ++orderSeq, mat, qty, done: 0, patience: p, maxP: p, flash: 0 };
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
  if (!t) return;
  if (!canExit(t)) { t.shake = 0.3; sndBlocked(); return; }
  const bi = bays.indexOf(null);
  if (bi < 0) { t.shake = 0.3; sndBlocked(); return; }
  bays[bi] = t; t.bayIndex = bi; t.state = 'toBay';
  startRoute(t, routeToBay(t, bi), () => { t.state = 'bay'; t.loadTimer = 0; t.heading = 0; });
  sndDrive(); fixDeadlock();
}
canvas.addEventListener('pointerdown', handleTap);

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
  const o = orders[idx], rc = cardRect(idx);
  o.done++; t.loadLeft--; coins += UNIT_COINS; earned += UNIT_COINS;
  spawnFloater(idx, t.mat, t.x, t.y);
  addText(rc.x + rc.w / 2, rc.y + rc.h * 0.2, '+' + UNIT_COINS);
  burst(rc.x + rc.w / 2, rc.y + rc.h / 2, MATERIALS[t.mat].color, 5);
  sndLoad();
  if (o.done >= o.qty) { coins += ORDER_BONUS; earned += ORDER_BONUS; o.flash = 0.4; burst(rc.x + rc.w / 2, rc.y + rc.h / 2, '#ffd166', 16); addText(rc.x + rc.w / 2, rc.y + rc.h * 0.5, '+' + ORDER_BONUS); respawnSlot(idx); }
  if (t.loadLeft <= 0) {
    bays[t.bayIndex] = null; t.state = 'leaving'; t.heading = 0; burst(t.x, t.y, '#cdd6ea', 8);
    startRoute(t, [{ x: t.x, y: -CELL * 2.5 }], () => { t.state = 'done'; t.done = true; afterDepart(); });
    sndDepart();
  }
  updateHUD(); fixDeadlock();
}
function afterDepart() { if (trucks.every(x => x.done)) endWin(); }
function spawnFloater(cardIdx, mat, fx, fy) { const rc = cardRect(cardIdx); floaters.push({ x: fx, y: fy, tx: rc.x + rc.w / 2, ty: rc.y + rc.h / 2, t: 0, mat }); }

/* ---------- Particles ---------- */
const rnd = () => Math.random();
function addSmoke(x, y) { particles.push({ type:'smoke', x, y, vx:(rnd()-.5)*14, vy:-10-rnd()*12, life:0, max:.5+rnd()*.4, r:CELL*.07 }); }
function addSpark(x, y, color) { particles.push({ type:'spark', x, y, vx:(rnd()-.5)*150, vy:-50-rnd()*110, life:0, max:.45+rnd()*.35, color, r:CELL*.055 }); }
function addText(x, y, txt) { particles.push({ type:'text', x, y, vy:-46, life:0, max:.9, txt }); }
function burst(x, y, color, n) { for (let i = 0; i < n; i++) addSpark(x, y, color); }
function updateParticles(dt) {
  for (const p of particles) { p.life += dt; p.x += (p.vx||0)*dt; p.y += (p.vy||0)*dt;
    if (p.type==='smoke'){ p.r += CELL*.11*dt; p.vy*=.95; } else if (p.type==='spark'){ p.vy += 340*dt; } else if (p.type==='text'){ p.vy*=.94; } }
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
    if (t.shake > 0) t.shake = Math.max(0, t.shake - dt);
  }
  // doors: open when a truck occupies the bay
  for (let i = 0; i < BAYS; i++) { const target = bays[i] ? 1 : 0; doorAnim[i] += (target - doorAnim[i]) * Math.min(1, dt * 6); }
  updateParticles(dt);
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
  drawGround();
  drawBoard();
  drawDock();
  drawRoads();
  drawYard();
  drawObstacles();
  for (const t of trucks) if (t.state === 'depot') drawTruck(t);
  for (const t of trucks) if (t.state !== 'depot' && !t.done) drawTruck(t);
  drawParticles();
  drawFloaters();
  drawVignette();
}

function drawGround() {
  const g = ctx.createLinearGradient(0, 0, 0, L.h);
  g.addColorStop(0, '#20305a'); g.addColorStop(0.5, '#2a3550'); g.addColorStop(1, '#232b42');
  ctx.fillStyle = g; ctx.fillRect(0, 0, L.w, L.h);
}

function drawBoard() {
  // "shipping orders" ticket rail
  for (let i = 0; i < SLOTS; i++) {
    const o = orders[i], rc = cardRect(i);
    const g = ctx.createLinearGradient(0, rc.y, 0, rc.y + rc.h);
    g.addColorStop(0, o && o.flash > 0 ? '#2ec27e' : '#f4f1e6'); g.addColorStop(1, o && o.flash > 0 ? '#1f9e63' : '#e2ddcb');
    ctx.fillStyle = g; roundRect(rc.x, rc.y, rc.w, rc.h, 10); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; roundRect(rc.x, rc.y, rc.w, rc.h * 0.16, 6); ctx.fill(); // clip strip
    ctx.fillStyle = '#c9c2a8'; ctx.fillRect(rc.x + rc.w * 0.44, rc.y - 3, rc.w * 0.12, 6); // clip
    if (!o) { ctx.fillStyle = '#9a9482'; ctx.font = `${Math.floor(CELL*0.4)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('✓', rc.x + rc.w/2, rc.y + rc.h/2); continue; }
    const mat = MATERIALS[o.mat];
    ctx.font = `${Math.floor(CELL*0.56)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(mat.icon, rc.x + rc.w/2, rc.y + rc.h*0.42);
    ctx.fillStyle = '#2a2a2a'; ctx.font = `bold ${Math.floor(CELL*0.32)}px system-ui`;
    ctx.fillText('× ' + (o.qty - o.done), rc.x + rc.w/2, rc.y + rc.h*0.72);
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
  ctx.save(); ctx.translate(t.x + shakeX, t.y); ctx.rotate(angle);
  drawTruckBody(mat, t.size);
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

function drawTruckBody(mat, size) {
  const w = CELL*0.56, h = size*CELL*0.88, hw = w/2, hh = h/2, cab = Math.min(CELL*0.34, h*0.34), rad = w*0.24;
  ctx.fillStyle = 'rgba(0,0,0,0.30)'; roundRect(-hw+2, -hh+4, w, h, rad); ctx.fill();
  const ww = w*0.16, wl = CELL*0.2;
  const axles = size > 1 ? [-hh+cab+CELL*0.15, 0, hh-CELL*0.2] : [-hh+cab+CELL*0.05, hh-CELL*0.18];
  ctx.fillStyle = '#15171d'; for (const wy of axles) { roundRect(-hw-ww*0.45, wy-wl/2, ww, wl, ww*0.35); ctx.fill(); roundRect(hw-ww*0.55, wy-wl/2, ww, wl, ww*0.35); ctx.fill(); }
  drawCargo(mat, -hh+cab, hh, w);
  ctx.fillStyle = '#2b303c'; roundRect(-hw, -hh, w, cab+rad, rad); ctx.fill();
  ctx.fillStyle = 'rgba(150,205,235,0.92)'; roundRect(-hw+w*0.16, -hh+cab*0.42, w*0.68, cab*0.34, 3); ctx.fill();
  ctx.fillStyle = '#ffe08a'; const hlr = w*0.09;
  ctx.beginPath(); ctx.arc(-hw+w*0.22, -hh+hlr+1, hlr, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(hw-w*0.22, -hh+hlr+1, hlr, 0, 7); ctx.fill();
  ctx.fillStyle = mat.color; roundRect(-w*0.16, -hh+cab*0.04, w*0.32, cab*0.2, 2); ctx.fill();
  const gg = ctx.createLinearGradient(0, -hh, 0, hh);
  gg.addColorStop(0, 'rgba(255,255,255,0.16)'); gg.addColorStop(0.45, 'rgba(255,255,255,0)'); gg.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = gg; roundRect(-hw, -hh, w, h, rad); ctx.fill();
}

function drawCargo(mat, bedTop, bedBot, w) {
  const bw = w*0.9, bx = -bw/2, bl = bedBot - bedTop, col = mat.color, dk = mat.dark, cat = mat.cargo;
  if (cat === 'liquid') {
    ctx.fillStyle = dk; roundRect(bx, bedTop, bw, bl, bw*0.46); ctx.fill();
    ctx.fillStyle = col; roundRect(bx+bw*0.06, bedTop+bl*0.03, bw*0.88, bl*0.94, bw*0.42); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; roundRect(bx+bw*0.2, bedTop+bl*0.06, bw*0.22, bl*0.88, bw*0.18); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 2; for (let i = 1; i <= 2; i++) { const yy = bedTop+bl*(i/3); line(bx+2, yy, bx+bw-2, yy); }
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(0, bedTop+bl*0.2, bw*0.1, 0, 7); ctx.fill();
  } else if (cat === 'logs' || cat === 'metal') {
    ctx.fillStyle = '#333844'; roundRect(bx, bedTop, bw, bl, 4); ctx.fill();
    const n = 3, lw = bw/n;
    for (let i = 0; i < n; i++) { const lx = bx+i*lw+1;
      ctx.fillStyle = col; roundRect(lx, bedTop+2, lw-2, bl-4, lw*(cat==='metal'?0.3:0.42)); ctx.fill();
      if (cat === 'metal') { ctx.fillStyle = 'rgba(255,255,255,0.4)'; roundRect(lx+lw*0.34, bedTop+3, lw*0.16, bl-6, 2); ctx.fill(); ctx.fillStyle = dk; ctx.beginPath(); ctx.arc(lx+lw/2, bedTop+lw*0.5, lw*0.24, 0, 7); ctx.fill(); }
      else { ctx.fillStyle = 'rgba(255,255,255,0.18)'; roundRect(lx+lw*0.12, bedTop+2, lw*0.28, bl-4, lw*0.3); ctx.fill(); ctx.strokeStyle = dk; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(lx+lw/2, bedTop+lw*0.5, lw*0.26, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(lx+lw/2, bedTop+lw*0.5, lw*0.12, 0, 7); ctx.stroke(); }
    }
  } else if (cat === 'boxes') {
    ctx.fillStyle = '#2b303c'; roundRect(bx, bedTop, bw, bl, 4); ctx.fill();
    const rN = Math.max(2, Math.round(bl/(bw*0.55))), cN = 2, cw = bw/cN, ch = bl/rN;
    for (let ri = 0; ri < rN; ri++) for (let ci = 0; ci < cN; ci++) { const xx = bx+ci*cw+2, yy = bedTop+ri*ch+2, ww2 = cw-4, hh2 = ch-4;
      ctx.fillStyle = col; roundRect(xx, yy, ww2, hh2, 3); ctx.fill();
      ctx.strokeStyle = dk; ctx.lineWidth = 1.3; line(xx+ww2/2, yy+1, xx+ww2/2, yy+hh2-1); line(xx+1, yy+hh2/2, xx+ww2-1, yy+hh2/2);
      ctx.fillStyle = 'rgba(255,255,255,0.16)'; roundRect(xx+2, yy+2, ww2*0.42, hh2*0.42, 2); ctx.fill(); }
  } else {
    ctx.fillStyle = '#6b4a2a'; roundRect(bx, bedTop, bw, bl, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.5; for (let i = 1; i < 3; i++) { const yy = bedTop+bl*(i/3); line(bx, yy, bx+bw, yy); }
    const fr = bw*0.17, pts = [[-bw*0.22,bedTop+bl*0.24],[bw*0.2,bedTop+bl*0.28],[0,bedTop+bl*0.52],[-bw*0.2,bedTop+bl*0.76],[bw*0.22,bedTop+bl*0.74]];
    for (const [px, py] of pts) { if (py > bedBot-fr) continue; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(px, py, fr, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.32)'; ctx.beginPath(); ctx.arc(px-fr*0.3, py-fr*0.3, fr*0.35, 0, 7); ctx.fill(); }
  }
}

function drawParticles() {
  for (const p of particles) { const t = p.life/p.max;
    if (p.type === 'smoke') { ctx.globalAlpha = (1-t)*0.3; ctx.fillStyle = '#cdd6ea'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); }
    else if (p.type === 'spark') { ctx.globalAlpha = 1-t; ctx.fillStyle = p.color || '#ffd166'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r*(1-t*0.4), 0, 7); ctx.fill(); }
    else { ctx.globalAlpha = 1-t; ctx.fillStyle = '#ffd166'; ctx.font = `bold ${Math.floor(CELL*0.32)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.txt, p.x, p.y); } }
  ctx.globalAlpha = 1;
}
function drawFloaters() {
  for (const f of floaters) { const k = ease(f.t); const x = f.x+(f.tx-f.x)*k, y = f.y+(f.ty-f.y)*k;
    ctx.globalAlpha = 1-f.t*0.5; ctx.font = `${Math.floor(CELL*0.5)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((MATERIALS[f.mat]||MATERIALS.wood).icon, x, y); ctx.globalAlpha = 1; }
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
  save.coins += earned; persist();
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
$('hintBtn').addEventListener('click', () => {
  if (!running || paused) return;
  const t = trucks.find(x => x.state === 'depot' && canExit(x) && orders.some(o => o && o.mat === x.mat && (o.qty - o.done) > 0) && bays.includes(null));
  if (t) { t.shake = 0.6; beep(880, 0.1, 'sine', 0.1); } else beep(300, 0.15, 'sawtooth', 0.1);
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
