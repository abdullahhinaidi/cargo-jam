'use strict';

/* ---------- Color palette ---------- */
const COLORS = {
  red:    { body: '#ff4d4d', dark: '#c92f2f' },
  blue:   { body: '#3b82f6', dark: '#2159c4' },
  green:  { body: '#34c759', dark: '#219a45' },
  yellow: { body: '#ffcc33', dark: '#d9a413' },
  orange: { body: '#ff8c1a', dark: '#d96f00' },
  purple: { body: '#a45cff', dark: '#7a35d6' },
  pink:   { body: '#ff5ca8', dark: '#d63b85' },
  cyan:   { body: '#22d3ee', dark: '#0f9fb8' },
};

/* ---------- Canvas ---------- */
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const PAD = 14;
let CELL = 60;
let DPR = 1;

// layout bands (filled in resize)
let L = { qY: 0, qH: 0, bayY: 0, bayH: 0, lotY: 0, bayW: 0, bayStartX: 0, w: 0, h: 0 };

/* ---------- Game state ---------- */
let levelIndex = 0;
let cols, rows, BAYS, CAP;
let buses = [];          // {c,r,color,state,seats,bay,x,y,anim}
let bays = [];           // array length BAYS of bus|null
let queue = [];          // array of color keys, [0] = front
let timeLeft = 0, timerId = null, running = false;
let pax = [];            // passenger objects mirroring queue for animation {color, pop}
let floaters = [];       // little animations for boarding

/* ---------- DOM ---------- */
const el = {
  level:   document.getElementById('levelValue'),
  timer:   document.getElementById('timerValue'),
  timerBox:document.getElementById('timerBox'),
  pax:     document.getElementById('paxValue'),
  overlay: document.getElementById('overlay'),
  ovTitle: document.getElementById('overlayTitle'),
  ovSub:   document.getElementById('overlaySub'),
  ovBtn:   document.getElementById('overlayBtn'),
};

/* ---------- Audio ---------- */
let audioCtx = null;
function beep(freq, dur = 0.08, type = 'sine', vol = 0.12) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    o.connect(g); g.connect(audioCtx.destination); o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.stop(audioCtx.currentTime + dur);
  } catch (e) {}
}
const sndMove    = () => beep(560, 0.09, 'triangle', 0.12);
const sndBoard   = () => beep(720, 0.06, 'sine', 0.10);
const sndDepart  = () => { beep(400, 0.12, 'triangle', 0.13); setTimeout(()=>beep(600,0.12,'triangle',0.11),90); };
const sndBlocked = () => beep(150, 0.14, 'sawtooth', 0.10);
const sndWin     = () => [523,659,784,1047].forEach((f,i)=>setTimeout(()=>beep(f,0.14,'triangle',0.16),i*110));
const sndLose    = () => [400,300,200].forEach((f,i)=>setTimeout(()=>beep(f,0.2,'sawtooth',0.14),i*140));

/* ---------- Level load ---------- */
function loadLevel(i) {
  const lv = LEVELS[i];
  cols = lv.cols; rows = lv.rows; BAYS = lv.bays; CAP = lv.cap;
  timeLeft = lv.time;
  bays = new Array(BAYS).fill(null);
  queue = lv.queue.slice();
  buses = lv.buses.map((b, idx) => ({
    id: idx, c: b.c, r: b.r, color: b.color,
    state: 'lot',           // lot | moving | bay | leaving
    seats: 0, bay: -1,
    x: 0, y: 0, anim: null, shake: 0,
  }));
  floaters = [];
  running = true;
  resize();
  buses.forEach(b => { const p = lotPos(b.c, b.r); b.x = p.x; b.y = p.y; });
  updateHUD();
  startTimer();
  if (typeof render === 'function') render(); // paint the new level immediately
}

function updateHUD() {
  el.level.textContent = levelIndex + 1;
  el.pax.textContent = queue.length;
  el.timer.textContent = timeLeft.toFixed(1);
  el.timerBox.classList.toggle('warning', timeLeft <= 10);
}

/* ---------- Timer ---------- */
function startTimer() {
  stopTimer();
  timerId = setInterval(() => {
    if (!running) return;
    timeLeft = Math.max(0, timeLeft - 0.1);
    el.timer.textContent = timeLeft.toFixed(1);
    el.timerBox.classList.toggle('warning', timeLeft <= 10);
    if (timeLeft <= 0) endLose('⏰ انتهى الوقت!');
  }, 100);
}
function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

/* ---------- Geometry ---------- */
function lotPos(c, r) {
  return { x: (L.w - cols * CELL) / 2 + c * CELL + CELL / 2, y: L.lotY + r * CELL + CELL / 2 };
}
function bayPos(i) {
  return { x: L.bayStartX + i * L.bayW + L.bayW / 2, y: L.bayY + L.bayH / 2 };
}

function resize() {
  const stage = document.getElementById('stage');
  const availW = stage.clientWidth, availH = stage.clientHeight;
  // vertical budget: queue(0.9) + gap(0.3) + bay(1.25) + gap(0.4) + lot(rows)
  const vRows = rows + 2.85;
  const maxCols = Math.max(cols, BAYS);
  CELL = Math.max(30, Math.floor(Math.min((availW - PAD * 2) / maxCols, (availH - PAD * 2) / vRows)));

  L.w = maxCols * CELL + PAD * 2;
  L.qH  = CELL * 0.9;
  L.bayH = CELL * 1.25;
  L.qY   = PAD;
  L.bayY = L.qY + L.qH + CELL * 0.3;
  L.lotY = L.bayY + L.bayH + CELL * 0.45;
  L.h = L.lotY + rows * CELL + PAD;

  L.bayW = Math.min(CELL * 1.5, (L.w - PAD * 2) / BAYS);
  L.bayStartX = (L.w - L.bayW * BAYS) / 2;

  DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = L.w + 'px';
  canvas.style.height = L.h + 'px';
  canvas.width = Math.round(L.w * DPR);
  canvas.height = Math.round(L.h * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // keep parked/bay buses positioned correctly after a resize
  buses.forEach(b => {
    if (b.state === 'lot') { const p = lotPos(b.c, b.r); b.x = p.x; b.y = p.y; }
    else if (b.state === 'bay' && b.bay >= 0) { const p = bayPos(b.bay); b.x = p.x; b.y = p.y; }
  });
}

/* ---------- Jam logic ---------- */
function isTappable(bus) {
  if (bus.state !== 'lot') return false;
  // blocked if any lot bus sits above it in the same column
  return !buses.some(o => o !== bus && o.state === 'lot' && o.c === bus.c && o.r < bus.r);
}
function firstFreeBay() { return bays.findIndex(b => b === null); }
function anyBusy() { return buses.some(b => b.state === 'moving' || b.state === 'leaving'); }

/* ---------- Boarding resolution ---------- */
function resolveBoarding() {
  let progressed = true;
  while (progressed) {
    progressed = false;
    if (queue.length === 0) break;
    const front = queue[0];
    const bus = bays.find(b => b && b.state === 'bay' && b.color === front && b.seats < CAP);
    if (bus) {
      bus.seats++;
      queue.shift();
      spawnFloater(bus);
      sndBoard();
      progressed = true;
      if (bus.seats >= CAP) departBus(bus);
    }
  }
  updateHUD();
  if (queue.length === 0) return endWin();
  checkDeadlock();
}

function departBus(bus) {
  bays[bus.bay] = null;
  bus.state = 'leaving';
  bus.anim = tween(bus, bus.x, -CELL * 2, 0.5, () => { bus.state = 'gone'; });
  sndDepart();
}

function checkDeadlock() {
  if (anyBusy()) return;                       // wait until motion settles
  if (queue.length === 0) return;
  if (firstFreeBay() !== -1) return;           // still room to act
  const front = queue[0];
  const canBoard = bays.some(b => b && b.color === front && b.seats < CAP);
  if (!canBoard) endLose('🚧 انسدّ الطابور!');
}

/* ---------- Floaters (passenger hops onto bus) ---------- */
function spawnFloater(bus) {
  floaters.push({ x: L.w / 2, y: L.qY + L.qH / 2, tx: bus.x, ty: bus.y, t: 0, color: bus.color });
}

/* ---------- Tween ---------- */
function tween(obj, tx, ty, dur, onDone) {
  return { fromX: obj.x, fromY: obj.y, toX: tx, toY: ty, t: 0, dur, onDone };
}
function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

/* ---------- Input ---------- */
function handleTap(evt) {
  if (!running || anyBusy()) return;
  const rect = canvas.getBoundingClientRect();
  const px = evt.clientX - rect.left, py = evt.clientY - rect.top;

  // hit-test lot buses
  const hit = buses.find(b => b.state === 'lot' &&
    Math.abs(px - b.x) < CELL / 2 && Math.abs(py - b.y) < CELL / 2);
  if (!hit) return;

  if (!isTappable(hit)) { hit.shake = 0.3; sndBlocked(); return; }
  const bi = firstFreeBay();
  if (bi === -1) { hit.shake = 0.3; sndBlocked(); return; }

  bays[bi] = hit;
  hit.bay = bi;
  hit.state = 'moving';
  const bp = bayPos(bi);
  // two-step: rise up then slide into bay (single tween is fine visually)
  hit.anim = tween(hit, bp.x, bp.y, 0.32, () => {
    hit.state = 'bay';
    resolveBoarding();
  });
  sndMove();
}
canvas.addEventListener('pointerdown', handleTap);

/* ---------- Main loop ----------
 * Driven by requestAnimationFrame when the tab is visible (smooth 60fps),
 * with a setInterval safety net so the board still renders in a throttled or
 * hidden tab (Chrome pauses rAF entirely for hidden tabs). Both drivers call
 * render(), which advances animation by real elapsed time via a shared clock,
 * so they never double-count. */
let lastTs = 0;

function render() {
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let dt = lastTs ? (now - lastTs) / 1000 : 0;
  lastTs = now;
  dt = Math.min(0.05, Math.max(0, dt));

  for (const b of buses) {
    if (b.anim) {
      b.anim.t += dt / b.anim.dur;
      const k = ease(Math.min(1, b.anim.t));
      b.x = b.anim.fromX + (b.anim.toX - b.anim.fromX) * k;
      b.y = b.anim.fromY + (b.anim.toY - b.anim.fromY) * k;
      if (b.anim.t >= 1) { const cb = b.anim.onDone; b.anim = null; if (cb) cb(); }
    }
    if (b.shake > 0) b.shake = Math.max(0, b.shake - dt);
  }
  for (const f of floaters) f.t = Math.min(1, f.t + dt / 0.35);
  floaters = floaters.filter(f => f.t < 1);

  draw();
}

function rafLoop() { render(); requestAnimationFrame(rafLoop); }
requestAnimationFrame(rafLoop);
// Safety net: keeps the canvas painting even if rAF is paused (hidden/throttled tab)
setInterval(() => { if (document.hidden) render(); }, 250);
// Repaint promptly when returning to the tab
document.addEventListener('visibilitychange', () => { lastTs = 0; render(); });

/* ---------- Rendering ---------- */
function draw() {
  ctx.clearRect(0, 0, L.w, L.h);

  drawQueue();
  drawBays();
  drawLot();
  // buses on top of lot/bays
  for (const b of buses) if (b.state !== 'gone') drawBus(b);
  drawFloaters();
}

function drawQueue() {
  const r = L.qH * 0.34;
  const gap = Math.min(L.qH * 0.92, (L.w - PAD * 2) / 12);
  const cy = L.qY + L.qH / 2;
  // station label
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  roundRect(PAD, L.qY, L.w - PAD * 2, L.qH, 12); ctx.fill();

  const show = Math.min(queue.length, Math.floor((L.w - PAD * 3) / gap));
  let x = PAD + gap * 0.7;
  for (let i = 0; i < show; i++) {
    drawPerson(x, cy, r, queue[i], i === 0);
    x += gap;
  }
  if (queue.length > show) {
    ctx.fillStyle = '#f2f5ff';
    ctx.font = `bold ${Math.floor(r * 1.1)}px system-ui`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('+' + (queue.length - show), x - gap * 0.2, cy);
  }
}

function drawPerson(x, y, r, color, isFront) {
  const col = COLORS[color] || COLORS.red;
  if (isFront) {
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.arc(x, y, r * 1.5, 0, Math.PI * 2); ctx.fill();
  }
  // body
  ctx.fillStyle = col.body;
  roundRect(x - r * 0.7, y - r * 0.1, r * 1.4, r * 1.2, r * 0.4); ctx.fill();
  // head
  ctx.beginPath(); ctx.arc(x, y - r * 0.55, r * 0.55, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = col.dark;
  ctx.beginPath(); ctx.arc(x, y - r * 0.55, r * 0.55, 0, Math.PI * 2); ctx.stroke();
}

function drawBays() {
  for (let i = 0; i < BAYS; i++) {
    const x = L.bayStartX + i * L.bayW, y = L.bayY;
    const w = L.bayW - 8;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    roundRect(x + 4, y, w, L.bayH, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    roundRect(x + 4, y, w, L.bayH, 14); ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawLot() {
  const lx = (L.w - cols * CELL) / 2;
  ctx.fillStyle = '#3a4166';
  roundRect(lx - 6, L.lotY - 6, cols * CELL + 12, rows * CELL + 12, 18); ctx.fill();
  ctx.strokeStyle = 'rgba(255, 209, 102, 0.30)';
  ctx.lineWidth = 2;
  for (let c = 1; c < cols; c++) line(lx + c * CELL, L.lotY + 6, lx + c * CELL, L.lotY + rows * CELL - 6);
  for (let r = 1; r < rows; r++) line(lx + 6, L.lotY + r * CELL, lx + cols * CELL - 6, L.lotY + r * CELL);
}

function drawBus(bus) {
  const col = COLORS[bus.color] || COLORS.red;
  const isBay = bus.state === 'bay';
  const bw = (isBay ? Math.min(L.bayW - 16, CELL * 1.3) : CELL) * 0.86;
  const bh = (isBay ? L.bayH - 16 : CELL) * 0.86;
  let x = bus.x - bw / 2, y = bus.y - bh / 2;

  const dim = bus.state === 'lot' && !isTappable(bus);
  if (bus.shake > 0) x += Math.sin(bus.shake * 45) * 3;

  const rad = Math.min(bw, bh) * 0.26;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  roundRect(x + 2, y + 3, bw, bh, rad); ctx.fill();
  // body
  ctx.fillStyle = dim ? mix(col.body, '#3a4166', 0.45) : col.body;
  roundRect(x, y, bw, bh, rad); ctx.fill();
  // roof stripe
  ctx.fillStyle = dim ? mix(col.dark, '#3a4166', 0.45) : col.dark;
  roundRect(x + bw * 0.12, y + bh * 0.12, bw * 0.76, bh * 0.2, rad * 0.5); ctx.fill();
  // windshield
  ctx.fillStyle = 'rgba(200,235,255,0.9)';
  roundRect(x + bw * 0.14, y + bh * 0.62, bw * 0.72, bh * 0.2, rad * 0.4); ctx.fill();

  // seat pips (capacity)
  const pipR = Math.min(bw, bh) * 0.07;
  const startX = x + bw * 0.2, pipY = y + bh * 0.42, stepX = (bw * 0.6) / Math.max(1, CAP - 1);
  for (let s = 0; s < CAP; s++) {
    ctx.beginPath();
    ctx.arc(startX + (CAP === 1 ? bw * 0.3 : s * stepX), pipY, pipR, 0, Math.PI * 2);
    ctx.fillStyle = s < bus.seats ? '#ffffff' : 'rgba(255,255,255,0.28)';
    ctx.fill();
  }

  // tappable highlight ring
  if (bus.state === 'lot' && isTappable(bus)) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    roundRect(x - 1, y - 1, bw + 2, bh + 2, rad); ctx.stroke();
  }
}

function drawFloaters() {
  for (const f of floaters) {
    const k = ease(f.t);
    const x = f.x + (f.tx - f.x) * k;
    const y = f.y + (f.ty - f.y) * k;
    const col = COLORS[f.color] || COLORS.red;
    ctx.globalAlpha = 1 - f.t * 0.6;
    ctx.fillStyle = col.body;
    ctx.beginPath(); ctx.arc(x, y, CELL * 0.14, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/* ---------- canvas helpers ---------- */
function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
function mix(a, b, t) {
  const pa = hex(a), pb = hex(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `rgb(${r},${g},${bl})`;
}
function hex(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

/* ---------- Win / Lose ---------- */
function endWin() {
  running = false; stopTimer(); sndWin();
  const isLast = levelIndex >= LEVELS.length - 1;
  showOverlay(
    isLast ? '🏆 أكملت كل المراحل!' : '✅ أحسنت!',
    isLast ? 'وصّلت كل الركاب! رجعنا للبداية؟' : 'كل الركاب ركبوا باصاتهم. جاهز للتالي؟',
    isLast ? 'العب من جديد' : 'المرحلة التالية',
    () => { levelIndex = isLast ? 0 : levelIndex + 1; hideOverlay(); loadLevel(levelIndex); }
  );
}
function endLose(msg) {
  if (!running) return;
  running = false; stopTimer(); sndLose();
  showOverlay(msg, 'ما قدرت توصّل كل الركاب. حاول مرة ثانية.', 'إعادة المحاولة',
    () => { hideOverlay(); loadLevel(levelIndex); });
}

/* ---------- Overlay ---------- */
let overlayHandler = null;
function showOverlay(title, sub, btn, handler) {
  el.ovTitle.textContent = title; el.ovSub.textContent = sub; el.ovBtn.textContent = btn;
  overlayHandler = handler; el.overlay.classList.remove('hidden');
}
function hideOverlay() { el.overlay.classList.add('hidden'); }
el.ovBtn.addEventListener('click', () => { if (overlayHandler) overlayHandler(); });

/* ---------- Hint ---------- */
document.getElementById('hintBtn').addEventListener('click', () => {
  if (!running || anyBusy() || queue.length === 0) return;
  const front = queue[0];
  // a bay bus already matching?
  if (bays.some(b => b && b.color === front && b.seats < CAP)) { beep(880, 0.1, 'sine', 0.1); return; }
  // else flash a tappable bus of the front color
  const pick = buses.find(b => b.state === 'lot' && b.color === front && isTappable(b));
  if (pick) { pick.shake = 0.6; beep(880, 0.1, 'sine', 0.1); }
  else beep(300, 0.15, 'sawtooth', 0.1);
});

/* ---------- Restart ---------- */
document.getElementById('restartBtn').addEventListener('click', () => {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  loadLevel(levelIndex);
});

/* ---------- Boot ---------- */
window.addEventListener('resize', () => { if (running) resize(); });
showOverlay('🚌 زحمة الباصات',
  'اضغط على الباص لتنقله إلى موقف الركوب. الراكب يركب الباص اللي بنفس لونه — رتّب الباصات قبل ما ينسدّ الطابور!',
  'ابدأ اللعب',
  () => { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); hideOverlay(); levelIndex = 0; loadLevel(0); });

render(); // initial paint (in case rAF is delayed)
