# Using mcb as an MCP server

`mcb mcp` speaks the [Model Context Protocol](https://modelcontextprotocol.io) over stdio, so
MCP-capable assistants (Claude Desktop, VS Code / GitHub Copilot agent mode, Cursor, …) can build in
Minecraft directly — and get preview images back inline.

## Configure your client

VS Code (`.vscode/mcp.json` in your workspace):

```json
{
  "servers": {
    "minecraft": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/path/to/minecraft-builder-skill/bin/mcb.js", "mcp"],
      "env": { "MCB_CONFIG": "C:/path/to/minecraft-builder-skill/mcb.config.json" }
    }
  }
}
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "minecraft": {
      "command": "node",
      "args": ["/path/to/minecraft-builder-skill/bin/mcb.js", "mcp"],
      "env": { "MCB_CONFIG": "/path/to/minecraft-builder-skill/mcb.config.json" }
    }
  }
}
```

Connection settings come from `mcb.config.json` (written by `mcb server setup`) or `MCB_*`
environment variables (`MCB_HOST`, `MCB_PORT`, `MCB_RCON_PASSWORD`, `MCB_PLAYER`, …).

## Tools

| Tool | What it does |
|---|---|
| `mc_generators` | List generators and their parameters |
| `mc_validate` | Check a blueprint (block names/states, auto-fixes, support warnings) |
| `mc_preview` | Render a blueprint → PNG image (iso + top + elevations) + size/warnings |
| `mc_build` | Build at `at: [x,y,z]` or `near: "<player>"` (`facing`, `clear`, `ground`, `verify`, `dryRun`, `mode`) |
| `mc_undo` | Undo the last (or a given) build; `list: true` lists snapshots |
| `mc_where` | Player position + facing, or the online player list |
| `mc_command` | Run raw server commands |
| `mc_snapshot` | Copy a world region into an inline JSON blueprint + preview image |

Blueprints can be passed **inline** as JSON objects (palette / layers / fills / blocks / parts /
generator — see [blueprint-format.md](blueprint-format.md)), as `"gen:<name>"` with `params`, or as
file paths.

The server keeps one connection to Minecraft open between calls and writes undo snapshots to
`.mcb/undo/` next to the config file.
