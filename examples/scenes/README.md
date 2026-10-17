# Example scenes

Two bigger builds that started life as hand-driven bot scripts, ported to the blueprint system as JS modules
(see [JS / MJS blueprints](../../docs/blueprint-format.md#js--mjs-blueprints)). The original code is kept as intact as
possible, so what you get is what the author built.

| Scene | What it is | Size (W×H×D) | Voxels | Commands | Build time¹ |
|---|---|---|---|---|---|
| [`gt-campus.mjs`](gt-campus.mjs) | Georgia Tech campus: roads, Tech Green, Tech Tower with its gold dome, Bobby Dodd Stadium, CULC, Crosland Tower, dorms, crosswalks, trees, parking lots, fountain, Buzz statue, shops, subway entrances | 401×61×401 | 445,253 (224,197 blocks + 221,056 air) | 9,479 | ~1 min |
| `gt-campus.mjs -p city=true` | … plus the Atlanta around it: city blocks, elevated highway ring, canal, hotel, church, hospital, MARTA, … | 727×73×727 | 1,835,037 (1,604,079 blocks + 230,958 air) | 225,152 | ~25 min |
| [`tech-tower-letters.mjs`](tech-tower-letters.mjs) | Brick tower with gold **TECH** letters on its south face | 20×19×10 | 2,541 (1,677 blocks + 864 air) | 33 | ~1 s |
| `tech-tower-letters.mjs -p allSides=true` | … TECH on all four faces, each readable from outside | 20×24×20 | 6,046 (3,742 blocks + 2,304 air) | 77 | ~1 s |

¹ estimate printed by `mcb info` (150 commands per second). Everything is measured with `mcb info`; `air` voxels are
explicit air that clears the world (the landmark rebuild of the campus carves out the old placeholder buildings, as the
original did).

Most common blocks — campus: grass_block 139,556 · gray_concrete 19,577 · white_concrete 7,377 · smooth_stone_slab 5,313 ·
bricks 5,161 · yellow_concrete 3,757 · birch_leaves 3,659 · smooth_stone 3,359 · polished_deepslate 2,702 (79 types);
tower: bricks 714 · stone_bricks 600 · dark_oak_planks 322 · gold_block 35 · glass 6 (the letters come from the `text`
generator's 3×5 font; the built-in bitmap fallback has 39 gold blocks, 2,545 voxels).

## Preview

```bash
mcb info examples/scenes/gt-campus.mjs                       # size, block counts, build plan, lint
mcb info examples/scenes/gt-campus.mjs -p city=true          # parameters: -p key=value (repeatable)
mcb preview examples/scenes/gt-campus.mjs -o gt.png          # iso view + top view + elevations
mcb preview examples/scenes/tech-tower-letters.mjs --view south -o tech.png
mcb preview examples/scenes/tech-tower-letters.mjs -p allSides=true --view iso -o tech-all.png
```

## Build

```bash
mcb build examples/scenes/gt-campus.mjs --at x,y,z --clear --dry-run   # count the commands first
mcb build examples/scenes/gt-campus.mjs --at x,y,z --clear
mcb build examples/scenes/tech-tower-letters.mjs --at x,y,z --facing east
```

* `--at x,y,z` puts the north-west corner of the footprint on `x,z`; `y` is the player's feet Y (the ground surface is
  `y - 1`). With `-p city=true` add `--anchor origin` to put the *campus* corner on `x,z` — the city then reaches 160
  blocks north and west of it (and 166 south and east).
* `--clear` clears the scene's whole bounding box (+2 blocks) before building. That is the normal way to prepare the site,
  but it also removes the terrain *below* the ground surface, down to the lowest block of the scene (the subway platforms,
  6 blocks under `y`). `-p flatten=true` is the alternative that only clears the 60 layers above the ground (the original
  "flatten") and leaves the terrain below alone.
* The scene reaches down to `y - 6`. On a default superflat world the floor is at y = −64, so the lowest layers do not fit:
  `mcb build` stops with "outside the overworld height limits" — pass `--force` (builds the part that fits) or build on a
  raised pad.
* `--facing` turns the whole build, TECH letters included; they stay readable from the front.

## Parameters

`gt-campus.mjs`

| Param | Default | |
|---|---|---|
| `city` | `false` | also build the Atlanta around the campus (727×727 blocks); everything outside the campus square only exists with this |
| `details` | `true` | detail pass (`build-details.js`): crosswalks, traffic lights, street trees, parking lots with cars, fountain, flower beds, bus stops, Buzz statue, … |
| `realism` | `true` | realism pass (`build-realism2.js`): shops with awnings, subway entrances, outdoor dining, manholes, mailboxes, … (canal, alleys, hotel, church, hospital, MARTA with `city`) |
| `flatten` | `false` | clear 401×60×401 to air inside the blueprint (the original "flatten"); normally use `mcb build --clear` |

`seed` has no effect: every pass keeps the fixed-seed generator of the original script.

`tech-tower-letters.mjs`

| Param | Default | |
|---|---|---|
| `allSides` | `false` | TECH on all four faces (a square tower, so the letters also fit on the short faces) |

## How the port works

`gt-campus.mjs` is the four scripts in the order the author ran them, each pass one function: **campus**
(`build-gt-city.js` phase 1) → **city** (its phase 2) → **landmarks** (`build-gt-rebuild.js`: Tech Tower, Crosland, CULC,
Bobby Dodd, College of Computing) → **details** (`build-details.js`) → **realism** (`build-realism2.js`). The statements are
the original ones; `fill`, `sb` and `blockAt` are small shims over the Structure, and the bot, `await`s, chat, logs and
`/tp` lines are gone.

* Coordinates are relative: the campus' north-west corner is (0, 0) and the ground surface is y = −1, so buildings start at y = 0.
* The details and realism passes look at the city (parking lots, billboards, rooftops, alleys, …). With `city: false` the
  whole pipeline therefore still runs and only the campus square is kept, so the campus is identical with and without the
  city (and nothing floats around it).
* Fixed for Minecraft 1.21.11: `chain` → `iron_chain`, lanterns under a ceiling are `hanging=true`, the MARTA rails sit on the
  deck, the park's sand and gravel get a floor, and the fire hydrants keep the spots the author had (`+ 359` in the `x % 45` test).
* `tech-tower-letters.mjs`: the capture script's tower (18×8, 14 tall) with TECH made by the `text` generator when the repo has
  one (compact 3×5 font) and by the capture script's own 5-row bitmap otherwise. The other faces turn the south-facing letters
  with `Structure.transformed({ rotate })` — no more hand-mirrored text. The window strips are three blocks tall (the script's
  loop only ever produced two single glass blocks).

Not ported, because they only make sense with a live bot: `/gamemode`, `/time set noon`, `/gamerule`, `/op` and `/tp` calls,
the chunked `/fill` and its delays, the bot that flies around placing gold blocks one by one (`fly-tech-placer.js`), and the
camera bot / prismarine-viewer / puppeteer frame capture and its pre-clear and foundation of `capture-tech-tower-demo.js`.
The world reads of `bot.blockAt` see the scene being built instead of the live world.

## Tests

```bash
node --test test/scenes.test.js
```

## Credits

Ported from the original scripts of this repository: `build-gt-city.js`, `build-gt-rebuild.js`, `build-details.js` and
`build-realism2.js` (the Georgia Tech campus and Atlanta city) and `fly-tech-placer.js` and `capture-tech-tower-demo.js`
(the TECH tower). The layout, coordinates and architecture are the original author's work.
