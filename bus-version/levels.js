/*
 * BUS JAM — level format
 *
 *   cols, rows : parking-lot grid size (buses are 1 cell each)
 *   bays       : number of boarding slots at the station
 *   cap        : seats per bus
 *   time       : seconds allowed
 *   queue      : array of color keys — the passenger line. queue[0] is at the
 *                FRONT and must board before anyone behind can move.
 *   buses      : array of { c, r, color } placed in the lot.
 *
 * Rules the engine enforces:
 *   - A bus can be tapped only if no bus sits above it in the same column
 *     (you must clear the jam from the top).
 *   - Tapping a tappable bus sends it to the next free bay.
 *   - The front passenger boards any bay bus of its color that has a free seat.
 *     A full bus departs and frees its bay.
 *   - Deadlock (all bays full + front passenger matches none) = you lose.
 *
 * Design invariant: for every color, (passengers of that color) must equal
 * (buses of that color) * cap, so every bus fills exactly and departs.
 */
const LEVELS = [
  // 1 — tutorial: grouped queue, one bus per color, no jam
  {
    cols: 3, rows: 1, bays: 3, cap: 3, time: 120,
    buses: [
      { c: 0, r: 0, color: 'red' },
      { c: 1, r: 0, color: 'blue' },
      { c: 2, r: 0, color: 'green' },
    ],
    queue: [
      'red','red','red',
      'blue','blue','blue',
      'green','green','green',
    ],
  },

  // 2 — interleaved: keep partly-filled buses parked across colors
  {
    cols: 3, rows: 1, bays: 3, cap: 3, time: 120,
    buses: [
      { c: 0, r: 0, color: 'red' },
      { c: 1, r: 0, color: 'blue' },
      { c: 2, r: 0, color: 'green' },
    ],
    queue: [
      'red','blue','red','blue','green','green','red','blue','green',
    ],
  },

  // 3 — more buses than bays: two red buses, manage the station
  {
    cols: 5, rows: 1, bays: 3, cap: 3, time: 150,
    buses: [
      { c: 0, r: 0, color: 'red' },
      { c: 1, r: 0, color: 'blue' },
      { c: 2, r: 0, color: 'green' },
      { c: 3, r: 0, color: 'yellow' },
      { c: 4, r: 0, color: 'red' },
    ],
    queue: [
      'red','blue','green','red','blue','green','red','blue','green',
      'yellow','yellow','yellow','red','red','red',
    ],
  },

  // 4 — real jam: 2 rows, needed colors buried under the top row
  {
    cols: 3, rows: 2, bays: 3, cap: 3, time: 160,
    buses: [
      { c: 0, r: 0, color: 'blue' },
      { c: 1, r: 0, color: 'red' },
      { c: 2, r: 0, color: 'green' },
      { c: 0, r: 1, color: 'red' },
      { c: 1, r: 1, color: 'green' },
      { c: 2, r: 1, color: 'blue' },
    ],
    queue: [
      'red','red','red','blue','blue','blue','green','green','green',
      'red','red','red','blue','blue','blue','green','green','green',
    ],
  },

  // 5 — the gauntlet: 4 colors, jam + interleave
  {
    cols: 4, rows: 2, bays: 3, cap: 3, time: 200,
    buses: [
      { c: 0, r: 0, color: 'red' },
      { c: 1, r: 0, color: 'yellow' },
      { c: 2, r: 0, color: 'blue' },
      { c: 3, r: 0, color: 'green' },
      { c: 0, r: 1, color: 'blue' },
      { c: 1, r: 1, color: 'green' },
      { c: 2, r: 1, color: 'red' },
      { c: 3, r: 1, color: 'yellow' },
    ],
    queue: [
      'red','yellow','red','yellow','red','yellow',
      'blue','green','blue','green','blue','green',
      'red','blue','red','blue','red','blue',
      'green','yellow','green','yellow','green','yellow',
    ],
  },
];
