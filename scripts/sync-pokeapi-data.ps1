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
Copy-Item -Recurse -Force (Join-Path $temp "data/v2") $targetV2

Remove-Item -Recurse -Force $temp

Write-Host "Done. Expected index: $targetV2/pokemon/index.json"