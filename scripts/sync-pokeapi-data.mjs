import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const destinationArg = process.argv[2];
const destination = destinationArg || 'resources/pokeapi-data';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 1);
}

const platform = os.platform();

if (platform === 'win32') {
  const scriptPath = path.join(__dirname, 'sync-pokeapi-data.ps1');

  // Prefer Windows PowerShell 5.1 ("powershell"); fall back to pwsh if needed.
  const tryPowershell = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Destination', destination], {
    stdio: 'inherit',
  });

  if (!tryPowershell.error) {
    process.exit(tryPowershell.status ?? 1);
  }

  run('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Destination', destination]);
} else {
  const scriptPath = path.join(__dirname, 'sync-pokeapi-data.sh');
  run('bash', [scriptPath, destination]);
}
