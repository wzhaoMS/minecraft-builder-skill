# Troubleshooting

Start with `node bin/mcb.js doctor` — it checks Node, dependencies, config, Java, the server,
RCON, the bot's connection and its operator status, and prints a fix for each problem.

## Connecting

| Error / symptom | Cause | Fix |
|---|---|---|
| `ECONNREFUSED` / `doctor`: "nothing answering" | Nothing listening on host:port | `doctor` prints the host:port it tried and where they came from (flag / env / config / default). Running your own server elsewhere? Pass `--host/--port` (or put them in `mcb.config.json`) — don't create a second server. Local server: `mcb server start`. |
| `Timed out connecting` | Firewall, wrong port, server still starting | `mcb server status`; wait for "Done" in `mcb server logs`. |
| `Kicked while joining: … whitelist` | Whitelist enabled | Console: `whitelist add BuilderBot`. |
| `Kicked … Failed to verify username` / online-mode | The server authenticates with Mojang | Use `--auth microsoft` (bot needs its own Minecraft account) or `--transport rcon`, or set `online-mode=false` for a private build server. |
| `Unsupported protocol version` | Server newer than mineflayer supports (max 26.1 at the time of writing) | `--transport rcon`, or run a supported version (`mcb server setup --mc-version 1.21.11`). |
| `RCON authentication failed` | Wrong `rcon.password` | Copy it from `server.properties`; `mcb server setup` stores it in `mcb.config.json`. |
| `RCON connection … failed` | RCON disabled | `enable-rcon=true`, `rcon.port`, `rcon.password` in `server.properties`, restart. |

## Building

| Error / symptom | Cause | Fix |
|---|---|---|
| `NOT_OP` / `Unknown or incomplete command` | Bot isn't an operator | Console: `op BuilderBot` (or `mcb server op BuilderBot`). |
| Bot kicked "spam" / "exceeded packet rate" | Commands sent too fast without op, or a custom anti-spam plugin | Op the bot; lower `--max-rate` (default 250 cmd/s, Paper kicks at 500 packets/s). |
| `That position is not loaded` (persisting) | Chunks can't load (world border, extreme coordinates) | Build closer to spawn / inside the border; RCON builds use `/forceload` automatically. |
| `Build spans y=…, outside the world height` | Blueprint too tall or `--at` y too high/low | Lower `--at` y, or pass `--force` to build the part that fits. |
| Torches / flowers / doors missing | Their support block was missing | `mcb validate` warns about unsupported blocks; run with `--verify` to auto-repair. |
| Leaves disappear over time | Non-persistent leaves far from logs | `mcb` places leaves with `persistent=true`; if you used raw `/fill`, add `[persistent=true]`. |
| Sand/gravel/concrete powder fell | No block underneath | Put a block under it, or build with `--strict` (no block updates). |
| Water flooded the build | Water placed before walls / no walls around it | `mcb` places fluids last; make sure pools are enclosed. |
| Fences / panes not connecting | Built with `--strict` (no block updates) | Build without `--strict`, or specify `north=true,…` in the block state. |
| Wrong rotation / mirrored text | Hand-mirrored letters or wrong `--facing` | Use the `text` generator (readable from its `facing` side); preview the `south` view. |
| Everything is 1 block too high/low | `--at` y was the block you stand **on** | Use the feet Y (`mcb where` prints it); blueprint `y=0` = first block above ground. |
| Players see `[BuilderBot: Changed the block…]` spam | That's op command echo (`send_command_feedback`). `mcb` turns it off during builds and restores it (even after a crash, on the next run); pass `--echo` to keep it on. |
| `Bot disconnected: another session logged in as BuilderBot` | Two mcb commands used the same bot account at once (e.g. `snapshot` while `watch` runs). Run them one after another (watch rejoins on its next rebuild), or give the second its own op'd `--username`. |
| `snapshot` stops with `NOT_OP` | Reading far-away areas means flying the bot there with `/tp`, which needs op: use the op'd bot account. |

## Undo / verify / safety

* `mcb undo <id>` restores what that build changed — use the id (or the full `undo:` command,
  which includes `--config`) printed by the build; plain `mcb undo` takes the newest snapshot in
  the current store. Blocks edited after the build are **left alone and listed** (`--force`
  restores them too); blocks that can't be read are skipped and reported, and the snapshot is kept
  until an undo completes, so you can simply run it again.
* Snapshots live in `.mcb/undo/` next to `mcb.config.json` (or the current directory) — a
  different `--config` or working directory means a different store (`mcb undo --list`). A
  snapshot remembers its server: undoing it while connected elsewhere fails with
  `SERVER_MISMATCH` (`--any-server` if it is really the same world). You can also pass the
  snapshot file: `mcb undo .mcb/undo/<id>.json.gz`.
* A re-run that changes nothing saves no snapshot; snapshots only record blocks the build
  actually changed.
* Undo needs the **bot** transport (RCON can't read blocks); RCON builds report
  `undo.available: false`. With RCON, `mcb undo --force` restores without checking for later edits.
* Snapshots store block states plus the block data clients can see (sign text, banner patterns,
  heads) — entities, dropped items and container contents are not saved. That's why builds refuse
  to overwrite chests, barrels, lecterns, shulker boxes… (`CONTAINERS_AT_RISK`) unless you pass
  `--force` — including identical ones a `/fill` would rewrite, and with `--no-undo`. Signs,
  banners and heads can be built over and undone; the exceptions are refused the same way: data
  too long for one restoring command (decorated player heads, many-pattern banners), and any of it
  with `--no-undo`.
* Nothing is changed when the snapshot can't be taken completely (`SNAPSHOT_TOO_LARGE`,
  `SNAPSHOT_INCOMPLETE`); split the build or use `--no-undo` deliberately.
* `--verify` compares every block (ignoring properties the game recomputes, like fence connections
  or leaf distance, and natural decay like grass → dirt) and repairs mismatches with one
  `/setblock` pass. The report separates `matched`, `mismatches`, `remaining` and `unreadable`
  (chunk not available — never counted as OK). It checks against your blueprint; to see what is
  really there, `mcb snapshot --from … --to … --render live.png`. Block data the blueprint asks
  for (sign text, banner patterns, heads) is checked and repaired too; data still different after
  the repair counts in `remaining` (`dataMismatches` says how many of those are data-only, e.g. an
  old sign format this Minecraft version ignores) and data that can't be read counts as unreadable.
* `mcb plan` shows the impact (blocks replaced by type, containers at risk) without changing anything.
* If a build is killed, `send_command_feedback` may stay off until the next `mcb` build or
  `mcb doctor` restores it (both do it automatically from the journal in `.mcb/`).

## Local server

| Symptom | Fix |
|---|---|
| `Paper has no version "x"` | Use a version from the list printed in the error. |
| `Java 21+ not found` | `winget install EclipseAdoptium.Temurin.21.JRE` / `brew install openjdk@21` / `sudo apt install openjdk-21-jre-headless`, or `mcb server setup --install-java`. Minecraft 26.x needs Java 25. |
| `Server exits right away` | `mcb server logs`; usual causes: EULA not accepted, port in use (`--port 25566`), not enough memory (`mcb server start --memory 4G`). |
| `PORT_IN_USE` on `server start` | Another server already answers on that port — build on it (`mcb doctor --port <port>`), stop it, or change `server-port`. |
| Windows PowerShell 5: `ConvertFrom-Json` fails on an exported blueprint | Palette keys that differ only by case (`A`/`a`) are valid JSON but PS 5 rejects them — use `ConvertFrom-Json -AsHashtable` (PS 7) or Node to read it. `Set-Content -Encoding utf8` adds a BOM on PS 5; `mcb` accepts BOM'd files. |
| Old `setup.sh` server (`../mc-server`) | `mcb server setup --dir ../mc-server --accept-eula` upgrades it in place and keeps its port/world. |

Set `MCB_DEBUG=1` to print stack traces.
