// Run on a Mac with the maintainer's Developer ID installed in Keychain.
// This builds and verifies distribution files. It never publishes them.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { collectNativeLicenses } from './collect-native-licenses.mjs';
if (process.platform !== 'darwin') throw Error('macOS signing and notarization require a Mac');
const identity = process.env.APPLE_SIGNING_IDENTITY;
const profile = process.env.RHINE_NOTARY_PROFILE;
if (!identity?.startsWith('Developer ID Application:') || !profile) throw Error('Set APPLE_SIGNING_IDENTITY and RHINE_NOTARY_PROFILE (Keychain profile name, not a password)');
const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const run = (bin, args, capture = false) => execFileSync(bin, args, { cwd: root, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' });
const version = JSON.parse(await fs.readFile('package.json', 'utf8')).version;
const arch = process.arch;
if (!['arm64', 'x64'].includes(arch)) throw Error('Unsupported architecture');
const output = path.resolve('release', `macos-${version}-${arch}`);
await fs.mkdir(output); // Never overwrite a previously built release.
run('npm', ['ci']);
process.env.VITE_PUBLIC_RELEASE = '1';
run('npm', ['run', 'desktop:prepare']);
for (const restricted of ['desktop-runtime/bin', 'desktop-runtime/node_modules/node-nim']) {
  if (await fs.stat(restricted).catch(() => null)) throw Error(`Remove optional private distribution components before building: ${restricted}`);
}
for (const file of ['PRIVACY.md', 'PLATFORM-NOTICE.md', 'LICENSE-AGPL-3.0-only']) await fs.copyFile(file, path.join('desktop-runtime', file));
const rustTarget = arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
run('cargo', ['fetch', '--manifest-path', 'src-tauri/Cargo.toml', '--target', rustTarget, '--locked']);
await collectNativeLicenses(path.resolve('desktop-runtime/third-party/native'), root, rustTarget);
await fs.writeFile('desktop-runtime/PUBLIC-PACKAGE.json', JSON.stringify({ version, platform: 'macos', arch, runtimeChecked: false }));
const entitlements = path.resolve('src-tauri/entitlements-node.plist');
// Sign all nested Mach-O code, including transitive native .node modules,
// before sealing the app. Only Node needs the JIT entitlement.
const node = path.resolve('desktop-runtime/node.exe');
await fs.chmod(node, 0o755);
const signedCode = [];
async function signNested(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await signNested(file);
    else if (entry.isFile() && run('file', ['-b', file], true).includes('Mach-O')) {
      run('codesign', ['--force', '--sign', identity, '--timestamp', '--options', 'runtime', ...(file === node ? ['--entitlements', entitlements] : []), file]);
      run('codesign', ['--verify', '--strict', '--verbose=2', file]);
      signedCode.push(path.relative(path.resolve('desktop-runtime'), file));
    }
  }
}
await signNested(path.resolve('desktop-runtime'));
if (!signedCode.includes('node.exe')) throw Error('Bundled Node is not a Mach-O executable');
const iconset = path.join(output, 'rhine.iconset');
await fs.mkdir(iconset);
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const pixels = String(size * scale);
    run('sips', ['-s', 'format', 'png', '-z', pixels, pixels, 'public/icons/icon-512.png', '--out', path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)]);
  }
}
const icon = path.join(output, 'icon.icns');
run('iconutil', ['-c', 'icns', iconset, '-o', icon]);
// Do not rerun beforeBuildCommand: that would replace the signed nested Node.
const config = path.join(output, 'tauri-macos.json');
await fs.writeFile(config, JSON.stringify({ build: { beforeBuildCommand: '' }, bundle: { icon: [icon], macOS: { signingIdentity: identity, hardenedRuntime: true } } }));
run('npx', ['tauri', 'build', '--bundles', 'app', '--config', config, '--', '--locked']);
const app = path.resolve('src-tauri/target/release/bundle/macos/Rhine Music.app');
const nestedNode = path.join(app, 'Contents/Resources/runtime/node.exe');
run(nestedNode, ['-e', 'console.log(process.platform, process.arch)']);
run('codesign', ['--verify', '--strict', '--verbose=2', nestedNode]);
run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
async function notarize(file, label) {
  const result = JSON.parse(run('xcrun', ['notarytool', 'submit', file, '--keychain-profile', profile, '--wait', '--output-format', 'json'], true));
  await fs.writeFile(path.join(output, `${label}-notary.json`), JSON.stringify(result, null, 2));
  if (result.status !== 'Accepted') throw Error(`Notarization failed: ${label}; retrieve the notarytool log before rebuilding`);
}
const zip = path.join(output, 'notarization.zip');
run('ditto', ['-c', '-k', '--keepParent', app, zip]);
await notarize(zip, 'app');
run('xcrun', ['stapler', 'staple', app]);
run('xcrun', ['stapler', 'validate', app]);
run('spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
const stage = path.join(output, 'dmg-content');
await fs.mkdir(stage);
run('ditto', [app, path.join(stage, 'Rhine Music.app')]);
await fs.symlink('/Applications', path.join(stage, 'Applications'));
const dmg = path.join(output, `Rhine-Music-macOS-${version}-${arch}.dmg`);
run('hdiutil', ['create', '-volname', 'Rhine Music', '-srcfolder', stage, '-ov', '-format', 'UDZO', dmg]);
run('codesign', ['--sign', identity, '--timestamp', dmg]);
await notarize(dmg, 'dmg');
run('xcrun', ['stapler', 'staple', dmg]);
run('xcrun', ['stapler', 'validate', dmg]);
run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', dmg]);
const sha256 = createHash('sha256').update(await fs.readFile(dmg)).digest('hex');
await fs.writeFile(dmg + '.sha256', `${sha256}  ${path.basename(dmg)}\n`);
await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ version, arch, sourceCommit: run('git', ['rev-parse', 'HEAD'], true).trim(), signedCode, signed: true, notarized: true, gatekeeperChecked: true, runtimeChecked: false, sha256 }, null, 2));
console.log('Signing and Gatekeeper passed. Complete the fresh-download runtime checks in docs/MACOS-RELEASE.md before publication.');
