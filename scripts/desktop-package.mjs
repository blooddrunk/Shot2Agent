// Portable Windows distribution: fixed relative executable/runtime paths; no PATH Node or WSL.
import { cpSync, copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
if (process.platform !== 'win32') throw new Error('WINDOWS_BUILD_REQUIRED');
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
writeFileSync(join(out, 'BUILD.txt'), `Shot2Agent M7-UX 0.7.2\nCommit: ${execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()}\nNode: ${process.version}\nWindows x64 portable build. WebView2 required.\nLaunch Shot2Agent.exe for Local GUI setup, capture, result delivery and history; no Relay or Fake task execution.\nStart Codex.cmd is an optional compatibility launcher. Start legacy Local.cmd opens the original Shot2Agent history root.\nStart acceptance.cmd is a developer-only isolated Fake root, delayed 8s.\nClose hides to tray. Tray > Quit Shot2Agent stops coordinator and Agent.\n`);
cpSync('docs/M7_UX_RUN.md', join(out, 'Windows instructions.md'));
cpSync('docs/M7_UX_VALIDATION.md', join(out, 'Validation and acceptance.md'));
process.stdout.write(`PASS portable layout: ${out}\n`);
