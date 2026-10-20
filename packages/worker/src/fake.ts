import { sha256 } from '../../core/src/blobs.ts';
import type { AgentAdapter, AgentResult, Profile, SubmissionMetadata } from '../../contracts/src/index.ts';
export const FAKE_PROFILE: Profile = Object.freeze({ id: 'fake-readonly', version: 'v1',
  fingerprint: sha256('fake-readonly:v1:read-only:deterministic'), sandbox: 'read-only', timeoutMs: 5000 });
export class FakeAgent implements AgentAdapter {
  readonly name = 'fake'; readonly version = '1';
  private behavior: 'success' | 'fail' | 'crash' | 'timeout';
  constructor(behavior: 'success' | 'fail' | 'crash' | 'timeout' = 'success') { this.behavior = behavior; }
  async execute(task: SubmissionMetadata, _profile: Profile, images: readonly Uint8Array[], signal: AbortSignal): Promise<AgentResult> {
    if (this.behavior === 'crash') throw new Error('synthetic crash');
    if (this.behavior === 'timeout') {
      await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); });
      return { status: 'timed_out', summary: 'Fake Agent stopped on timeout', contentMarkdown: '', artifacts: [], errorCode: 'AGENT_TIMEOUT' };
    }
    if (this.behavior === 'fail') return { status: 'failed', summary: 'Synthetic failure', contentMarkdown: '', artifacts: [], errorCode: 'FAKE_FAILURE' };
    const text = `# Fake result\n\n${images.length} image(s)\n${task.images.map((image, i) => `${i + 1}. ${image.sha256}`).join('\n')}\n`;
    const bytes = Buffer.from(text);
    return { status: 'succeeded', summary: `Processed ${images.length} image(s)`, contentMarkdown: text,
      artifacts: [{ fileName: 'result.txt', contentType: 'text/plain', dataBase64: bytes.toString('base64'), sha256: sha256(bytes) }] };
  }
}
