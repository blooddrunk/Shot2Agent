// Local operator utility. Run from the portable package after exiting Shot2Agent.
import { spawn } from 'node:child_process';
import console from 'node:console';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { credentialCommand, readGatewayToken, validateGateway } from './runtime/dist/packages/worker/src/gateway.js';
import { claudeProfile } from './runtime/dist/packages/worker/src/claude.js';
import { programDigest } from './runtime/dist/packages/worker/src/discovery.js';
import { executionRegistry } from './runtime/dist/packages/worker/src/registry.js';
import { LocalState } from './runtime/dist/packages/local/src/state.js';
import { loadSettings, saveSettings } from './runtime/dist/packages/desktop/src/settings.js';
const check = (value, code) => { if (!value) throw Error(code); };
const run = (exe, args, env = process.env) => new Promise((resolve, reject) => {
 const child = spawn(exe, args, { env, shell: false, stdio: 'inherit', windowsHide: false });
 const timer = setTimeout(() => child.kill(), 300000);
 child.on('error', () => {});
 child.on('close', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(Error('LOCAL_STEP_FAILED_NO_RETRY')); });
});
const root = join(process.env.LOCALAPPDATA ?? '', 'Shot2Agent-Codex');
const here = new URL('./', import.meta.url);
let state;
try {
 check(process.platform === 'win32' && (process.argv.includes('--repair-and-test') || process.argv.includes('--check-only')), 'EXPLICIT_LOCAL_REPAIR_REQUIRED');
 check(existsSync(join(root, 'settings.json')), 'EXISTING_PROFILE_REQUIRED');
 const settings = loadSettings(root);
 const prior = settings.agents?.profiles.find(p => p.policy.id === settings.agents.selected.id && p.policy.version === settings.agents.selected.version);
 check(prior?.provider === 'claude-compatible-endpoint', 'SELECT_GLM_GATEWAY_PROFILE_FIRST');
 const g = prior.policy.gateway;
 validateGateway(g);
 check(g.baseUrl === 'https://open.bigmodel.cn/api/anthropic' && [g.model, ...Object.values(g.models)].every(m => m === 'glm-5.3-flash'), 'GLM_5_3_FLASH_DOMESTIC_PROFILE_REQUIRED');
 check(settings.agents.profiles.length <= 30, 'PROFILE_REGISTRY_CAPACITY_REQUIRED');
 claudeProfile(prior.policy);
 check(programDigest(prior.policy.program) === prior.policy.digest, 'CLAUDE_VERSION_CHANGED');
 const receiptFile = new URL('GLM-ONCE-RECEIPT.json', here);
 if (existsSync(receiptFile)) check(JSON.parse(readFileSync(receiptFile, 'utf8')).requestsSent === 0, 'ONE_REQUEST_ALREADY_RESERVED_NO_RETRY');
 check(!existsSync(new URL('GLM-ONCE-RUNNING.lock', here)), 'TEST_ALREADY_RUNNING_OR_INTERRUPTED');
 state = new LocalState(root); state.acquireWorker();
 if (process.argv.includes('--check-only')) {
  console.log('PASS_REPAIR_PREFLIGHT_NO_CREDENTIAL_OR_MODEL_ACCESS');
 } else {
  console.log('请在下方隐藏提示中输入 GLM Token。不要在聊天中发送 Token。');
  console.log('将新增 Windows 安全凭据引用；保留原凭据和所有历史任务。');
  const reference = `Shot2Agent-Gateway-${randomUUID()}`;
  const command = credentialCommand('add', reference);
  await run(command.executable, command.args, command.env);
  await readGatewayToken(reference); // Availability only; the token is never printed or saved as plaintext.
  const bind = vision => {
   const policy = JSON.parse(JSON.stringify(prior.policy));
   policy.version = `m6-${randomUUID()}`;
   policy.gateway = { ...policy.gateway, credentialRef: reference, vision };
   const approved = { provider: 'claude-compatible-endpoint', policy };
   const next = loadSettings(root);
   check(next.agents.selected.id === settings.agents.selected.id && next.agents.selected.version === settings.agents.selected.version, 'PROFILE_CHANGED_DURING_REPAIR');
   const old = { ...next.agents.selected };
   next.agents.profiles.push(approved);
   next.agents.selected = { id: policy.id, version: policy.version };
   next.agents.archived = [...(next.agents.archived ?? []).filter(p => p.id !== old.id || p.version !== old.version), old];
   executionRegistry(next.agents.profiles);
   copyFileSync(join(root, 'settings.json'), join(root, `settings.credential-repair-backup-${randomUUID()}.json`));
   saveSettings(root, next);
   settings.agents.selected = { ...next.agents.selected };
   return policy;
  };
  const bound = bind('not-verified');
  console.log('安全凭据已绑定。现在只执行已授权的一次合成截图请求；不重试、不切换模型。');
  await run(process.execPath, [fileURLToPath(new URL('Verify GLM vision once.mjs', here)), '--authorized-once']);
  const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
  check(receipt.status === 'PASS_DIRECT_ENDPOINT_IMAGE_RECOGNITION' && receipt.requestsSent === 1 && receipt.model === 'glm-5.3-flash' && receipt.markerRecognized === true, 'VISION_TEST_NOT_PASSED_NO_RETRY');
  check(loadSettings(root).agents.selected.version === bound.version, 'PROFILE_CHANGED_DURING_TEST');
  console.log('直接端点已识别合成文字 SHOT2AGENT 42。原生 Claude CLI 的真实端点行为仍未验证。');
  console.log('如你确认用此次直接识图证据声明该网关的视觉支持，并允许之后由你提交的新截图使用此配置，输入 YES。');
  console.log('这记录操作人员声明，不代表 Claude CLI 已通过真实请求验证；现在不会再请求模型。回车则保留拒绝状态。');
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await input.question('确认并启用新任务 Profile [YES/回车]: '); input.close();
  if (answer.trim() === 'YES') { bind('operator-attested'); console.log('已保存新的操作人员声明版本。可重新打开 Start Codex.cmd；无需再次批准。'); }
  else console.log('保留 not-verified；未启用正式截图请求。');
 }
} catch (error) {
 const code = /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'LOCAL_REPAIR_FAILED';
 console.error(code);
 console.error('若提示 LOCAL_WORKER_ALREADY_RUNNING，请从托盘退出 Shot2Agent 后再运行。不要重复添加 Profile 或删除 Token。');
 process.exitCode = 1;
} finally { state?.close(); }
