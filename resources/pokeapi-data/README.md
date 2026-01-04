# PokeAPI api-data sync

This folder is intended to contain a synced copy of `PokeAPI/api-data`'s `data/v2` tree.

Expected layout:

- `resources/pokeapi-data/v2/pokemon/index.json`
- `resources/pokeapi-data/v2/pokemon/<id>/index.json`

Sync options:

- GitHub Actions: see `.github/workflows/sync-pokeapi-data.yml`
- Manual:
  1. `git clone https://github.com/PokeAPI/api-data.git temp-api-data`
  2. Copy `temp-api-data/data/v2` -> `resources/pokeapi-data/v2`
  3. Delete `temp-api-data`
