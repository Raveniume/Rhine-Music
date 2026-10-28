// Run only on the public release assets, before publication.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const version = JSON.parse(await fs.readFile('package.json', 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Stable release version required');
const dir = path.resolve(process.argv[2] || 'release-assets');
const name = `Rhine-Music-Windows-${version}-x64-Setup.exe`;
const hash = createHash('sha256').update(await fs.readFile(path.join(dir, name))).digest('hex');
const expected = (await fs.readFile(path.join(dir, name + '.sha256'), 'utf8')).split(/\s+/)[0];
if (hash !== expected) throw Error('Installer checksum mismatch');
const base = 'https://github.com/Raveniume/Rhine-Music';
await fs.writeFile(path.join(dir, 'update.json'), JSON.stringify({
  tag_name: `v${version}`, name: `RhineMusic ${version}`, html_url: `${base}/releases/tag/v${version}`,
  assets: [{ name, browser_download_url: `${base}/releases/download/v${version}/${name}`, digest: `sha256:${hash}` }],
}, null, 2) + '\n');
