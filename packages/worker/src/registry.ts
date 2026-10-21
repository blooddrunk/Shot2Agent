import { CodexAgent, codexProfile } from './codex.ts';
import type { CodexPolicy } from './codex.ts';
import { ClaudeAgent, claudeProfile } from './claude.ts';
import type { ClaudePolicy } from './claude.ts';
import type { ExecutionEntry } from './worker.ts';
import { requireValue } from '../../core/src/model.ts';
export type ApprovedPolicy = { provider: 'codex'; policy: CodexPolicy } | { provider: 'claude' | 'claude-compatible-endpoint'; policy: ClaudePolicy };
export function executionRegistry(policies: readonly ApprovedPolicy[]): ExecutionEntry[] {
  requireValue(policies.length > 0 && policies.length <= 32, 'REGISTRY_LIMIT');
  requireValue(policies.every(p => p && ['codex', 'claude', 'claude-compatible-endpoint'].includes(p.provider) && p.policy), 'INVALID_PROVIDER');
  requireValue(policies.every(p => p.provider === 'codex' || (p.provider === 'claude-compatible-endpoint') === !!p.policy.gateway), 'AUTH_PROFILE_MISMATCH');
  const entries = policies.map(p => p.provider === 'codex'
    ? { adapter: new CodexAgent([p.policy]), profile: codexProfile(p.policy, false) }
    : { adapter: new ClaudeAgent([p.policy]), profile: claudeProfile(p.policy, false) });
  requireValue(new Set(entries.map(e => `${e.profile.id}:${e.profile.version}`)).size === entries.length, 'DUPLICATE_PROFILE');
  return entries;
}
