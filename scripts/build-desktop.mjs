import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = { win32: 'desktop:build:windows', darwin: 'desktop:build:macos' }[process.platform];
if (!script) throw Error('Desktop builds currently support Windows and macOS.');
const check = spawnSync(process.execPath, ['scripts/check-desktop-version.mjs'], { cwd: root, stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status || 1);
const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', script], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
