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
  containers/signs without `--force`, conflict-aware undo, quiet builds with crash-safe gamerule
  restore, `plan` impact reports, per-dimension height checks.
- Verification that reads every block back (unreadable ≠ OK) and repairs once.
- Single-player data pack export (stepped, marker-anchored, self-cleaning forceloads, cancel).
- MCP server (`mcb mcp`) with inline-image previews.
- Cross-platform local Paper server management (PaperMC Fill API with checksums, optional
  Temurin JRE install, flat world, RCON, correct offline-UUID ops).
- Unit tests (233), end-to-end tests against a real server (11), GitHub Actions CI on
  Windows/macOS/Linux × Node 22/24 plus an e2e job.

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
