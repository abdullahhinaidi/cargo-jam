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

const LEVELS = Array.from({ length: 30 }, (_, i) => makeDepot(i));
