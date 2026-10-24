export interface NativeOptions {
  monitor: string; save: boolean; directory: string; submit: boolean; clipboard: boolean;
  delayMs: number; charsPerSecond: number;
}
export const nativeDefaults = (): NativeOptions => ({ monitor: '', save: true, directory: '', submit: false, clipboard: false, delayMs: 3000, charsPerSecond: 60 });

export const nativeErrorText: Record<string, string> = {
  CAPTURE_PAUSED: "截图已暂停，请先恢复捕获。",
  CAPTURE_BUSY: "正在截图，请稍候。",
  CAPTURE_DIRECTORY_REQUIRED: "请选择截图保存目录。",
  CAPTURE_OUTPUT_REQUIRED: "请至少选择一种截图去向。",
  CAPTURE_STORAGE_FAILED: "截图保存失败，请检查目录权限、磁盘空间及文件系统。",
  UNSAFE_CAPTURE_DIRECTORY: "截图目录不可用，请选择实际本地目录。",
  CAPTURE_UNSUPPORTED: "此设备不支持 Windows 原生截图。",
  CAPTURE_ACCESS_DENIED: "Windows 拒绝截图，请检查系统的屏幕捕获权限或限制。",
  CAPTURE_DEVICE_FAILED: "显示设备暂不可用，请检查显示器后重试。",
  CAPTURE_MONITORS_UNAVAILABLE: "未发现可用显示器。",
  CAPTURE_MONITOR_REMOVED: "所选显示器已断开，请刷新并重新选择。",
  CAPTURE_MONITOR_CHANGED: "截图时显示器尺寸发生变化，请重试。",
  CAPTURE_FRAME_TIMEOUT: "未收到屏幕画面，请确认桌面未锁定后重试。",
  CAPTURE_SETTINGS_CHANGED: "截图期间设置发生变化，未提交；请重新截图。",
  TYPING_EMPTY: "没有可输入的文字。",
  TYPING_BUSY: "正在输入，请先停止当前操作。",
  TYPING_TEXT_LIMIT: "文字过长或含有不支持的空字符，请选取较短的结果。",
  TYPING_INVALID_TARGET: "请选择其他应用的文字输入位置，然后重试。",
  TYPING_INJECTION_FAILED: "Windows 未接受全部输入，可能受权限限制。已停止，请检查已输入部分；不会自动重试或改用粘贴。",
  TYPING_FOCUS_CHANGED: "目标焦点已改变，输入已停止。请检查已输入部分。",
  TYPING_RELEASE_MODIFIERS: "请松开 Ctrl、Alt、Shift 和 Windows 键后重试。",
  TYPING_CANCELED: "输入已停止，已输入的内容保留。",
  TYPING_TIME_LIMIT: "已达到 5 分钟输入上限，剩余文字未发送。请检查已输入部分。",
  INVALID_NATIVE_SETTINGS: "请检查原生截图和输入设置的取值。",
  CAPTURE_INITIALIZATION_FAILED: "截图服务未能初始化，请退出应用后重试。",
  CAPTURE_SIZE_UNSUPPORTED: "显示器尺寸超过当前截图上限。",
  CAPTURE_ENCODE_FAILED: "屏幕画面未能转换成 PNG，请重试。",
  WINDOWS_CAPTURE_REQUIRED: "原生截图需要 Windows。",
  WINDOWS_TYPING_REQUIRED: "直接输入需要 Windows。",
  TYPING_INVALID_UNICODE: "剪贴板文字的 Unicode 编码无效。",
};
