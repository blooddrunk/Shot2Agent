import { spawn } from 'node:child_process';
import { credentialCommand, readGatewayToken, validateGateway } from '../../../packages/worker/src/gateway.ts';
import type { GatewayConfig } from '../../../packages/worker/src/gateway.ts';
import { resolve, join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, realpathSync, writeFileSync, lstatSync, copyFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { discover, resolveProgram } from '../../../packages/worker/src/discovery.ts';
import type { Provider } from '../../../packages/worker/src/discovery.ts';
import { executionRegistry } from '../../../packages/worker/src/registry.ts';
import { claudeProfile } from '../../../packages/worker/src/claude.ts';
import type { ApprovedPolicy } from '../../../packages/worker/src/registry.ts';
import { LocalState } from '../../../packages/local/src/state.ts';
import { loadSettings, saveSettings } from '../../../packages/desktop/src/settings.ts';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { privateDirectory } from '../../../packages/core/src/store.ts';
import { requireValue } from '../../../packages/core/src/model.ts';
import { FAKE_PROFILE, FakeAgent } from '../../../packages/worker/src/fake.ts';
import { CodexAgent, codexProfile, inspectCodex } from '../../../packages/worker/src/codex.ts';
import type { CodexPolicy } from '../../../packages/worker/src/codex.ts';
import { WindowsClipboard } from '../../../packages/local/src/clipboard.ts';
import { LocalApp, readImageFile } from '../../../packages/local/src/app.ts';
import { effectiveDelivery } from '../../../packages/local/src/delivery.ts';
import type { DeliveryConfig } from '../../../packages/local/src/delivery.ts';
const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  root: { type: 'string' }, adapter: { type: 'string' }, workspace: { type: 'string' }, codex: { type: 'string' },
  'codex-script': { type: 'string' }, clipboard: { type: 'string' }, save: { type: 'string' }, auto: { type: 'boolean', default: false },
  endpoint: { type: 'string' }, model: { type: 'string' }, 'credential-ref': { type: 'string' },
  'sonnet-model': { type: 'string' }, 'opus-model': { type: 'string' }, 'haiku-model': { type: 'string' },
  'confirm-delete': { type: 'boolean' }, 'attest-vision': { type: 'boolean' },
  provider: { type: 'string' }, path: { type: 'string' },
  force: { type: 'boolean', default: false },
} });
const [command = 'help', argument] = positionals;
const root = resolve(values.root ?? join(process.env.LOCALAPPDATA ?? homedir(), 'Shot2Agent'));
interface Settings { adapter: 'fake' | 'codex'; delivery: DeliveryConfig; codex?: CodexPolicy; agents?: { version: 1; selected: { id: string; version: string }; profiles: ApprovedPolicy[] } }
function log(value: unknown) { process.stdout.write(typeof value === 'string' ? value + '\n' : JSON.stringify(value) + '\n'); }
function program(path: string, script?: string) {
  return script ? { executable: realpathSync(path), args: [realpathSync(script)] } : resolveProgram('codex', path);
}
async function main() {
  if (command === 'help') {
    log('M6: credential-add --root <root> (hidden Windows prompt) | credential-delete --credential-ref <ref> --confirm-delete --root <root> | approve-gateway --path <claude.exe> --endpoint <approved HTTPS URL> --model <model> --credential-ref <ref> [--sonnet-model <model> --opus-model <model> --haiku-model <model>] [--attest-vision: operator asserts separately established image support; not automatic verification]. Stop Worker first.');
    log('M5: discover-agents [--provider codex|claude] [--path <absolute>] | approve-agent --provider codex|claude [--path <absolute>] --root <existing-Codex-root> (stop desktop first). Explicit approval pins a new immutable profile; prior profiles remain.');
    log('Shot2Agent Local: init | doctor | submit | file <image> | work | watch | list | show <id> | copy <id> | delivery <id> | retry-delivery <id>\nOptions: --root <private-dir> (all commands); init: --adapter fake|codex --workspace <dir> --codex <exe-or-npm-cmd> [--codex-script <js>] --clipboard off|manual|smart|always --save <directory>; watch: --auto (explicit cloud upload opt-in); submit/file: --force (intentional duplicate).\nwatch commands: submit, current, list, show <id>, copy <id>, delivery <id>, quit. Defaults: confirmation required, manual clipboard, history always on.'); return;
  }
  if (command === 'discover-agents') {
    const workspace = realpathSync(values.workspace ? resolve(values.workspace) : process.cwd());
    const providers: Provider[] = values.provider ? [values.provider as Provider] : ['codex', 'claude'];
    requireValue(providers.every(p => ['codex', 'claude'].includes(p)), 'INVALID_PROVIDER');
    for (const provider of providers) log(await discover(provider, workspace, { manual: values.path })); return;
  }
  privateDirectory(root); const configPath = join(root, 'settings.json');
  if (command === 'credential-add' || command === 'credential-delete') {
    requireValue(existsSync(configPath), 'SETTINGS_REQUIRED');
    const state = new LocalState(root);
    try {
      state.acquireWorker();
      const reference = command === 'credential-add' ? `Shot2Agent-Gateway-${randomUUID()}` : values['credential-ref'];
      requireValue(reference && (command !== 'credential-delete' || values['confirm-delete']), 'CREDENTIAL_DELETE_CONFIRMATION_REQUIRED');
      const native = credentialCommand(command === 'credential-add' ? 'add' : 'delete', reference);
      const code = await new Promise<number | null>(resolve => {
        const child = spawn(native.executable, native.args, { shell: false, stdio: 'inherit' });
        const timer = setTimeout(() => child.kill(), 300000);
        child.on('error', () => {}); child.on('close', code => { clearTimeout(timer); resolve(code); });
      });
      requireValue(code === 0, 'GATEWAY_SECURE_STORE_OPERATION_FAILED');
      log({ credentialRef: reference, status: command === 'credential-add' ? 'stored_in_windows_credential_manager' : 'deleted_profiles_will_refuse' });
    } finally { state.close(); }
    return;
  }
  if (command === 'approve-agent' || command === 'approve-gateway') {
    requireValue(command === 'approve-gateway' || values.provider === 'codex' || values.provider === 'claude', 'PROVIDER_REQUIRED');
    requireValue(existsSync(configPath), 'ORIGINAL_CODEX_PROFILE_REQUIRED');
    const state = new LocalState(root);
    try {
      state.acquireWorker(); // A running desktop/Worker prevents any approval mutation.
      const next = loadSettings(root); requireValue(next.adapter === 'codex' && next.codex, 'ORIGINAL_CODEX_PROFILE_REQUIRED');
      const provider = command === 'approve-gateway' ? 'claude' : values.provider as Provider;
      const workspace = values.workspace ? realpathSync(resolve(values.workspace)) : next.codex.workspace;
      const candidates = await discover(provider, workspace, { manual: values.path });
      const viable = candidates.filter(c => c.status === 'unverified_auth');
      requireValue(candidates.every(c => c.status !== 'scan_incomplete') && viable.length === 1 && (!values.path || isAbsolute(values.path)), 'EXPLICIT_UNIQUE_CLI_REQUIRED');
      const candidate = viable[0];
      const policy = { id: `${provider}-readonly`, version: `m5-${candidate.digest!.slice(0, 16)}-${randomUUID().slice(0, 8)}`, workspace,
        digest: candidate.digest!, program: candidate.program!, cliVersion: candidate.version!, timeoutMs: 180000, prompt: next.codex.prompt };
      let gateway: GatewayConfig | undefined;
      if (command === 'approve-gateway') {
        requireValue(values.endpoint && values.model && values['credential-ref'], 'GATEWAY_CONFIGURATION_REQUIRED');
        gateway = { kind: 'claude-compatible-endpoint', baseUrl: values.endpoint, model: values.model,
          models: { sonnet: values['sonnet-model'] ?? values.model, opus: values['opus-model'] ?? values.model, haiku: values['haiku-model'] ?? values.model },
          credentialRef: values['credential-ref'], vision: values['attest-vision'] ? 'operator-attested' : 'not-verified' };
        validateGateway(gateway); await readGatewayToken(gateway.credentialRef);
        policy.id = 'claude-gateway-readonly';
      }
      const approved: ApprovedPolicy = provider === 'codex' ? { provider, policy } : { provider: gateway ? 'claude-compatible-endpoint' : 'claude', policy: { ...policy, ...(gateway ? { gateway } : {}), digest: candidate.digest!,
        // Native stdin/image/completion qualified against native Windows 2.1.305/2.1.306 only.
        ...(['2.1.305 (Claude Code)', '2.1.306 (Claude Code)'].includes(candidate.version!) ? { imageProtocol: 'windows-jsonl-v1' as const } : {}) } };
      const profiles: ApprovedPolicy[] = next.agents?.profiles ?? [{ provider: 'codex', policy: next.codex }];
      if (approved.provider === 'codex') codexProfile(approved.policy); else claudeProfile(approved.policy);
      profiles.push(approved); executionRegistry(profiles);
      copyFileSync(configPath, join(root, `settings.m5-backup-${randomUUID()}.json`));
      next.agents = { version: 1, selected: { id: policy.id, version: policy.version }, profiles };
      saveSettings(root, next);
      log({ approved: approved.provider, gateway: gateway ? { endpoint: gateway.baseUrl, model: gateway.model, vision: gateway.vision, credentials: 'available' } : undefined, path: candidate.path, version: candidate.version, profileId: policy.id, profileVersion: policy.version, modelAuthentication: 'unverified', imageProtocol: provider === 'claude' ? ('imageProtocol' in approved.policy ? 'qualified_transport_only' : 'not_verified_execution_refused') : 'existing_codex_protocol' });
    } finally { state.close(); }
    return;
  }
  if (command === 'init') {
    requireValue(!existsSync(configPath), 'ALREADY_INITIALIZED_EDIT_PRIVATE_SETTINGS');
    const adapter = values.adapter ?? 'fake'; const clipboard = values.clipboard ?? 'manual';
    requireValue(['fake', 'codex'].includes(adapter) && ['off', 'manual', 'smart', 'always'].includes(clipboard), 'INVALID_SETTINGS');
    const settings: Settings = { adapter: adapter as Settings['adapter'], delivery: { clipboard: clipboard as DeliveryConfig['clipboard'],
      ...(values.save ? { saveDirectory: resolve(values.save) } : {}) } };
    if (adapter === 'codex') {
      requireValue(values.workspace, 'WORKSPACE_REQUIRED');
      const workspace = realpathSync(resolve(values.workspace));
      const inventory = values.codex ? undefined : await discover('codex', workspace);
      requireValue(!inventory?.some(c => c.status === 'scan_incomplete'), 'EXPLICIT_CLI_PATH_REQUIRED');
      const found = inventory?.filter(c => c.status === 'unverified_auth');
      requireValue(values.codex || found?.length === 1, 'EXPLICIT_UNIQUE_CLI_REQUIRED');
      const approvedProgram = values.codex ? program(resolve(values.codex), values['codex-script']) : found![0].program!;
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
    if (settings.agents) {
      const results = [];
      for (const entry of settings.agents.profiles) results.push(...await discover(entry.provider === 'claude-compatible-endpoint' ? 'claude' : entry.provider, entry.policy.workspace, { approved: { program: entry.policy.program, version: entry.policy.cliVersion, digest: entry.policy.digest } }));
      log({ selected: settings.agents.selected, profiles: results, modelExecution: 'not_tested' }); return;
    }
    if (settings.adapter === 'codex') { requireValue(policy, 'MISSING_CODEX_POLICY'); requireValue(await inspectCodex(policy.program, policy.workspace) === policy.cliVersion, 'CODEX_VERSION_CHANGED_REVIEW_AND_REPIN'); }
    log({ adapter: settings.adapter, version: policy?.cliVersion, platform: process.platform, nativeClipboard: process.platform === 'win32' ? 'requires interactive session acceptance' : 'unavailable', root }); return;
  }
  requireValue(settings.adapter !== 'codex' || policy, 'MISSING_CODEX_POLICY');
  const delivery = effectiveDelivery(settings);
  const needsClipboard = ['submit', 'copy', 'watch'].includes(command) || (['work', 'file'].includes(command) && ['smart', 'always'].includes(delivery.clipboard));
  const clipboard = needsClipboard ? new WindowsClipboard() : undefined;
  const registry = settings.agents ? executionRegistry(settings.agents.profiles) : undefined;
  const selected = registry?.find(e => e.profile.id === settings.agents!.selected.id && e.profile.version === settings.agents!.selected.version);
  requireValue(!registry || selected, 'UNAPPROVED_PROFILE');
  const adapter = selected?.adapter ?? (settings.adapter === 'codex' ? new CodexAgent([policy!]) : new FakeAgent());
  const app = new LocalApp(root, adapter, selected?.profile ?? (settings.adapter === 'codex' ? codexProfile(policy!) : FAKE_PROFILE), delivery, clipboard, registry);
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
      log({ taskId: id ?? null, status: app.lastCaptureStatus, next: 'work or watch' });
    } else if (command === 'work') log({ worked: await app.work(controller.signal) });
    else if (command === 'watch') {
      await app.arm();
      log(`Ready (${settings.adapter}, ${values.auto ? 'AUTO submission enabled' : 'confirm: type submit after screenshot'}). Commands: submit, current, list, show ID, copy ID, delivery ID, quit. No Relay/HTTP. Minimize this console; it will not activate windows.`);
      const input = createInterface({ input: process.stdin, output: process.stdout });
      let commands = Promise.resolve(); let worker: Promise<unknown> | undefined;
      input.on('line', line => { commands = commands.then(async () => {
        const [action, id] = line.trim().split(/\s+/);
        try {
          if (action === 'quit') { stop(); input.close(); }
          else if (action === 'submit' || action === 'current') { const taskId = await app.capture(values.force, action === 'current'); log({ taskId: taskId ?? null, status: app.lastCaptureStatus }); }
          else await actions(action, id);
        } catch (error) {
          const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'LOCAL_OPERATION_FAILED';
          log(`Action failed: ${code}. Use list / delivery ID to inspect status.`);
        }
      }); });
      input.on('close', stop);
      try {
        while (!controller.signal.aborted) {
          try {
            const event = await app.observe(values.auto);
            if (event.image) log(event.id ? { queued: event.id } : (values.auto ? 'Image ignored: duplicate within 5 seconds.' : 'Image staged in memory; type submit to confirm, or current to read the clipboard again.'));
          } catch { log('Clipboard unavailable/busy/oversized; will retry. Use submit as fallback.'); }
          if (!worker) {
            worker = app.work(controller.signal).then(worked => { if (worked) log('Task processed. Type list for status; show ID / copy ID / delivery ID.'); })
              .catch(error => log(error instanceof Error && error.message === 'AGENT_STOP_UNCONFIRMED'
                ? 'AGENT_STOP_UNCONFIRMED: processing paused. Inspect/stop the old Agent before restarting; history/copy remain available.'
                : 'Worker/storage error; inspect list before resubmitting. Started tasks may become execution_unknown.'))
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
