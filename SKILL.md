# Minecraft Builder Bot — AI Agent Skill

## Overview
This skill enables an AI agent to build structures in Minecraft Java Edition by controlling a mineflayer bot that connects to a Paper MC server. The bot can place blocks one-by-one (human-like) or use /fill commands for bulk placement.

## Prerequisites

### OS Support
- **Linux (Ubuntu 22.04+)**: Primary. All commands tested on Ubuntu 24.04 x86_64.
- **macOS**: Should work. Replace `apt` with `brew`. Java and Node available via brew.
- **Windows**: Use WSL2 with Ubuntu. Native Windows not tested.

### Required Software
| Software | Version | Install |
|----------|---------|---------|
| Java (OpenJDK) | 21+ | `sudo apt install openjdk-21-jre-headless` (Linux) / `brew install openjdk@21` (macOS) |
| Node.js | 18+ | `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo -E bash - && sudo apt install nodejs` |
| Minecraft Java | 1.21.1 | Via minecraft-launcher |

### Optional Software
| Software | Purpose | Install |
|----------|---------|---------|
| Arnis | OSM→MC world generator | `git clone https://github.com/louis-e/arnis && cargo build --release` |
| Python 3 + PIL | Screenshot analysis | `sudo apt install python3-pil` |
| scrot | Screenshots | `sudo apt install scrot` |

## Quick Start

### 1. Setup Server
```bash
mkdir -p ~/mc-server && cd ~/mc-server

# Download Paper MC 1.21.1
curl -sL "https://api.papermc.io/v2/projects/paper/versions/1.21.1/builds/132/downloads/paper-1.21.1-132.jar" -o paper.jar

# Accept EULA
echo "eula=true" > eula.txt

# Configure server
cat > server.properties << 'EOF'
server-port=25566
online-mode=false
gamemode=creative
level-name=world
allow-flight=true
EOF

# Download FAWE plugin
mkdir -p plugins
curl -sL "https://cdn.modrinth.com/data/z4HZZnLr/versions/mHtmqIig/FastAsyncWorldEdit-Paper-2.15.0.jar" -o plugins/FastAsyncWorldEdit.jar

# Start server (MUST use < /dev/null or it hangs)
java -Xmx2G -Xms1G -jar paper.jar nogui < /dev/null > server.log 2>&1 &
# Wait ~60s for first start
```

### 2. Setup Builder Bot
```bash
mkdir -p ~/mc-builder && cd ~/mc-builder
npm init -y
npm install mineflayer mineflayer-pathfinder prismarine-item minecraft-data vec3
```

### 3. Op the Bot
Add to `~/mc-server/ops.json`:
```json
[{"uuid":"40c73079-eb42-3445-9f3c-c31a5964a44a","name":"BuilderBot","level":4,"bypassesPlayerLimit":false}]
```
Then restart server.

### 4. Connect and Build
```javascript
const mineflayer = require('mineflayer');
const bot = mineflayer.createBot({
  host: 'localhost', port: 25566,
  username: 'BuilderBot', auth: 'offline', version: '1.21.11'
});
bot.on('spawn', async () => {
  bot.chat('/gamemode creative');
  // Now use bot.chat('/fill ...') or bot.placeBlock() to build
});
```

## Building Methods

### Method 1: /fill Commands (Fast, bulk)
Best for: walls, floors, large structures. 32,768 block limit per command.
```javascript
bot.chat('/fill 100 64 100 110 74 110 bricks');
```

### Method 2: /setblock (Fast, single blocks)
Best for: details, decorations. No mirroring issues.
```javascript
bot.chat('/setblock 105 70 100 gold_block');
```

### Method 3: placeBlock (Human-like, visible)
Best for: demonstrations, watching the bot work. Bot must be within 4.5 blocks.
```javascript
// Fly to position using /tp
bot.chat('/tp BuilderBot ' + x + ' ' + y + ' ' + (z-3));
await sleep(300);
// Look at reference block and place
const ref = bot.blockAt(vec3(x, y, z+1)); // brick behind target
await bot.lookAt(ref.position.offset(0.5, 0.5, 0.5));
await bot.placeBlock(ref, vec3(0, 0, -1)); // place on south face
```

### Method 4: FAWE Schematic Paste (Instant, complex structures)
```javascript
bot.chat('//schem load MyBuilding');
bot.chat('//paste -a'); // -a = skip air blocks
```

## Critical Bugs & Fixes

### Bot gets kicked for packet rate
**Cause**: Too many /setblock commands in rapid succession.
**Fix**: Use /fill for bulk. Add `await sleep(80)` between commands. Max ~15 commands/sec.

### Pathfinder destroys placed blocks
**Fix**: `movements.canDig = false;`

### Bot can't place block at own position
**Fix**: `/tp BuilderBot` 3 blocks away from target before placing.

### Paper server hangs on startup
**Fix**: Always start with `< /dev/null`: `java -jar paper.jar nogui < /dev/null`

### /fill exceeds 32768 block limit
**Fix**: Split into chunks. Helper function:
```javascript
async function fill(x1,y1,z1,x2,y2,z2,block) {
  const vol = Math.abs(x2-x1+1) * Math.abs(y2-y1+1) * Math.abs(z2-z1+1);
  if (vol > 32000) { /* split along longest axis */ }
  bot.chat(`/fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${block}`);
  await sleep(80);
}
```

### Text/letters appear mirrored on some faces
**Root cause**: MC coordinate system — when looking at a face from outside, the axis direction depends on which face:
- **South face (z=const, viewed from -z)**: X increases to the RIGHT ✓
- **North face (z=const, viewed from +z)**: X increases to the LEFT — must reverse letter order
- **West face (x=const, viewed from -x)**: Z increases to the RIGHT ✓  
- **East face (x=const, viewed from +x)**: Z increases to the LEFT — must reverse letter order

For text on north/east faces, reverse both letter ORDER and individual letter SHAPES.

## Building Patterns

### Skyscraper with Glass Curtain Wall
```
Walls: brick/concrete shell
Glass columns: every 2 blocks (glass_pane for thin look)
Floor bands: restore wall material every 4 blocks height
Roof: accent material + antenna (iron_bars + sea_lantern)
```

### Realistic City Block
Based on top-rated MC builds research:
1. **Varied heights** — 3-story shops next to 60-story towers
2. **Alleyways** — dumpsters (green_terracotta), pipes (iron_bars), fire escapes (chain + iron_bars platforms)
3. **Ground-level shops** — glass fronts, colored awnings (wool), interior lighting (lantern)
4. **Street furniture** — benches (oak_stairs), trash cans (cauldron), fire hydrants (red_concrete)
5. **Parking lots** — black_concrete surface, white_concrete lines, colored concrete cars with glass tops
6. **Negative space** — the gaps BETWEEN buildings matter more than the buildings themselves

### Real Building from Photos (Feedback Loop)
1. Study reference photos for: materials, proportions, distinctive features
2. Build with /fill for structure
3. Take screenshot (`scrot /tmp/build.png`)
4. Compare screenshot to reference — check letter orientation, proportions, materials
5. Fix issues, repeat

## File Formats

### Blueprint JSON
```json
{
  "name": "My Building",
  "blocks": [
    {"x": 0, "y": 0, "z": 0, "name": "bricks"},
    {"x": 1, "y": 0, "z": 0, "name": "glass"}
  ]
}
```

### Sponge Schematic (.schem)
Parse with Python `nbt` library, convert to blueprint JSON, or paste directly with FAWE.

## Key Files
| File | Purpose |
|------|---------|
| `build-blueprint.js` | Universal builder: reads JSON/schem, places blocks |
| `build-fast.js` | Fast /setblock builder for large blueprints |
| `build-city.js` | City generator with streets, buildings, highway |
| `build-details.js` | Adds realism: crosswalks, trees, cars, furniture |
| `fly-tech-placer.js` | Flying bot that hand-places blocks visibly |
| `gen-skyscrapers.py` | Generates .schem skyscraper files |

## Arnis (OSM→Minecraft)
Generate real-world locations:
```bash
./arnis --bbox "33.769,-84.407,33.784,-84.392" --path /path/to/output
# Creates MC world from OpenStreetMap data
# Output goes to /path/to/output/Arnis World 1/
# Copy to server: mv "Arnis World 1" ~/mc-server/world
```

## Coordinate Reference
- **Y**: Height (increases upward). Ground typically at y=-62 for flat worlds.
- **X**: East(+) / West(-)
- **Z**: South(+) / North(-)
- When player faces south (+Z), X increases to the left.
