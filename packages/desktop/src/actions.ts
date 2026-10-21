import type { TaskView } from '../../core/src/model.ts';
import { requireValue } from '../../core/src/model.ts';
import type { LocalApp } from '../../local/src/app.ts';
export const ACTIONS = ['toggle-pause', 'copy-latest', 'retry-latest-delivery', 'cycle-agent', 'current'] as const;
export type GlobalAction = typeof ACTIONS[number];
export type Hotkeys = Partial<Record<GlobalAction, string>>;
export function validateHotkeys(value: unknown): asserts value is Hotkeys {
  requireValue(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length <= 5, 'INVALID_HOTKEYS');
  const seen = new Set();
  for (const [action, key] of Object.entries(value)) {
    requireValue(ACTIONS.includes(action as GlobalAction) && typeof key === 'string' && /^(?:Ctrl\+Alt|Ctrl\+Shift|Alt\+Shift)\+[A-Z0-9]$/.test(key), 'INVALID_HOTKEY');
    requireValue(!seen.has(key), 'DUPLICATE_HOTKEY'); seen.add(key);
  }
}
/** Durable completion ordering; UUID is a deterministic tie break at millisecond precision. */
export function completedResults(app: LocalApp): TaskView[] {
  return app.list().filter(t => t.status === 'succeeded' && t.result?.status === 'succeeded')
    .sort((a, b) => b.result!.finishedAt - a.result!.finishedAt || b.submission.taskId.localeCompare(a.submission.taskId));
}
export function retryableChannels(app: LocalApp, t: TaskView): string[] {
  return (['save', 'clipboard'] as const).filter(channel => {
    if (channel === 'save' ? !app.config.saveDirectory : !['smart', 'always'].includes(app.config.clipboard)) return false;
    const receipt = app.state.get(t.submission.taskId, channel);
    // Hotkeys never replay interrupted/ambiguous writes or conflict protection.
    return receipt?.status === 'failed' && receipt.classification !== 'ambiguous' && receipt.classification !== 'conflict';
  });
}

export const retryableDelivery = (app: LocalApp, task: TaskView): boolean => retryableChannels(app, task).length > 0;
