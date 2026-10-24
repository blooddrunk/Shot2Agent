export interface NativeOptions {
  monitor: string; save: boolean; directory: string; submit: boolean; clipboard: boolean;
  delayMs: number; charsPerSecond: number;
}
export const nativeDefaults = (): NativeOptions => ({ monitor: '', save: true, directory: '', submit: false, clipboard: false, delayMs: 3000, charsPerSecond: 60 });
