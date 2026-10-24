import { requireValue } from '../../../packages/core/src/model.ts';
export interface Capability { id: string; version: string; fingerprint: string; provider: string; selectable?: boolean; isDefault?: boolean }
export interface Presence { deviceId: string; label: string; profiles: Capability[]; accepting: boolean; lastSeen: number }
export function capabilities(value: unknown): Capability[] {
  requireValue(Array.isArray(value) && value.length <= 32, 'INVALID_CAPABILITIES');
  return value.map(p => {
    requireValue(p && typeof p === 'object' && /^[a-z][a-z0-9-]{0,63}$/.test(p.id) &&
      /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(p.version) && /^[a-f0-9]{64}$/.test(p.fingerprint) &&
      ['codex', 'claude', 'claude-compatible-endpoint', 'fake'].includes(p.provider), 'INVALID_CAPABILITIES');
    requireValue((p.selectable === undefined || typeof p.selectable === 'boolean') && (p.isDefault === undefined || typeof p.isDefault === 'boolean'), 'INVALID_CAPABILITIES');
    return { id: p.id, version: p.version, fingerprint: p.fingerprint, provider: p.provider,
      ...(p.selectable === undefined ? {} : { selectable: p.selectable }), ...(p.isDefault === undefined ? {} : { isDefault: p.isDefault }) };
  });
}
/** Old publishers append versions in approval order; retain only their last version per id for discovery. */
export function selectableCapabilities(profiles: readonly Capability[]): Capability[] {
  const current = new Map<string, Capability>();
  for (const profile of profiles) if (profile.selectable !== false) current.set(profile.id, profile);
  return [...current.values()];
}
