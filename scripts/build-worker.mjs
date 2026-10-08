import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [
  require.resolve('wrangler/bin/wrangler.js'), 'deploy',
  '--config', fileURLToPath(new URL('../edge-api/wrangler.baegot.jsonc', import.meta.url)),
  '--dry-run',
  '--outdir', fileURLToPath(new URL('../.local/baegot-worker', import.meta.url)),
], { stdio: 'inherit', windowsHide: true });
process.exit(result.status ?? 1);
