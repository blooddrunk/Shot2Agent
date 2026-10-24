import { requireValue } from '../../../packages/core/src/model.ts';
export interface Capability { id: string; version: string; fingerprint: string; provider: string }
export interface Presence { deviceId: string; label: string; profiles: Capability[]; accepting: boolean; lastSeen: number }
export function capabilities(value: unknown): Capability[] {
  requireValue(Array.isArray(value) && value.length <= 20, 'INVALID_CAPABILITIES');
  return value.map(p => {
    requireValue(p && typeof p === 'object' && /^[a-z][a-z0-9-]{0,63}$/.test(p.id) &&
      /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(p.version) && /^[a-f0-9]{64}$/.test(p.fingerprint) &&
      ['codex', 'claude', 'claude-compatible-endpoint', 'fake'].includes(p.provider), 'INVALID_CAPABILITIES');
    return { id: p.id, version: p.version, fingerprint: p.fingerprint, provider: p.provider };
  });
}
