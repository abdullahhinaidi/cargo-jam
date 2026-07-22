/*
 * CARGO JAM — 30 levels on a difficulty curve.
 *
 * Each level: { cols, rows, slots, bays, lives, patience, mats, trucks }
 * Trucks are generated densely with a deterministic material scatter and a
 * share of two-cell "big rigs". Materials are introduced gradually. Solvability
 * is guaranteed at runtime by the engine's fixDeadlock(); every level is
 * additionally verified by an automated play-through test.
 */
const ALL_MATS = ['food', 'wood', 'steel', 'goods', 'water', 'oil'];

function matsFor(i) {
  if (i < 4)  return ['food', 'wood', 'steel'];
  if (i < 10) return ['food', 'wood', 'steel', 'goods'];
  if (i < 18) return ['food', 'wood', 'steel', 'goods', 'water'];
  return ALL_MATS;
}

// grid size per level (1-indexed feel), capped so cells stay a sensible size
const SIZES = [
  [5, 5], [5, 5], [5, 6], [6, 6], [6, 6],       // 1-5
  [6, 6], [6, 7], [7, 7], [7, 7], [7, 7],       // 6-10
  [7, 7], [7, 8], [7, 8], [8, 8], [8, 8],       // 11-15
  [8, 8], [8, 8], [8, 9], [8, 9], [8, 9],       // 16-20
  [8, 9], [9, 9], [9, 9], [9, 9], [9, 9],       // 21-25
  [9, 9], [9, 9], [9, 10], [9, 10], [9, 10],    // 26-30
];

function skipsFor(cols, rows, i) {
  // a few empty cells so the yard breathes; more gaps early, fewer late
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
  const out = [[Math.round(cx), Math.round(cy)]];
  if (i >= 3 && cols > 5) out.push([Math.round(cx) - 1, Math.round(cy) + 1]);
  if (i >= 8) out.push([Math.round(cx) + 1, Math.round(cy) - 1]);
  if (i < 6) { out.push([0, rows - 1]); out.push([cols - 1, 0]); }   // easier: corners open
  return out;
}

function makeDepot(i) {
  const [cols, rows] = SIZES[i];
  const mats = matsFor(i);
  const slots = i < 6 ? 3 : i < 20 ? 4 : 5;
  const bays  = i < 8 ? 3 : i < 22 ? 4 : 5;
  const lives = i < 22 ? 3 : 4;
  const patience = Math.round(56 - i * (17 / 29));      // 56 → 39
  const bigEvery = i < 5 ? 9 : i < 12 ? 6 : i < 22 ? 5 : 4;

  const skip = new Set(skipsFor(cols, rows, i).map(([c, r]) => c + ',' + r));
  const used = new Set();
  const key = (c, r) => c + ',' + r;
  const free = (c, r) => c >= 0 && c < cols && r >= 0 && r < rows && !skip.has(key(c, r)) && !used.has(key(c, r));
  const trucks = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!free(c, r)) continue;
      const m = mats[((c * 7 + r * 13 + c * r * 3) % mats.length + mats.length) % mats.length];
      const wantBig = ((c * 3 + r * 2 + i) % bigEvery === 0);
      if (wantBig && free(c + 1, r)) { used.add(key(c, r)); used.add(key(c + 1, r)); trucks.push({ c, r, mat: m, size: 2, o: 'h' }); continue; }
      if (wantBig && free(c, r + 1)) { used.add(key(c, r)); used.add(key(c, r + 1)); trucks.push({ c, r, mat: m, size: 2, o: 'v' }); continue; }
      used.add(key(c, r)); trucks.push({ c, r, mat: m, size: 1 });
    }
  }
  return { cols, rows, slots, bays, lives, patience, mats, trucks };
}

// ---- Obstacle levels: rectangular yard with interior terrain (rock / water / building).
// Trucks fill every non-obstacle cell that has a clear straight exit to some edge, so the
// terrain reshapes the jam without ever trapping a truck. Obstacles never touch an edge.
function makeMapLevel(opts) {
  const { cols, rows } = opts;
  const mats = opts.mats || ALL_MATS.slice(0, opts.matCount || 4);
  const obs = new Set();
  (opts.obstacles || []).forEach(o => { for (let dy = 0; dy < o.h; dy++) for (let dx = 0; dx < o.w; dx++) obs.add((o.x + dx) + ',' + (o.y + dy)); });
  const isObs = (c, r) => obs.has(c + ',' + r);
  const used = new Set();
  const key = (c, r) => c + ',' + r;
  const free = (c, r) => c >= 0 && c < cols && r >= 0 && r < rows && !isObs(c, r) && !used.has(key(c, r));
  const rayClear = (c, r, sx, sy) => { let x = c + sx, y = r + sy; while (x >= 0 && x < cols && y >= 0 && y < rows) { if (isObs(x, y)) return false; x += sx; y += sy; } return true; };
  const hasExit = (c, r) => rayClear(c, r, 0, -1) || rayClear(c, r, 0, 1) || rayClear(c, r, -1, 0) || rayClear(c, r, 1, 0);
  const bigH = (c, r) => (rayClear(c, r, -1, 0) || rayClear(c + 1, r, 1, 0));
  const bigV = (c, r) => (rayClear(c, r, 0, -1) || rayClear(c, r + 1, 0, 1));
  const trucks = [];
  const bigEvery = opts.bigEvery || 6;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!free(c, r) || !hasExit(c, r)) continue;
      const m = mats[((c * 7 + r * 13 + c * r * 3) % mats.length + mats.length) % mats.length];
      const wantBig = ((c * 3 + r * 2) % bigEvery === 0);
      if (wantBig && free(c + 1, r) && hasExit(c + 1, r) && bigH(c, r)) { used.add(key(c, r)); used.add(key(c + 1, r)); trucks.push({ c, r, mat: m, size: 2, o: 'h' }); continue; }
      if (wantBig && free(c, r + 1) && hasExit(c, r + 1) && bigV(c, r)) { used.add(key(c, r)); used.add(key(c, r + 1)); trucks.push({ c, r, mat: m, size: 2, o: 'v' }); continue; }
      used.add(key(c, r)); trucks.push({ c, r, mat: m, size: 1 });
    }
  }
  return { cols, rows, slots: opts.slots, bays: opts.bays, lives: opts.lives, patience: opts.patience, mats, obstacles: opts.obstacles, trucks };
}

// These aim HARDER than the base curve: big dense yards, only 4 bays, many big rigs,
// 5–6 materials, and obstacles placed to BLOCK/queue rather than delete the hard
// central trucks. Difficulty comes from density + limited bays + terrain, not size alone.
const OBSTACLE_LEVELS = [
  // 31 — warehouse maze: two wall spines force single-file lanes (front truck blocks its lane)
  makeMapLevel({ cols: 8, rows: 8, slots: 4, bays: 4, lives: 3, patience: 44, matCount: 5, bigEvery: 4,
    obstacles: [{ x: 2, y: 0, w: 1, h: 5, kind: 'building' }, { x: 5, y: 0, w: 1, h: 5, kind: 'building' }] }),
  // 32 — a wooded belt low and to one side, so the deep crowded corner stays
  makeMapLevel({ cols: 9, rows: 8, slots: 4, bays: 4, lives: 3, patience: 43, matCount: 6, bigEvery: 4,
    obstacles: [{ x: 4, y: 4, w: 4, h: 2, kind: 'trees' }] }),
  // 33 — a river crossed by a bridge, packed yard, four bays only
  makeMapLevel({ cols: 9, rows: 9, slots: 4, bays: 4, lives: 3, patience: 43, matCount: 6, bigEvery: 4,
    obstacles: [{ x: 3, y: 3, w: 3, h: 3, kind: 'bridge' }] }),
  // 34 — scattered terrain props break sight-lines all over a dense yard
  makeMapLevel({ cols: 9, rows: 8, slots: 5, bays: 4, lives: 3, patience: 42, matCount: 6, bigEvery: 4,
    obstacles: [{ x: 2, y: 1, w: 1, h: 2, kind: 'building' }, { x: 6, y: 1, w: 1, h: 2, kind: 'water' },
      { x: 4, y: 3, w: 1, h: 2, kind: 'containers' }, { x: 2, y: 5, w: 1, h: 2, kind: 'trees' }, { x: 6, y: 5, w: 1, h: 2, kind: 'bridge' }] }),
  // 35 — the big container yard: all six materials, densest, tightest
  makeMapLevel({ cols: 9, rows: 9, slots: 5, bays: 4, lives: 4, patience: 42, matCount: 6, bigEvery: 4,
    obstacles: [{ x: 3, y: 2, w: 4, h: 3, kind: 'containers' }] }),
];

const LEVELS = Array.from({ length: 30 }, (_, i) => makeDepot(i)).concat(OBSTACLE_LEVELS);
