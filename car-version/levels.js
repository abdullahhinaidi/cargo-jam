/*
 * Level format:
 *   cols, rows : board size in cells
 *   time       : seconds allowed
 *   cars: array of { c, r, len, o, dir, color }
 *     c,r  = anchor cell (top-left of the car), 0-indexed
 *     len  = length in cells (1..)
 *     o    = orientation: 'h' (horizontal) | 'v' (vertical)
 *     dir  = exit direction the car drives toward:
 *              'v' cars use 'up' | 'down'
 *              'h' cars use 'left' | 'right'
 *     color= palette key (see COLORS in game.js)
 *
 * A car leaves the lot when every cell between its front and the board
 * edge (in its exit direction) is empty. Clear all cars to win.
 */
const LEVELS = [
  // 1 — intro: free the red by moving yellow first
  {
    cols: 5, rows: 6, time: 90,
    cars: [
      { c: 2, r: 2, len: 2, o: 'v', dir: 'up',    color: 'red' },
      { c: 1, r: 1, len: 3, o: 'h', dir: 'right', color: 'yellow' },
      { c: 0, r: 0, len: 2, o: 'v', dir: 'down',  color: 'blue' },
      { c: 2, r: 5, len: 2, o: 'h', dir: 'left',  color: 'green' },
      { c: 4, r: 2, len: 2, o: 'v', dir: 'down',  color: 'purple' },
    ],
  },

  // 2 — a small jam near the top exit
  {
    cols: 6, rows: 6, time: 90,
    cars: [
      { c: 2, r: 3, len: 2, o: 'v', dir: 'up',    color: 'red' },
      { c: 0, r: 2, len: 3, o: 'h', dir: 'right', color: 'orange' },
      { c: 3, r: 2, len: 3, o: 'h', dir: 'right', color: 'yellow' },
      { c: 1, r: 4, len: 2, o: 'h', dir: 'left',  color: 'green' },
      { c: 4, r: 3, len: 3, o: 'v', dir: 'down',  color: 'blue' },
      { c: 5, r: 0, len: 2, o: 'v', dir: 'down',  color: 'purple' },
      { c: 3, r: 5, len: 2, o: 'h', dir: 'right', color: 'pink' },
    ],
  },

  // 3 — cross traffic
  {
    cols: 6, rows: 7, time: 100,
    cars: [
      { c: 2, r: 2, len: 2, o: 'v', dir: 'up',    color: 'red' },
      { c: 0, r: 1, len: 2, o: 'h', dir: 'right', color: 'cyan' },
      { c: 3, r: 1, len: 3, o: 'h', dir: 'right', color: 'yellow' },
      { c: 2, r: 4, len: 2, o: 'v', dir: 'down',  color: 'green' },
      { c: 0, r: 4, len: 2, o: 'v', dir: 'down',  color: 'orange' },
      { c: 4, r: 3, len: 3, o: 'v', dir: 'down',  color: 'blue' },
      { c: 1, r: 6, len: 3, o: 'h', dir: 'left',  color: 'purple' },
      { c: 5, r: 0, len: 2, o: 'v', dir: 'down',  color: 'pink' },
    ],
  },

  // 4 — packed lot
  {
    cols: 7, rows: 7, time: 120,
    cars: [
      { c: 3, r: 3, len: 2, o: 'v', dir: 'up',    color: 'red' },
      { c: 1, r: 2, len: 3, o: 'h', dir: 'right', color: 'yellow' },
      { c: 5, r: 2, len: 2, o: 'v', dir: 'down',  color: 'cyan' },
      { c: 0, r: 4, len: 3, o: 'h', dir: 'right', color: 'green' },
      { c: 4, r: 4, len: 3, o: 'h', dir: 'right', color: 'orange' },
      { c: 3, r: 5, len: 2, o: 'v', dir: 'down',  color: 'blue' },
      { c: 1, r: 0, len: 2, o: 'v', dir: 'down',  color: 'purple' },
      { c: 6, r: 5, len: 2, o: 'v', dir: 'down',  color: 'pink' },
      { c: 0, r: 6, len: 2, o: 'h', dir: 'left',  color: 'teal' },
    ],
  },

  // 5 — the gauntlet
  {
    cols: 7, rows: 8, time: 140,
    cars: [
      { c: 3, r: 3, len: 2, o: 'v', dir: 'up',    color: 'red' },
      { c: 0, r: 2, len: 3, o: 'h', dir: 'right', color: 'orange' },
      { c: 4, r: 2, len: 3, o: 'h', dir: 'right', color: 'yellow' },
      { c: 1, r: 5, len: 3, o: 'h', dir: 'left',  color: 'green' },
      { c: 5, r: 4, len: 3, o: 'v', dir: 'down',  color: 'blue' },
      { c: 2, r: 6, len: 2, o: 'v', dir: 'down',  color: 'purple' },
      { c: 0, r: 5, len: 2, o: 'v', dir: 'down',  color: 'cyan' },
      { c: 4, r: 6, len: 3, o: 'h', dir: 'right', color: 'pink' },
      { c: 1, r: 0, len: 2, o: 'v', dir: 'down',  color: 'teal' },
      { c: 6, r: 0, len: 2, o: 'v', dir: 'down',  color: 'lime' },
    ],
  },
];
