<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { actionFeedback, trayView, type TrayViewState } from "../../../packages/desktop/src/tray";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import AppNavigation from "./components/AppNavigation.vue";
import AppIcon from "./components/AppIcon.vue";
import { loadTheme, saveTheme, type Theme } from "./theme";
import { nativeDefaults, nativeErrorText, type NativeOptions } from "../../../packages/desktop/src/native-options";

type Receipt = {
  status: string;
  code?: string;
  attempts: number;
  classification?: string;
  stopReason?: string;
};
type Task = {
  mode?: string;
  remote?: { upload: string; error?: string; targetWorkerId?: string };
  id: string;
  createdAt: number;
  status: string;
  provider?: string;
  profileId?: string;
  summary?: string;
  error?: string;
  clipboard?: Receipt;
  save?: Receipt;
  notification?: Receipt;
  imageCount?: number;
  retryableChannels: string[];
};
type Hotkeys = Record<string, string>;
type Agent = {
  id: string;
  version: string;
  provider: string;
  archived: boolean;
  historical: boolean;
  referenced: boolean;
  removable: boolean;
  deletable: boolean;
  path?: string;
  workspace?: string;
  prompt?: string;
  cliVersion?: string;
  gateway?: {
    endpoint: string;
    model: string;
    vision: string;
    credentialStatus: string;
    connectionStatus: string;
  };
};
type Discovery = {
  provider: string;
  path: string;
  selectionPath?: string;
  version?: string;
  status: string;
};
type Snapshot = {
  typingAvailable?: boolean;
  nativeOptions?: NativeOptions;
  nativeCapture?: { path?: string; submission: string; clipboard: string };
  nativeRuntime?: { capturing: boolean; captureStatus: string; typing: { phase?: string; active?: boolean; sent?: number; total?: number } | null };
  remote?: {
    mode: string; url: string; label: string; receive: boolean; hasToken: boolean; status: string; error?: string; lastSync?: number;
    identity?: { ownerId: string; deviceId: string };
    target?: { deviceId: string; id: string; version: string; provider: string };
    workers: { deviceId: string; label: string; accepting: boolean; lastSeen: number; profiles: { id: string; version: string; provider: string; selectable?: boolean; isDefault?: boolean }[] }[];
  };
  tray: TrayViewState;
  appVersion?: string;
  fileCache?: { directory?: string; files?: number; bytes?: number; maxFiles?: number; maxBytes?: number; error?: string };
  activity: { running: number; queued: number };
  hotkeys: Hotkeys;
  hotkeyStatus?: string;
  lastAction?: { action: string; status: string };
  lastHistoryCleanup?: {
    deleted: number;
    preservedActive: number;
    preservedUnknown: number;
  };
  launchMode: string;
  root: string;
  status: string;
  setupRequired: boolean;
  workspaceSuggestion: string;
  error?: string;
  total: number;
  historyTotal: number;
  historyOffset: number;
  pending: string | null;
  captureStatus: string;
  composer?: { id: string; preview: string }[];
  folderError?: string;
  canReviewUnknownHistory: boolean;
  settings: {
    enabled: boolean;
    folderEnabled?: boolean;
    folderDirectory?: string;
    mode: string;
    paused: boolean;
    autoConsent: boolean;
    alwaysConsent: boolean;
  };
  delivery: {
    clipboard: string;
    saveDirectory?: string;
    clipboardPayload?: string;
    notification?: boolean;
    retry?: { maxRetries: number; backoffMs: number; budgetMs: number };
  };
  agents: Agent[];
  discovery: Discovery[];
  profile: {
    adapter: string;
    id: string;
    profileVersion?: string;
    workspace?: string;
    version?: string;
    sandbox: string;
  };
  tasks: Task[];
};

const globalActions = [
  { id: "toggle-pause", label: "暂停 / 恢复捕获" },
  { id: "copy-latest", label: "复制最新成功结果" },
  { id: "retry-latest-delivery", label: "重试最新失败投递" },
  { id: "cycle-agent", label: "循环切换 Agent" },
  { id: "current", label: "提交当前剪贴板图片" },
  { id: "capture-monitor", label: "截取所选显示器" },
  { id: "type-latest", label: "输入最新结果" },
  { id: "stop-typing", label: "停止输入（也可按 Esc）" },
];
const providerText: Record<string, string> = {
  fake: "Fake · 合成测试",
  codex: "Codex CLI",
  claude: "Claude Code",
  "claude-compatible-endpoint": "Claude Code · GLM 网关",
};
const cliStatusText: Record<string, string> = {
  not_found: "未安装",
  invalid: "路径无效",
  unsupported: "功能不兼容",
  version_changed: "版本或文件已变化",
  unverified_auth: "已发现",
  scan_incomplete: "检测未完成",
};
const errorText: Record<string, string> = {
  ...nativeErrorText,
  REMOTE_OTHER_DEVICE_REQUIRED: "请选择另一台电脑的助手。本机处理请使用 Local；接收远程任务无需选择远程目标。",
  INVALID_REMOTE_TOKEN: "设备 Token 格式无效。请只粘贴 Token 内容（32–256 个可打印字符），不要包含文件名、说明或中间空格。",
  INVALID_REMOTE_SETTINGS: "跨设备设置无效。请填写 Relay HTTPS 地址和这台电脑的名称（最多 80 个字符）。",
  REMOTE_TOKEN_SAVE_FAILED: "Windows 凭据管理器未能保存设备 Token；连接设置未更改。请从托盘退出并重新打开应用后再试。",
  REMOTE_TOKEN_VERIFY_FAILED: "设备 Token 保存后无法从 Windows 凭据管理器正确读回；连接设置未更改。请重新打开应用后再试。",
  REMOTE_SETTINGS_SAVE_FAILED: "连接设置无法写入本机数据目录；原连接保持不变。请检查设置页显示的数据目录是否可写。",
  FORMAL_PROFILE_REQUIRED: "当前是隔离 Fake 或旧版 Local 窗口。请从托盘退出，再直接打开 Shot2Agent.exe 配置真实 AI 助手。",
  INVALID_HOTKEY: "组合键格式无效。请使用 Ctrl+Alt、Ctrl+Shift 或 Alt+Shift 加一个字母或数字，例如 Ctrl+Alt+P。",
  INVALID_HOTKEYS: "快捷键配置格式无效，请重新填写后保存。",
  DUPLICATE_HOTKEY: "多个操作使用了相同的组合键。请为每个操作选择不同的快捷键。",
  HOTKEY_CONFLICT_OLD_BINDINGS_RETAINED: "Windows 未能注册这组快捷键，可能已被其他程序占用。原快捷键保持不变，请换一组后保存。",
  HOTKEY_THREAD_TIMEOUT: "快捷键注册服务未响应。请从托盘退出 Shot2Agent 后重新打开，再保存快捷键。",
  HOTKEY_THREAD_STOPPED: "快捷键注册服务已停止。请从托盘退出 Shot2Agent 后重新打开。",
  HOTKEY_SETTINGS_UNAVAILABLE: "无法读取当前快捷键设置。请从托盘退出 Shot2Agent 后重新打开。",
  HOTKEY_SETTINGS_SAVE_FAILED: "快捷键设置未能写入本机数据目录，原设置未更改。请检查设置页显示的数据目录是否可写。",
  HOTKEY_ROLLBACK_FAILED_DISABLED: "保存失败，且无法确认原快捷键已恢复。请从托盘退出 Shot2Agent 后重新打开，再配置快捷键。",
  CLIPBOARD_HELPER_STOPPED: "剪贴板连接已断开。请点“重新连接剪贴板”；已有任务继续处理。",
  STAGING_WORKER_STOPPED: "隔离测试的处理服务故障。请退出并重新启动 Start acceptance.cmd。",
  RESTART_APP_AFTER_CHECKING_AGENT: "请先确认 AI 助手进程已停止，再退出并重新打开应用；不要重复提交不确定的任务。",
  NO_ELIGIBLE_FAILED_DELIVERY: "没有可重试的失败通道，可在历史中手动复制结果。",
  DELIVERY_STILL_FAILED: "结果投递仍未完成，请检查下方通道状态；没有重新请求 AI。",
  PROFILE_UNAVAILABLE: "此任务绑定的助手配置不可用，请在 AI 助手页恢复对应配置；不会自动换用其他助手。",
  SAVE_CONFLICT: "目标文件已存在且内容不同，未覆盖；请在历史中复制结果或另选保存目录。",

  FILE_CLIPBOARD_CACHE_FULL: "文件复制缓存已满。请到设置中的文件复制缓存清理旧文件。",
  UNSAFE_FILE_CACHE: "缓存含有无法安全清理的文件或链接。请保留原目录并检查数据位置。",
  FILE_CACHE_CLEANUP_UNAVAILABLE: "当前无法检查 Windows 剪贴板，未清理缓存。请重启应用后再试。",
  FILE_CACHE_CLEANUP_FAILED: "缓存清理未完成，可能已有部分旧文件被删除。当前剪贴板文件仍保留；请刷新后重试。",

  BATCH_IMAGE_COUNT: "多图任务需要 2–5 张图片；最多可添加 5 张。",
  BATCH_OVER_60_MIB: "图片合计超过 60 MiB，请减少图片或文件大小。",
  INVALID_IMAGE: "图片不完整或格式不支持，请选择已保存完成的 PNG/JPEG/WebP。",
  CAPTURE_FOLDER_REQUIRED: "请选择截图文件夹，再启用目录监听。",
  CAPTURE_OUTPUT_OVERLAP: "截图文件夹不能与应用数据或结果保存目录重叠，请另选目录。",
  CAPTURE_FOLDER_UNAVAILABLE: "截图目录不可访问，请重新选择后应用设置。",
  FOLDER_IMAGE_INVALID_OR_UNREADABLE: "已跳过无法读取的图片，请检查文件是否完整。",
  NO_CURRENT_IMAGE: "当前剪贴板中没有图片，请先截图。",
  NATIVE_NOTIFICATION_UNAVAILABLE: "Windows 通知不可用；请检查系统通知设置，其他输出仍可使用。",
  CLIPBOARD_BUSY: "剪贴板正被其他程序占用，尚未写入；请稍后手动复制。",
  CLIPBOARD_REPLACED_AFTER_WRITE: "文件已写入，但随后被其他剪贴板活动替换；请稍后手动复制并在资源管理器粘贴。",
  CLIPBOARD_WRITE_AMBIGUOUS: "无法确认剪贴板写入结果，未自动重试；请检查后手动复制。",
  CLIPBOARD_HELPER_TIMEOUT: "剪贴板响应超时，未自动重试；请重启应用后手动复制。",
  COPY_FAILED: "复制未完成，请检查剪贴板是否被占用；可稍后手动复制。",
  PROFILE_NAME_EXISTS:
    "这个名称已经存在，请编辑或恢复原助手，或使用另一个名称。",
  CLI_NOT_USABLE: "本机程序暂不可用，请重新检测或选择 Codex / Claude Code。",
  GATEWAY_VISION_NOT_VERIFIED: "图片能力尚未验证，请在 AI 助手中测试连接。",
  INVALID_PROFILE_ID: "名称请使用小写英文字母开头，只包含英文、数字和短横线。",
  SELECT_ANOTHER_PROFILE_FIRST: "请先选择另一个默认助手，再移除此助手。",
  CODEX_INTERRUPTED: "Codex 任务已中断，未取得完整结果。",
  HISTORY_AGENT_STOP_PENDING:
    "请等待当前 Agent 执行及清理结束后再删除不确定历史；若 Worker 停止状态未确认，请先确认 Agent 已停止，再退出并重新打开应用。",
  TASK_EXECUTION_UNKNOWN_REQUIRES_REVIEW:
    "请确认对应 Agent 已停止，再删除这条执行结果不确定的历史。",
  CLAUDE_MANAGED_POLICY_REFUSED:
    "检测到 Claude 受管理配置，已停止执行。请确认本机是否安装了组织管理的 Claude 配置。",
  CLAUDE_POLICY_CHECK_UNAVAILABLE:
    "无法完成 Claude 本机配置检查，请使用最新 Windows 程序包后重试新任务。",
  CLAUDE_POLICY_CHECK_TIMEOUT:
    "Claude 本机配置检查超时，请稍后手动提交新任务。",
  LOCAL_OPERATION_FAILED:
    "本地操作未完成。若刚确认了 GLM 合成图片测试，请先不要重复提交，以免重复请求。",
  WORKSPACE_PATH_UNAVAILABLE:
    "所选工作区不存在或无法访问，请用“选择文件夹…”选一个本机上可访问的文件夹。",
  WORKSPACE_CREATE_FAILED:
    "无法创建默认工作区，请改选一个有权限访问的本机文件夹。",
  GATEWAY_CREDENTIAL_STORE_FAILED:
    "Windows 凭据管理器未能保存或读回 Token；尚未发送 GLM 测试请求。",
  GATEWAY_SECURE_STORE_OPERATION_FAILED:
    "Windows 凭据管理器操作失败；Agent 配置未保存。",
  GATEWAY_CREDENTIAL_VERIFY_FAILED:
    "Token 保存后无法从 Windows 凭据管理器读回；Agent 配置未保存。",
  GATEWAY_AUTH_FAILED: "GLM 拒绝了这个 Token，请检查后在此窗口重新输入。",
  GATEWAY_ENDPOINT_FAILED: "GLM 端点或模型返回错误，请检查所选地区和模型名称。",
  GATEWAY_REQUEST_FAILED:
    "无法完成 GLM 请求。若刚确认测试，请先不要连续重试；服务端可能已经收到请求。",
  GATEWAY_SYNTHETIC_VISION_FAILED:
    "GLM 未能识别测试图片中的标记；请检查模型是否支持图片输入。",
  GATEWAY_SYNTHETIC_IMAGE_UNAVAILABLE:
    "程序包缺少或无法读取测试图片，未发送模型请求。请更新完整 ZIP；现有助手配置保持不变。",
  GATEWAY_SYNTHETIC_TEST_FAILED:
    "GLM 合成图片测试未完成。若刚确认测试，请先不要重复提交；服务端可能已经收到请求。",
  PROFILE_SETTINGS_SAVE_FAILED:
    "Agent 配置无法保存到本机设置。请确认应用数据目录可写。",
};
const data = ref<Snapshot>();
const remoteUrl = ref(''); const remoteLabel = ref('Windows PC'); const remoteToken = ref(''); const remoteDirty = ref(false);
const remoteGroups = computed(() => (data.value?.remote?.workers ?? []).filter(w => w.deviceId !== data.value?.remote?.identity?.deviceId).map(w => {
  const profiles = new Map<string, (typeof w.profiles)[number]>();
  for (const profile of w.profiles) if (profile.selectable !== false) profiles.set(profile.id, profile);
  const status = Date.now() - w.lastSeen >= 60000 ? '离线' : w.accepting ? '在线' : '已暂停接收';
  return { deviceId: w.deviceId, label: `${w.label} · ${w.deviceId} · ${status}`, options: [...profiles.values()].map(p => ({
    key: JSON.stringify([w.deviceId, p.id, p.version]), label: `${providerText[p.provider] ?? p.provider} · ${p.id}${p.isDefault ? ' · 对方默认' : ''}`, deviceId: w.deviceId, ...p,
  })) };
}).filter(w => w.options.length));
const remoteOptions = computed(() => remoteGroups.value.flatMap(w => w.options));
const remoteSelection = computed(() => { const t = data.value?.remote?.target; return t ? JSON.stringify([t.deviceId, t.id, t.version]) : ''; });
const selectedRemoteComputer = computed(() => remoteGroups.value.find(g => g.options.some(p => p.key === remoteSelection.value))?.label);
const remoteTargetUnavailable = computed(() => !!remoteSelection.value && !remoteOptions.value.some(p => p.key === remoteSelection.value));
const localReceiverAgents = computed(() => (data.value?.agents ?? []).filter(a => !a.archived && !a.historical)
  .map(a => `${providerText[a.provider] ?? a.provider} · ${a.id}${a.id === data.value?.profile.id && a.version === data.value?.profile.profileVersion ? '（本机默认）' : ''}`).join('；'));
async function saveRemote() {
  await action('remote-configure', { url: remoteUrl.value.trim(), label: remoteLabel.value.trim(), ...(remoteToken.value ? { token: remoteToken.value.trim() } : {}) });
  if (!error.value) {
    remoteToken.value = ''; remoteDirty.value = false;
    remoteUrl.value = data.value?.remote?.url ?? ''; remoteLabel.value = data.value?.remote?.label ?? 'Windows PC';
  }
}
async function selectRemote(event: Event) {
  const option = remoteOptions.value.find(o => o.key === (event.target as HTMLSelectElement).value);
  if (option) await action('remote-select', { deviceId: option.deviceId, id: option.id, version: option.version });
}
const transportError = ref("");
const error = ref("");
const message = ref("");
const busy = ref(false);
const enabled = ref(false);
const folderEnabled = ref(false);
const folderDirectory = ref("");
const clipboardPayload = ref("text");
const notification = ref(false);
const mode = ref("confirm");
const clipboard = ref("always");
const save = ref(false);
const directory = ref("");
const maxRetries = ref(0);
const backoffMs = ref(100);
const budgetMs = ref(3000);
const autoConsent = ref(false);
const alwaysConsent = ref(false);
const dirty = ref(false);
const hotkeys = ref<Hotkeys>({});
const nativeOptions = ref<NativeOptions>(nativeDefaults());
const nativeDirty = ref(false);
const nativeCapturing = ref(false);
const monitors = ref<{ id: string; width: number; height: number; primary: boolean }[]>([]);
const typingLabel = computed(() => {
  const t = data.value?.nativeRuntime?.typing;
  if (!t?.phase || t.phase === 'idle') return "";
  if (t.phase === 'preparing') return "准备输入：请在倒计时结束前切换到目标应用的文字输入位置，并松开快捷键。";
  if (t.phase === 'typing') return `正在输入 ${t.sent ?? 0} / ${t.total ?? 0} 字符；按 Esc 可停止。`;
  if (t.phase === 'sent') return `已发送 ${t.sent ?? 0} 字符，请在目标应用核对；部分应用不接受模拟 Unicode 输入。`;
  return friendlyError(t.phase);
});
const hotkeyDirty = ref(false);
const hotkeyErrorCode = ref("");
const hotkeyMessage = ref("");
const showProfileForm = ref(false);
const profileDirty = ref(false);
const setupProvider = ref("");
const profileId = ref("claude-gateway-readonly");
const cliPath = ref("");
const workspace = ref("");
const reuseExisting = ref(false);
const prompt = ref(
  "Analyze the screenshot and return a concise, useful Markdown explanation.",
);
const endpoint = ref("https://open.bigmodel.cn/api/anthropic");
const model = ref("glm-5.3-flash");
const token = ref("");
const editId = ref("");
const editVersion = ref("");
const selectedTasks = ref<string[]>([]);
const detail = ref<{
  status: string;
  gateway?: { endpoint: string; model: string; vision: string };
  result?: { contentMarkdown: string; errorCode?: string };
}>();
const theme = ref<Theme>(loadTheme());
function changeTheme(value: Theme) {
  theme.value = value;
  message.value = saveTheme(value)
    ? `已切换为${value === "dark" ? "深色" : "浅色"}主题。`
    : "主题已切换，但无法保存外观偏好；下次启动可能恢复默认主题。";
}
const presentation = computed(() => transportError.value ? trayView() : data.value?.tray);
const workerText = computed(() => presentation.value?.work ?? "正在连接处理服务");
const captureSummary = computed(() => {
  const snapshot = data.value;
  if (!snapshot) return "正在读取捕获状态";
  return `${snapshot.settings.mode === "auto" ? "自动提交" : "确认后提交"} · ${presentation.value?.capture}`;
});
function friendlyError(code: string) {
  if (errorText[code]) return errorText[code];
  if (/^RELAY_40[13]$|CREDENTIAL_UNAVAILABLE/.test(code)) return 'Relay 拒绝了设备 Token。请在跨设备设置更新 Token，再测试连接；已有任务保持原样。';
  if (code === 'REMOTE_WAIT_FOR_IDLE') return '请等待当前任务结束后再保存连接；暂停接收会保留已经开始的任务。';
  if (/HTTPS_REQUIRED/.test(code)) return '请输入完整的 HTTPS Relay 地址。只有本机隔离测试支持 HTTP。';
  if (/^REMOTE_|^RELAY_|UNAPPROVED_TARGET|ARTIFACT_INTEGRITY/.test(code)) return '远程同步未完成。请检查 Relay 连接及远程电脑的 Agent 配置，然后测试连接或重试同步；不会改用本机执行。';
  if (/COORDINATOR|^Error: COORDINATOR/.test(code)) return "本地处理服务失联。请从托盘退出并重新打开应用；结果不确定的任务不会自动重跑。";
  return errorText[code] ?? "操作未完成。请检查本机程序、目录及网络后再试；执行结果不确定的任务不会自动重跑。";
}
function openPreview() { page.value = "home"; detail.value = undefined; void refresh(); }
const page = ref("home");
const search = ref("");
const historyOffset = ref(0);
function snapshotArgs() {
  return page.value === "history"
    ? { offset: historyOffset.value, query: search.value }
    : {};
}
watch([page, search], () => {
  historyOffset.value = 0;
  selectedTasks.value = [];
  void refresh();
});
async function historyPage(offset: number) {
  historyOffset.value = offset;
  selectedTasks.value = [];
  await refresh();
}
const resultDialog = ref<HTMLDialogElement>();
const resultTitle = ref<HTMLElement>();
const resultReturnFocus = ref<HTMLElement>();
const editor = ref<HTMLDialogElement>();
const editorTitle = ref<HTMLElement>();
const returnFocus = ref<HTMLElement>();
const visibleTasks = computed(() =>
  (data.value?.tasks ?? []).slice(0, page.value === "home" ? 3 : undefined),
);
const receiptText: Record<string, string> = {
  succeeded: "已完成",
  failed: "失败",
  pending: "等待中",
  skipped: "未启用",
  blocked_by_clipboard_change: "已保护较新的剪贴板",
  interrupted: "已中断",
};
const taskStatus: Record<string, string> = {
  queued: "排队中",
  running: "处理中",
  leased: "准备处理",
  succeeded: "处理完成",
  failed: "处理失败",
  timed_out: "已超时",
  canceled: "已取消",
  execution_unknown: "结果不确定",
};
async function showEditor() {
  returnFocus.value = document.activeElement as HTMLElement;
  showProfileForm.value = true;
  await nextTick();
  editor.value?.showModal();
  editorTitle.value?.focus();
}
function closeEditor() {
  if (busy.value) return;
  editor.value?.close();
  showProfileForm.value = false;
  token.value = "";
  profileDirty.value = false;
  editId.value = "";
  editVersion.value = "";
  reuseExisting.value = false;
  returnFocus.value?.focus();
}
async function nativeHide() {
  try {
    await invoke("hide_window");
  } catch {
    error.value = "无法隐藏到托盘，请重试。";
  }
}
let timer: ReturnType<typeof setInterval> | undefined;
let polling = false;
const activeProfiles = computed(
  () => data.value?.agents.filter((a) => !a.archived && !a.historical) ?? [],
);
const removedProfiles = computed(
  () => data.value?.agents.filter((a) => a.archived) ?? [],
);
const historicalProfiles = computed(
  () => data.value?.agents.filter((a) => !a.archived && a.historical) ?? [],
);

const selectedAgent = computed(() => data.value?.agents.find(isSelectedAgent));
const safeTasks = computed(() => data.value?.tasks.filter(isDeletable) ?? []);
function isSelectedAgent(agent: Agent) {
  return (
    agent.id === data.value?.profile.id &&
    agent.version === data.value?.profile.profileVersion
  );
}
function isDeletable(task: Task) {
  return (
    ["succeeded", "failed", "timed_out", "canceled"].includes(task.status) ||
    (task.status === "execution_unknown" &&
      data.value?.canReviewUnknownHistory === true)
  );
}
function providerForDiscovery() {
  return setupProvider.value === "codex" ? "codex" : setupProvider.value ? "claude" : "";
}
function chooseDetectedPath() {
  const candidate = data.value?.discovery.find(
    (c) =>
      c.provider === providerForDiscovery() &&
      c.status === "unverified_auth" &&
      c.path,
  );
  if (candidate) cliPath.value = candidate.selectionPath ?? candidate.path;
}
function hydrate(snapshot: Snapshot) {
  data.value = snapshot;
  // Resume may arrive through the tray/hotkey while an action error is visible.
  // Expire only this recovered refusal; preserve unrelated errors on polling.
  if (!snapshot.settings.paused && error.value === nativeErrorText.CAPTURE_PAUSED) error.value = "";
  if (!nativeDirty.value) nativeOptions.value = { ...(snapshot.nativeOptions ?? nativeDefaults()) };
  if (!remoteDirty.value) { remoteUrl.value = snapshot.remote?.url ?? ''; remoteLabel.value = snapshot.remote?.label ?? 'Windows PC'; }
  if (page.value === "history")
    historyOffset.value = snapshot.historyOffset ?? 0;
  if (!hotkeyDirty.value) hotkeys.value = { ...snapshot.hotkeys };
  if (!dirty.value) {
    enabled.value = snapshot.settings.enabled;
    folderEnabled.value = snapshot.settings.folderEnabled ?? false;
    folderDirectory.value = snapshot.settings.folderDirectory ?? "";
    clipboardPayload.value = snapshot.delivery.clipboardPayload ?? "text";
    notification.value = snapshot.delivery.notification ?? false;
    mode.value = snapshot.settings.mode;
    clipboard.value = snapshot.delivery.clipboard;
    maxRetries.value = snapshot.delivery.retry?.maxRetries ?? 0;
    backoffMs.value = snapshot.delivery.retry?.backoffMs ?? 100;
    budgetMs.value = snapshot.delivery.retry?.budgetMs ?? 3000;
    save.value = !!snapshot.delivery.saveDirectory;
    directory.value = snapshot.delivery.saveDirectory ?? "";
    autoConsent.value = snapshot.settings.autoConsent;
    alwaysConsent.value = snapshot.settings.alwaysConsent;
  }
  if (!profileDirty.value) {
    if (!workspace.value) workspace.value = snapshot.workspaceSuggestion;
    if (!cliPath.value) chooseDetectedPath();
  }
  const present = new Set(snapshot.tasks.map((task) => task.id));
  selectedTasks.value = selectedTasks.value.filter((id) => present.has(id));
}
async function rpc(command: string, args: Record<string, unknown> = {}) {
  const response = await invoke<{
    ok: boolean;
    value: unknown;
    error?: string;
  }>("rpc", { request: { v: 1, command, ...args } });
  if (!response.ok) throw new Error(response.error ?? "LOCAL_OPERATION_FAILED");
  return response.value;
}
async function refresh() {
  if (polling || busy.value) return;
  polling = true;
  try {
    hydrate((await rpc("snapshot", snapshotArgs())) as Snapshot);
    transportError.value = "";
  } catch (e) {
    if (!transportError.value) transportError.value = String(e);
  } finally {
    polling = false;
  }
}
async function cleanFileCache() {
  if (!window.confirm("清理超过 10 分钟的旧复制缓存？当前剪贴板引用的文件会保留。导出的 Markdown、任务历史和截图不会删除。")) return;
  await action("clean-file-cache", { confirm: true });
}
async function action(command: string, args: Record<string, unknown> = {}) {
  if (busy.value) return;
  busy.value = true;
  nativeCapturing.value = command === 'capture-monitor' || (command === 'action' && args.action === 'capture-monitor');
  error.value = "";
  message.value = "";
  try {
    const result = await rpc(command, args);
    if (command === "detail") detail.value = result as typeof detail.value;
    else if (command !== "quit")
      hydrate(
        (page.value === "history" || command === "clean-file-cache")
          ? ((await rpc("snapshot", snapshotArgs())) as Snapshot)
          : (result as Snapshot),
      );
    if (command === "create-profile") {
      token.value = "";
      editId.value = "";
      editVersion.value = "";
      reuseExisting.value = false;
      profileDirty.value = false;
      editor.value?.close();
      showProfileForm.value = false;
      returnFocus.value?.focus();
      message.value =
        "Agent 配置已保存。已有任务保留原配置；可直接提交截图，测试连接可选。";
    }
    if (command === "archive-agent")
      message.value = args.archived
        ? "Agent 已移除，可在“已移除的助手”中恢复。已有任务和历史保留。"
        : data.value?.profile.id === args.id &&
            data.value?.profile.profileVersion === args.version
          ? "已恢复并设为该 Agent 的默认版本。"
          : "Agent 已恢复；默认助手保持不变。";
    if (command === "delete-agent" || command === "cleanup-unused-agents")
      message.value =
        "未被任务引用的旧配置已清理；仍被任务或其他配置引用的项目已保留。";
    if (command === "credential-status")
      message.value = "凭据状态已检查；Token 不会显示。";
    if (command === "delete-history") {
      selectedTasks.value = [];
      detail.value = undefined;
      message.value =
        "任务历史及应用私有文件已删除。已保存到其他目录的 Markdown 文件不会被删除。";
    }
    if (command === "clear-history") {
      selectedTasks.value = [];
      detail.value = undefined;
      const cleanup = (result as Snapshot).lastHistoryCleanup;
      message.value = `删除 ${cleanup?.deleted ?? 0} 项；保留 ${cleanup?.preservedActive ?? 0} 个排队或运行任务，以及 ${cleanup?.preservedUnknown ?? 0} 个结果不确定任务。`;
    }
    if (command === "select-agent")
      message.value = "默认助手已更换，仅影响接下来的截图。";
    if (command === "test-agent")
      message.value =
        "合成图片测试通过，可处理新的截图。默认助手与原有任务绑定均已保留。";
    if (command === "discover-agents") message.value = "本机程序检测已更新。";
    if (command === "pause")
      message.value = args.paused
        ? "捕获已暂停；已提交的任务继续处理。"
        : "捕获已恢复，已有图片不会自动提交。";
    if (command === "clean-file-cache") {
      const cleanup = result as { deleted: number; retained: number };
      message.value = `已清理 ${cleanup.deleted} 个旧缓存文件；保留 ${cleanup.retained} 个当前剪贴板引用或最近 10 分钟的文件。`;
    }
    if (command === "copy-files") message.value = "已写入并验证 Markdown 文件，请在资源管理器按 Ctrl+V 粘贴（Win+V 不作为文件粘贴依据）。";
    if (command === "composer-submit") message.value = "多张图片已作为一个任务提交。";
    if (command === "retry-delivery")
      message.value =
        "已检查结果投递，请查看剪贴板和保存状态；Agent 未重新执行。";
    if (command === "capture-monitor") message.value = "截图完成；请查看文件、确认预览及各去向状态。";
    if (command.startsWith("type-")) message.value = "输入已准备，请切换到目标应用；按 Esc 停止。";
    if (command === "copy") message.value = "已复制结果，可以粘贴。";
    if (command === "discard") message.value = "已丢弃预览，没有创建任务。";
    if (command === "submit" || command === "current")
      message.value =
        data.value?.captureStatus === "duplicate"
          ? "5 秒内的相同图片已忽略。"
          : data.value?.captureStatus === "no_image"
            ? "当前剪贴板没有图片。"
            : "图片已提交到本地队列。";
  } catch (e) {
    const code = e instanceof Error ? e.message : String(e);
    if (command === "configure-hotkeys") {
      hotkeyErrorCode.value = /^[A-Z][A-Z0-9_]{0,127}$/.test(code) ? code : "HOTKEY_SAVE_FAILED";
    } else error.value = friendlyError(code);
  } finally {
    busy.value = false;
    nativeCapturing.value = false;
  }
}
async function pickExecutable() {
  try {
    const path = await open({
      title: "选择 Codex 或 Claude CLI",
      multiple: false,
      filters: [{ name: "CLI", extensions: ["exe", "cmd", "ps1"] }],
    });
    if (typeof path === "string") {
      cliPath.value = path;
      reuseExisting.value = false;
      profileDirty.value = true;
    }
  } catch {
    error.value = "无法打开程序选择窗口，请手动填写程序路径。";
  }
}
async function pickWorkspace() {
  try {
    const path = await open({
      title: "选择只读工作区",
      directory: true,
      multiple: false,
    });
    if (typeof path === "string") {
      workspace.value = path;
      profileDirty.value = true;
    }
  } catch {
    error.value = "无法打开文件夹选择窗口，请手动填写工作区。";
  }
}
function providerChanged() {
  profileDirty.value = true;
  reuseExisting.value = false;
  cliPath.value = "";
  if (!editVersion.value)
    profileId.value =
      setupProvider.value === "codex"
        ? "my-codex"
        : setupProvider.value === "claude"
          ? "my-claude"
          : "my-glm";
  chooseDetectedPath();
}
function selectExecutable(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (value === "__current__") reuseExisting.value = true;
  else {
    reuseExisting.value = false;
    cliPath.value = value;
  }
  profileDirty.value = true;
}
function editProfile(agent: Agent) {
  error.value = "";
  message.value = "";
  setupProvider.value = agent.provider;
  profileId.value = agent.id;
  cliPath.value = agent.path ?? "";
  workspace.value = agent.workspace ?? data.value?.workspaceSuggestion ?? "";
  reuseExisting.value = true;
  prompt.value = agent.prompt ?? prompt.value;
  endpoint.value = agent.gateway?.endpoint ?? endpoint.value;
  model.value = agent.gateway?.model ?? model.value;
  token.value = "";
  editId.value = agent.id;
  editVersion.value = agent.version;
  profileDirty.value = true;
  void showEditor();
}
function addProfile() {
  error.value = "";
  message.value = "";
  const providers = [...new Set(data.value?.discovery.filter(c => c.status === "unverified_auth").map(c => c.provider))];
  setupProvider.value = providers.length === 1 ? providers[0] : "";
  profileId.value = setupProvider.value === "codex" ? "my-codex" : setupProvider.value === "claude" ? "my-claude" : "";
  cliPath.value = "";
  reuseExisting.value = false;
  editId.value = "";
  editVersion.value = "";
  token.value = "";
  prompt.value =
    "Analyze the screenshot and return a concise, useful Markdown explanation.";
  workspace.value = data.value?.workspaceSuggestion ?? "";
  endpoint.value = "https://open.bigmodel.cn/api/anthropic";
  model.value = "glm-5.3-flash";
  profileDirty.value = true;
  chooseDetectedPath();
  void showEditor();
}
async function saveProfile() {
  if (!setupProvider.value) { error.value = "请先选择 AI 助手类型。"; return; }
  if (!reuseExisting.value && !cliPath.value.trim()) {
    error.value = "请选择已安装的 Codex CLI 或 Claude Code。";
    return;
  }
  if (!workspace.value.trim()) {
    error.value = "请选择一个工作区。";
    return;
  }
  if (
    setupProvider.value === "claude-compatible-endpoint" &&
    !token.value &&
    !editVersion.value
  ) {
    error.value = "请输入 GLM Token。";
    return;
  }
  const gateway = setupProvider.value === "claude-compatible-endpoint";
  await action("create-profile", {
    provider: setupProvider.value,
    id: profileId.value.trim(),
    path: cliPath.value.trim(),
    workspace: workspace.value.trim(),
    prompt: prompt.value,
    reuseExisting: reuseExisting.value,
    ...(gateway
      ? { endpoint: endpoint.value, model: model.value, token: token.value }
      : {}),
    ...(editVersion.value
      ? { editId: editId.value, editVersion: editVersion.value }
      : {}),
  });
}
async function applyHotkeys() {
  if (busy.value) return;
  hotkeyErrorCode.value = "";
  hotkeyMessage.value = "";
  await action("configure-hotkeys", {
    hotkeys: Object.fromEntries(
      Object.entries(hotkeys.value).filter(([, key]) => key),
    ),
  });
  if (!hotkeyErrorCode.value) {
    hotkeyDirty.value = false;
    hotkeyMessage.value = "快捷键已保存。隐藏到托盘后仍有效。";
    await refresh();
  }
}
async function refreshMonitors() {
  try { monitors.value = await rpc('native-monitors') as typeof monitors.value; }
  catch (e) { error.value = friendlyError(e instanceof Error ? e.message : String(e)); }
}
async function pickNativeDirectory() {
  const path = await open({ directory: true, multiple: false, title: '选择截图保存目录' });
  if (typeof path === 'string') { nativeOptions.value.directory = path; nativeDirty.value = true; }
}
async function applyNative() {
  await action('configure-native', { options: { ...nativeOptions.value } });
  if (!error.value) { nativeDirty.value = false; message.value = '截图与输入设置已保存。'; }
}
async function apply() {
  if (save.value && !directory.value.trim()) {
    error.value = "请填写本地保存目录。";
    return;
  }
  await action("configure", {
    capture: { enabled: enabled.value, mode: mode.value, folderEnabled: folderEnabled.value, ...(folderDirectory.value ? { folderDirectory: folderDirectory.value } : {}) },
    autoConsent: autoConsent.value,
    alwaysConsent: alwaysConsent.value,
    delivery: {
      clipboard: clipboard.value,
      clipboardPayload: clipboardPayload.value,
      notification: notification.value,
      retry: {
        maxRetries: maxRetries.value,
        backoffMs: backoffMs.value,
        budgetMs: budgetMs.value,
      },
      ...(save.value ? { saveDirectory: directory.value.trim() } : {}),
    },
  });
  if (!error.value) {
    dirty.value = false;
    message.value = "设置已保存。仅监听此后新增的图片。";
    await refresh();
  }
}
async function pickImages() {
  try {
    const paths = await open({ title: "添加 2–5 张截图", multiple: true, filters: [{ name: "截图", extensions: ["png", "jpg", "jpeg", "webp"] }] });
    if (paths) await action("composer-add-files", { paths: Array.isArray(paths) ? paths : [paths] });
  } catch { error.value = "无法打开图片选择窗口，请重试。"; }
}
async function pickCaptureFolder() {
  try {
    const path = await open({ title: "选择截图文件夹", directory: true, multiple: false });
    if (typeof path === "string") { folderDirectory.value = path; dirty.value = true; }
  } catch { error.value = "无法选择截图文件夹，请检查目录是否可访问。"; }
}
async function pickSaveDirectory() {
  try {
    const path = await open({
      title: "选择 Markdown 保存目录",
      directory: true,
      multiple: false,
    });
    if (typeof path === "string") {
      directory.value = path;
      dirty.value = true;
    }
  } catch {
    error.value = "无法打开文件夹选择窗口，请手动填写保存目录。";
  }
}
function closeResult() {
  resultDialog.value?.close();
  detail.value = undefined;
  resultReturnFocus.value?.focus();
}
async function openTask(id: string) {
  resultReturnFocus.value = document.activeElement as HTMLElement;
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  detail.value = undefined;
  try {
    detail.value = (await rpc("detail", { id })) as NonNullable<
      typeof detail.value
    >;
    await nextTick();
    resultDialog.value?.showModal();
    resultTitle.value?.focus();
  } catch (e) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}
function toggleTask(id: string, checked: boolean) {
  selectedTasks.value = checked
    ? [...new Set([...selectedTasks.value, id])]
    : selectedTasks.value.filter((value) => value !== id);
}
function selectVisibleTasks() {
  selectedTasks.value = visibleTasks.value
    .filter(isDeletable)
    .map((task) => task.id);
}
function deleteTask(id: string) {
  const unknown =
    data.value?.tasks.find((task) => task.id === id)?.status ===
    "execution_unknown";
  const review = unknown
    ? "请先确认这个旧 Agent 任务已经停止。确认后仅删除历史，不会取消或重新运行 Agent。\n"
    : "";
  if (
    window.confirm(
      `${review}删除此任务的本地历史、截图、结果附件和投递记录？已保存到其他目录的 Markdown 不会删除。`,
    )
  )
    void action("delete-history", { ids: [id], reviewedUnknown: unknown });
}
function deleteSelectedTasks() {
  const unknown =
    data.value?.tasks.filter(
      (task) =>
        selectedTasks.value.includes(task.id) &&
        task.status === "execution_unknown",
    ).length ?? 0;
  const review = unknown
    ? `其中 ${unknown} 项执行结果不确定，请先确认对应 Agent 均已停止。清理不会取消或重新运行 Agent。\n`
    : "";
  if (
    selectedTasks.value.length &&
    window.confirm(
      `${review}永久删除选中的 ${selectedTasks.value.length} 项本地任务数据？已导出的 Markdown 保留。`,
    )
  )
    void action("delete-history", {
      ids: [...selectedTasks.value],
      reviewedUnknown: unknown > 0,
    });
}
function clearHistory(scope: "completed" | "all-safe") {
  const message =
    scope === "completed"
      ? "删除所有成功任务的本地历史和私有文件？"
      : "删除所有可安全删除的终态任务？排队、运行中及结果不确定的任务会保留。";
  if (window.confirm(`${message}\n已保存在其他目录的 Markdown 不会删除。`))
    void action("clear-history", { mode: scope });
}
function testConnection(agent: Agent) {
  if (
    window.confirm(
      "测试连接会向此 GLM 端点发送一张程序提供的合成图片，可能产生费用。不会使用个人截图，也不会自动重试。是否发送一次请求？",
    )
  )
    void action("test-agent", {
      id: agent.id,
      version: agent.version,
      confirm: true,
    });
}
function archive(agent: Agent, archived: boolean) {
  void action("archive-agent", {
    id: agent.id,
    version: agent.version,
    archived,
    confirm: true,
  });
}
function permanentlyDelete(agent: Agent) {
  if (agent.referenced) {
    error.value = "PROFILE_REFERENCED_BY_TASK";
    return;
  }
  if (
    window.confirm(
      `永久删除 ${agent.id} 的未引用配置？如没有其他 Profile 使用其凭据，也会从 Windows Credential Manager 删除该凭据。`,
    )
  )
    void action("delete-agent", {
      id: agent.id,
      version: agent.version,
      confirm: true,
    });
}
onMounted(() => {
  window.addEventListener("shot2agent-open-preview", openPreview);
  void refresh();
  timer = setInterval(() => {
    void refresh();
  }, 1000);
});
onUnmounted(() => { clearInterval(timer); window.removeEventListener("shot2agent-open-preview", openPreview); });
</script>

<template>
  <div class="app-shell" :data-backend-ready="!!data">
    <aside class="sidebar">
      <div class="brand">Shot2Agent<span>Local 桌面助手</span></div>
      <AppNavigation
        :page="page"
        @navigate="
          page = $event;
          detail = undefined;
        "
      />
      <div class="sidebar-bottom">
        <div class="runtime-status" role="status" aria-label="运行状态">
          <span
            class="dot"
            :class="{ active: presentation?.icon === 'monitoring' }"
          ></span>
          本地运行
          <p>
            {{ presentation?.capture ?? "正在连接…" }}
          </p>
          <p>{{ workerText }}</p>
        </div>
        <button
          :aria-label="theme === 'dark' ? '切换为浅色主题' : '切换为深色主题'"
          @click="changeTheme(theme === 'dark' ? 'light' : 'dark')"
        >
          <AppIcon :name="theme === 'dark' ? 'sun' : 'moon'" />{{ theme === "dark" ? "浅色主题" : "深色主题" }}
        </button>
        <button @click="nativeHide"><AppIcon name="hide" />隐藏到托盘</button
        ><button @click="action('quit')" :disabled="busy"><AppIcon name="power" />退出应用</button>
      </div>
    </aside>
    <main>
      <header class="page-header">
        <h1>
          {{
            {
              home: "截图处理",
              agents: "AI 助手",
              history: "历史记录",
              settings: "设置",
            }[page]
          }}
        </h1>
        <span class="status-pill" role="status"
          ><span
            class="dot"
            :class="{ active: presentation?.icon === 'monitoring' }"
          ></span
          >{{
            presentation?.label ?? "正在连接…"
          }}</span
        >
      </header>
      <div class="feedback" aria-live="polite">
        <p
          v-if="error || transportError || data?.error"
          class="error"
          role="alert"
        >
          <AppIcon name="alert" />{{ error || friendlyError(transportError || data?.error || "") }}
          <button
            v-if="data?.status === 'capture_error'"
            @click="action('recover')"
          >
            重新连接剪贴板
          </button>
        </p>
        <p v-if="data?.tray.feedback && !(data.lastAction?.status === 'preparing' && data.nativeRuntime?.typing?.phase)" class="hint" role="status">{{ data.tray.feedback }}</p>
        <p v-if="message" class="notice" role="status"><AppIcon name="check" />{{ message }}</p>
      </div>
      <section v-if="typingLabel" aria-label="直接输入进度" class="notice" role="status">
        <p>{{ typingLabel }}</p>
        <button v-if="data?.nativeRuntime?.typing?.active" @click="action('stop-typing')">停止输入</button>
      </section>
      <section v-if="page === 'home'" aria-label="截图处理">
        <section aria-label="原生截图与输入">
          <h2>原生截图与输入</h2>
          <div class="button-row">
            <button :disabled="busy || !data || data.settings.paused || data.nativeRuntime?.capturing" @click="action('capture-monitor')">截取所选显示器</button>
            <button :disabled="busy || !data?.typingAvailable || data?.nativeRuntime?.typing?.active" @click="action('type-latest')">输入最新结果</button>
            <button :disabled="busy || !data || data.nativeRuntime?.typing?.active" @click="action('type-clipboard')">输入剪贴板文本</button>
          </div>
          <p class="hint">整屏截图可只保存文件；在设置中选择显示器和去向。输入启动后，请在准备时间内切换到其他应用；Esc 停止。</p>
          <p v-if="nativeCapturing || data?.nativeRuntime?.capturing" role="status">正在截取显示器…</p>
          <p v-if="data?.nativeRuntime?.captureStatus && data.nativeRuntime.captureStatus !== 'saved' && data.nativeRuntime.captureStatus !== 'capturing'" class="error">{{ friendlyError(data.nativeRuntime.captureStatus) }}</p>
          <p v-if="data?.nativeCapture?.path" class="hint path">截图已保存：{{ data.nativeCapture.path }}</p>
          <p v-if="data?.nativeCapture && !['off', 'succeeded'].includes(data.nativeCapture.clipboard)" class="error">图片剪贴板：{{ friendlyError(data.nativeCapture.clipboard) }}</p>
        </section>
        <div class="agent-current">
          <div>
            <span class="hint">当前 AI 助手</span>
            <h2>
              {{ data?.remote?.mode === 'remote' ? `${data.remote.target?.deviceId} · ${data.remote.target?.id}` : selectedAgent ? selectedAgent.id : "添加你的第一个 AI 助手" }}
            </h2>
            <p class="hint">
              {{
                data?.remote?.mode === 'remote' ? 'Remote · 截图经私人 Relay 发送到所选电脑' : selectedAgent
                  ? providerText[selectedAgent.provider]
                  : "支持 Codex、Claude Code 和 GLM"
              }}
            </p>
          </div>
          <button @click="page = data?.remote?.mode === 'remote' ? 'settings' : 'agents'">
            <AppIcon name="agent" />{{ data?.setupRequired ? "开始设置" : "更换助手" }}
          </button>
        </div>
        <p v-if="selectedAgent?.gateway?.connectionStatus === 'not_tested'" class="notice">
          Token 已本地保存。可直接提交截图；测试连接可选且可能产生费用。
        </p>
        <div class="section-heading">
          <h2>截图处理</h2>
          <button
            @click="action('current')"
            :disabled="busy || !data || data.setupRequired"
          >
            <AppIcon name="clipboard" />处理剪贴板图片
          </button>
        </div>
        <div class="preview" v-if="data?.pending">
          <img :src="data.pending" alt="待确认的截图预览" />
          <div>
            <strong>等待确认</strong>
            <p>尚未发送。点击提交后，仅此预览会交给当前助手；云模型可能收费。</p>
            <button class="primary" @click="action('submit')" :disabled="busy">
              <AppIcon name="send" />提交图片</button
            ><button @click="action('composer-add-pending')" :disabled="busy || (data?.composer?.length ?? 0) >= 5"><AppIcon name="images" />加入多图任务</button><button @click="action('discard')" :disabled="busy"><AppIcon name="trash" />丢弃</button>
          </div>
        </div>
        <div v-else class="empty">
          <strong>{{
            data?.setupRequired ? "配置 Agent 后开始使用" : "等待下一张截图"
          }}</strong>
          <p>
            {{
              data?.setupRequired
                ? "点击“添加 AI 助手”，选择本机程序并保存。"
                : "使用 Win + Shift + S 复制图片。确认模式会先显示预览。"
            }}
          </p>
        </div>

        <section class="composer" aria-label="多图任务">
          <div class="section-heading"><h2>多图任务 · 2–5 张</h2><button @click="pickImages" :disabled="busy || (data?.composer?.length ?? 0) >= 5"><AppIcon name="image" />添加图片文件…</button></div>
          <p class="hint">按列表顺序作为一个任务提交。编辑期间监听不会改变列表；提交时使用当前选择的助手。</p>
          <button @click="action('composer-add-clipboard')" :disabled="busy || (data?.composer?.length ?? 0) >= 5"><AppIcon name="clipboard" />添加当前剪贴板图片</button>
          <ol class="composer-images" v-if="data?.composer?.length">
            <li v-for="(image, index) in data.composer" :key="image.id">
              <img :src="image.preview" :alt="`第 ${index + 1} 张截图`" />
              <div><strong>第 {{ index + 1 }} 张</strong><div class="task-actions">
                <button :aria-label="`上移第 ${index + 1} 张`" :disabled="busy || index === 0" @click="action('composer-move', { index, to: index - 1 })"><AppIcon name="up" />上移</button>
                <button :aria-label="`下移第 ${index + 1} 张`" :disabled="busy || index === data.composer.length - 1" @click="action('composer-move', { index, to: index + 1 })"><AppIcon name="down" />下移</button>
                <button :aria-label="`移除第 ${index + 1} 张`" :disabled="busy" @click="action('composer-remove', { index })"><AppIcon name="trash" />移除</button>
              </div></div>
            </li>
          </ol>
          <div class="task-actions" v-if="data?.composer?.length">
            <button class="primary" :disabled="busy || data.setupRequired || data.composer.length < 2" @click="action('composer-submit')"><AppIcon name="send" />提交 {{ data.composer.length }} 张为一个任务</button>
            <button :disabled="busy" @click="action('composer-discard')"><AppIcon name="trash" />丢弃多图草稿</button>
          </div>
        </section>
        <p v-if="data?.folderError" class="error" role="status">{{ errorText[data.folderError] || data.folderError }}</p>
        <div class="capture-toolbar">
          <span class="hint" role="status" aria-label="当前捕获状态">{{ captureSummary }}</span
          ><button @click="page = 'settings'"><AppIcon name="settings" />捕获与输出设置</button
          ><button
            v-if="data && (!data.setupRequired || !!data.nativeOptions?.directory || data.nativeOptions?.clipboard)"
            @click="action('pause', { paused: !data.settings.paused })"
            :disabled="busy"
          >
            <AppIcon :name="data.settings.paused ? 'play' : 'pause'" />{{ data.settings.paused ? "恢复捕获" : "暂停捕获" }}
          </button>
        </div>
      </section>
      <section v-if="page === 'agents'" aria-label="AI 助手管理">
        <div class="section-heading">
          <p class="hint">
            选择一个默认助手处理接下来的截图。已有任务始终使用原配置。
          </p>
          <button class="primary" @click="addProfile" :disabled="busy || !data">
            <AppIcon name="plus" />添加 AI 助手
          </button>
        </div>
        <div v-if="!activeProfiles.length" class="empty">
          <h2>让截图找到你的 AI 助手</h2>
          <p>
            选择 Codex、Claude Code 或 GLM。自动检测本机程序，Token 仅存入
            Windows 凭据管理器。
          </p>
          <button class="primary" @click="addProfile" :disabled="!data">
            添加第一个助手
          </button>
        </div>
        <article
          v-for="agent in activeProfiles"
          :key="agent.id + agent.version"
          class="agent-entry"
        >
          <div class="section-heading">
            <div>
              <h2>
                {{ agent.id }}
                <span v-if="isSelectedAgent(agent)" class="badge">默认</span>
              </h2>
              <p class="hint">
                {{ providerText[agent.provider] || agent.provider }}
              </p>
            </div>
            <button
              v-if="!isSelectedAgent(agent)"
              @click="
                action('select-agent', { id: agent.id, version: agent.version })
              "
              :disabled="busy"
            >
              设为默认
            </button>
          </div>
          <p v-if="agent.gateway" class="hint path">
            {{ agent.gateway.model }} ·
            {{
              agent.gateway.vision === "not-verified"
                ? "未验证图片能力"
                : "已验证连接"
            }}
            ·
            {{
              agent.gateway.credentialStatus === "available"
                ? "Token 已保存"
                : "请检查 Token"
            }}
          </p>
          <div class="profile-actions">
            <button @click="editProfile(agent)" :disabled="busy">
              <AppIcon name="edit" />编辑配置</button
            ><button
              v-if="agent.gateway"
              @click="editProfile(agent)"
              :disabled="busy"
            >
              更换 Token</button
            ><button
              v-if="agent.gateway"
              @click="testConnection(agent)"
              :disabled="busy"
            >
              测试连接</button
            ><button
              :disabled="busy || !agent.removable"
              @click="archive(agent, true)"
            >
              移除 Agent
            </button>
          </div>
          <p v-if="!agent.removable" class="hint">
            当前默认助手需要保留；选择另一助手后可移除。
          </p>
        </article>
        <details v-if="removedProfiles.length">
          <summary>已移除的助手（{{ removedProfiles.length }}）</summary>
          <article
            v-for="agent in removedProfiles"
            :key="agent.id + agent.version"
            class="agent-entry"
          >
            <h2>{{ agent.id }}</h2>
            <p class="hint">历史记录和原配置已保留。</p>
            <button @click="archive(agent, false)" :disabled="busy">
              恢复 Agent
            </button>
          </article>
        </details>
        <details class="cleanup-panel">
          <summary>高级清理</summary>
          <p class="hint">
            每次编辑助手都会保留一份旧配置，供原有任务使用。这里可以清理不再需要的旧配置和凭据，当前助手和任务仍需使用的配置会保留。
          </p>
          <p
            v-if="!historicalProfiles.length && !removedProfiles.length"
            class="hint"
          >
            没有可列出的旧配置。
          </p>
          <div
            v-for="agent in [...historicalProfiles, ...removedProfiles]"
            :key="agent.id + agent.version"
            class="profile-entry"
          >
            <p>{{ agent.id }} · {{ agent.version }}</p>
            <p class="hint">
              {{
                agent.referenced
                  ? "已有任务仍需使用，暂时保留。"
                  : agent.deletable
                    ? "旧配置已不再使用，可以清理。"
                    : "此配置仍需保留。"
              }}
            </p>
            <button
              v-if="agent.deletable"
              @click="permanentlyDelete(agent)"
              :disabled="busy"
            >
              永久删除未引用版本
            </button>
          </div>
          <div class="cleanup-actions">
            <button
              @click="action('cleanup-unused-agents')"
              :disabled="
                busy ||
                ![...historicalProfiles, ...removedProfiles].some(
                  (agent) => agent.deletable,
                )
              "
            >
              清理不再使用的旧配置
            </button>
          </div>
        </details>
        <button @click="action('discover-agents')" :disabled="busy">
          重新检测本机程序
        </button>
      </section>
      <section
        v-if="page === 'settings'"
        class="settings-page"
        aria-label="应用设置"
      >
        <fieldset aria-label="跨设备处理">
          <legend>跨设备处理</legend>
          <p class="hint">Remote 会将截图经你的私人 VPS 发送给所选电脑。Local 使用本机助手；现有任务保持原来的处理位置。</p>
          <label>新任务处理位置
            <select aria-label="新任务处理位置" :value="data?.remote?.mode ?? 'local'" :disabled="busy" @change="action('remote-configure', { mode: ($event.target as HTMLSelectElement).value })">
              <option value="local">Local · 本机</option><option value="remote" :disabled="!data?.remote?.target || !data.remote.hasToken">Remote · 远程电脑</option>
            </select>
          </label>
          <label>Relay HTTPS 地址<input aria-label="Relay HTTPS 地址" v-model="remoteUrl" placeholder="https://relay.example.com" @input="remoteDirty = true" /></label>
          <label>这台电脑的名称<input aria-label="这台电脑的名称" v-model="remoteLabel" maxlength="80" @input="remoteDirty = true" /></label>
          <label>设备 Token<input aria-label="设备 Token" type="password" v-model="remoteToken" autocomplete="off" @input="remoteDirty = true" :placeholder="data?.remote?.hasToken ? '已安全保存；输入新 Token 可更新' : '填写部署时为这台电脑生成的 Token'" /></label>
          <p class="hint">Token 仅保存在 Windows 凭据管理器中。A、B 使用各自的设备 Token。</p>
          <div class="button-row">
            <button :disabled="busy" @click="saveRemote">保存连接</button>
            <button :disabled="busy || !data?.remote?.hasToken || remoteDirty" @click="action('remote-test')">测试连接 / 刷新电脑</button>
            <button :disabled="busy || !data?.remote?.hasToken" @click="action('remote-delete-token')">删除设备 Token</button>
          </div>
          <p role="status">{{ data?.remote?.status === 'connected' ? 'Relay 已连接' : data?.remote?.hasToken ? 'Relay 未连接 / 等待同步' : '尚未配置 Relay' }}<span v-if="data?.remote?.lastSync"> · 上次同步 {{ new Date(data.remote.lastSync).toLocaleTimeString() }}</span></p>
          <p v-if="data?.remote?.error" class="error">{{ friendlyError(data.remote.error) }} · {{ data.remote.error }}</p>
          <label>远程电脑及已批准 Agent
            <select aria-label="远程电脑及已批准 Agent" :value="remoteSelection" :disabled="busy || !data?.remote?.hasToken" @change="selectRemote">
              <option value="" disabled>发送到另一台电脑时，在此选择助手</option>
              <option v-if="remoteTargetUnavailable" :value="remoteSelection" disabled>原目标暂不可选，请刷新或重新选择</option>
              <optgroup v-for="group in remoteGroups" :key="group.deviceId" :label="group.label">
                <option v-for="option in group.options" :key="option.key" :value="option.key">{{ option.label }}</option>
              </optgroup>
            </select>
          </label>
          <p v-if="selectedRemoteComputer" class="hint">已选远程电脑：{{ selectedRemoteComputer }}</p>
          <p class="hint">本机作为 B 接收任务时，无需选择远程目标。请在 A 电脑选择本机及其助手；“对方默认”表示该电脑当前选中的助手。</p>
          <p v-if="!remoteGroups.length && data?.remote?.status === 'connected'" class="hint">尚未发现其他电脑的当前助手。只在本机接收任务时，可直接开启下方接收开关。</p>
          <p v-if="localReceiverAgents" class="hint">本机可接收任务的当前助手：{{ localReceiverAgents }}</p>
          <label class="check"><input type="checkbox" :checked="data?.remote?.receive" :disabled="busy || !data?.remote?.hasToken || data.setupRequired" @change="action('remote-configure', { receive: ($event.target as HTMLInputElement).checked })" />在本机接收远程任务（与本机任务共用一个执行槽）</label>
          <button :disabled="busy || !data?.remote?.hasToken" @click="action('remote-retry')">重试上传 / 同步结果</button>
          <p class="hint">离线任务保留在这台电脑上，不会转到 Local 执行。暂停接收仅影响下一项远程任务，当前 Agent 会继续完成。</p>
        </fieldset>
        <fieldset class="theme-picker">
          <legend>外观</legend>
          <p class="hint">主题立即生效，并在下次打开时保留。</p>
          <div role="group" aria-label="主题">
            <button
              :aria-pressed="theme === 'dark'"
              @click="changeTheme('dark')"
            >
              <AppIcon name="moon" />深色</button
            ><button
              :aria-pressed="theme === 'light'"
              @click="changeTheme('light')"
            >
              <AppIcon name="sun" />浅色
            </button>
          </div>
        </fieldset>
        <fieldset aria-label="原生截图与直接输入设置" @input="nativeDirty = true" @change="nativeDirty = true">
          <legend>原生截图与直接输入</legend>
          <label>截图显示器<select aria-label="截图显示器" v-model="nativeOptions.monitor">
            <option value="">当前主显示器</option>
            <option v-if="nativeOptions.monitor && !monitors.some(m => m.id === nativeOptions.monitor)" :value="nativeOptions.monitor">{{ nativeOptions.monitor }}（点击刷新确认连接）</option>
            <option v-for="m in monitors" :key="m.id" :value="m.id">{{ m.id }} · {{ m.width }} × {{ m.height }}{{ m.primary ? ' · 主显示器' : '' }}</option>
          </select></label>
          <button :disabled="busy" @click="refreshMonitors">刷新显示器</button>
          <label class="check"><input type="checkbox" v-model="nativeOptions.save" />保存截图 PNG 文件</label>
          <label v-if="nativeOptions.save">截图保存目录<input aria-label="截图保存目录" v-model="nativeOptions.directory" spellcheck="false" /></label>
          <button v-if="nativeOptions.save" :disabled="busy" @click="pickNativeDirectory">选择截图保存目录…</button>
          <label class="check"><input type="checkbox" v-model="nativeOptions.submit" />同时交给所选 Agent（遵循确认/自动与暂停设置）</label>
          <label class="check"><input type="checkbox" v-model="nativeOptions.clipboard" />同时将截图图片写入剪贴板（覆盖当前内容）</label>
          <p class="hint">默认只保存文件，不读取或改写剪贴板。若勾选提交，处理结果仍使用独立的“结果去向”设置。4K 按实际像素保存；HDR 当前按 SDR 输出。区域框选尚未提供。</p>
          <label>输入准备时间（毫秒）<input aria-label="输入准备时间（毫秒）" type="number" min="500" max="10000" step="100" v-model.number="nativeOptions.delayMs" /></label>
          <label>输入速度（字符/秒）<input aria-label="输入速度（字符/秒）" type="number" min="1" max="200" v-model.number="nativeOptions.charsPerSecond" /></label>
          <p class="hint">直接输入仅手动启动，无需先复制结果，手动剪贴板模式同样可用。界面按钮允许在准备时间内选目标；全局快捷键保持触发时的目标，不抢焦点。目标改变、Esc、停止或退出均会终止；单次最多 5 分钟。部分应用或管理员窗口可能拒绝模拟输入，请检查已输入内容，不会自动改用粘贴。</p>
          <button :disabled="busy || !nativeDirty" @click="applyNative">保存截图与输入设置</button>
        </fieldset>
        <h2><AppIcon name="camera" />捕获</h2>
        <form
          @submit.prevent="apply"
          @change="dirty = true"
          @input="dirty = true"
        >
          <label class="check"
            ><input
              type="checkbox"
              v-model="enabled"
              :disabled="data?.setupRequired"
            />监听剪贴板中的新图片</label
          >
          <label class="check"><input type="checkbox" v-model="folderEnabled" :disabled="data?.setupRequired" />监听截图文件夹（仅此目录）</label>
          <template v-if="folderEnabled">
            <label>截图文件夹<input v-model="folderDirectory" type="text" placeholder="请选择独立的截图目录" spellcheck="false" /></label>
            <button type="button" @click="pickCaptureFolder"><AppIcon name="folder" />选择截图文件夹…</button>
            <p class="hint">仅 PNG/JPEG/WebP，文件完成写入后处理；启动、恢复和切换目录时跳过已有文件。不能与应用数据或结果保存目录重叠。</p>
          </template>
          <label
            >提交方式<select v-model="mode">
              <option value="confirm">确认后提交</option>
              <option value="auto">自动提交</option>
            </select></label
          >
          <label v-if="mode === 'auto'" class="consent"
            ><input
              type="checkbox"
              v-model="autoConsent"
            />我同意新截图自动发送给所选 Agent。云模型会收到图片。</label
          >
          <p class="hint">
            启动和恢复时会跳过已存在的图片。确认预览只保留在内存。
          </p>
          <h2><AppIcon name="file" />结果去向</h2>
          <p class="hint">
            历史始终保留。剪贴板、Markdown 保存和 Windows 通知可独立启用。
          </p>
          <label
            >剪贴板返回<select v-model="clipboard">
              <option value="off">关闭</option>
              <option value="manual">手动复制</option>
              <option value="smart">自动复制 · 保护后来复制的内容（Smart）</option>
              <option value="always">自动复制 · 总是覆盖（Always）</option>
            </select></label
          >
          <label>自动复制内容<select v-model="clipboardPayload"><option value="text">文本 · 粘贴到编辑器</option><option value="files">Markdown 文件 · 粘贴到资源管理器</option></select></label>
          <label class="check"><input type="checkbox" v-model="notification" />完成时显示 Windows 通知</label>
          <p class="hint">关闭所有输出后，结果仍保留在历史中。系统通知可能被 Windows 设置隐藏。</p>
          <label v-if="clipboard === 'always'" class="consent"
            ><input
              type="checkbox"
              v-model="alwaysConsent"
            />我同意结果自动覆盖剪贴板。</label
          >
          <label class="check"
            ><input type="checkbox" v-model="save" />自动保存 Markdown</label
          >
          <template v-if="save"
            ><label
              >本地保存目录<input
                type="text"
                v-model="directory"
                placeholder="D:\Shot2Agent Results"
                spellcheck="false" /></label
            ><button type="button" @click="pickSaveDirectory">
              <AppIcon name="folder" />选择文件夹…
            </button></template
          >
          <button class="primary" type="submit" :disabled="busy || !data">
            <AppIcon name="save" />应用设置</button
          ><span v-if="dirty" class="hint unsaved">尚未保存</span>
        </form>
        <details class="hotkeys">
          <summary><AppIcon name="keyboard" />全局快捷键与操作</summary>
          <p id="hotkey-format" class="hint">
            默认关闭。填写组合键文字，例如 Ctrl+Alt+P；支持 Ctrl+Alt、Ctrl+Shift 或 Alt+Shift 加一个大写字母或数字。
          </p>
          <form @submit.prevent="applyHotkeys">
            <label v-for="item in globalActions" :key="item.id"
              >{{ item.label
              }}<input
                type="text"
                v-model="hotkeys[item.id]"
                @input="hotkeyDirty = true; hotkeyErrorCode = ''; hotkeyMessage = ''"
                aria-describedby="hotkey-format hotkey-feedback"
                placeholder="未启用"
                spellcheck="false" /></label
            ><button type="submit" :disabled="busy || !data"><AppIcon name="save" />保存快捷键</button>
          </form>
          <div id="hotkey-feedback" aria-live="polite">
            <p v-if="hotkeyErrorCode" class="error" role="alert">
              {{ errorText[hotkeyErrorCode] || "快捷键未能保存。请保留下方错误代码，以便定位原因。" }}
              <span class="hint path">错误代码：{{ hotkeyErrorCode }}</span>
            </p>
            <p v-else-if="hotkeyMessage" class="notice" role="status">{{ hotkeyMessage }}</p>
          </div>
          <p class="hint">
            原生状态：{{ data?.hotkeyStatus || "尚未连接" }}
            <span v-if="hotkeyDirty">· 尚未保存</span>
          </p>
          <p class="hint">立即操作（无需配置快捷键）</p>
          <div class="quick-actions" role="group" aria-label="立即操作">
            <button
              v-for="item in globalActions"
              :key="item.id"
              :disabled="busy || !data"
              @click="action('action', { action: item.id })"
            >
              {{ item.label }}
            </button>
          </div>
          <p v-if="data?.lastAction" class="hint">
            {{
              globalActions.find((a) => a.id === data?.lastAction?.action)
                ?.label
            }}：{{ actionFeedback(data.lastAction.status) }}
          </p>
        </details>
        <section aria-label="文件复制缓存">
          <h3><AppIcon name="archive" />文件复制缓存</h3>
          <p class="hint">{{ data?.fileCache?.files ?? 0 }} / 1000 个文件 · {{ ((data?.fileCache?.bytes ?? 0) / 1048576).toFixed(2) }} / 256 MiB</p>
          <p class="hint">只清理超过 10 分钟的旧复制缓存。保留当前剪贴板引用的文件；导出的 Markdown、历史和截图不受影响。</p>
          <p v-if="data?.fileCache?.error" class="error">{{ errorText[data.fileCache.error] }}</p>
          <button :disabled="busy || !data || !!data.fileCache?.error" @click="cleanFileCache"><AppIcon name="trash" />清理旧复制缓存</button>
          <p class="path">{{ data?.fileCache?.directory }}</p>
        </section>
        <section aria-label="版本与备份">
          <h3><AppIcon name="drive" />Shot2Agent {{ data?.appVersion }}</h3>
          <div v-if="data?.launchMode === 'staging'" class="staging-tools">
            <p class="hint">隔离 Fake 验收：仅使用合成图片。模拟故障后可重新启动 Start acceptance.cmd，得到全新的测试数据目录。</p>
            <div class="quick-actions" role="group" aria-label="隔离故障测试">
              <button @click="action('staging-fault', { kind: 'capture' })" :disabled="busy">模拟捕获故障</button>
              <button @click="action('staging-fault', { kind: 'worker' })" :disabled="busy">模拟处理服务故障</button>
              <button @click="action('staging-fault', { kind: 'coordinator' })" :disabled="busy">模拟协调器失联</button>
            </div>
          </div>
          <p class="hint">Local · 完整构建提交见解压目录 BUILD.txt。</p>
          <p class="path">数据目录：{{ data?.root }}</p>
          <p class="hint">升级前从托盘退出应用，再复制整个数据目录作为备份。完整解压新版到另一个目录后启动，会继续使用原数据。Token 由 Windows 凭据管理器保管，不包含在目录备份中；换电脑需重新填写。回退时先退出应用，保留当前数据副本后恢复整份旧备份。不要在运行时只复制 SQLite 文件。</p>
        </section>
        <details class="advanced">
          <summary>高级设置</summary>
          <details>
            <summary>投递失败重试</summary>
            <p class="hint">只重试可确认的暂时失败；不会重新执行 Agent。</p>
            <label
              >额外尝试次数<input
                type="number"
                v-model.number="maxRetries"
                min="0"
                max="10"
                step="1"
            /></label>
            <label
              >初始等待（毫秒）<input
                type="number"
                v-model.number="backoffMs"
                min="10"
                max="1000"
                step="1"
            /></label>
            <label
              >每通道时间预算（毫秒）<input
                type="number"
                v-model.number="budgetMs"
                min="100"
                max="10000"
                step="1"
            /></label>
          </details>
          <details>
            <summary>安装路径和检测结果</summary>
            <div
              v-for="(candidate, index) in data?.discovery"
              :key="index"
              class="hint path"
            >
              {{ candidate.provider }} · {{ candidate.version || "" }} ·
              {{ cliStatusText[candidate.status] || candidate.status }} ·
              {{ candidate.path }}
            </div>
          </details>
          <details>
            <summary>本地数据位置</summary>
            <p class="path">{{ data?.root }}</p>
          </details>
        </details>
      </section>
      <section
        v-if="page === 'home' || page === 'history'"
        aria-label="任务列表"
      >
        <label v-if="page === 'history'"
          ><AppIcon name="search" />搜索历史<input
            type="search"
            maxlength="200"
            v-model="search"
            placeholder="搜索全部历史：摘要、助手或状态"
        /></label>
        <div class="section-heading history-heading">
          <h2>
            {{ page === "home" ? "最近处理" : "历史记录" }}
            <span>{{ data?.total ?? 0 }}</span>
          </h2>
          <span class="hint">{{
            page === "home" ? "仅显示最近 3 项" : "本机私有历史"
          }}</span>
        </div>
        <template v-if="page === 'history'">
          <div class="profile-actions">
            <button @click="selectVisibleTasks" :disabled="!safeTasks.length">
              选择可删除的已结束任务</button
            ><button
              @click="deleteSelectedTasks"
              :disabled="busy || !selectedTasks.length"
            >
              删除所选（{{ selectedTasks.length }}）</button
            ><button
              @click="clearHistory('completed')"
              :disabled="busy || !data?.total"
            >
              清除成功历史</button
            ><button
              @click="clearHistory('all-safe')"
              :disabled="busy || !data?.total"
            >
              清除所有可安全删除的历史
            </button>
          </div>
          <p class="hint">
            排队、运行中任务会保留。执行结果不确定的旧任务可在确认 Agent
            停止后单独或批量删除。删除历史不会删除保存到其他目录的 Markdown
            文件。
          </p>
          <p v-if="data?.lastHistoryCleanup" class="notice">
            最近清理：删除 {{ data.lastHistoryCleanup.deleted }} 项，保留
            {{ data.lastHistoryCleanup.preservedActive }} 个活动任务和
            {{ data.lastHistoryCleanup.preservedUnknown }} 个结果不确定任务。
          </p>
          <p class="hint" v-if="!data?.total">
            尚无任务。配置 Agent 后开启捕获并应用设置。
          </p>
        </template>
        <ul class="tasks">
          <li v-for="task in visibleTasks" :key="task.id">
            <div class="section-heading">
              <label v-if="page === 'history'" class="check task-check"
                ><input
                  type="checkbox"
                  :aria-label="'选择任务 ' + task.id.slice(0, 8)"
                  :checked="selectedTasks.includes(task.id)"
                  :disabled="busy || !isDeletable(task)"
                  @change="
                    toggleTask(
                      task.id,
                      ($event.target as HTMLInputElement).checked,
                    )
                  " /></label
              ><button
                class="task-title"
                @click="openTask(task.id)"
                :disabled="busy"
              >
                <strong>{{
                  (task.error && errorText[task.error]) ||
                  task.summary ||
                  taskStatus[task.status] ||
                  task.status
                }}</strong
                ><span
                  >{{
                    new Date(task.createdAt).toLocaleString("zh-CN", {
                      hour12: false,
                    })
                  }}
                  · {{ providerText[task.provider || ""] || task.provider }} ·
                  {{ task.profileId }} · {{ task.id.slice(0, 8) }} ·
                  {{ task.remote?.upload === 'pending_upload' ? '等待上传' : task.remote?.upload === 'upload_failed' ? '上传失败' : taskStatus[task.status] || task.status }} · {{ task.mode === 'remote' ? `Remote → ${task.remote?.targetWorkerId}` : 'Local' }}</span
                ></button
              ><button
                v-if="
                  page === 'history' &&
                  isDeletable(task) &&
                  task.status !== 'execution_unknown'
                "
                @click="deleteTask(task.id)"
                :disabled="busy"
              >
                删除
              </button>
            </div>
            <p v-if="page === 'history'" class="hint">
              剪贴板：{{
                receiptText[task.clipboard?.status || ""] ||
                task.clipboard?.status ||
                "等待结果"
              }}
              · 保存：{{
                receiptText[task.save?.status || ""] ||
                task.save?.status ||
                "等待结果"
              }}
            </p>
            <p v-if="page === 'history'" class="hint">{{ task.imageCount ?? 1 }} 张图片 · 通知：{{ receiptText[task.notification?.status || ''] || task.notification?.status || '等待结果' }}<span v-if="task.notification?.code"> · {{ friendlyError(task.notification.code) }}</span></p>
            <p class="hint" v-if="task.clipboard?.code">
              剪贴板：{{ friendlyError(task.clipboard.code) }} ·

              {{ task.clipboard.attempts }} 次
            </p>
            <p class="hint" v-if="task.save?.code">
              保存：{{ friendlyError(task.save.code) }} ·
              {{ task.save.attempts }} 次
            </p>
            <p class="error" v-if="task.error">
              {{ friendlyError(task.error) }} · 此任务不会自动重跑。
            </p>
            <p
              class="notice"
              v-if="task.clipboard?.status === 'blocked_by_clipboard_change'"
            >
              已保留你后来复制的内容，可手动复制此结果。
            </p>
            <p class="hint" v-if="task.retryableChannels?.length">结果已保留。重试只重新复制、保存或通知，不会重新请求 AI。</p>
            <p v-if="task.remote?.error" class="error">{{ friendlyError(task.remote.error) }} · {{ task.remote.error }}</p>
            <details v-if="task.error || task.clipboard?.code || task.save?.code || task.notification?.code" class="hint">
              <summary>技术详情</summary>
              <p>{{ task.error }} {{ task.clipboard?.code }} {{ task.clipboard?.classification }} {{ task.save?.code }} {{ task.save?.classification }} {{ task.notification?.code }}</p>
            </details>
            <div class="task-actions" v-if="task.status === 'succeeded'">
              <button @click="action('copy', { id: task.id })" :disabled="busy">
                <AppIcon name="copy" />复制文本</button
              ><button @click="action('type-result', { id: task.id })" :disabled="busy || data?.nativeRuntime?.typing?.active">输入此结果</button
              ><button @click="action('copy-files', { id: task.id })" :disabled="busy"><AppIcon name="copy-file" />复制文件</button><button
                v-if="task.retryableChannels?.length"
                @click="action('retry-delivery', { id: task.id })"
                :disabled="busy"
              >
                <AppIcon name="retry" />重试结果投递
              </button>
            </div>
            <div class="notice" v-if="task.status === 'execution_unknown'">
              <p>
                执行结果不确定，不会自动重跑。确认对应 Agent
                已停止后，可以删除这条历史。
              </p>
              <button
                :disabled="busy || !data?.canReviewUnknownHistory"
                @click="deleteTask(task.id)"
              >
                确认停止后删除</button
              ><span v-if="!data?.canReviewUnknownHistory" class="hint"
                >请等待当前 Agent 执行及清理结束。</span
              >
            </div>
            <p
              class="hint"
              v-if="['queued', 'leased', 'running'].includes(task.status)"
            >
              任务正在排队或运行；不会因为清理历史而取消。
            </p>
          </li>
        </ul>
        <button
          v-if="page === 'home'"
          class="view-history"
          @click="page = 'history'"
        >
          查看全部历史<AppIcon name="next" />
        </button>
        <p
          v-if="page === 'history' && data?.total && !visibleTasks.length"
          class="empty"
        >
          没有匹配的任务，试试其他关键词。
        </p>
      </section>
      <div
        v-if="page === 'history' && (data?.historyTotal ?? 0) > 0"
        class="capture-toolbar"
        aria-label="历史分页"
      >
        <span class="hint"
          >{{ historyOffset + 1 }}–{{
            Math.min(historyOffset + 50, data?.historyTotal ?? 0)
          }}
          / {{ data?.historyTotal }} 项</span
        >
        <button
          :disabled="busy || historyOffset === 0"
          @click="historyPage(Math.max(0, historyOffset - 50))"
        >
          上一页
        </button>
        <button
          :disabled="busy || historyOffset + 50 >= (data?.historyTotal ?? 0)"
          @click="historyPage(historyOffset + 50)"
        >
          下一页
        </button>
      </div>
      <dialog
        ref="resultDialog"
        class="result-dialog"
        aria-label="结果详情"
        @cancel.prevent="closeResult"
      >
        <article v-if="detail" class="result">
          <div class="section-heading">
            <h2 ref="resultTitle" tabindex="-1">结果详情</h2>
            <button @click="closeResult">关闭详情</button>
          </div>
          <p class="hint">{{ taskStatus[detail.status] || detail.status }}</p>
          <p v-if="detail.gateway" class="hint path">
            {{ detail.gateway.endpoint }} · {{ detail.gateway.model }}
          </p>
          <pre>{{
            detail.result?.contentMarkdown ||
            detail.result?.errorCode ||
            "暂无结果；完成后重新打开详情。"
          }}</pre>
        </article>
      </dialog>
    </main>
    <dialog
      ref="editor"
      class="agent-dialog"
      aria-labelledby="editor-title"
      @cancel.prevent="closeEditor"
    >
      <template v-if="showProfileForm && data"
        ><div class="section-heading">
          <h2 id="editor-title" ref="editorTitle" tabindex="-1">
            {{ editVersion ? "编辑 Agent 配置" : "添加 AI 助手" }}
          </h2>
          <button @click="closeEditor" :disabled="busy" aria-label="关闭编辑器">
            <AppIcon name="close" />关闭
          </button>
        </div>
        <p class="hint">
          {{
            editVersion
              ? "修改仅用于未来的任务。Token 不回显，留空沿用原凭据。"
              : "选择助手，自动发现本机程序并保存。不发起模型请求。"
          }}
        </p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <form @submit.prevent="saveProfile" @input="profileDirty = true">
          <label
            >Agent 类型<select
              v-model="setupProvider"
              @change="providerChanged"
            >
              <option disabled value="">请选择 Codex / Claude Code / GLM</option>
              <option value="codex">Codex CLI</option>
              <option value="claude">Claude Code 个人登录</option>
              <option value="claude-compatible-endpoint">
                GLM（通过 Claude Code）
              </option>
            </select></label
          >
          <label
            >本机安装<select
              :value="reuseExisting ? '__current__' : cliPath"
              @change="selectExecutable"
            >
              <option v-if="reuseExisting" value="__current__">
                使用已检测到的
                {{ setupProvider === "codex" ? "Codex" : "Claude Code" }}
              </option>
              <option value="">选择已发现的安装，或手动选文件</option>
              <option
                v-for="(candidate, index) in data.discovery.filter(
                  (c) =>
                    c.provider === providerForDiscovery() &&
                    c.status === 'unverified_auth',
                )"
                :key="index"
                :value="candidate.selectionPath || candidate.path"
              >
                {{ candidate.version }} · {{ candidate.path }}
              </option>
            </select></label
          >
          <label
            >程序路径<input
              type="text"
              v-model="cliPath"
              @input="reuseExisting = false"
              spellcheck="false"
          /></label>
          <div class="profile-actions">
            <button type="button" @click="pickExecutable">浏览 CLI 程序…</button
            ><span class="hint path">{{ cliPath || "尚未选择 CLI" }}</span>
          </div>
          <label
            >Agent 名称（小写英文、数字或短横线）<input
              required
              pattern="[a-z][a-z0-9-]{0,63}"
              type="text"
              v-model="profileId"
              placeholder="例如 my-codex"
              spellcheck="false"
          /></label>
          <details>
            <summary>高级配置 · 工作区与提示词</summary>
            <label
              >工作区<input
                type="text"
                v-model="workspace"
                placeholder="选择一个只读工作区"
                spellcheck="false"
            /></label>
            <div class="profile-actions">
              <button type="button" @click="pickWorkspace">选择文件夹…</button
              ><button
                type="button"
                @click="workspace = data.workspaceSuggestion"
              >
                使用 Shot2Agent 默认工作区
              </button>
            </div>
            <label
              >默认提示词<textarea
                v-model="prompt"
                rows="3"
                maxlength="10000"
              ></textarea>
            </label>
          </details>
          <template v-if="setupProvider === 'claude-compatible-endpoint'">
            <label
              >GLM 端点<input
                type="text"
                v-model="endpoint"
                list="endpoints"
              /><datalist id="endpoints">
                <option value="https://open.bigmodel.cn/api/anthropic">
                  国内 · BigModel
                </option>
                <option value="https://api.z.ai/api/anthropic">
                  国际 · Z.ai
                </option>
              </datalist></label
            >
            <label
              >模型<input
                type="text"
                v-model="model"
                placeholder="glm-5.3-flash"
                spellcheck="false"
            /></label>
            <label
              >GLM Token（仅输入；不会回显或保存为明文）<input
                type="password"
                v-model="token"
                autocomplete="new-password"
                spellcheck="false"
                placeholder="输入新 Token；编辑时留空可沿用已保存凭据"
            /></label>
            <p class="hint">
              保存仅将 Token 存入 Windows 凭据管理器，不会请求模型。新
              Token、端点或模型可直接用于您提交的截图。“测试连接”可选，可能产生费用；保存不会触发测试。
            </p>
          </template>
          <div class="dialog-footer">
            <button type="button" @click="closeEditor" :disabled="busy">
              取消</button
            ><button class="primary" type="submit" :disabled="busy || !data">
              {{ busy ? "正在保存…" : "保存 Agent" }}
            </button>
          </div>
        </form>
      </template>
    </dialog>
  </div>
</template>
