#!/usr/bin/env bash
# One-command setup for Linux/macOS: npm deps + a local Paper build server + mcb.config.json.
#   ./setup.sh                      # interactive EULA prompt
#   ./setup.sh --accept-eula --op YourMinecraftName
# Extra flags are passed to `mcb server setup` (see `node bin/mcb.js --help`).
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22+ is required: https://nodejs.org (or: brew install node / sudo apt install nodejs)" >&2
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js 22+ is required (found $(node -v))." >&2
  exit 1
fi

npm install --no-fund --no-audit

ARGS=("$@")
if [[ ! " ${ARGS[*]-} " =~ " --accept-eula " ]]; then
  echo
  echo "Running a Minecraft server requires accepting the Minecraft EULA: https://aka.ms/MinecraftEULA"
  read -r -p "Do you accept it? [y/N] " yn
  if [[ "$yn" =~ ^[Yy] ]]; then ARGS+=("--accept-eula"); fi
fi

node bin/mcb.js server setup --dir ../mc-server ${ARGS[@]+"${ARGS[@]}"}
echo
echo "Start the server:  node bin/mcb.js server start"
echo "Check everything:  node bin/mcb.js doctor"
