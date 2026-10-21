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
writeFileSync(join(out, 'BUILD.txt'), `Shot2Agent M6-L 0.6.0\nCommit: ${execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()}\nNode: ${process.version}\nWindows x64 portable developer build. WebView2 required.\nShot2Agent.exe / Start Codex.cmd: approved Shot2Agent-Codex root; no Fake fallback.\nStart acceptance.cmd: isolated Fake root, delayed 8s. Start legacy Local.cmd: original Shot2Agent history root.\nClose hides to tray. Tray > Quit Shot2Agent stops coordinator and Agent.\n`);
copyFileSync('scripts/desktop-codex-verify.mjs', join(out, 'Verify Codex.mjs'));
copyFileSync('scripts/claude-windows-transport-probe.mjs', join(out, 'Verify Claude transport.mjs'));
copyFileSync('docs/M5_WINDOWS_ACCEPTANCE.md', join(out, 'M5 Windows acceptance.md'));
cpSync('docs/M3_WINDOWS_RUN.md', join(out, 'Windows instructions.md'));
process.stdout.write(`PASS portable layout: ${out}\n`);

copyFileSync('scripts/claude-gateway-windows-probe.mjs', join(out, 'Verify Gateway transport.mjs'));
copyFileSync('docs/M6_WINDOWS_ACCEPTANCE.md', join(out, 'M6 Windows acceptance.md'));

copyFileSync('scripts/glm-vision-once.mjs', join(out, 'Verify GLM vision once.mjs'));
copyFileSync('scripts/fixtures/glm-vision.png', join(out, 'Synthetic GLM screenshot.png'));
writeFileSync(join(out, 'Run authorized GLM vision test once.cmd'), '@echo off\r\ncd /d "%~dp0"\r\necho This sends ONE synthetic image to your selected glm-5.3-flash gateway. Account quota may be consumed.\r\necho No retry or model fallback. A receipt prevents another request from this package.\r\n"%~dp0runtime\\node.exe" "%~dp0Verify GLM vision once.mjs" --authorized-once\r\necho Read GLM-ONCE-RECEIPT.json for the result. Never share your token.\r\npause\r\n');
