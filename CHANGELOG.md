# Changelog

## 2.0.0 — mcb

A rewrite of the skill around one CLI, `mcb`, that covers the whole design → preview → plan →
build → verify → undo loop. Tested end-to-end against Paper 1.21.11 (locally and in CI).

### Added
- `mcb` CLI with `--json` everywhere, stable error codes and `hint:` lines: `doctor`, `server
  setup|start|stop|status|logs|op`, `generators`, `info`, `validate`, `preview`, `plan`, `build`,
  `watch`, `undo`, `snapshot`, `export`, `where`, `cmd`, `mcp`.
- Blueprint formats: JSON v2 (palette, ASCII layers, fills, blocks, parts, generator), JS/MJS
  modules with a Structure DSL, `.schem` (Sponge v1–3), `.nbt`, `.litematic`, MCEdit `.schematic`.
- 24 parametric generators (house, castle, tower, skyscraper, city, tree, road, bridge, fountain,
  lighthouse, windmill, text, pixel art, primitives…) with reusable building helpers.
- PNG previews (isometric + plan + elevations, compass, coordinates) with block colours averaged
  from the real 1.21.11 textures.
- Greedy `/fill` compiler, support-aware placement order, block-state rotation/mirroring,
  automatic door/bed halves, persistent leaves.
- Transports: mineflayer bot (acknowledged batches, rate/volume caps, auto-reconnect), RCON
  (forceload management), dry run.
- Safety: validation before any change, complete undo snapshot or no build, refusal to overwrite
  containers/signs without `--force` (also with `--no-undo`, for identical containers a `/fill`
  would rewrite, and for areas too large to scan — `SCAN_TOO_LARGE`), conflict-aware undo that
  skips unreadable blocks and keeps the snapshot until it completes, snapshots tied to their server
  (`SERVER_MISMATCH`, `--any-server`), quiet builds with a crash-safe, per-server gamerule journal
  that always names the world it changes, `plan` impact reports, per-dimension height checks.
- Verification that reads every block back (unreadable ≠ OK) and repairs once.
- Single-player data pack export (stepped, marker-anchored, self-cleaning forceloads, cancel).
- MCP server (`mcb mcp`) with inline-image previews, serialized world-changing tools and strict
  JSON-RPC envelope checks.
- Cross-platform local Paper server management (PaperMC Fill API with checksums, optional
  Temurin JRE install, flat world, RCON, correct offline-UUID ops; refuses a busy port, and only
  ever stops the process it launched — identified by a per-launch token on its command line).
- `house style=classic|medieval|rustic|modern` palettes; `facing` for JSON `parts` and
  `Structure.place()` (north-west corner after turning); block renames across versions
  (`chain` ↔ `iron_chain`, `grass` → `short_grass`) translated automatically.
- Placement around a player: `--near <player> --side west --gap 40`; `preview --facing`,
  `preview --cut <y>`; per-command help (`mcb build --help`).
- Build options (`--at`, `--gap`, `--side`, `--facing`, `--mirror`, `--rotate`, `--mode`,
  `--dimension`, `--bps`, `--clear`) are checked before connecting (exit 2); a `--dimension` that
  differs from the `--near` player's world is reported; bare generator names are case-insensitive
  and unknown names suggest the closest generators (`cottage` → `house`).
- `watch` sessions: one undo id, resumable after a restart, survive the bot being kicked, NDJSON
  events with `--json` (rebuild events carry warnings such as the RCON fallback).
- `mcb.config.json` also accepts `"rcon": { "port", "password" }` and kebab/snake-case keys;
  unknown keys are reported (with a did-you-mean) by every command and by `doctor`, instead of
  being silently ignored.
- The bot reads player positions and gamerules through `/tellraw`, so servers with
  `send_command_feedback=false` work.
- Snapshots and undo keep sign text, banner patterns and player heads (what the server shares with
  clients), so signs can be built over and restored; a rebuild with new sign text updates it.
- Unit tests (274, incl. an in-memory server for safety regressions), end-to-end tests against a
  real server (14, incl. a Nether build/undo and a bot that logs in inside another world), GitHub
  Actions CI on Windows/macOS/Linux × Node 22/24 plus an e2e job.

### Changed
- SKILL.md rewritten as an agent-first workflow guide; README, troubleshooting, blueprint format,
  building guide, generators and MCP docs added.
- The v1 scripts were replaced: the Georgia Tech campus/city scripts are now
  `examples/scenes/gt-campus.mjs`, the TECH tower is `examples/scenes/tech-tower-letters.mjs`,
  `build-city.js` is `gen:city`, `gen-skyscrapers.py` is `gen:skyscraper`.

### Fixed (from v1)
- `setup.sh` downloaded Paper from the retired PaperMC v2 API (HTTP 410).
- Bot hard-coded `version: '1.21.11'` against a 1.21.1 server; now auto-detected.
- Hard-coded player `alphasuperduper`, `/tmp` and `/home/wei` paths.
- Wrong offline UUID in the generated `ops.json` (the bot was never op'd by it).
- Gamerules silently failing on 1.21.11 (renamed to snake_case); `chain` → `iron_chain`.
- Leaves decaying, mirrored text on north/east faces, unsupported lanterns/torches.
