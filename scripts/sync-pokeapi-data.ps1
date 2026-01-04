Param(
  [string]$Destination = "resources/pokeapi-data"
)

$ErrorActionPreference = 'Stop'

Write-Host "Syncing PokeAPI/api-data into $Destination ..."

$temp = Join-Path $env:TEMP "pokeapi-api-data"
if (Test-Path $temp) {
  Remove-Item -Recurse -Force $temp
}

git clone --depth 1 https://github.com/PokeAPI/api-data.git $temp

$targetV2 = Join-Path $Destination "v2"
if (Test-Path $targetV2) {
  Remove-Item -Recurse -Force $targetV2
}

New-Item -ItemType Directory -Force $Destination | Out-Null
$sourceV2 = Join-Path $temp "data/api/v2"
if (-not (Test-Path $sourceV2)) {
  $sourceV2 = Join-Path $temp "data/v2"
}

if (-not (Test-Path $sourceV2)) {
  throw "Could not find PokeAPI v2 data at 'data/api/v2' (or legacy 'data/v2') inside $temp"
}

Copy-Item -Recurse -Force $sourceV2 $targetV2

Remove-Item -Recurse -Force $temp

Write-Host "Done. Expected index: $targetV2/pokemon/index.json"