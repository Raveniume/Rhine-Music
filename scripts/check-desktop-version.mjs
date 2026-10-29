import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const version = JSON.parse(read('package.json')).version;
const lock = JSON.parse(read('package-lock.json'));
const versions = [
  lock.version, lock.packages[''].version,
  JSON.parse(read('src-tauri/tauri.conf.json')).version,
  read('src-tauri/Cargo.toml').match(/^version = "([^"]+)"/m)?.[1],
  read('src-tauri/Cargo.lock').match(/name = "rhine-music-windows"\nversion = "([^"]+)"/)?.[1],
];
if (versions.some(value => value !== version)) throw Error(`Desktop version mismatch: ${[version, ...versions].join(', ')}`);
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) {
  throw Error(`Release tag must match package version v${version}`);
}
console.log(`Shared desktop version: ${version}`);
