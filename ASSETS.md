# Cargo Jam — Obstacle Art Direction

## Visual target

`obstacle_visual_target.png` defines the target direction: strict bird's-eye view, premium casual diorama, dark navy asphalt, warm gold edge highlights, crisp silhouettes, readable footprints, and route cues that communicate where a truck can or cannot pass.

## Obstacle gameplay language

| Kind | Visual identity | Gameplay role |
|---|---|---|
| `building` | Raised warehouse slab with roof, doors, shadow, and hazard trim | Hard blocker; creates lane walls and blind corners. |
| `water` | Recessed blue basin with animated wave bands | Hard blocker; breaks direct routes and forces alternate exits. |
| `bridge` | Water basin with a solid crossing deck | Directional benefit: passable along the bridge's long axis and visually marked as a shortcut. |
| `containers` | Stacked colored freight containers | Directional corridor: passable along the long axis, blocked from the sides; slows movement slightly as a tight passage. |
| `trees` / `boulders` | Raised natural island with layered foliage or rocks | Hard blocker; improves visual variation and creates cover-like dead zones without hiding the requested truck completely. |

## Acceptance criteria

The obstacle footprint must remain legible at small mobile canvas sizes. A player should distinguish a hard blocker from a directional corridor without reading text. A bridge should be visibly useful but not universally optimal; containers should trade access for slower movement. The level generator must continue to avoid spawning trucks inside obstacle cells and all JavaScript must pass syntax checks.
