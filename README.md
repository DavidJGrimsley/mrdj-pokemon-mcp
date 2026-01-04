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

- Internal server runs on `localhost:4027`
- Public endpoints are path-prefixed under `/mcp/mrdj-pokemon-mcp/*`

On the VPS, the PokeAPI dataset must be present at `resources/pokeapi-data/v2`. The included [deploy.sh](deploy.sh) will run `npm run sync` automatically if the dataset is missing.

Use the Plesk-friendly reverse proxy snippet in [nginx.conf](nginx.conf).

## Attribution

Pokémon data is provided by [PokéAPI](https://pokeapi.co/) and sourced from `PokeAPI/api-data`.
Pokémon and Pokémon character names are trademarks of Nintendo.
 
