#!/usr/bin/env bash
# setup.sh — One-command setup for MC Builder Bot
# Supports: Linux (Ubuntu/Debian), macOS
set -e

OS="$(uname -s)"
ARCH="$(uname -m)"
echo "=== MC Builder Bot Setup ==="
echo "OS: $OS  Arch: $ARCH"

# --- Check/Install Java 21+ ---
if command -v java &>/dev/null; then
  JAVA_VER=$(java -version 2>&1 | head -1 | grep -oP '\d+' | head -1)
  echo "Java found: version $JAVA_VER"
  if [ "$JAVA_VER" -lt 21 ]; then
    echo "WARNING: Java 21+ required. Current: $JAVA_VER"
    echo "Install: sudo apt install openjdk-21-jre-headless (Linux) or brew install openjdk@21 (macOS)"
  fi
else
  echo "Java NOT found."
  if [ "$OS" = "Linux" ]; then
    echo "Installing Java 21..."
    sudo apt-get update -qq && sudo apt-get install -y -qq openjdk-21-jre-headless
  elif [ "$OS" = "Darwin" ]; then
    echo "Install Java: brew install openjdk@21"
    exit 1
  fi
fi

# --- Check/Install Node.js 18+ ---
if command -v node &>/dev/null; then
  NODE_VER=$(node -v | grep -oP '\d+' | head -1)
  echo "Node.js found: v$NODE_VER"
  if [ "$NODE_VER" -lt 18 ]; then
    echo "WARNING: Node 18+ required."
  fi
else
  echo "Node.js NOT found."
  if [ "$OS" = "Linux" ]; then
    echo "Installing Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y -qq nodejs
  elif [ "$OS" = "Darwin" ]; then
    echo "Install Node: brew install node"
    exit 1
  fi
fi

# --- Setup mc-builder ---
BUILDER_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "Builder dir: $BUILDER_DIR"

if [ ! -d "$BUILDER_DIR/node_modules" ]; then
  echo "Installing npm dependencies..."
  cd "$BUILDER_DIR"
  npm install
fi

# --- Setup mc-server ---
SERVER_DIR="$BUILDER_DIR/../mc-server"
mkdir -p "$SERVER_DIR/plugins"

if [ ! -f "$SERVER_DIR/paper.jar" ]; then
  echo "Downloading Paper MC 1.21.1..."
  curl -sL "https://api.papermc.io/v2/projects/paper/versions/1.21.1/builds/132/downloads/paper-1.21.1-132.jar" -o "$SERVER_DIR/paper.jar"
fi

if [ ! -f "$SERVER_DIR/eula.txt" ]; then
  echo "eula=true" > "$SERVER_DIR/eula.txt"
fi

if [ ! -f "$SERVER_DIR/server.properties" ]; then
  cat > "$SERVER_DIR/server.properties" << 'PROPS'
server-port=25566
online-mode=false
gamemode=creative
level-name=world
allow-flight=true
spawn-protection=0
max-players=10
PROPS
fi

if [ ! -f "$SERVER_DIR/plugins/FastAsyncWorldEdit.jar" ]; then
  echo "Downloading FastAsyncWorldEdit..."
  curl -sL "https://cdn.modrinth.com/data/z4HZZnLr/versions/mHtmqIig/FastAsyncWorldEdit-Paper-2.15.0.jar" -o "$SERVER_DIR/plugins/FastAsyncWorldEdit.jar"
fi

# --- Op BuilderBot ---
if [ ! -f "$SERVER_DIR/ops.json" ] || ! grep -q BuilderBot "$SERVER_DIR/ops.json" 2>/dev/null; then
  cat > "$SERVER_DIR/ops.json" << 'OPS'
[
  {"uuid":"40c73079-eb42-3445-9f3c-c31a5964a44a","name":"BuilderBot","level":4,"bypassesPlayerLimit":false}
]
OPS
fi

echo ""
echo "=== Setup Complete ==="
echo "To start server:  cd $SERVER_DIR && java -Xmx2G -Xms1G -jar paper.jar nogui < /dev/null &"
echo "To run builder:   cd $BUILDER_DIR && node build-blueprint.js --file blueprints/house.json --clear"
echo ""
echo "Player joins:     Multiplayer > localhost:25566"
