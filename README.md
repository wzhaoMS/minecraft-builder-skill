# MC Builder Bot

AI-controlled Minecraft building bot using [mineflayer](https://github.com/PrismarineJS/mineflayer). Connects to a Paper MC server and builds structures via `/fill` commands or human-like block placement.

## Features
- **City generator** — streets, buildings (varied heights), elevated highway, streetlights
- **Campus builder** — Georgia Tech campus with Tech Tower, Bobby Dodd Stadium, CULC, etc.
- **Realism details** — shops, alleyways, parking lots, cars, churches, subway, MARTA station
- **Schematic support** — paste .schem files via FAWE plugin
- **Flying hand-placement** — bot hovers and places blocks one-by-one (visible to players)
- **Blueprint system** — JSON format for defining structures block-by-block

## Quick Start

```bash
# 1. Setup everything (downloads server, plugins, dependencies)
./setup.sh

# 2. Start the Paper MC server
cd ../mc-server && java -Xmx2G -Xms1G -jar paper.jar nogui < /dev/null &

# 3. Wait ~60s, then run a builder
node build-blueprint.js --file blueprints/house.json --clear --near-player
```

Join the server: **Multiplayer → localhost:25566**

## Requirements
- **OS**: Linux (Ubuntu 22.04+), macOS, or Windows (WSL2)
- **Java**: 21+
- **Node.js**: 18+
- **Minecraft Java Edition**: 1.21.1

## Key Scripts

| Script | What it does |
|--------|-------------|
| `setup.sh` | One-command setup: Java, Node, Paper server, FAWE, dependencies |
| `build-blueprint.js` | Universal builder — reads JSON blueprints or .schem files |
| `build-fast.js` | Bulk /setblock builder for large blueprints |
| `build-city.js` | Generates a full city with streets, buildings, highway |
| `build-gt-city.js` | Georgia Tech campus + surrounding Atlanta city |
| `build-details.js` | Adds crosswalks, traffic lights, trees, benches, cars |
| `build-realism2.js` | Canal, shops, church, hotel, hospital, subway, MARTA |
| `fly-tech-placer.js` | Flying bot places gold TECH letters on Tech Tower |
| `gen-skyscrapers.py` | Generates skyscraper .schem files programmatically |

## AI Agent Skill

See [SKILL.md](SKILL.md) for the full skill document — covers setup, building methods, bug fixes, coordinate system, and patterns for realistic builds.

## Architecture

```
mc-builder/          ← This repo (bot code)
  ├── *.js           ← Builder scripts
  ├── blueprints/    ← JSON blueprint files
  ├── schematics/    ← .schem schematic files
  ├── SKILL.md       ← AI agent skill document
  ├── setup.sh       ← One-command setup
  └── package.json   ← Dependencies

mc-server/           ← Paper MC server (created by setup.sh)
  ├── paper.jar
  ├── plugins/FastAsyncWorldEdit.jar
  ├── world/         ← Minecraft world data
  ├── ops.json       ← Bot permissions
  └── server.properties
```

## Lessons Learned

1. **Paper server hangs** if started without `< /dev/null` — the stdin pipe blocks.
2. **Pathfinder breaks blocks** unless `movements.canDig = false`.
3. **Packet rate kicks** happen with >15 /setblock commands/sec — use /fill or add delays.
4. **Text on MC block faces** must be mirrored for north/east faces (viewer sees reversed X/Z axis).
5. **Bot flying** — use `/tp` to position the bot for precise placement instead of pathfinding which causes falls.
6. **FAWE > WorldEdit** — WorldEdit 7.3.x rejects "unsupported" MC versions; FAWE 2.15.0 works with 1.21.1.
