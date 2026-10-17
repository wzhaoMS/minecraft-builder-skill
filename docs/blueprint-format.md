# Blueprint formats

`mcb` accepts four kinds of input everywhere a `<blueprint>` is expected (`info`, `validate`,
`preview`, `build`, `export`):

| Input | Best for | Example |
|---|---|---|
| `gen:<name>` | Parametric structures (house, tower, castle, tree, text, pixel art, city…) | `mcb preview gen:castle -p width=41` |
| `*.json` | Hand-designed builds: ASCII layers, fills, single blocks, composition | [`examples/blueprints/cottage.json`](../examples/blueprints/cottage.json) |
| `*.js` / `*.mjs` | Anything procedural — loops, math, randomness, reusing generators | [`examples/blueprints/watchtower.mjs`](../examples/blueprints/watchtower.mjs) |
| `*.schem` `*.schematic` `*.nbt` `*.litematic` | Builds downloaded from the internet / made in WorldEdit, Litematica or structure blocks | `mcb build castle.schem --at 0,64,0` |

## Coordinates and orientation

```
            north (-Z)
               ▲
 west (-X) ◄───┼───► east (+X)        +Y is up
               ▼
            south (+Z)
```

* Blueprint coordinates are **relative**. `y = 0` is the first layer **above the ground**
  (negative `y` digs below the ground — basements, foundations).
* The **front** of a blueprint (door, facade, readable text) faces **south (+Z)**.
  `mcb build --facing east` rotates the whole build — block states included (stairs, doors, logs,
  signs…) — so the front faces east.
* With `--at x,y,z` the north-west corner of the footprint lands on `x,z` and blueprint `y=0` lands
  on `y` (use the Y of the block the player stands **on** + 1, i.e. the player's feet Y).
* With `--near <player>` the build is placed a few blocks in front of the player, centred on their
  line of sight, with its front facing them.

## Block states

Any Minecraft block-state string works: `stone`, `minecraft:oak_stairs[facing=north,half=top]`,
`chest[facing=south]{Items:[{Slot:0b,id:"minecraft:apple",count:3}]}`.

* The `minecraft:` prefix is optional; property order doesn't matter.
* `air` is a real block — it **clears** what's in the world. Unset cells (`null`, `.`) leave the
  world untouched.
* `mcb validate` checks every block and property against Minecraft's data and suggests fixes for
  typos (`oak_plank` → `oak_planks`, `redstone` → `redstone_wire`).
* Things `mcb` fixes for you automatically:
  * doors / tall flowers get both halves (`oak_door[facing=south]` → lower + upper), beds get their
    head (placed in the `facing` direction);
  * leaves are placed with `persistent=true` so they don't decay;
  * support-dependent blocks (torches, doors, plants, rails, carpets, signs…) are placed after all
    solid blocks, and water/lava last.

### Stairs, slabs and other orientable blocks — cheat sheet

| Block | Property | Meaning |
|---|---|---|
| stairs | `facing=north` | the tall back side is on the **north**; you walk **up** toward the north |
| stairs | `half=top` | upside-down (eaves, arches, overhangs) |
| roof slope rising toward the north (south side of a gable roof) | | `facing=north` |
| slabs | `type=bottom` / `top` / `double` | lower half / upper half / full |
| logs, pillars, basalt, chains | `axis=x\|y\|z` | direction the log runs |
| doors | `facing` | direction you face when walking **in**; `hinge=left\|right` |
| wall torch / ladder / wall sign | `facing=south` | points south, i.e. attached to the block on its **north** |
| standing sign / banner / head | `rotation=0..15` | 0 = facing south, 4 = west, 8 = north, 12 = east |
| bed | `facing=north` | head is north of the foot |

## JSON blueprints

All sections are optional and are applied **in this order** (later ones overwrite earlier ones):
`generator` → `parts` → `fills` → `layers` → `blocks`.

```jsonc
{
  "name": "gatehouse",
  "description": "optional, shown by mcb info",

  // 1. start from a generator
  "generator": "tower", "params": { "radius": 4, "height": 14 },

  // 2. compose other blueprints / generators. "at" is where the part's north-west corner (its
  //    smallest x and z) lands AFTER it is turned — its own y offsets are kept, so a part with a
  //    foundation at y = -1 still sinks one block; "facing" turns its front (built facing south)
  //    toward north/east/south/west; "rotate" is the same in clockwise degrees seen from above
  //    (90 = west, 180 = north, 270 = east); "mirror": "x"|"z". Block states turn with the part.
  "parts": [
    { "generator": "tree", "params": { "type": "oak", "seed": 3 }, "at": [12, 0, 3] },
    { "generator": "house", "params": { "style": "medieval" }, "at": [0, 0, 14], "facing": "east" },
    { "file": "door-frame.json", "at": [3, 0, 8], "rotate": 90 },
    { "layers": [["SS"]], "at": [0, 5, 0] }
  ],

  // characters/keys used by fills, layers and blocks. null = leave the world untouched
  "palette": { "#": "stone_bricks", "G": "glass_pane", "_": "air", ".": null },

  // 3. boxes: mode = replace (default) | hollow (shell + air inside) | outline (shell only)
  //           | walls (4 sides, no floor/ceiling) | keep (only fill unset/air cells)
  "fills": [ { "from": [0, 0, 0], "to": [8, 5, 8], "block": "#", "mode": "hollow" } ],

  // 4. ASCII layers, bottom → top. Each layer is a list of rows from NORTH (z=0) to SOUTH,
  //    each row's characters go WEST → EAST (x=0…). ' ' and '.' are empty unless in the palette.
  "layerOrigin": [0, 0, 0],
  "layers": [
    ["#####",
     "#___#",
     "##_##"],
    ["#G#G#",
     "#___#",
     "#####"]
  ],

  // 5. single blocks: objects or [x, y, z, block-or-palette-key]
  "blocks": [ { "x": 2, "y": 1, "z": 2, "b": "lantern" }, [2, 0, 2, "#"] ]
}
```

Tips for agents drawing layers:

* Draw a **map**: north is the top row, east is the right end of a row.
* Keep every row of a layer the same length (pad with `.`), and every layer the same number of rows.
* Use `_` → `air` for interiors so the build also clears grass/terrain inside rooms.
* Put door lower halves in the layers and let `mcb` add the upper half.

The original (v1) format still works: `{ "blocks": [{ "x", "y", "z", "name" | "b" }], "palette": {...} }`
and `{ "generator": "sphere", "params": {...} }`.

## JS / MJS blueprints

A module whose default export is either a build function or an object with metadata:

```js
// examples/blueprints/watchtower.mjs
export default {
  name: 'watchtower',
  description: 'Stone watchtower with a lookout deck',
  params: {
    height: { type: 'int', default: 12, min: 6, max: 60, description: 'tower height' },
    wood: { type: 'block', default: 'spruce_planks' },
  },
  build(s, p, ctx) {
    // s: Structure — the blueprint being built (relative coords, front = south)
    // p: params with defaults applied (CLI: -p height=20)
    // ctx: { rng (seeded), gen(name, params) → Structure, Structure }
    s.fill(0, 0, 0, 4, p.height, 4, 'stone_bricks', { mode: 'hollow' });
    s.fill(-1, p.height + 1, -1, 5, p.height + 1, 5, p.wood);
    s.place(ctx.gen('tree', { type: 'birch' }), 8, 0, 2);
  },
};
```

or simply `export default function build(s, params, ctx) { … }`.

Generated parts come with extras (eaves, porches, foundations below y = 0): get their exact size
with `mcb info gen:<name> -p …` or `ctx.gen(...).bounds()` before laying several out side by side.

### Structure API

| Method | Notes |
|---|---|
| `s.set(x, y, z, block)` / `s.get(x, y, z)` | `block = null` unsets |
| `s.fill(x1, y1, z1, x2, y2, z2, block, { mode })` | modes as in JSON `fills` |
| `s.walls(…)`, `s.floor(x1, z1, x2, z2, y, block)`, `s.clear(…)` | clear = explicit air |
| `s.line(x1, y1, z1, x2, y2, z2, block)` | 3-D line |
| `s.sphere(cx, cy, cz, r, block, { hollow, thickness, half: 'top'\|'bottom', ry, rz })` | ellipsoids via ry/rz |
| `s.cylinder(cx, y, cz, r, height, block, { hollow, thickness, rz, taper })` | vertical; `taper` < 0 narrows upward |
| `s.place(other, x, y, z, { facing, rotate, mirror, skipAir, keep })` | compose like JSON `parts`: north-west corner at x,y,z after turning |
| `s.paste(other, dx, dy, dz, { rotate, mirror, skipAir, keep })` | low-level: offsets every block; rotation is around (0,0,0), so a turned part can move into negative x/z |
| `s.replace(from, to)`, `s.mapBlocks(fn)` | material swaps, e.g. `b => b.replace('oak_', 'spruce_')` |
| `s.transformed({ rotate: 90, mirror: 'x' })`, `s.translated(dx, dy, dz)`, `s.normalized()` | return new structures |
| `s.bounds()`, `s.count`, `s.blockCounts()`, `s.forEach((x, y, z, block) => …)` | inspection |

Helpers for good-looking builds live in `src/generators/helpers.js` (`materialFamily`, `door`,
`bed`, `stairs`, `slab`, `gableRoof`, `hipRoof`, …) and are importable from a blueprint module:

```js
import { gableRoof, door } from '../../src/generators/helpers.js';
```

## Structure files

* **Sponge `.schem`** (WorldEdit / FAWE, v1–v3) — read and write.
* **Vanilla structure `.nbt`** (structure blocks, `/place template`) — read and write.
* **Litematica `.litematic`** — read and write (all regions merged on read).
* **MCEdit `.schematic`** (pre-1.13) — read. Blocks renamed since the file's version
  (`grass` → `short_grass`, `chain` → `iron_chain`, …) are upgraded on import.

Air: `.schem` / `.litematic` / `.schematic` have no "leave untouched" marker, so their air is
dropped on import (like `//paste -a`) and pasting never carves holes into terrain — use
`mcb build --clear` to empty the area first. `.nbt` files mark untouched cells with
`structure_void`, so their air is deliberate and is kept (exactly what the game's structure blocks do).

## Exports

```bash
mcb export my.json -o my.schem                   # WorldEdit / FAWE: //schem load my
mcb export my.json -o my.nbt                     # structure block / /place template
mcb export my.json -o my.litematic               # Litematica
mcb export my.json -o my.mcfunction --at 0,64,0  # one function file (small builds)
mcb export my.json --datapack ./out --name tower # single-player: no bot or server needed
mcb export my.json -o my.png                     # preview image
```

The data pack builds in steps across ticks (so huge builds don't hit the command-chain limit),
force-loads only the chunks it needs (and only removes forceloads it added), and can be stopped
with `/function mcb:<name>/cancel`. Copy the generated folder into `saves/<World>/datapacks/`,
open the world **with cheats on** (or Open to LAN → Allow Cheats), `/reload` (check with
`/datapack list`), stand where the north-west bottom corner should go, and run
`/function mcb:<name>` (or export with `--at x,y,z` for fixed coordinates). There is no undo in
single player — back the world up first. Works with Minecraft 1.21 – 1.21.11 (1.21.5 – 1.21.11
with `--strict`).

Using a `.schem` in game: put it in `.minecraft/config/worldedit/schematics/` (single-player
WorldEdit) or `plugins/WorldEdit/schematics/` (server), `//schem load <name>`, stand where the
north-west bottom corner should go (the file's paste offset is 0,0,0, so it extends east, south
and up from your feet) and `//paste`. Cells the blueprint leaves untouched are saved as air, so a
plain `//paste` also clears them; `//paste -a` keeps what is already there. `//undo` reverts it.
