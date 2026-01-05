# PokeAPI api-data sync

This folder is intended to contain a synced copy of `PokeAPI/api-data`'s `data/v2` tree.

Note: the actual data under `resources/pokeapi-data/v2` is intentionally NOT tracked in git.

Expected layout:

- `resources/pokeapi-data/v2/pokemon/index.json`
- `resources/pokeapi-data/v2/pokemon/<id>/index.json`

Sync options:

- Recommended: `npm run sync`
- Direct scripts:
  - Windows: `./scripts/sync-pokeapi-data.ps1`
  - macOS/Linux: `./scripts/sync-pokeapi-data.sh`

## Optional: scheduled refresh (VPS)

If you run this server long-term, consider refreshing the dataset weekly and restarting the PM2 process.

Example cron entry:

```cron
0 3 * * 1 cd /path/to/mrdj-pokemon-mcp && npm run sync && pm2 restart mrdj-pokemon-mcp
```
