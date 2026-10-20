import { resolve, join, isAbsolute, dirname } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, realpathSync, writeFileSync, lstatSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { privateDirectory } from '../../../packages/core/src/store.ts';
import { requireValue } from '../../../packages/core/src/model.ts';
import { FAKE_PROFILE, FakeAgent } from '../../../packages/worker/src/fake.ts';
import { CodexAgent, codexProfile, inspectCodex } from '../../../packages/worker/src/codex.ts';
import type { CodexPolicy } from '../../../packages/worker/src/codex.ts';
import { WindowsClipboard } from '../../../packages/local/src/clipboard.ts';
import { LocalApp, readImageFile } from '../../../packages/local/src/app.ts';
import type { DeliveryConfig } from '../../../packages/local/src/delivery.ts';
const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  root: { type: 'string' }, adapter: { type: 'string' }, workspace: { type: 'string' }, codex: { type: 'string' },
  'codex-script': { type: 'string' }, clipboard: { type: 'string' }, save: { type: 'string' }, auto: { type: 'boolean', default: false },
  force: { type: 'boolean', default: false },
} });
const [command = 'help', argument] = positionals;
const root = resolve(values.root ?? join(process.env.LOCALAPPDATA ?? homedir(), 'Shot2Agent'));
interface Settings { adapter: 'fake' | 'codex'; delivery: DeliveryConfig; codex?: CodexPolicy }
function log(value: unknown) { process.stdout.write(typeof value === 'string' ? value + '\n' : JSON.stringify(value) + '\n'); }
function program(path: string, script?: string) {
  // npm's Windows .cmd shim cannot be spawned with shell:false. Invoke its JS entry using Node.
  if (/\.cmd$/i.test(path) && !script) {
    const entry = join(dirname(path), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    requireValue(existsSync(entry), 'USE_CODEX_EXE_OR_NPM_CMD_WITH_ADJACENT_PACKAGE');
    return { executable: process.execPath, args: [realpathSync(entry)] };
  }
  return { executable: realpathSync(path), args: script ? [realpathSync(script)] : [] };
}
async function main() {
  if (command === 'help') {
    log('Shot2Agent Local: init | doctor | submit | file <image> | work | watch | list | show <id> | copy <id> | delivery <id> | retry-delivery <id>\nOptions: --root <private-dir> (all commands); init: --adapter fake|codex --workspace <dir> --codex <exe-or-npm-cmd> [--codex-script <js>] --clipboard off|manual|smart|always --save <directory>; watch: --auto (explicit cloud upload opt-in); submit/file: --force (intentional duplicate).\nwatch commands: submit, list, show <id>, copy <id>, delivery <id>, quit. Defaults: confirmation required, manual clipboard, history always on.'); return;
  }
  privateDirectory(root); const configPath = join(root, 'settings.json');
  if (command === 'init') {
    requireValue(!existsSync(configPath), 'ALREADY_INITIALIZED_EDIT_PRIVATE_SETTINGS');
    const adapter = values.adapter ?? 'fake'; const clipboard = values.clipboard ?? 'manual';
    requireValue(['fake', 'codex'].includes(adapter) && ['off', 'manual', 'smart', 'always'].includes(clipboard), 'INVALID_SETTINGS');
    const settings: Settings = { adapter: adapter as Settings['adapter'], delivery: { clipboard: clipboard as DeliveryConfig['clipboard'],
      ...(values.save ? { saveDirectory: resolve(values.save) } : {}) } };
    if (adapter === 'codex') {
      requireValue(values.workspace && values.codex, 'WORKSPACE_AND_CODEX_PATH_REQUIRED');
      const workspace = realpathSync(resolve(values.workspace)); const approvedProgram = program(resolve(values.codex), values['codex-script']);
      settings.codex = { id: 'codex-readonly', version: 'v1', workspace, program: approvedProgram,
        cliVersion: await inspectCodex(approvedProgram, workspace), timeoutMs: 180_000,
        prompt: 'Analyze the screenshot. Transcribe relevant text accurately and explain the content concisely in Markdown.' };
      codexProfile(settings.codex);
    }
    writeFileSync(configPath, JSON.stringify(settings, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    log({ initialized: root, adapter, clipboard, save: settings.delivery.saveDirectory ?? 'off' }); return;
  }
  requireValue(lstatSync(configPath).isFile() && !lstatSync(configPath).isSymbolicLink() && lstatSync(configPath).size < 65536, 'UNSAFE_SETTINGS');
  const settings = JSON.parse(readFileSync(configPath, 'utf8')) as Settings;
  requireValue(['fake', 'codex'].includes(settings.adapter) && ['off', 'manual', 'smart', 'always'].includes(settings.delivery.clipboard) &&
    (!settings.delivery.saveDirectory || isAbsolute(settings.delivery.saveDirectory)), 'INVALID_SETTINGS');
  const policy = settings.codex;
  if (command === 'doctor') {
    if (settings.adapter === 'codex') { requireValue(policy, 'MISSING_CODEX_POLICY'); requireValue(await inspectCodex(policy.program, policy.workspace) === policy.cliVersion, 'CODEX_VERSION_CHANGED_REVIEW_AND_REPIN'); }
    log({ adapter: settings.adapter, version: policy?.cliVersion, platform: process.platform, nativeClipboard: process.platform === 'win32' ? 'requires interactive session acceptance' : 'unavailable', root }); return;
  }
  requireValue(settings.adapter !== 'codex' || policy, 'MISSING_CODEX_POLICY');
  const needsClipboard = ['submit', 'copy', 'watch'].includes(command) || (['work', 'file'].includes(command) && ['smart', 'always'].includes(settings.delivery.clipboard));
  const clipboard = needsClipboard ? new WindowsClipboard() : undefined;
  const adapter = settings.adapter === 'codex' ? new CodexAgent([policy!]) : new FakeAgent();
  const app = new LocalApp(root, adapter, settings.adapter === 'codex' ? codexProfile(policy!) : FAKE_PROFILE, settings.delivery, clipboard);
  const controller = new AbortController();
  const stop = () => controller.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const actions = async (action: string, id?: string) => {
    if (action === 'list') log(app.list().map(t => ({ id: t.submission.taskId, status: t.status, errorCode: t.result?.errorCode })));
    else if (action === 'show') { requireValue(id, 'TASK_ID_REQUIRED'); log(app.get(id).result?.contentMarkdown ?? app.get(id).status); }
    else if (action === 'copy') { requireValue(id, 'TASK_ID_REQUIRED'); await app.copy(id); log('Copied text'); }
    else if (action === 'delivery') { requireValue(id, 'TASK_ID_REQUIRED'); log({ save: app.state.get(id, 'save'), clipboard: app.state.get(id, 'clipboard') }); }
    else if (action === 'retry-delivery') { requireValue(id, 'TASK_ID_REQUIRED'); await app.retryDelivery(id); log('Delivery retried; execution was not repeated'); }
    else throw new Error('UNKNOWN_COMMAND');
  };
  try {
    if (command === 'submit' || command === 'file') {
      if (command === 'file') requireValue(argument, 'IMAGE_PATH_REQUIRED');
      const id = command === 'submit' ? await app.capture(values.force) : await app.submit(readImageFile(resolve(argument!)), undefined, values.force);
      log({ taskId: id ?? null, status: id ? 'queued' : 'no image or duplicate within 5 seconds', next: 'work or watch' });
    } else if (command === 'work') log({ worked: await app.work(controller.signal) });
    else if (command === 'watch') {
      log(`Ready (${settings.adapter}, ${values.auto ? 'AUTO submission enabled' : 'confirm: type submit after screenshot'}). Commands: submit, list, show ID, copy ID, delivery ID, quit. No Relay/HTTP. Minimize this console; it will not activate windows.`);
      const input = createInterface({ input: process.stdin, output: process.stdout });
      let commands = Promise.resolve(); let worker: Promise<unknown> | undefined;
      input.on('line', line => { commands = commands.then(async () => {
        const [action, id] = line.trim().split(/\s+/);
        try {
          if (action === 'quit') { stop(); input.close(); }
          else if (action === 'submit') log({ taskId: await app.capture(values.force) ?? null });
          else await actions(action, id);
        } catch { log('Action failed. Check ID, clipboard availability and delivery status.'); }
      }); });
      input.on('close', stop);
      try {
        while (!controller.signal.aborted) {
          try {
            const event = await app.observe(values.auto);
            if (event.image) log(event.id ? { queued: event.id } : 'Image detected; type submit to confirm (duplicates suppressed for 5 seconds).');
          } catch { log('Clipboard unavailable/busy/oversized; will retry. Use submit as fallback.'); }
          if (!worker) {
            worker = app.work(controller.signal).then(worked => { if (worked) log('Task processed. Type list for status; show ID / copy ID / delivery ID.'); })
              .catch(() => log('Worker/storage error; inspect list before resubmitting. Started tasks may become execution_unknown.'))
              .finally(() => { worker = undefined; });
          }
          await new Promise<void>(resolve => { const timer = setTimeout(done, 1000); function done() { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); } controller.signal.addEventListener('abort', done, { once: true }); });
        }
      } finally { input.close(); await commands; await worker; }
    } else await actions(command, argument);
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); app.close(); }
}
try { await main(); } catch (error) {
  // No child stderr, screenshots or result text in diagnostic errors.
  const message = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'LOCAL_OPERATION_FAILED';
  process.stderr.write(message + '\n'); process.exitCode = 1;
}
