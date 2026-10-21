import { existsSync, lstatSync, readFileSync, writeFileSync, renameSync, copyFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDirectory } from '../../core/src/store.ts';
import { requireValue } from '../../core/src/model.ts';
import type { ApprovedPolicy } from '../../worker/src/registry.ts';
import { executionRegistry } from '../../worker/src/registry.ts';
import type { CodexPolicy } from '../../worker/src/codex.ts';
import { validateRetry } from '../../local/src/delivery.ts';
import type { DeliveryConfig } from '../../local/src/delivery.ts';
export interface Settings {
  adapter: 'fake' | 'codex'; delivery: DeliveryConfig; codex?: CodexPolicy;
  agents?: { version: 1; selected: { id: string; version: string }; profiles: ApprovedPolicy[] };
  desktop: { version: 1; enabled: boolean; mode: 'confirm' | 'auto'; paused: boolean; autoConsent: boolean; alwaysConsent: boolean };
}
export const defaults = (): Settings => ({ adapter: 'fake', delivery: { clipboard: 'manual' },
  desktop: { version: 1, enabled: false, mode: 'confirm', paused: false, autoConsent: false, alwaysConsent: false } });
export function validate(settings: Settings): void {
  requireValue(settings && ['fake', 'codex'].includes(settings.adapter) && settings.delivery &&
    ['off', 'manual', 'smart', 'always'].includes(settings.delivery.clipboard) &&
    (settings.delivery.saveDirectory === undefined || (typeof settings.delivery.saveDirectory === 'string' && isAbsolute(settings.delivery.saveDirectory))), 'INVALID_SETTINGS');
  validateRetry(settings.delivery.retry);
  if (settings.agents) {
    const a = settings.agents; requireValue(a.version === 1 && settings.adapter === 'codex' && Array.isArray(a.profiles), 'INVALID_AGENT_SETTINGS');
    const entries = executionRegistry(a.profiles);
    requireValue(entries.some(e => e.profile.id === a.selected?.id && e.profile.version === a.selected?.version), 'UNAPPROVED_PROFILE');
    requireValue(settings.codex && a.profiles.some(p => p.provider === 'codex' && JSON.stringify(p.policy) === JSON.stringify(settings.codex)), 'ORIGINAL_CODEX_PROFILE_REQUIRED');
  }
  const c = settings.desktop;
  requireValue(c && c.version === 1 && ['confirm', 'auto'].includes(c.mode) &&
    [c.enabled, c.paused, c.autoConsent, c.alwaysConsent].every(v => typeof v === 'boolean'), 'INVALID_DESKTOP_SETTINGS');
  requireValue(c.mode !== 'auto' || c.autoConsent, 'AUTO_CLOUD_CONSENT_REQUIRED');
  requireValue(settings.delivery.clipboard !== 'always' || c.alwaysConsent, 'ALWAYS_OVERWRITE_CONSENT_REQUIRED');
}
export function saveSettings(root: string, settings: Settings): void {
  validate(settings); privateDirectory(root);
  const path = join(root, 'settings.json'); const temp = join(root, `.settings-${randomUUID()}.tmp`);
  if (existsSync(path)) requireValue(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), 'UNSAFE_SETTINGS');
  const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(settings, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
}
export function loadSettings(root: string): Settings {
  privateDirectory(root); const path = join(root, 'settings.json');
  if (!existsSync(path)) { const settings = defaults(); saveSettings(root, settings); return settings; }
  const st = lstatSync(path); requireValue(st.isFile() && !st.isSymbolicLink() && st.size < 65536, 'UNSAFE_SETTINGS');
  const settings = JSON.parse(readFileSync(path, 'utf8')) as Settings;
  if (!settings.desktop) {
    // M2 config remains CLI-readable; databases and profile contents are untouched.
    copyFileSync(path, join(root, `settings.m2-backup-${randomUUID()}.json`));
    settings.desktop = defaults().desktop;
    // Old Always consent is deliberately requested again at the desktop boundary.
    if (settings.delivery?.clipboard === 'always') settings.delivery.clipboard = 'manual';
    saveSettings(root, settings);
  }
  validate(settings); return settings;
}
