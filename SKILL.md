---
name: minecraft-builder
description: Design, preview, build, verify and undo structures in Minecraft Java Edition — houses, castles, towers, skyscrapers, whole cities, trees, bridges, pixel art from images, block-letter text, and imported schematics — through the `mcb` CLI (mineflayer bot or RCON). Use whenever the user wants something built, generated, copied or placed in Minecraft, wants a local Paper build server set up, wants schematics (.schem/.nbt/.litematic) converted/imported/exported, or wants a datapack that builds a structure in a single-player world.
---

# Minecraft Builder (`mcb`)

`mcb` turns a blueprint into blocks in a running Minecraft world — fast (greedy `/fill` merging),
safely (undo snapshots, verified results, no chat spam) and repeatably (same input → same build).
You design; `mcb` handles coordinates, block-state rotation, placement order, rate limits, chunk
loading and server quirks.

Run everything from the repo root: `node bin/mcb.js <command>` (or `npx mcb <command>` after
`npm install`). Every command accepts `--json` for machine-readable output; errors always come
with a `hint:` line telling you what to do.

## 1. Get connected (once)

```bash
npm install                       # Node.js ≥ 22
node bin/mcb.js doctor            # tells you exactly what is missing and how to fix it
```

Pick the situation that matches the user:

| Situation | Do this |
|---|---|
| No server yet (most common) | `node bin/mcb.js server setup --accept-eula --op <TheirMinecraftName>` then `node bin/mcb.js server start`. Tell the user to join **Multiplayer → `localhost`** with Minecraft Java **1.21.11** (or the version printed). Only pass `--accept-eula` after telling the user they are agreeing to the [Minecraft EULA](https://aka.ms/MinecraftEULA). Add `--install-java` if `doctor` says Java 21 is missing. |
| They already run a server | Need its host/port, and either RCON (`--rcon-password`, fastest) or an op'd bot account: in the server console `op BuilderBot` (offline-mode servers) — online-mode servers need `--auth microsoft` with a real account. Save settings in `mcb.config.json` (see below). |
| Single-player world only, no server | `node bin/mcb.js export <blueprint> --datapack "<.minecraft>/saves/<World>/datapacks" --name <name>`, then in game `/reload` and `/function mcb:<name>` while standing where the build's north-west corner should go. |

`server setup` writes `mcb.config.json` (host, port, RCON password, server dir) so later commands
need no flags. You can also create it by hand:

```json
{ "host": "127.0.0.1", "port": 25565, "username": "BuilderBot", "transport": "auto",
  "rconPort": 25575, "rconPassword": "…", "player": "Steve" }
```

`transport`: `bot` (default; can read blocks → verify/undo/snapshot, visible "BuilderBot" player),
`rcon` (server console; fastest, no op needed, no verify), `auto` (bot, falls back to RCON).

## 2. The build loop

1. **Where?** `node bin/mcb.js where <player>` → position + facing. Or ask the user for coordinates
   (F3 screen). If `"player"` is set in the config, `--near` defaults to them.
2. **Design** — pick the cheapest approach that gets a good result:
   * a generator: `node bin/mcb.js generators` (list), `node bin/mcb.js generators house` (params);
   * a JSON blueprint with ASCII layers / fills (hand-designed builds);
   * a JS module (procedural/math/composition) — see [docs/blueprint-format.md](docs/blueprint-format.md);
   * an existing `.schem` / `.nbt` / `.litematic` file.
3. **Check** — `node bin/mcb.js validate x.json` (block typos with suggestions, unsupported torches,
   floating sand…) then `node bin/mcb.js preview x.json -o x.png` and **look at the PNG** (iso view
   from the south-east, top view with north up, south (front) and east elevations). Fix and repeat
   until it looks right. `node bin/mcb.js info x.json` shows size, block counts and command estimate.
4. **Plan, then build** — `node bin/mcb.js plan x.json --near <player>` is read-only: where it will
   land, how many existing blocks it replaces (by type), whether it would destroy chests/signs.
   Then `node bin/mcb.js build x.json --near <player> --verify` (or `--at x,y,z --facing south`).
   Add `--clear` to empty the area first (trees, terrain), `--ground grass_block` for a foundation
   layer, `--mode hand` to watch the bot place blocks one by one, `--dry-run` to print the commands.
5. **Report** to the user: where it is, its size, verify result. If they don't like it:
   `node bin/mcb.js undo` restores what the build changed (blocks someone edited since are left
   alone and listed; `--force` restores those too).

Build reports (`--json`, schema `mcb.build-report/1`) include `ok`, `status`
(`complete`/`partial`), `box` (world bounds), `facing`, `impact` (replaced blocks), `plan.commands`,
`errors[]` (with hints), `verify.{matched,mismatches,repaired,remaining,unreadable}` and `undo.id`.
Re-running a build is safe and cheap: blocks that are already correct are skipped.

Safety rails you can rely on (and should not bypass casually): nothing changes until the blueprint
is valid and the undo snapshot is complete; builds refuse to overwrite chests, barrels, signs and
other blocks whose contents undo can't restore (`CONTAINERS_AT_RISK` → move the build or `--force`);
an interrupted build can simply be re-run.

## 3. Coordinates and orientation — get these right

* +X = east, +Z = south, +Y = up. Overworld height −64…319; default superflat ground surface is y = −61
  (players stand at y = −60).
* Blueprint `y = 0` is the first layer **above** the ground; negative y goes underground.
* A blueprint's **front faces south (+Z)**: put doors, facades and text on the south side.
  `--facing north|east|south|west` rotates the build (block states too). `--near <player>` places
  it in front of them, front facing them.
* ASCII layers are drawn like a map: first row = north, characters left→right = west→east,
  first layer = bottom.
* Stairs `facing=X` = you walk **up** toward X (the tall side is at X). On a gable roof whose ridge
  runs east–west, the south slope uses `facing=north`, the north slope `facing=south`; eaves use
  `half=top`.
* Wall torches/ladders/wall signs `facing=X` point toward X and hang on the block on the opposite
  side. Standing signs/banners `rotation`: 0 south, 4 west, 8 north, 12 east.
* Text: use the `text` generator (`-p text=HELLO -p facing=south`) — it is readable from the side
  you name, so you never hand-mirror letters.

Handled automatically (don't work around them): door/tall-plant upper halves and bed heads are
added; leaves are made persistent; torches, doors, plants, rails, carpets, signs are placed after
the blocks they hang on, fluids last; `/fill` volume limits; chunk loading; rate limits; the
1.21.11 gamerule renames; the dimension of the `--near` player; op command echo
(`send_command_feedback` is muted during builds and restored, even after a crash).

## 4. Blueprint quick reference

JSON (all sections optional; order applied: generator → parts → fills → layers → blocks):

```json
{
  "name": "shed",
  "palette": { "P": "spruce_planks", "L": "spruce_log", "G": "glass_pane", "_": "air", ".": null,
               "D": "spruce_door[facing=south]", "S": "spruce_slab",
               "n": "spruce_stairs[facing=south]", "s": "spruce_stairs[facing=north]" },
  "fills": [ { "from": [0, 0, 0], "to": [4, 0, 4], "block": "cobblestone" } ],
  "layers": [
    [".....", ".....", ".....", ".....", "....."],
    ["LPPPL", "P___P", "P___P", "P___P", "LPDPL"],
    ["LPGPL", "P___P", "G___G", "P___P", "LP.PL"],
    ["nnnnn", "P___P", "P___P", "P___P", "sssss"],
    [".....", "nnnnn", "P___P", "sssss", "....."],
    [".....", ".....", "SSSSS", ".....", "....."]
  ],
  "parts": [ { "generator": "tree", "params": { "type": "birch" }, "at": [7, 0, 1] } ]
}
```
(`D` is the door's lower half — `mcb` adds the upper half in the `.` above it; `n`/`s` are the
north/south roof slopes, `S` the ridge.)

JS module (loops, math, reuse): `export default { name, params: { h: { type: 'int', default: 10 } }, build(s, p, ctx) { s.fill(…); s.paste(ctx.gen('tree', { type: 'oak' }), 8, 0, 2); } }`.
Structure methods: `set/get/fill(…, {mode: hollow|outline|walls|keep})/walls/floor/clear/line/sphere/cylinder/paste/replace/mapBlocks/transformed`. Helpers in `src/generators/helpers.js`: `materialFamily`, `door`, `bed`, `stairs`, `slab`, `gableRoof`, `hipRoof`, …
Full spec: [docs/blueprint-format.md](docs/blueprint-format.md).

## 5. Generators

| Generator | Good for | Key params (defaults) |
|---|---|---|
| `house` | cottages, homes | `width=8 depth=8 height=5 wall=red_concrete roof=dark_oak_planks roofStyle=gable\|hip\|flat chimney interior` |
| `tower` | castle/watch towers | `radius=4 height=18 shape=round\|square roof=cone\|crenellated\|flat material=stone_bricks` |
| `castle` | keeps, forts | `width=31 depth=31 wallHeight=8 towerRadius=4 towerRoof=cone material accent gate` |
| `skyscraper` | modern towers | `style=glass\|setback\|cylinder width=16 depth=16 height=96 body glass accent spire` |
| `city` | whole districts | `width=160 depth=160 blockSize=22 streetWidth=5 maxHeight=90 parks=0.15 highway` |
| `tree` | landscaping | `type=oak\|birch\|spruce\|jungle\|acacia\|dark_oak\|cherry\|pale_oak\|mangrove\|azalea height=0 (auto)` |
| `road` / `bridge` | infrastructure | road: `length=32 width=7 axis=x\|z lamps=12`; bridge: `length=24 style=arch\|beam\|suspension` |
| `fountain` / `arch` / `wall` | plazas, gates, walls | `radius=4`; `width=9 height=8`; `width=10 height=5 crenellations` |
| `text` | signs, logos, labels | `text=HELLO block=gold_block font=5x7\|3x5 scale=1 facing=south plane=vertical\|flat background` |
| `pixelart` | images → blocks | `image=<png/jpg> width=64 palette=concrete\|wool\|terracotta\|concrete+wool\|full dither plane` |
| `sphere` `dome` `cylinder` `cone` `pyramid` `box` | primitives | `radius`, `height`, `material`, `hollow` |

Generators are deterministic (`-p seed=N` changes the random details), put their footprint's
north-west corner at x = z = 0 and face south. Compose them with JSON `parts` or `ctx.gen(...)`.

`node bin/mcb.js generators <name>` lists every param with type, default and range. Use
`-p key=value` (repeatable) or `--params '{"key":value}'`.

## 6. Making it look good

Read [docs/building-guide.md](docs/building-guide.md) before designing anything big. The short version:

* **Depth beats flat**: inset windows one block, frame them (stairs/slabs/trapdoors), add
  overhangs, pillars, buttresses; never leave a large flat single-material wall.
* **2–4 material palette** with one accent: e.g. medieval = cobblestone base, oak/spruce logs as
  frame, white/stripped planks infill, dark oak stairs roof; modern = white/light-gray concrete,
  black/gray stained glass, smooth quartz trim.
* **Real roofs**: stairs with 1-block eaves (`half=top` underneath), slabs on the ridge; steep
  (1:1) for cottages, low for modern.
* **Light it**: lanterns/torches every ~6 blocks so it's lit at night and mobs don't spawn.
* **Proportion**: storeys are 4 blocks floor-to-floor; doors 1×2; windows 1–2 wide, 2 tall.
* **Context**: path to the door, some trees, a fence or garden; vary heights in cities.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `NOT_OP` / "Unknown or incomplete command" | Server console: `op BuilderBot` (or `node bin/mcb.js server op BuilderBot` with RCON). |
| `ECONNREFUSED` / connect timeout | Server not running or wrong host/port → `node bin/mcb.js doctor`, `server start`. |
| Kicked: whitelist / online-mode | `whitelist add BuilderBot`; online-mode servers need `--auth microsoft` or use RCON. |
| "Unsupported server version" | mineflayer supports up to 26.1. Use `--transport rcon`, or a supported server version. |
| `Unknown block "x"` | Fix the name — the error lists suggestions; `validate` checks the whole blueprint. |
| Build landed in the wrong place/orientation | `undo`, then re-check `--at` (NW corner, feet-level Y) and `--facing`; preview the top view. |
| Some blocks missing after build | Run with `--verify` (auto-repairs); check warnings about unsupported torches/floating sand. |
| `CONTAINERS_AT_RISK` | The area holds chests/signs/etc. Move the build, empty them, or (only if the user agrees) `--force`. |
| `SNAPSHOT_TOO_LARGE` / `SNAPSHOT_INCOMPLETE` | Split the build into parts, retry, or `--no-undo` (then there is no undo). |
| Huge build is slow | Prefer `transport: rcon`; `info` estimates time; split into parts; keep `--mode fill`. |

More: [docs/troubleshooting.md](docs/troubleshooting.md).

## 8. Etiquette with real worlds

* Run `plan` first and tell the user where you are about to build, how big it is and what it
  replaces; avoid building on top of them (`--near` leaves a gap).
* `--clear` deletes everything in the area (except below ground). Builds are undoable, but ask
  before clearing or `--force`-ing in worlds you didn't create.
* Keep the undo id from the report; `node bin/mcb.js undo --list` shows all snapshots. Undo restores
  block states only (not entities, dropped items or container contents).
* JS blueprints are code — only run modules you or the user wrote/trust. For random designs,
  `export` once to `.json` and preview/build that file so both see the same blocks.
