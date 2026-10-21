<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

type Receipt = { status: string; code?: string; attempts: number; classification?: string; stopReason?: string };
type Task = { id: string; status: string; provider?: string; profileId?: string; summary?: string; error?: string; clipboard?: Receipt; save?: Receipt };
type Hotkeys = Record<string, string>;
type Agent = { id: string; version: string; provider: string; archived: boolean; historical: boolean; referenced: boolean; removable: boolean; deletable: boolean;
  path?: string; workspace?: string; prompt?: string; cliVersion?: string; gateway?: { endpoint: string; model: string; vision: string; credentialStatus: string; connectionStatus: string } };
type Discovery = { provider: string; path: string; selectionPath?: string; version?: string; status: string };
type Snapshot = { hotkeys: Hotkeys; hotkeyStatus?: string; lastAction?: { action: string; status: string }; lastHistoryCleanup?: { deleted: number; preservedActive: number; preservedUnknown: number };
  launchMode: string; root: string; status: string; setupRequired: boolean; workspaceSuggestion: string; error?: string; total: number; pending: string | null; captureStatus: string;
  settings: { enabled: boolean; mode: string; paused: boolean; autoConsent: boolean; alwaysConsent: boolean };
  delivery: { clipboard: string; saveDirectory?: string; retry?: { maxRetries: number; backoffMs: number; budgetMs: number } };
  agents: Agent[]; discovery: Discovery[]; profile: { adapter: string; id: string; profileVersion?: string; workspace?: string; version?: string; sandbox: string }; tasks: Task[] };

const globalActions = [{ id: 'toggle-pause', label: '暂停 / 恢复捕获' }, { id: 'copy-latest', label: '复制最新成功结果' }, { id: 'retry-latest-delivery', label: '重试最新失败投递' }, { id: 'cycle-agent', label: '循环切换 Agent' }, { id: 'current', label: '提交当前剪贴板图片' }];
const providerText: Record<string, string> = { fake: 'Fake · 合成测试', codex: 'Codex CLI', claude: 'Claude Code', 'claude-compatible-endpoint': 'Claude Code · GLM 网关' };
const modeText: Record<string, string> = { codex: 'Local', staging: 'Fake 验收', legacy: '旧 Local 历史' };
const cliStatusText: Record<string, string> = { not_found: '未安装', invalid: '路径无效', unsupported: '功能不兼容', version_changed: '版本或文件已变化', unverified_auth: '已发现', scan_incomplete: '检测未完成' };
const statusText: Record<string, string> = { monitoring: '正在监听新图片', paused: '捕获已暂停', capture_off: '捕获已关闭', setup_required: '先选择或配置一个 Agent', worker_error: 'Worker 已停止 · 请检查后重启', capture_error: '剪贴板读取暂停 · 可重新连接' };
const errorText: Record<string, string> = {
  LOCAL_OPERATION_FAILED: '本地操作未完成。若刚确认了 GLM 合成图片测试，请先不要重复提交，以免重复请求。',
  WORKSPACE_PATH_UNAVAILABLE: '所选工作区不存在或无法访问，请用“选择文件夹…”选一个本机上可访问的文件夹。',
  WORKSPACE_CREATE_FAILED: '无法创建默认工作区，请改选一个有权限访问的本机文件夹。',
  GATEWAY_CREDENTIAL_STORE_FAILED: 'Windows 凭据管理器未能保存或读回 Token；尚未发送 GLM 测试请求。',
  GATEWAY_SECURE_STORE_OPERATION_FAILED: 'Windows 凭据管理器操作失败；Agent 配置未保存。',
  GATEWAY_CREDENTIAL_VERIFY_FAILED: 'Token 保存后无法从 Windows 凭据管理器读回；Agent 配置未保存。',
  GATEWAY_AUTH_FAILED: 'GLM 拒绝了这个 Token，请检查后在此窗口重新输入。',
  GATEWAY_ENDPOINT_FAILED: 'GLM 端点或模型返回错误，请检查所选地区和模型名称。',
  GATEWAY_REQUEST_FAILED: '无法完成 GLM 请求。若刚确认测试，请先不要连续重试；服务端可能已经收到请求。',
  GATEWAY_SYNTHETIC_VISION_FAILED: 'GLM 未能识别测试图片中的标记；请检查模型是否支持图片输入。',
  GATEWAY_SYNTHETIC_TEST_FAILED: 'GLM 合成图片测试未完成。若刚确认测试，请先不要重复提交；服务端可能已经收到请求。',
  PROFILE_SETTINGS_SAVE_FAILED: 'Agent 配置无法保存到本机设置。请确认应用数据目录可写。',
};
const data = ref<Snapshot>(); const transportError = ref(''); const error = ref(''); const message = ref(''); const busy = ref(false);
const enabled = ref(false); const mode = ref('confirm'); const clipboard = ref('always'); const save = ref(false); const directory = ref('');
const maxRetries = ref(0); const backoffMs = ref(100); const budgetMs = ref(3000); const autoConsent = ref(false); const alwaysConsent = ref(false); const dirty = ref(false);
const hotkeys = ref<Hotkeys>({}); const hotkeyDirty = ref(false); const showAdvanced = ref(false); const showProfileForm = ref(false); const profileDirty = ref(false);
const setupProvider = ref('claude-compatible-endpoint'); const profileId = ref('claude-gateway-readonly'); const cliPath = ref(''); const workspace = ref('');
const reuseExisting = ref(false);
const prompt = ref('Analyze the screenshot and return a concise, useful Markdown explanation.'); const endpoint = ref('https://open.bigmodel.cn/api/anthropic'); const model = ref('glm-5.3-flash'); const token = ref('');
const editId = ref(''); const editVersion = ref(''); const selectedTasks = ref<string[]>([]); const detail = ref<{ status: string; gateway?: { endpoint: string; model: string; vision: string }; result?: { contentMarkdown: string; errorCode?: string } }>();
let timer: ReturnType<typeof setInterval> | undefined; let polling = false;
const activeProfiles = computed(() => data.value?.agents.filter(a => !a.archived && !a.historical) ?? []);
const removedProfiles = computed(() => data.value?.agents.filter(a => a.archived) ?? []);
const historicalProfiles = computed(() => data.value?.agents.filter(a => !a.archived && a.historical) ?? []);
const selectableProfiles = computed(() => activeProfiles.value);
const selectedAgent = computed(() => data.value?.agents.find(isSelectedAgent));
const safeTasks = computed(() => data.value?.tasks.filter(t => ['succeeded', 'failed', 'timed_out', 'canceled'].includes(t.status)) ?? []);
function isSelectedAgent(agent: Agent) { return agent.id === data.value?.profile.id && agent.version === data.value?.profile.profileVersion; }
function isDeletable(task: Task) { return ['succeeded', 'failed', 'timed_out', 'canceled'].includes(task.status); }
function providerForDiscovery() { return setupProvider.value === 'codex' ? 'codex' : 'claude'; }
function chooseDetectedPath() {
  const candidate = data.value?.discovery.find(c => c.provider === providerForDiscovery() && c.status === 'unverified_auth' && c.path);
  if (candidate) cliPath.value = candidate.selectionPath ?? candidate.path;
}
function hydrate(snapshot: Snapshot) {
  data.value = snapshot;
  if (!hotkeyDirty.value) hotkeys.value = { ...snapshot.hotkeys };
  if (!dirty.value) { enabled.value = snapshot.settings.enabled; mode.value = snapshot.settings.mode; clipboard.value = snapshot.delivery.clipboard;
    maxRetries.value = snapshot.delivery.retry?.maxRetries ?? 0; backoffMs.value = snapshot.delivery.retry?.backoffMs ?? 100; budgetMs.value = snapshot.delivery.retry?.budgetMs ?? 3000;
    save.value = !!snapshot.delivery.saveDirectory; directory.value = snapshot.delivery.saveDirectory ?? ''; autoConsent.value = snapshot.settings.autoConsent; alwaysConsent.value = snapshot.settings.alwaysConsent; }
  if (!profileDirty.value) {
    if (!workspace.value) workspace.value = snapshot.workspaceSuggestion;
    if (!cliPath.value) chooseDetectedPath();
  }
  const present = new Set(snapshot.tasks.map(task => task.id)); selectedTasks.value = selectedTasks.value.filter(id => present.has(id));
}
async function rpc(command: string, args: Record<string, unknown> = {}) {
  const response = await invoke<{ ok: boolean; value: unknown; error?: string }>('rpc', { request: { v: 1, command, ...args } });
  if (!response.ok) throw new Error(response.error ?? 'LOCAL_OPERATION_FAILED');
  return response.value;
}
async function refresh() {
  if (polling || busy.value) return; polling = true;
  try { hydrate(await rpc('snapshot') as Snapshot); transportError.value = ''; }
  catch (e) { if (!transportError.value) transportError.value = String(e); }
  finally { polling = false; }
}
async function action(command: string, args: Record<string, unknown> = {}) {
  if (busy.value) return; busy.value = true; error.value = ''; message.value = '';
  try {
    const result = await rpc(command, args);
    if (command === 'detail') detail.value = result as typeof detail.value;
    else if (command !== 'quit') hydrate(result as Snapshot);
    if (command === 'create-profile') { token.value = ''; editId.value = ''; editVersion.value = ''; reuseExisting.value = false; profileDirty.value = false; showProfileForm.value = false; message.value = 'Agent 已保存并设为新任务默认项。已有任务仍绑定原配置。'; }
    if (command === 'archive-agent') message.value = args.archived ? '已从新任务列表移除。已有任务仍保留此配置，可恢复。'
      : data.value?.profile.id === args.id && data.value?.profile.profileVersion === args.version ? '已恢复并设为该 Agent 的默认版本。' : '已恢复到新任务列表；默认 Agent 保持不变。';
    if (command === 'delete-agent' || command === 'cleanup-unused-agents') message.value = '未被任务引用的旧配置已清理；仍被任务或其他配置引用的项目已保留。';
    if (command === 'credential-status') message.value = '凭据状态已检查；Token 不会显示。';
    if (command === 'delete-history') { selectedTasks.value = []; detail.value = undefined; message.value = '任务历史及应用私有文件已删除。已保存到其他目录的 Markdown 文件不会被删除。'; }
    if (command === 'clear-history') { selectedTasks.value = []; detail.value = undefined; const cleanup = (result as Snapshot).lastHistoryCleanup; message.value = `删除 ${cleanup?.deleted ?? 0} 项；保留 ${cleanup?.preservedActive ?? 0} 个排队或运行任务，以及 ${cleanup?.preservedUnknown ?? 0} 个结果不确定任务。`; }
    if (command === 'copy') message.value = '已复制结果，可以粘贴。';
    if (command === 'discard') message.value = '已丢弃预览，没有创建任务。';
    if (command === 'submit' || command === 'current') message.value = data.value?.captureStatus === 'duplicate' ? '5 秒内的相同图片已忽略。' : data.value?.captureStatus === 'no_image' ? '当前剪贴板没有图片。' : '图片已提交到本地队列。';
  } catch (e) {
    const code = e instanceof Error ? e.message : String(e);
    error.value = errorText[code] ? `${code}：${errorText[code]}` : code;
  }
  finally { busy.value = false; }
}
async function pickExecutable() {
  const path = await open({ title: '选择 Codex 或 Claude CLI', multiple: false, filters: [{ name: 'CLI', extensions: ['exe', 'cmd', 'ps1'] }] });
  if (typeof path === 'string') { cliPath.value = path; reuseExisting.value = false; profileDirty.value = true; }
}
async function pickWorkspace() {
  const path = await open({ title: '选择只读工作区', directory: true, multiple: false });
  if (typeof path === 'string') { workspace.value = path; profileDirty.value = true; }
}
function providerChanged() { profileDirty.value = true; reuseExisting.value = false; cliPath.value = ''; chooseDetectedPath(); }
function selectExecutable(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (value === '__current__') reuseExisting.value = true;
  else { reuseExisting.value = false; cliPath.value = value; }
  profileDirty.value = true;
}
function editProfile(agent: Agent) {
  setupProvider.value = agent.provider; profileId.value = agent.id; cliPath.value = agent.path ?? ''; workspace.value = agent.workspace ?? data.value?.workspaceSuggestion ?? '';
  reuseExisting.value = true; prompt.value = agent.prompt ?? prompt.value; endpoint.value = agent.gateway?.endpoint ?? endpoint.value; model.value = agent.gateway?.model ?? model.value;
  token.value = ''; editId.value = agent.id; editVersion.value = agent.version; profileDirty.value = true; showProfileForm.value = true;
}
function addProfile() {
  setupProvider.value = 'claude-compatible-endpoint'; profileId.value = 'glm-personal'; cliPath.value = ''; reuseExisting.value = false;
  editId.value = ''; editVersion.value = ''; token.value = ''; prompt.value = 'Analyze the screenshot and return a concise, useful Markdown explanation.';
  chooseDetectedPath(); showProfileForm.value = true;
}
async function saveProfile() {
  if (!reuseExisting.value && !cliPath.value.trim()) { error.value = '请选择已安装的 Codex CLI 或 Claude Code。'; return; }
  if (!workspace.value.trim()) { error.value = '请选择一个工作区。'; return; }
  if (setupProvider.value === 'claude-compatible-endpoint' && !token.value && !editVersion.value) { error.value = '请输入 GLM Token。'; return; }
  const gateway = setupProvider.value === 'claude-compatible-endpoint';
  if (gateway && !window.confirm('将向所选 GLM 端点发送一张随程序提供的合成图片（不是个人截图）进行一次视觉测试。提供方可能对此请求收费；不会重试。若识别成功，Shot2Agent 会保存 Token 并启用此 Profile 供之后的新任务使用。是否继续？')) return;
  await action('create-profile', { provider: setupProvider.value, id: profileId.value.trim(), path: cliPath.value.trim(), workspace: workspace.value.trim(), prompt: prompt.value,
    reuseExisting: reuseExisting.value, ...(gateway ? { endpoint: endpoint.value, model: model.value, token: token.value, enableAfterTest: true } : {}),
    ...(editVersion.value ? { editId: editId.value, editVersion: editVersion.value } : {}) });
}
async function applyHotkeys() {
  await action('configure-hotkeys', { hotkeys: Object.fromEntries(Object.entries(hotkeys.value).filter(([, key]) => key)) });
  if (!error.value) { hotkeyDirty.value = false; message.value = '快捷键已保存。隐藏到托盘后仍有效。'; await refresh(); }
}
async function apply() {
  if (save.value && !directory.value.trim()) { error.value = '请填写本地保存目录。'; return; }
  await action('configure', { capture: { enabled: enabled.value, mode: mode.value }, autoConsent: autoConsent.value, alwaysConsent: alwaysConsent.value,
    delivery: { clipboard: clipboard.value, retry: { maxRetries: maxRetries.value, backoffMs: backoffMs.value, budgetMs: budgetMs.value }, ...(save.value ? { saveDirectory: directory.value.trim() } : {}) } });
  if (!error.value) { dirty.value = false; message.value = '设置已保存。从下一次剪贴板变化开始监听。'; await refresh(); }
}
async function pickSaveDirectory() {
  const path = await open({ title: '选择 Markdown 保存目录', directory: true, multiple: false });
  if (typeof path === 'string') { directory.value = path; dirty.value = true; }
}
async function openTask(id: string) {
  if (busy.value) return; busy.value = true; error.value = ''; detail.value = undefined;
  try { detail.value = await rpc('detail', { id }) as NonNullable<typeof detail.value>; }
  catch (e) { error.value = String(e); } finally { busy.value = false; }
}
function toggleTask(id: string, checked: boolean) { selectedTasks.value = checked ? [...new Set([...selectedTasks.value, id])] : selectedTasks.value.filter(value => value !== id); }
function selectVisibleTasks() { selectedTasks.value = safeTasks.value.map(task => task.id); }
function deleteTask(id: string) {
  if (window.confirm('删除此任务的本地历史、截图、结果附件和投递记录？已保存到其他目录的 Markdown 不会删除。')) void action('delete-history', { ids: [id] });
}
function deleteSelectedTasks() {
  if (selectedTasks.value.length && window.confirm(`永久删除选中的 ${selectedTasks.value.length} 项本地任务数据？`)) void action('delete-history', { ids: [...selectedTasks.value] });
}
function clearHistory(scope: 'completed' | 'all-safe') {
  const message = scope === 'completed' ? '删除所有成功任务的本地历史和私有文件？' : '删除所有可安全删除的终态任务？排队、运行中及结果不确定的任务会保留。';
  if (window.confirm(`${message}\n已保存在其他目录的 Markdown 不会删除。`)) void action('clear-history', { mode: scope });
}
function archive(agent: Agent, archived: boolean) { void action('archive-agent', { id: agent.id, version: agent.version, archived, confirm: true }); }
function permanentlyDelete(agent: Agent) {
  if (agent.referenced) { error.value = 'PROFILE_REFERENCED_BY_TASK'; return; }
  if (window.confirm(`永久删除 ${agent.id} 的未引用配置？如没有其他 Profile 使用其凭据，也会从 Windows Credential Manager 删除该凭据。`)) void action('delete-agent', { id: agent.id, version: agent.version, confirm: true });
}
onMounted(() => { void refresh(); timer = setInterval(() => { void refresh(); }, 1000); });
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <header>
    <div class="identity"><svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><path d="M3 12V4h8M21 4h8v8M29 21v8h-8M11 29H3v-8" fill="none" stroke="currentColor" stroke-width="3"/><path d="m11 17 4 4 7-10" fill="none" stroke="currentColor" stroke-width="2"/></svg><div><h1>Shot2Agent</h1><p>{{ data ? modeText[data.launchMode] : '正在连接' }} · Local，无需 Relay</p></div></div>
    <div class="header-actions"><button @click="invoke('hide_window')">隐藏到托盘</button><button @click="action('quit')" :disabled="busy">退出</button></div>
  </header>
  <main>
    <div class="statusbar" role="status"><span class="dot" :class="{ active: data?.status === 'monitoring' }"></span><strong>{{ data ? statusText[data.status] : '正在打开本地应用…' }}</strong><button v-if="data && !data.setupRequired" @click="action('pause', { paused: !data.settings.paused })" :disabled="busy">{{ data.settings.paused ? '恢复捕获' : '暂停捕获' }}</button></div>
    <p v-if="error || transportError || data?.error" class="error" role="alert">{{ error || transportError || data?.error }} <button v-if="data?.status === 'capture_error'" @click="action('recover')">重新连接剪贴板</button></p>
    <p v-if="message" class="notice" role="status">{{ message }}</p>
    <p v-if="data?.setupRequired" class="notice">首次使用：选择已安装的 Agent，指定或使用默认工作区，然后保存。此步骤不会发送截图或请求模型。</p>

    <section class="profile setup-card" v-if="data && (data.setupRequired || showProfileForm)" aria-label="Agent 配置">
      <div class="section-heading"><h2>{{ data.setupRequired ? '设置默认 Agent' : editVersion ? '编辑 Agent 配置' : '添加 Agent' }}</h2><button v-if="!data.setupRequired" @click="showProfileForm = false; profileDirty = false">收起</button></div>
      <form @submit.prevent="saveProfile" @input="profileDirty = true">
        <label>Agent 类型<select v-model="setupProvider" @change="providerChanged"><option value="codex">Codex CLI</option><option value="claude">Claude Code 个人登录</option><option value="claude-compatible-endpoint">Claude Code + GLM Gateway</option></select></label>
        <label>本机安装<select :value="reuseExisting ? '__current__' : cliPath" @change="selectExecutable"><option v-if="reuseExisting" value="__current__">使用当前已批准的 CLI 安装</option><option value="">选择已发现的安装，或手动选文件</option><option v-for="(candidate, index) in data.discovery.filter(c => c.provider === providerForDiscovery() && c.status === 'unverified_auth')" :key="index" :value="candidate.selectionPath || candidate.path">{{ candidate.version }} · {{ candidate.path }}</option></select></label>
        <div class="profile-actions"><button type="button" @click="pickExecutable">浏览 CLI 程序…</button><span class="hint path">{{ cliPath || '尚未选择 CLI' }}</span></div>
        <label>工作区<input type="text" v-model="workspace" placeholder="选择一个只读工作区" spellcheck="false"></label>
        <div class="profile-actions"><button type="button" @click="pickWorkspace">选择文件夹…</button><button type="button" @click="workspace = data.workspaceSuggestion">使用 Shot2Agent 默认工作区</button></div>
        <label>Agent 名称<input type="text" v-model="profileId" placeholder="例如 my-codex" spellcheck="false"></label>
        <label>默认提示词<textarea v-model="prompt" rows="3" maxlength="10000"></textarea></label>
        <template v-if="setupProvider === 'claude-compatible-endpoint'">
          <label>GLM Endpoint<select v-model="endpoint"><option value="https://open.bigmodel.cn/api/anthropic">国内 · BigModel</option><option value="https://api.z.ai/api/anthropic">国际 · Z.ai</option></select></label>
          <label>模型<input type="text" v-model="model" placeholder="glm-5.3-flash" spellcheck="false"></label>
          <label>GLM Token（仅输入；不会回显或保存为明文）<input type="password" v-model="token" autocomplete="new-password" spellcheck="false" placeholder="输入新 Token；编辑时留空可沿用已保存凭据"></label>
          <p class="hint">保存时会发送随程序提供的合成图片做一次视觉测试。此请求可能产生费用；个人截图不会用于测试，也不会自动重试。识别成功后 Token 保存到 Windows Credential Manager，Profile 会启用该模型；该状态只表示本次端点与合成图片测试通过。</p>
        </template>
          <div class="profile-actions"><button class="primary" type="submit" :disabled="busy || !data">{{ busy ? '正在检查…' : setupProvider === 'claude-compatible-endpoint' ? '保存并测试合成图片' : '保存并设为默认 Agent' }}</button><button v-if="!data.setupRequired" type="button" @click="showProfileForm = false; editId = ''; editVersion = ''; reuseExisting = false; profileDirty = false">取消</button></div>
      </form>
    </section>

    <div class="columns">
      <section class="controls" aria-label="Agent、捕获和结果设置">
        <div v-if="data && !data.setupRequired" class="profile-selection">
          <h2>新任务 Agent</h2>
          <select :value="data.profile.id + ':' + data.profile.profileVersion" :disabled="busy || selectableProfiles.length < 2" @change="(event) => { const agent = selectableProfiles.find(a => a.id + ':' + a.version === (event.target as HTMLSelectElement).value); if (agent) action('select-agent', { id: agent.id, version: agent.version }); }">
            <option v-for="agent in selectableProfiles" :key="agent.id + agent.version" :value="agent.id + ':' + agent.version">{{ providerText[agent.provider] || agent.provider }} · {{ agent.id }}</option>
          </select>
          <p class="hint">切换只影响之后提交的新图片。排队任务和历史继续使用创建时的配置。</p>
          <p v-if="selectedAgent" class="hint">{{ providerText[selectedAgent.provider] || selectedAgent.provider }} · {{ selectedAgent.id }}<template v-if="selectedAgent.gateway"> · 凭据：{{ selectedAgent.gateway.credentialStatus }} · 连接：{{ selectedAgent.gateway.connectionStatus }}</template></p>
          <div class="profile-actions"><button v-if="selectedAgent" type="button" @click="editProfile(selectedAgent)">编辑当前 Agent / 修复 Token</button><button type="button" @click="addProfile">添加 Agent</button></div>
        </div>

        <h2>捕获</h2>
        <form @submit.prevent="apply" @change="dirty = true" @input="dirty = true">
          <label class="check"><input type="checkbox" v-model="enabled" :disabled="data?.setupRequired">监听剪贴板中的新图片</label>
          <label>提交方式<select v-model="mode"><option value="confirm">确认后提交</option><option value="auto">自动提交</option></select></label>
          <label v-if="mode === 'auto'" class="consent"><input type="checkbox" v-model="autoConsent">我同意新截图自动发送给所选 Agent。云模型会收到图片。</label>
          <p class="hint">启动和恢复时会跳过已存在的图片。确认预览只保留在内存。</p>
          <h2>结果去向</h2><p class="hint">历史始终保留。剪贴板返回和 Markdown 保存可同时启用。</p>
          <label>剪贴板返回<select v-model="clipboard"><option value="off">关闭</option><option value="manual">手动复制</option><option value="smart">Smart · 保护后来复制的内容</option><option value="always">Always · 总是覆盖</option></select></label>
          <label v-if="clipboard === 'always'" class="consent"><input type="checkbox" v-model="alwaysConsent">我同意结果自动覆盖剪贴板。</label>
          <label class="check"><input type="checkbox" v-model="save">自动保存 Markdown</label>
          <template v-if="save"><label>本地保存目录<input type="text" v-model="directory" placeholder="D:\Shot2Agent Results" spellcheck="false"></label><button type="button" @click="pickSaveDirectory">选择文件夹…</button></template>
          <button class="primary" type="submit" :disabled="busy || !data">应用设置</button><span v-if="dirty" class="hint unsaved">尚未保存</span>
        </form>
        <details v-if="data && !data.setupRequired" class="profile-management"><summary>管理 Agent 配置与 Token</summary>
          <p class="hint">默认选择只影响新任务；已有任务继续使用创建时的配置。历史版本保留到没有任务引用时。Token 不会显示。</p>
          <div v-for="agent in activeProfiles" :key="agent.id + agent.version" class="profile-entry">
            <strong>{{ providerText[agent.provider] || agent.provider }} · {{ agent.id }}</strong><p v-if="agent.gateway" class="hint">{{ agent.gateway.endpoint }} · {{ agent.gateway.model }} · 凭据：{{ agent.gateway.credentialStatus }} · 测试：{{ agent.gateway.connectionStatus }}</p>
            <div class="profile-actions"><button @click="editProfile(agent)">编辑 / 修复 Token</button><button v-if="agent.gateway" @click="action('credential-status', { id: agent.id, version: agent.version })">检查凭据</button><button :disabled="busy || !agent.removable" @click="archive(agent, true)">从新任务列表移除</button></div>
          </div>
          <details v-if="removedProfiles.length"><summary>已移除配置（{{ removedProfiles.length }}）</summary><div v-for="agent in removedProfiles" :key="agent.id + agent.version" class="profile-entry"><p>{{ providerText[agent.provider] || agent.provider }} · {{ agent.id }} <span v-if="agent.referenced">· 有历史任务引用</span></p><button @click="archive(agent, false)">恢复到新任务列表</button><button v-if="agent.deletable" @click="permanentlyDelete(agent)">永久删除</button></div></details>
          <details v-if="historicalProfiles.length"><summary>历史版本（{{ historicalProfiles.length }}）</summary><div v-for="agent in historicalProfiles" :key="agent.id + agent.version" class="profile-entry"><p>{{ agent.id }} <span v-if="agent.referenced">· {{ data?.tasks.filter(t => t.profileId === agent.id).length || '已有' }} 个任务引用</span><span v-else>· 未被任务引用</span></p><button v-if="agent.deletable" @click="permanentlyDelete(agent)">永久删除未引用版本</button></div><button @click="action('cleanup-unused-agents')">清理所有未引用历史版本</button></details>
          <button @click="action('discover-agents')">重新检测 Codex / Claude</button>
        </details>
        <details class="advanced"><summary>高级设置</summary>
          <details><summary>投递失败重试</summary><p class="hint">只重试可确认的暂时失败；不会重新执行 Agent。</p>
            <label>额外尝试次数<input type="number" v-model.number="maxRetries" min="0" max="10" step="1"></label>
            <label>初始等待（毫秒）<input type="number" v-model.number="backoffMs" min="10" max="1000" step="1"></label>
            <label>每通道时间预算（毫秒）<input type="number" v-model.number="budgetMs" min="100" max="10000" step="1"></label>
          </details>
          <details><summary>安装路径和检测结果</summary><div v-for="(candidate, index) in data?.discovery" :key="index" class="hint path">{{ candidate.provider }} · {{ candidate.version || '' }} · {{ cliStatusText[candidate.status] || candidate.status }} · {{ candidate.path }}</div></details>
          <details class="hotkeys"><summary>全局快捷键与操作</summary>
            <p class="hint">默认关闭。支持 Ctrl+Alt、Ctrl+Shift 或 Alt+Shift 加字母/数字。</p>
            <form @submit.prevent="applyHotkeys"><label v-for="item in globalActions" :key="item.id">{{ item.label }}<input type="text" v-model="hotkeys[item.id]" @input="hotkeyDirty = true" placeholder="未启用" spellcheck="false"></label><button type="submit" :disabled="busy || !data">保存快捷键</button></form>
            <p class="hint">原生状态：{{ data?.hotkeyStatus || '尚未连接' }} <span v-if="hotkeyDirty">· 尚未保存</span></p>
            <div v-for="item in globalActions" :key="item.id"><button :disabled="busy || !data" @click="action('action', { action: item.id })">{{ item.label }}</button></div>
            <p v-if="data?.lastAction" class="hint">{{ globalActions.find(a => a.id === data?.lastAction?.action)?.label }}：{{ data.lastAction.status }}</p>
          </details>
          <details><summary>本地数据位置</summary><p class="path">{{ data?.root }}</p></details>
        </details>
      </section>

      <section class="workspace" aria-label="当前图片与本地历史">
        <div class="section-heading"><h2>当前图片</h2><button @click="action('current')" :disabled="busy || !data || data.setupRequired">提交当前剪贴板图片</button></div>
        <div class="preview" v-if="data?.pending"><img :src="data.pending" alt="待确认的截图预览"><div><strong>等待确认</strong><p>仅此预览会被提交。</p><button class="primary" @click="action('submit')" :disabled="busy">提交图片</button><button @click="action('discard')" :disabled="busy">丢弃</button></div></div>
        <div v-else class="empty"><strong>{{ data?.setupRequired ? '配置 Agent 后开始使用' : '等待下一张截图' }}</strong><p>{{ data?.setupRequired ? '安装检测与 Agent 配置在左侧完成。' : '使用 Win + Shift + S 复制图片。确认模式会先显示预览。' }}</p></div>

        <div class="section-heading history-heading"><h2>本地历史 <span>{{ data?.total ?? 0 }}</span></h2><span class="hint">最近显示 {{ data?.tasks.length ?? 0 }} 项</span></div>
        <div class="profile-actions"><button @click="selectVisibleTasks" :disabled="!safeTasks.length">选择可删除的已结束任务</button><button @click="deleteSelectedTasks" :disabled="busy || !selectedTasks.length">删除所选（{{ selectedTasks.length }}）</button><button @click="clearHistory('completed')" :disabled="busy || !data?.total">清除成功历史</button><button @click="clearHistory('all-safe')" :disabled="busy || !data?.total">清除所有可安全删除的历史</button></div>
        <p class="hint">排队、运行中和结果不确定的任务会保留，直到可安全删除。删除历史不会删除保存到其他目录的 Markdown 文件。</p>
        <p v-if="data?.lastHistoryCleanup" class="notice">最近清理：删除 {{ data.lastHistoryCleanup.deleted }} 项，保留 {{ data.lastHistoryCleanup.preservedActive }} 个活动任务和 {{ data.lastHistoryCleanup.preservedUnknown }} 个结果不确定任务。</p>
        <p class="hint" v-if="!data?.tasks.length">尚无任务。配置 Agent 后开启捕获并应用设置。</p>
        <ul class="tasks"><li v-for="task in data?.tasks" :key="task.id">
          <div class="section-heading"><label class="check task-check"><input type="checkbox" :checked="selectedTasks.includes(task.id)" :disabled="busy || !isDeletable(task)" @change="toggleTask(task.id, ($event.target as HTMLInputElement).checked)"><span>选择删除</span></label><button class="task-title" @click="openTask(task.id)" :disabled="busy"><strong>{{ task.summary || task.status }}</strong><span>{{ task.provider || task.profileId }} · {{ task.id.slice(0, 8) }} · {{ task.status }}</span></button><button v-if="isDeletable(task)" @click="deleteTask(task.id)" :disabled="busy">删除</button></div>
          <p class="hint">剪贴板：{{ task.clipboard?.status || '等待结果' }} · 保存：{{ task.save?.status || '等待结果' }}</p>
          <p class="hint" v-if="task.clipboard?.code">剪贴板：{{ task.clipboard.code }} · {{ task.clipboard.classification }} · {{ task.clipboard.attempts }} 次</p><p class="hint" v-if="task.save?.code">保存：{{ task.save.code }} · {{ task.save.classification }} · {{ task.save.attempts }} 次</p>
          <p class="error" v-if="task.error">{{ task.error }} · 此任务不会自动重跑。</p><p class="notice" v-if="task.clipboard?.status === 'blocked_by_clipboard_change'">Smart 已保护较新的剪贴板内容，可手动复制结果。</p>
          <div class="task-actions" v-if="task.status === 'succeeded'"><button @click="action('copy', { id: task.id })" :disabled="busy">复制结果</button><button @click="action('retry-delivery', { id: task.id })" :disabled="busy">重试结果投递</button></div>
          <p class="notice" v-if="task.status === 'execution_unknown'">执行结果不确定。请先检查 Agent；此任务不能自动重跑或删除。</p>
          <p class="hint" v-if="['queued', 'leased', 'running'].includes(task.status)">任务正在排队或运行；不会因为清理历史而取消。</p>
        </li></ul>
        <article v-if="detail" class="result"><div class="section-heading"><h2>结果详情</h2><button @click="detail = undefined">关闭详情</button></div><p class="hint">{{ detail.status }}</p><p v-if="detail.gateway" class="hint path">{{ detail.gateway.endpoint }} · {{ detail.gateway.model }}</p><pre>{{ detail.result?.contentMarkdown || detail.result?.errorCode || '暂无结果；完成后重新打开详情。' }}</pre></article>
      </section>
    </div>
  </main>
</template>
