# CLAUDE.md — Cargo Jam (زحمة الشحن)

Context for any Claude Code session working on this repo (local, cloud, or mobile).

## What this is

A browser puzzle game, **no build step, no dependencies, no backend**. Plain HTML + CSS + Canvas/JS.
UI language is **Arabic (RTL)** — keep all player-facing strings in Arabic.

Live: https://abdullahhinaidi.github.io/cargo-jam/ · Owner plays it with his kids.

## Files

| File | Role |
|---|---|
| `index.html` | All screens as DOM sections (`#menu`, `#levels`, `#settings`, `#game`) + overlays (pause/result/start) |
| `style.css` | Menus, responsive layout, phone/tablet/laptop breakpoints |
| `levels.js` | Generates the **30 levels** (difficulty curve, material introduction, big-rig ratio) |
| `game.js` | Engine, screen manager, save system, dock/truck rendering, audio |
| `car-version/`, `bus-version/` | Earlier prototypes of the idea. Do not modify; kept as history. |

## Core game loop

Trucks sit jammed in a depot. Each carries a material (`wood, oil, food, steel, goods, water`).
Order cards at the top demand a material + qty, each with a **patience timer**.

1. A depot truck can pull out only if its straight path **in its facing direction** to the depot edge is clear → this is the jam. Facings are mixed (up/down/left/right) — that variety *is* the difficulty; don't make them all face one way.
2. Tapping a reachable truck routes it along a **ring road** around the yard into a free **dock bay**.
3. In the bay it loads **one unit at a time** whenever an order matches its material; when `loadLeft` hits 0 it drives off-screen.
4. Big rigs (`size: 2`) occupy 2 cells and carry 2 units — they block more and wait longer to fill.
5. An expired order costs a heart. 0 hearts = lose. All trucks delivered = win.
6. Stars = lives remaining (3 = none lost, 2 = lost one, else 1).

## Invariants — do not break these

- **`fixDeadlock()` guarantees solvability.** It ensures there is always either a reachable truck that can enter a bay, or a docked truck whose material is demanded. It is called after staging, loading, and order respawn. If you touch demand/bay logic, keep this contract or levels become unwinnable.
- **Demand is generated from remaining supply** (`availableSupply`), so orders are always fulfillable. Never demand more of a material than exists.
- The player loses **only** via order expiry — never via an unsolvable board.

## Verifying changes (do this before shipping)

There are no unit tests. Verify in a browser and **prove all 30 levels still solve**. Serve locally:

```bash
python -m http.server 8777    # then open http://localhost:8777
```

Then in the devtools console, run a headless play-through of every level: load each level, repeatedly
`fixDeadlock()` → force-load any docked truck whose material is demanded → move a reachable truck into a free
bay; assert every level ends with `trucks.every(t => t.done)` and zero stuck states. Any level that fails to
clear is a regression in the demand/bay/jam logic.

## Gotchas that have bitten before

- **A throw inside the render loop used to kill the game permanently.** `rafLoop()` wraps `render()` in try/catch and `draw()` early-returns until a level is loaded — keep both. Canvas `createLinearGradient`/`createRadialGradient` **throw on NaN**, which is exactly what happens before layout is initialised.
- **Cache busting:** `index.html` loads assets as `style.css?v=N` / `game.js?v=N`. **Bump `N` when shipping changes**, or browsers (especially the kids' phones) serve stale files.
- Layout is computed in `resize()`; everything derives from `CELL`. Phones use a slimmer ring road (`laneAllow`) and compact chrome via CSS breakpoints.
- Progress lives in `localStorage` under `cargojam_v1` (`{unlocked, stars, coins, sfx, music}`).

## Design principle the owner cares about

A puzzle is only hard if **wrong moves are possible**. An earlier version where tapping any free vehicle
always helped was greedy-trivial and boring. Depth here comes from *limited* bays + shifting demand +
the multi-directional jam. Cosmetic layers (colours, gates) do not add difficulty — don't mistake them for it.

## Deploying

GitHub Pages serves `main` at the repo root. **Push to `main` and it redeploys in ~1 minute.**

```bash
git add -A && git commit -m "..." && git push
```
