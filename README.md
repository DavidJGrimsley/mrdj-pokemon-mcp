# mrdj-pokemon-mcp

This runs on my VPS and can be used in any MCP client (VS Code, etc.) at:

- https://davidjgrimsley.com/mcp/mrdj-pokemon-mcp/mcp

More info page:

- https://davidjgrimsley.com/mcp/mrdj-pokemon-mcp

## What it is

Model Context Protocol (MCP) server that surfaces:

- Pokémon data from a locally synced copy of `PokeAPI/api-data` (to minimize external API calls)
- Mr. DJ’s Pokémon strategy guides (Markdown in `guides/`)

## Tools

- `list-guides` — list available Markdown guides as MCP resources
- `get_strategy` — return a full guide by id
- `search_pokemon` — search Pokémon names using local api-data index
- `get_pokemon` — get Pokémon JSON by name or National Dex id (uses local sync first; falls back to live PokeAPI when missing and caches locally)
- `type_effectiveness` — calculate type matchup multipliers
- `counter_pokemon` — suggest best attacking types (and example Pokémon when local data exists)
- `suggest_team` — analyze a team and suggest defensive coverage improvements

## Data source (PokeAPI api-data)

The full PokeAPI `api-data` dataset is large, so (like `node_modules`) it is intentionally NOT tracked in git.

This server expects the `api-data/data/v2` tree copied to:

- `resources/pokeapi-data/v2/...`

Examples:

- `resources/pokeapi-data/v2/pokemon/index.json`
- `resources/pokeapi-data/v2/pokemon/<id>/index.json`

### Sync (recommended)

Prereq: you need `git` installed.

```bash
npm run sync
```

This downloads `PokeAPI/api-data` and copies `data/v2` into `resources/pokeapi-data/v2`.

### Sync (direct scripts)

- Windows (PowerShell): `./scripts/sync-pokeapi-data.ps1`
- macOS/Linux (bash): `./scripts/sync-pokeapi-data.sh`

## Run locally (stdio MCP)

1. Install Node.js 18+.
2. `npm install`
3. `npm run build`
4. `npm start`

## Run as HTTP server (for remote access)

```bash
npm run build
npm run start:http  # Starts on port 4027
curl http://localhost:4027/health
```

## VPS deployment (Plesk/nginx + PM2)

- Internal server runs on `127.0.0.1:4027`
- Public endpoints are path-prefixed under `/mcp/mrdj-pokemon-mcp/*`

On the VPS, the PokeAPI dataset must be present at `resources/pokeapi-data/v2`. The included [deploy.sh](deploy.sh) will run `npm run sync` automatically if the dataset is missing.

Use the Plesk-friendly reverse proxy snippet in [nginx.conf](nginx.conf).

### Weekly dataset refresh (cron)

The PokeAPI dataset changes over time. This repo does not schedule refreshes automatically; schedule `npm run sync` on the VPS.

Example (runs Mondays at 03:00, then restarts PM2):

```cron
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin

0 3 * * 1 cd /home/deployer/mrdj-pokemon-mcp && npm run sync && pm2 restart mrdj-pokemon-mcp >> /home/deployer/mrdj-pokemon-mcp/sync.log 2>&1
```

Notes:

- Update the path to match where you cloned the repo.
- If your VPS uses a Node version manager (e.g. nodenv/nvm), you may need to set `PATH` so `node`/`npm` are available to cron.

## Attribution

Pokémon data is provided by [PokéAPI](https://pokeapi.co/) and sourced from `PokeAPI/api-data`.
Pokémon and Pokémon character names are trademarks of Nintendo.
 
