import { nativeErrorText } from './native-options.ts';
/** Read-only presentation shared by the WebView and native tray. Never persisted. */
export interface TrayInput {
  setupRequired: boolean;
  status: string;
  folderError?: string;
  nativeOptions?: { save: boolean; directory: string; clipboard: boolean };
  pending: unknown;
  activity: { running: number; queued: number };
  settings: { enabled: boolean; folderEnabled?: boolean; paused: boolean };
  actions: { copy: boolean; retry: boolean; cycle: boolean; current: boolean };
  lastAction?: { action: string; status: string };
}
export const actionLabels: Record<string, string> = {
  'toggle-pause': '暂停 / 恢复截图监听', 'copy-latest': '复制最新结果',
  'retry-latest-delivery': '重试失败投递', 'cycle-agent': '切换 AI 助手', current: '提交剪贴板图片',
  'capture-monitor': '截取所选显示器', 'type-latest': '输入最新结果', 'type-history': '输入此结果', 'type-clipboard': '输入剪贴板文本', 'stop-typing': '停止输入',
};
export function actionFeedback(status: string): string {
  const known: Record<string, string> = {
    preparing: '准备输入，请选择目标并松开快捷键', CAPTURE_PAUSED: '截图已暂停，请先恢复', CAPTURE_DIRECTORY_REQUIRED: '请先设置截图保存目录', CAPTURE_MONITOR_REMOVED: '显示器已断开，请重新选择',
    succeeded: '操作完成', NO_COMPLETED_RESULT: '还没有可复制的结果，请先提交图片',
    NO_ELIGIBLE_FAILED_DELIVERY: '没有可重试的失败投递，可在历史中手动复制',
    DELIVERY_STILL_FAILED: '投递仍未完成，请在历史中查看原因；没有重新请求 AI',
    NO_OTHER_APPROVED_AGENT: '请先在 AI 助手页添加另一个助手',
    NO_CURRENT_IMAGE: '剪贴板中没有图片，请先截图', DUPLICATE_IMAGE: '刚刚已提交相同图片，请查看历史',
    CLIPBOARD_BUSY: '剪贴板被占用，请稍后手动复制', AGENT_SETUP_REQUIRED: '请先在 AI 助手页完成配置',
  };
  return known[status] ?? nativeErrorText[status] ?? '操作未完成，请打开应用查看原因；不要重复提交 AI 任务';
}
export function trayView(s?: TrayInput) {
  const online = !!s;
  const enabled = !!s && (s.settings.enabled || !!s.settings.folderEnabled);
  const nativeReady = !!s?.nativeOptions && ((s.nativeOptions.save && !!s.nativeOptions.directory) || s.nativeOptions.clipboard);
  const sources = s ? [s.settings.enabled && '剪贴板', s.settings.folderEnabled && '文件夹'].filter(Boolean).join(' + ') : '';
  const capture = !s ? '捕获状态不可用' : s.status === 'worker_error' ? '处理服务故障，请退出并重新打开' : s.status === 'capture_error' ? '捕获读取暂停，请重新连接剪贴板'
    : s.folderError ? '截图文件夹异常，请检查目录后应用设置'
    : !enabled ? '捕获已关闭' : s.settings.paused ? '捕获已暂停' : s.setupRequired ? '等待配置 AI 助手' : `正在监听新图片（${sources}）`;
  const work = !s ? '处理状态不可用' : s.status === 'worker_error' ? '处理服务已停止，请退出并重新打开'
    : s.activity.running ? `正在处理 ${s.activity.running} 项${s.activity.queued ? ` · 排队 ${s.activity.queued} 项` : ''}`
    : s.activity.queued ? `等待处理 ${s.activity.queued} 项` : '处理服务空闲';
  const pending = s?.pending ? '图片等待确认' : '';
  const error = !s || ['worker_error', 'capture_error'].includes(s.status) || !!s.folderError;
  const icon = error ? 'error' : s.activity.running ? 'running' : s.activity.queued ? 'queued'
    : pending ? 'pending' : enabled && s.settings.paused ? 'paused' : s.setupRequired || !enabled ? 'off' : 'monitoring';
  const label = { error: '需要处理', running: '正在处理', queued: '正在排队', pending: '等待确认', paused: '监听已暂停', off: s?.setupRequired ? '等待配置' : '监听未开启', monitoring: '正在监听' }[icon];
  const feedback = s?.lastAction ? `${actionLabels[s.lastAction.action] ?? '快捷操作'}：${actionFeedback(s.lastAction.status)}` : '';
  const tooltip = ['Shot2Agent', !online ? '处理服务失联，请退出并重新打开' : '', work, capture, pending, feedback].filter(Boolean).join(' · ').slice(0, 127);
  return { icon, label, capture, work, pending, tooltip, feedback, menu: {
    toggleLabel: s?.settings.paused ? '恢复截图监听' : '暂停截图监听',
    toggle: online && ((enabled && !s.setupRequired) || nativeReady) && !['worker_error', 'capture_error'].includes(s.status),
    copy: !!s?.actions.copy, retry: !!s?.actions.retry, cycle: !!s?.actions.cycle, current: !!s?.actions.current,
    capture: !!s && !s.settings.paused,
  } };
}
export type TrayViewState = ReturnType<typeof trayView>;
