import type { AgentAdapter, AgentResult, Profile } from '../../contracts/src/index.ts';
import type { WorkerPort } from '../../core/src/core.ts';
import { requireValue } from '../../core/src/model.ts';
import { verifyImage } from '../../core/src/blobs.ts';
export interface ExecutionEntry { adapter: AgentAdapter; profile: Profile }
/** No shell, credentials or paths can be selected by task input. Profiles are resolved locally before execution. */
export async function runOnce(port: WorkerPort, adapter: AgentAdapter, profiles: readonly Profile[], heartbeatMs = 5000, signal?: AbortSignal, registry?: readonly ExecutionEntry[]): Promise<boolean> {
  const outcome = await runTask(port, adapter, profiles, heartbeatMs, signal, registry)
    .then(worked => ({ ok: true as const, worked }), error => ({ ok: false as const, error }));
  // Persist uncertainty first, then keep this Worker occupied until process and cleanup settle.
  for (const agent of new Set(registry?.map(e => e.adapter) ?? [adapter])) {
    const confirmed = await (agent.settle?.() ?? Promise.resolve(true)).catch(() => false);
    requireValue(confirmed, 'AGENT_STOP_UNCONFIRMED');
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.worked;
}
async function runTask(port: WorkerPort, adapter: AgentAdapter, profiles: readonly Profile[], heartbeatMs: number, signal?: AbortSignal, registry?: readonly ExecutionEntry[]): Promise<boolean> {
  if (signal?.aborted) return false;
  const claim = await port.claim(profiles.map(p => ({ id: p.id, version: p.version })));
  if (!claim) return false;
  const { task, proof } = claim; const id = task.submission.taskId;
  const profile = profiles.find(p => p.id === task.submission.profileId && p.version === task.submission.profileVersion);
  requireValue(profile && profile.sandbox === 'read-only', 'UNAPPROVED_PROFILE');
  if (registry) {
    const entry = registry.find(e => e.profile.id === profile.id && e.profile.version === profile.version);
    requireValue(entry, 'UNAPPROVED_PROFILE'); adapter = entry.adapter;
  }
  const bindingChanged = (task.submission.profileFingerprint && task.submission.profileFingerprint !== profile.fingerprint) || (task.submission.provider && task.submission.provider !== adapter.name);
  // Starting before launch is conservative: a crash in this window remains uncertain.
  await port.start(id, proof, { profileFingerprint: profile.fingerprint, adapterName: adapter.name, adapterVersion: adapter.version, timeoutMs: profile.timeoutMs });
  if (bindingChanged) {
    await port.complete(id, proof, { status: 'failed', summary: 'Approved task binding changed; execution refused', contentMarkdown: '', artifacts: [], errorCode: 'PROFILE_BINDING_CHANGED' }); return true;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  let leaseLost = false;
  const heartbeat = setInterval(() => { port.heartbeat(id, proof).catch(() => { leaseLost = true; controller.abort(); }); }, heartbeatMs);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stopRequest: ReturnType<typeof setTimeout> | undefined;
  let result: AgentResult;
  try {
    const images: Buffer[] = [];
    try {
      for (let i = 0; i < task.inputs.length; i++) {
        const bytes = await port.file(id, task.inputs[i].fileId);
        await verifyImage(bytes, task.submission.images[i]); images.push(bytes);
      }
    } catch {
      if (leaseLost) return true;
      await port.complete(id, proof, { status: 'failed', summary: 'Input integrity check failed before Agent launch', contentMarkdown: '', artifacts: [], errorCode: 'INPUT_INTEGRITY' });
      return true;
    }
    const deadline = new Promise<AgentResult>(resolve => {
      // Reserve the last 20% of the budget for acknowledged stop and result transport.
      stopRequest = setTimeout(() => controller.abort(), Math.max(1, Math.floor(profile.timeoutMs * 0.8)));
      timeout = setTimeout(() => {
        // A generic adapter that has not acknowledged stopping cannot prove timeout safety.
        resolve({ status: 'execution_unknown', summary: 'Agent stop is unconfirmed', contentMarkdown: '', artifacts: [], errorCode: 'STOP_UNCONFIRMED' });
      }, Math.max(2, Math.floor(profile.timeoutMs * 0.9)));
    });
    result = await Promise.race([adapter.execute(task.submission, profile, images, controller.signal), deadline]);
  } catch {
    result = { status: 'execution_unknown', summary: 'Agent interrupted; review before resubmitting', contentMarkdown: '', artifacts: [], errorCode: 'AGENT_INTERRUPTED' };
  } finally { signal?.removeEventListener('abort', abort); clearInterval(heartbeat); if (timeout) clearTimeout(timeout); if (stopRequest) clearTimeout(stopRequest); }
  // No retry of the Agent or automatic alternate-mode fallback on result transport errors.
  if (!leaseLost) await port.complete(id, proof, result);
  return true;
}
