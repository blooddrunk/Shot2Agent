import { createHash } from 'node:crypto';
import { APP_VERSION } from '../dist/packages/desktop/src/version.js';
// Portable Windows distribution: fixed relative executable/runtime paths; no PATH Node or WSL.
import { cpSync, copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
if (process.platform !== 'win32') throw new Error('WINDOWS_BUILD_REQUIRED');
for (const path of ['apps/desktop/src-tauri/tauri.conf.json', 'apps/desktop/src-tauri/Cargo.toml']) {
  if (!readFileSync(path, 'utf8').includes(APP_VERSION)) throw new Error('APP_VERSION_MISMATCH');
}
const out = resolve('build/Shot2Agent'); const runtime = join(out, 'runtime');
mkdirSync(runtime, { recursive: true });
copyFileSync('apps/desktop/src-tauri/target/release/shot2agent-desktop.exe', join(out, 'Shot2Agent.exe'));
copyFileSync(process.execPath, join(runtime, 'node.exe'));
cpSync('dist', join(runtime, 'dist'), { recursive: true });
// Flatten the one native runtime dependency and its optional platform packages.
// Materialize only the frozen-lockfile runtime dependency tree; do not copy dev tools.
const copied = new Set();
function copyDependency(name, from, optional = false) {
  let manifest;
  try {
    const search = createRequire(from).resolve.paths(name) ?? [];
    manifest = search.map(path => join(path, name, 'package.json')).find(path => existsSync(path));
    if (!manifest) throw new Error('MISSING_RUNTIME_DEPENDENCY');
    manifest = realpathSync(manifest);
  }
  catch (error) { if (optional) return; throw error; }
  if (copied.has(name)) return; copied.add(name);
  const meta = JSON.parse(readFileSync(manifest, 'utf8'));
  cpSync(dirname(manifest), join(runtime, 'node_modules', name), { recursive: true, dereference: true });
  for (const dependency of Object.keys(meta.dependencies ?? {})) copyDependency(dependency, manifest);
  for (const dependency of Object.keys(meta.optionalDependencies ?? {})) copyDependency(dependency, manifest, true);
}
copyDependency('sharp', resolve('package.json'));
writeFileSync(join(out, 'Start Codex.cmd'), '@echo off\r\nstart "" "%~dp0Shot2Agent.exe" --codex\r\n');
writeFileSync(join(out, 'Start legacy Local.cmd'), '@echo off\r\nstart "" "%~dp0Shot2Agent.exe" --legacy\r\n');
writeFileSync(join(out, 'Start acceptance.cmd'), '@echo off\r\nstart "" "%~dp0Shot2Agent.exe" --staging\r\n');
writeFileSync(join(out, 'Start Remote acceptance.cmd'), '@echo off\r\nset "LOCALAPPDATA=%~dp0Remote acceptance data"\r\nif not exist "%LOCALAPPDATA%" mkdir "%LOCALAPPDATA%"\r\nstart "" "%~dp0Shot2Agent.exe" --legacy\r\n');
for (let i = 1; i <= 5; i++) await sharp({ create: { width: 160, height: 100, channels: 3, background: { r: i * 40, g: 80, b: 120 } } }).png().toFile(join(out, `Remote synthetic ${i}.png`));
cpSync('docs/REMOTE_GUIDE.md', join(out, 'REMOTE_GUIDE.md'));
cpSync('docs/M10_R_VALIDATION.md', join(out, 'M10_R_VALIDATION.md'));
const relaySource = join(out, 'Relay source');
for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.build.json', '.dockerignore']) {
  mkdirSync(relaySource, { recursive: true }); copyFileSync(file, join(relaySource, file));
}
// A source bundle must never sweep ignored runtime state or private developer files.
const sourceFiles = execFileSync('git', ['ls-files', '-z', '--', 'packages', 'services', 'apps/cli', 'scripts', 'deploy/relay'], { encoding: 'utf8' }).split('\0').filter(Boolean);
for (const file of sourceFiles) { mkdirSync(dirname(join(relaySource, file)), { recursive: true }); copyFileSync(file, join(relaySource, file)); }
mkdirSync(join(relaySource, 'docs'), { recursive: true });
for (const file of ['REMOTE_GUIDE.md', 'M10_R_VALIDATION.md']) copyFileSync(`docs/${file}`, join(relaySource, 'docs', file));
writeFileSync(join(relaySource, 'SOURCE.txt'), execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }));
writeFileSync(join(out, 'BUILD.txt'), `Shot2Agent M9-L ${APP_VERSION}\nCommit: ${execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()}\nNode: ${process.version}\nWindows x64 portable build. WebView2 required.\nLaunch Shot2Agent.exe for Local GUI setup, capture, result delivery and history; no Relay or Fake task execution.\nStart Codex.cmd is an optional compatibility launcher. Start legacy Local.cmd opens the original Shot2Agent history root.\nStart acceptance.cmd is a developer-only isolated Fake root, delayed 8s.\nClose hides to tray. 托盘 > 退出 Shot2Agent stops coordinator and Agent.\n`);
cpSync('docs/LOCAL_V1_GUIDE.md', join(out, 'Windows instructions.md'));
cpSync('docs/LOCAL_V1_GUIDE.md', join(out, 'LOCAL_V1_GUIDE.md'));
cpSync('docs/USER_GUIDE.md', join(out, 'USER_GUIDE.md'));
cpSync('THIRD_PARTY_NOTICES.md', join(out, 'THIRD_PARTY_NOTICES.md'));
cpSync('docs/V1_0_2_VALIDATION.md', join(out, 'Validation and acceptance.md'));
cpSync('docs/V1_0_2_VALIDATION.md', join(out, 'V1_0_2_VALIDATION.md'));
process.stdout.write(`PASS portable layout: ${out}\n`);

const files = {};
function record(directory, prefix = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) record(join(directory, entry.name), relative + '/');
    else if (!['MANIFEST.json', 'SMOKE.txt', 'PORTABLE-VERIFY.txt', 'TRAY-SMOKE.txt'].includes(relative)) files[relative] = createHash('sha256').update(readFileSync(join(directory, entry.name))).digest('hex');
  }
}
record(out);
writeFileSync(join(out, 'MANIFEST.json'), JSON.stringify({ version: APP_VERSION, sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), files }, null, 2) + '\n');
