# Building guide — making builds that look good

Rules of thumb collected from experienced Minecraft builders, written for an AI agent designing
blueprints. Preview every iteration (`mcb preview x -o x.png`) and look at it critically.

## Scale

* 1 block ≈ 1 m. A player is ~2 blocks tall; doors are 1×2; ceilings 3–4 blocks.
* Storeys: 4 blocks floor-to-floor (1 floor + 3 air) for houses, 4–5 for offices/towers.
* Real landmarks: use real dimensions in metres, then adjust so key features (windows, columns,
  letters) land on whole blocks. Prefer odd widths so a door or tower can sit exactly centred.

## Depth (the #1 difference between amateur and good builds)

* Never leave a big flat wall of one block. Break it up with:
  * **frames**: logs/pillars at corners and every 3–5 blocks;
  * **insets**: windows and doors set one block back from the wall face;
  * **overhangs**: upper storey 1 block out over the lower one (jettying), eaves under roofs;
  * **trim**: stair/slab ledges at floor lines, upside-down stairs under windows (sills), walls or
    fences as railings;
  * **buttresses / pilasters** on long stone walls.
* Mix a base course (cobblestone / stone bricks, 1–2 high) under a lighter wall material.

## Materials

Pick 2–4 materials + 1 accent and stick to them:

| Style | Base | Walls | Frame / trim | Roof | Accent |
|---|---|---|---|---|---|
| Medieval cottage | cobblestone | white or stripped planks, wattle (birch planks) | oak / dark oak logs | dark oak or spruce stairs | lanterns, flower pots |
| Nordic | stone bricks | spruce planks | stripped spruce logs | dark oak / deepslate tiles | campfire chimney |
| Castle | stone bricks + mossy/cracked mix | stone bricks | polished andesite, cobblestone walls | stone brick stairs, spruce cones on towers | banners, iron bars |
| Desert | sandstone | smooth / cut sandstone | chiseled sandstone, terracotta | flat with sandstone slabs | orange terracotta, cyan glazed terracotta |
| Japanese | stone / andesite | white concrete or birch planks, paper (white wool) panels | dark oak / stripped mangrove logs | dark prismarine or deepslate stairs, curved eaves | cherry leaves, lanterns |
| Modern | light gray concrete | white concrete, smooth quartz | black concrete / iron bars | flat with parapet | gray/black stained glass, sea lanterns |
| Brick city | stone bricks | bricks, terracotta | quartz / white concrete trim | flat, cornice of stairs | awnings in wool, signs |

Texture mixing: randomly sprinkle 10–30 % of a similar block into large surfaces (stone bricks +
cracked + mossy; cobblestone + andesite) — in a JS blueprint, `ctx.rng.chance(0.2)`.

## Roofs

* Gable roof on a W-wide building: stairs rise 1 per row; a 1-block overhang on every side;
  `half=top` stairs under the eaves; slabs or a log on the ridge.
* Facing rule: the slope that rises toward the north uses `facing=north`, etc.
* Steep (1:1) for cottages, shallow (1:2 using slabs) for big halls, flat + parapet for modern.
* Hip roofs for square towers/pavilions; cones (stacked shrinking circles) for round towers.
* Use the helpers: `gableRoof`, `hipRoof`, `flatRoof` in `src/generators/helpers.js`.

## Windows & doors

* Glass panes look better than glass blocks on houses; glass blocks/stained glass on towers.
* Group windows (pairs) and align them vertically between storeys.
* Shutters: trapdoors on both sides; sills: upside-down stairs/slabs below; lintels: stairs above.
* Door on the **south** side (blueprint front); a path and a light either side of it.

## Lighting

* Lanterns/torches every 5–7 blocks inside and around the build (stops mobs spawning).
* Hidden light: glowstone/sea lantern/shroomlight under carpet or behind leaves.
* Hanging lanterns (`lantern[hanging=true]`) need a block above; chains (`iron_chain` since
  1.21.9, `chain` before — `mcb` translates either name for your server) look great with them.

## Landscaping & context

* A build sitting on flat grass looks unfinished: add a path (`dirt_path`, gravel), fences,
  a garden (flowers, leaves bushes with `persistent=true`), 1–3 trees (`tree` generator).
* Vary terrain slightly; put the base course partly into the ground (negative y).

## Cities

From top-rated city builds (Zingopolis, World of Worlds, the "negative space" guide):

1. **Varied heights** — 3-storey shops next to 60-storey towers; tallest near the centre.
2. **Street hierarchy** — main roads 7–9 wide with lane lines, side streets 5, alleys 2–3.
3. **Ground floor detail** — shopfronts with glass, colored wool/banners as awnings, lit interiors.
4. **Alleys** — dumpsters (green terracotta), pipes (iron bars / chains), fire escapes
   (iron bar platforms + ladders).
5. **Street furniture** — benches (stairs), trash cans (cauldrons), hydrants (red concrete + button),
   lamp posts every ~12 blocks, crosswalks (white concrete stripes), trees in sidewalk planters.
6. **Parking lots** — black concrete, white line markings, "cars" of colored concrete + glass.
7. **Negative space** — plazas, parks and gaps between buildings matter as much as buildings.
8. **Landmarks** — one or two unique buildings (stadium, church, tower) give a city identity.

The `city` generator does most of this; use it as a base and add landmarks with `parts`.

## Text, logos and pixel art

* `text` generator: 5×7 or 3×5 font, `scale`, `facing` (side it's readable from), `plane: flat`
  for ground text. Put text on a contrasting background block and 1 block proud of the wall.
* `pixelart` generator: images → blocks (concrete/wool/terracotta/full palettes, dithering).
  64–128 blocks wide is a good size; view it from the south (or from above if `plane=flat`).

## Real buildings from photos (feedback loop)

1. Study reference photos: footprint, proportions, materials, distinctive features.
2. Block out the massing with fills (boxes) — preview.
3. Add roof, windows, trims; preview the `south`/`east` elevations and compare with the photos.
4. Build, then `mcb snapshot --from … --to … --render built.png` to see what's actually in the
   world (or take an in-game screenshot) and compare; fix and rebuild (unchanged blocks are skipped).

## Big builds

* `mcb info` first: blocks, commands, estimated time. 100k blocks ≈ a few hundred commands ≈
  seconds; 2M blocks ≈ minutes.
* Split huge projects into parts (separate blueprints) so each preview is readable and each
  build is undoable on its own.
* `--clear` big sites once, then build parts without `--clear`.
