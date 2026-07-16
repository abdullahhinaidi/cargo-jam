'use strict';

/* ---------- Color palette (top-down car colors) ---------- */
const COLORS = {
  red:    { body: '#ff4d4d', roof: '#d63030' },
  blue:   { body: '#3b82f6', roof: '#2563c9' },
  green:  { body: '#34c759', roof: '#249b43' },
  yellow: { body: '#ffcc33', roof: '#e0a91a' },
  orange: { body: '#ff8c1a', roof: '#e06f00' },
  purple: { body: '#a45cff', roof: '#7f3ce0' },
  pink:   { body: '#ff5ca8', roof: '#e03b87' },
  cyan:   { body: '#22d3ee', roof: '#12afc7' },
  teal:   { body: '#14b8a6', roof: '#0d9285' },
  lime:   { body: '#a3e635', roof: '#7cc019' },
};

/* ---------- Canvas / layout ---------- */
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

let CELL = 64;        // pixel size of one grid cell (computed to fit)
const PAD = 14;       // inner padding around the lot, in px
let DPR = Math.min(window.devicePixelRatio || 1, 2);

/* ---------- Game state ---------- */
let levelIndex = 0;
let cars = [];
let cols = 6, rows = 6;
let moves = 0;
let timeLeft = 60;
let timerId = null;
let running = false;

/* ---------- DOM ---------- */
const el = {
  level:   document.getElementById('levelValue'),
  timer:   document.getElementById('timerValue'),
  timerBox:document.getElementById('timerBox'),
  moves:   document.getElementById('movesValue'),
  overlay: document.getElementById('overlay'),
  ovTitle: document.getElementById('overlayTitle'),
  ovSub:   document.getElementById('overlaySub'),
  ovBtn:   document.getElementById('overlayBtn'),
};

/* ---------- Audio (tiny WebAudio blips, no assets) ---------- */
let audioCtx = null;
function beep(freq, dur = 0.08, type = 'sine', vol = 0.12) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.stop(audioCtx.currentTime + dur);
  } catch (e) { /* ignore */ }
}
const sndDrive   = () => { beep(520, 0.10, 'triangle', 0.14); setTimeout(() => beep(760, 0.10, 'triangle', 0.12), 60); };
const sndBlocked = () => beep(150, 0.14, 'sawtooth', 0.10);
const sndWin     = () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.14, 'triangle', 0.16), i * 110)); };
const sndLose    = () => { [400, 300, 200].forEach((f, i) => setTimeout(() => beep(f, 0.2, 'sawtooth', 0.14), i * 140)); };

/* ---------- Car helpers ---------- */
// cells occupied by a car (ignores animation offset)
function carCells(car) {
  const out = [];
  for (let i = 0; i < car.len; i++) {
    if (car.o === 'h') out.push([car.c + i, car.r]);
    else               out.push([car.c, car.r + i]);
  }
  return out;
}

// build occupancy grid from all cars that are still parked (not exiting)
function buildGrid() {
  const g = Array.from({ length: rows }, () => new Array(cols).fill(null));
  for (const car of cars) {
    if (car.exiting) continue;
    for (const [c, r] of carCells(car)) {
      if (r >= 0 && r < rows && c >= 0 && c < cols) g[r][c] = car;
    }
  }
  return g;
}

// is the path from the car's front to the board edge clear?
function canExit(car, grid) {
  if (car.o === 'v') {
    const c = car.c;
    if (car.dir === 'up') {
      for (let r = car.r - 1; r >= 0; r--) if (grid[r][c]) return false;
    } else { // down
      for (let r = car.r + car.len; r < rows; r++) if (grid[r][c]) return false;
    }
  } else {
    const r = car.r;
    if (car.dir === 'left') {
      for (let c = car.c - 1; c >= 0; c--) if (grid[r][c]) return false;
    } else { // right
      for (let c = car.c + car.len; c < cols; c++) if (grid[r][c]) return false;
    }
  }
  return true;
}

/* ---------- Load / reset ---------- */
function loadLevel(i) {
  const lv = LEVELS[i];
  cols = lv.cols; rows = lv.rows;
  timeLeft = lv.time;
  moves = 0;
  cars = lv.cars.map((c, idx) => ({
    ...c,
    id: idx,
    offset: 0,       // px offset while exiting
    exiting: false,
    done: false,
    shake: 0,        // shake timer for "blocked" feedback
  }));
  running = true;
  resize();
  updateHUD();
  startTimer();
  render(); // paint the new level immediately
}

function updateHUD() {
  el.level.textContent = (levelIndex + 1);
  el.moves.textContent = moves;
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
    if (timeLeft <= 0) endLose();
  }, 100);
}
function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

/* ---------- Sizing ---------- */
function resize() {
  const stage = document.getElementById('stage');
  const availW = stage.clientWidth;
  const availH = stage.clientHeight;
  // choose cell so the whole board fits, leaving room for exit lanes
  const cw = (availW - PAD * 2) / cols;
  const ch = (availH - PAD * 2) / rows;
  CELL = Math.max(28, Math.floor(Math.min(cw, ch)));

  const w = cols * CELL + PAD * 2;
  const h = rows * CELL + PAD * 2;
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = Math.round(w * DPR);
  canvas.height = Math.round(h * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

/* ---------- Rendering ---------- */
function draw() {
  const w = cols * CELL + PAD * 2;
  const h = rows * CELL + PAD * 2;
  ctx.clearRect(0, 0, w, h);

  // lot floor
  ctx.fillStyle = '#3a4166';
  roundRect(0, 0, w, h, 20); ctx.fill();

  // parking slot lines
  ctx.strokeStyle = 'rgba(255, 209, 102, 0.35)';
  ctx.lineWidth = 2;
  for (let c = 1; c < cols; c++) {
    line(PAD + c * CELL, PAD + 6, PAD + c * CELL, PAD + rows * CELL - 6);
  }
  for (let r = 1; r < rows; r++) {
    line(PAD + 6, PAD + r * CELL, PAD + cols * CELL - 6, PAD + r * CELL);
  }
  // border frame
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 4;
  roundRect(4, 4, w - 8, h - 8, 16); ctx.stroke();

  // cars
  for (const car of cars) {
    if (car.done) continue;
    drawCar(car);
  }
}

function drawCar(car) {
  const inset = Math.max(4, CELL * 0.10);
  let x = PAD + car.c * CELL + inset;
  let y = PAD + car.r * CELL + inset;
  let cw = (car.o === 'h' ? car.len : 1) * CELL - inset * 2;
  let ch = (car.o === 'v' ? car.len : 1) * CELL - inset * 2;

  // exit animation offset
  if (car.exiting) {
    if (car.dir === 'up')    y -= car.offset;
    if (car.dir === 'down')  y += car.offset;
    if (car.dir === 'left')  x -= car.offset;
    if (car.dir === 'right') x += car.offset;
  }
  // blocked shake
  if (car.shake > 0) {
    const s = Math.sin(car.shake * 40) * 3;
    if (car.o === 'h') y += s; else x += s;
  }

  const col = COLORS[car.color] || COLORS.red;
  const rad = Math.min(cw, ch) * 0.28;

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  roundRect(x + 3, y + 4, cw, ch, rad); ctx.fill();

  // body
  ctx.fillStyle = col.body;
  roundRect(x, y, cw, ch, rad); ctx.fill();

  // roof (darker centre panel)
  ctx.fillStyle = col.roof;
  const rInset = Math.min(cw, ch) * 0.22;
  if (car.o === 'v') {
    roundRect(x + rInset, y + ch * 0.30, cw - rInset * 2, ch * 0.42, rad * 0.6);
  } else {
    roundRect(x + cw * 0.30, y + rInset, cw * 0.42, ch - rInset * 2, rad * 0.6);
  }
  ctx.fill();

  // windshield near the front (exit direction)
  ctx.fillStyle = 'rgba(200, 235, 255, 0.85)';
  const wsT = Math.min(cw, ch) * 0.16;
  if (car.o === 'v') {
    if (car.dir === 'up') roundRect(x + rInset, y + ch * 0.14, cw - rInset * 2, wsT, 3);
    else                  roundRect(x + rInset, y + ch * 0.86 - wsT, cw - rInset * 2, wsT, 3);
  } else {
    if (car.dir === 'left') roundRect(x + cw * 0.14, y + rInset, wsT, ch - rInset * 2, 3);
    else                    roundRect(x + cw * 0.86 - wsT, y + rInset, wsT, ch - rInset * 2, 3);
  }
  ctx.fill();

  // direction arrow (subtle) pointing to the exit
  drawArrow(car, x, y, cw, ch);

  // glossy highlight
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  roundRect(x + cw * 0.12, y + ch * 0.10, cw * 0.20, ch * 0.80, rad * 0.5); ctx.fill();
}

function drawArrow(car, x, y, cw, ch) {
  const cx = x + cw / 2, cy = y + ch / 2;
  const s = Math.min(cw, ch) * 0.16;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  const d = car.dir;
  if (d === 'up')    { ctx.moveTo(cx, cy - s); ctx.lineTo(cx - s, cy + s * 0.4); ctx.lineTo(cx + s, cy + s * 0.4); }
  if (d === 'down')  { ctx.moveTo(cx, cy + s); ctx.lineTo(cx - s, cy - s * 0.4); ctx.lineTo(cx + s, cy - s * 0.4); }
  if (d === 'left')  { ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s * 0.4, cy - s); ctx.lineTo(cx + s * 0.4, cy + s); }
  if (d === 'right') { ctx.moveTo(cx + s, cy); ctx.lineTo(cx - s * 0.4, cy - s); ctx.lineTo(cx - s * 0.4, cy + s); }
  ctx.closePath();
  ctx.fill();
}

/* canvas path helpers */
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

/* ---------- Input ---------- */
function pointToCell(evt) {
  const rect = canvas.getBoundingClientRect();
  const px = (evt.clientX - rect.left);
  const py = (evt.clientY - rect.top);
  const c = Math.floor((px - PAD) / CELL);
  const r = Math.floor((py - PAD) / CELL);
  return { c, r };
}

function carAt(c, r) {
  const grid = buildGrid();
  if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
  return grid[r][c];
}

function handleTap(evt) {
  if (!running) return;
  const { c, r } = pointToCell(evt);
  const car = carAt(c, r);
  if (!car || car.exiting) return;

  const grid = buildGrid();
  if (canExit(car, grid)) {
    car.exiting = true;
    moves++;
    updateHUD();
    sndDrive();
  } else {
    car.shake = 0.32;
    sndBlocked();
  }
}

canvas.addEventListener('pointerdown', handleTap);

/* ---------- Main loop ----------
 * Driven by requestAnimationFrame when the tab is visible (smooth 60fps),
 * with a setInterval safety net so the board still renders in a throttled or
 * hidden tab (Chrome pauses rAF entirely for hidden tabs). Both drivers call
 * render(), which advances animation by real elapsed time via a shared clock. */
let lastTs = 0;

function render() {
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let dt = lastTs ? (now - lastTs) / 1000 : 0;
  lastTs = now;
  dt = Math.min(0.05, Math.max(0, dt));

  const travel = Math.max(cols, rows) * CELL + CELL; // px to fully leave
  for (const car of cars) {
    if (car.exiting && !car.done) {
      car.offset += (600 + car.offset * 2.2) * dt;  // ease-out acceleration
      if (car.offset > travel) {
        car.done = true;
        checkWin();
      }
    }
    if (car.shake > 0) car.shake = Math.max(0, car.shake - dt);
  }

  draw();
}

function rafLoop() { render(); requestAnimationFrame(rafLoop); }
requestAnimationFrame(rafLoop);
// Safety net: keeps the canvas painting even if rAF is paused (hidden/throttled tab)
setInterval(() => { if (document.hidden) render(); }, 250);
// Repaint promptly when returning to the tab
document.addEventListener('visibilitychange', () => { lastTs = 0; render(); });

/* ---------- Win / Lose ---------- */
function checkWin() {
  if (cars.every(c => c.done)) {
    running = false;
    stopTimer();
    sndWin();
    const isLast = levelIndex >= LEVELS.length - 1;
    showOverlay(
      isLast ? '🏆 أكملت كل المراحل!' : '✅ أحسنت!',
      isLast ? `أنهيت اللعبة بـ ${moves} نقلة. رجعنا للبداية؟` : `فككت الزحمة في ${moves} نقلة.`,
      isLast ? 'العب من جديد' : 'المرحلة التالية',
      () => {
        levelIndex = isLast ? 0 : levelIndex + 1;
        hideOverlay();
        loadLevel(levelIndex);
      }
    );
  }
}

function endLose() {
  if (!running) return;
  running = false;
  stopTimer();
  sndLose();
  showOverlay('⏰ انتهى الوقت!', 'الموقف ما زال مزدحماً. حاول مرة ثانية.', 'إعادة المحاولة', () => {
    hideOverlay();
    loadLevel(levelIndex);
  });
}

/* ---------- Overlay ---------- */
let overlayHandler = null;
function showOverlay(title, sub, btn, handler) {
  el.ovTitle.textContent = title;
  el.ovSub.textContent = sub;
  el.ovBtn.textContent = btn;
  overlayHandler = handler;
  el.overlay.classList.remove('hidden');
}
function hideOverlay() { el.overlay.classList.add('hidden'); }

el.ovBtn.addEventListener('click', () => { if (overlayHandler) overlayHandler(); });

/* ---------- Hint: flash a car that can exit ---------- */
document.getElementById('hintBtn').addEventListener('click', () => {
  if (!running) return;
  const grid = buildGrid();
  const movable = cars.filter(c => !c.exiting && canExit(c, grid));
  if (movable.length) {
    const pick = movable[0];
    pick.shake = 0.5;
    beep(880, 0.1, 'sine', 0.1);
  }
});

/* ---------- Restart ---------- */
document.getElementById('restartBtn').addEventListener('click', () => {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  loadLevel(levelIndex);
});

/* ---------- Boot ---------- */
window.addEventListener('resize', () => { if (running) resize(); });

// Start screen
showOverlay('🚗 زحمة المواقف', 'اضغط على السيارة لتخرجها من الموقف. فكّ الزحمة قبل نفاد الوقت!', 'ابدأ اللعب', () => {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  hideOverlay();
  levelIndex = 0;
  loadLevel(levelIndex);
});

render(); // initial paint (in case rAF is delayed)
