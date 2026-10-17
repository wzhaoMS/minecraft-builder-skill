# Troubleshooting

Start with `node bin/mcb.js doctor` — it checks Node, dependencies, config, Java, the server,
RCON, the bot's connection and its operator status, and prints a fix for each problem.

## Connecting

| Error / symptom | Cause | Fix |
|---|---|---|
| `ECONNREFUSED` | Nothing listening on host:port | Start the server (`mcb server start`), check `--host/--port` / `mcb.config.json`. |
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
| Players see `[BuilderBot: Changed the block…]` spam | `log_admin_commands` was on | `mcb` turns it off during builds and restores it; if a build was killed: `mcb cmd "gamerule log_admin_commands true"`. |

## Undo / verify

* `mcb undo` restores the most recent snapshot (`mcb undo --list`, `mcb undo <id>`). Snapshots
  live in `.mcb/undo/` next to `mcb.config.json` (or the current directory).
* Undo needs the **bot** transport (RCON can't read blocks). Builds made over RCON have no snapshot
  unless the bot is used.
* Snapshots store block states only — chest contents and sign text inside the area are not saved.
* `--verify` compares every block (ignoring properties the game recomputes, like fence connections)
  and repairs mismatches with `/setblock`. Remaining mismatches are listed in the report.

## Local server

| Symptom | Fix |
|---|---|
| `Paper has no version "x"` | Use a version from the list printed in the error. |
| `Java 21+ not found` | `winget install EclipseAdoptium.Temurin.21.JRE` / `brew install openjdk@21` / `sudo apt install openjdk-21-jre-headless`, or `mcb server setup --install-java`. Minecraft 26.x needs Java 25. |
| Server exits right away | `mcb server logs`; usual causes: EULA not accepted, port in use (`--port 25566`), not enough memory (`mcb server start --memory 4G`). |
| Old `setup.sh` server (`../mc-server`) | `mcb server setup --dir ../mc-server --accept-eula` upgrades it in place and keeps its port/world. |

Set `MCB_DEBUG=1` to print stack traces.
