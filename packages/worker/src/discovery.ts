import { createHash } from 'node:crypto';
import { openSync, readSync, closeSync, existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { requireValue } from '../../core/src/model.ts';
import { inspectCodex } from './codex.ts';
import { boundedProcess } from './process.ts';
import type { Program } from './process.ts';
export type Provider = 'codex' | 'claude';
export type Availability = 'not_found' | 'invalid' | 'unsupported' | 'version_changed' | 'unverified_auth' | 'scan_incomplete';
export interface Candidate { provider: Provider; path: string; program?: Program; version?: string; status: Availability; digest?: string }
const packageNames = { codex: '@openai/codex', claude: '@anthropic-ai/claude-code' };
const entries = { codex: 'bin/codex.js', claude: 'cli.js' };
function regular(path: string): string {
  requireValue(isAbsolute(path) && !path.startsWith('\\\\') && !path.startsWith('//'), 'LOCAL_ABSOLUTE_PATH_REQUIRED');
  requireValue(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() && realpathSync(path) === resolve(path), 'UNSAFE_CLI_PATH');
  return realpathSync(path);
}
/** Never interpret shim text as code. Only map a known package's exact, contained bin entry. */
export function resolveProgram(provider: Provider, path: string, node = process.execPath): Program {
  path = regular(path);
  if (/\.(cmd|ps1|bat)$/i.test(path) || (!/\.[^/\\]+$/.test(path) && process.platform === 'win32')) {
    const root = join(dirname(path), 'node_modules', packageNames[provider]);
    const metadata = regular(join(root, 'package.json'));
    requireValue(lstatSync(metadata).size <= 65536, 'PACKAGE_METADATA_LIMIT');
    const pkg = JSON.parse(readFileSync(metadata, 'utf8'));
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[provider];
    requireValue(pkg.name === packageNames[provider] && [entries[provider], ...(provider === 'claude' ? ['bin/claude.exe'] : [])].includes(bin?.replace(/^\.\//, '')), 'UNVERIFIED_NPM_ENTRY');
    const entry = regular(join(root, bin.replace(/^\.\//, '')));
    requireValue(entry.startsWith(realpathSync(root) + sep), 'NPM_ENTRY_ESCAPE');
    if (/\.exe$/i.test(entry)) return { executable: entry, args: [] };
    return { executable: regular(node), args: [entry] };
  }
  requireValue(!/\.(m?js|cjs)$/i.test(path) && (process.platform !== 'win32' || /\.exe$/i.test(path)), 'NATIVE_CLI_REQUIRED');
  return { executable: path, args: [] };
}
export function programDigest(program: Program): string {
  const hash = createHash('sha256'); const buffer = Buffer.alloc(65536);
  for (const path of [program.executable, ...program.args]) {
    hash.update(regular(path)); const fd = openSync(path, 'r');
    try { let count: number; while ((count = readSync(fd, buffer)) > 0) hash.update(buffer.subarray(0, count)); }
    finally { closeSync(fd); }
  }
  return hash.digest('hex');
}
export const CLAUDE_FLAGS = ['--input-format', '--output-format', '--tools', '--disallowedTools', '--restricted', '--safe-mode', '--no-session-persistence', '--strict-mcp-config', '--mcp-config', '--settings'];
export async function inspectClaude(program: Program, cwd: string): Promise<string> {
  const version = await boundedProcess(program, ['--version'], { cwd, timeoutMs: 5000, maxBytes: 16384 }); await version.settled;
  requireValue(version.code === 0 && !version.stopped && /^\d+\.\d+\.\d+ \(Claude Code\)$/.test(version.output.trim()), 'CLAUDE_VERSION_UNAVAILABLE');
  const help = await boundedProcess(program, ['--help'], { cwd, timeoutMs: 5000, maxBytes: 131072 }); await help.settled;
  requireValue(help.code === 0 && !help.stopped && CLAUDE_FLAGS.every(f => help.output.includes(f)), 'CLAUDE_FLAGS_UNSUPPORTED');
  return version.output.trim();
}
export async function inspectCandidate(provider: Provider, path: string, cwd: string, pinned?: { version: string; digest?: string }, approvedProgram?: Program): Promise<Candidate> {
  const base: Candidate = { provider, path, status: 'invalid' };
  try { base.program = approvedProgram ?? resolveProgram(provider, path); base.digest = programDigest(base.program); }
  catch { return base; }
  try {
    base.version = await (provider === 'codex' ? inspectCodex : inspectClaude)(base.program, cwd);
    base.status = pinned && (base.version !== pinned.version || (pinned.digest && base.digest !== pinned.digest)) ? 'version_changed' : 'unverified_auth';
  } catch { base.status = 'unsupported'; }
  return base;
}
/** Enumerate only bounded known local directories; never recursively search or execute a shell. */
export async function discover(provider: Provider, cwd: string, options: { manual?: string; approved?: { program: Program; version: string; digest?: string }; directories?: string[] } = {}): Promise<Candidate[]> {
  if (options.manual) return [await inspectCandidate(provider, options.manual, cwd)];
  if (options.approved) return [await inspectCandidate(provider, options.approved.program.executable, cwd, options.approved, options.approved.program)];
  const user = process.env.USERPROFILE ?? homedir();
  const dirs = options.directories ?? [...(process.env.PATH ?? process.env.Path ?? '').split(delimiter), join(user, '.local', 'bin'),
    join(user, '.claude', 'local'), ...(process.env.APPDATA ? [join(process.env.APPDATA, 'npm')] : []),
    ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'), join(process.env.LOCALAPPDATA, 'Programs', provider)] : [])];
  const deadline = Date.now() + 5000;
  const seen = new Set<string>(); const candidates: Candidate[] = [];
  for (const dir of dirs.slice(0, 128)) {
    if (!isAbsolute(dir) || dir.startsWith('\\\\') || dir.startsWith('//')) continue;
    for (const name of process.platform === 'win32' ? [`${provider}.exe`, `${provider}.cmd`, `${provider}.ps1`, provider] : [provider]) {
      const path = join(dir, name); if (!existsSync(path)) continue;
      if (Date.now() > deadline) return [...candidates, { provider, path: '', status: 'scan_incomplete' }];
      let resolved: Program | undefined;
      try { resolved = resolveProgram(provider, path); } catch { /* invalid candidates are reported below */ }
      if (resolved && seen.has(JSON.stringify(resolved))) continue;
      const c = await inspectCandidate(provider, path, cwd, undefined, resolved);
      const key = c.program ? JSON.stringify(c.program) : path;
      if (!seen.has(key)) { seen.add(key); candidates.push(c); }
      if (candidates.length >= 16) return [...candidates, { provider, path: '', status: 'scan_incomplete' }];
    }
  }
  return candidates.length ? candidates : [{ provider, path: '', status: 'not_found' }];
}
