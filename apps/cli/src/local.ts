import { resolve } from 'node:path';
import { openCore } from '../../../packages/core/src/core.ts';
import { runOnce } from '../../../packages/worker/src/worker.ts';
import { FAKE_PROFILE, FakeAgent } from '../../../packages/worker/src/fake.ts';
import { syntheticSubmission } from './fixture.ts';
const [command = 'demo', directory = '.local/shot2agent', argument = '1'] = process.argv.slice(2);
const core = openCore(resolve(directory));
const identity = { ownerId: 'local-user', deviceId: 'local-pc' };
try {
  if (command === 'demo' || command === 'submit') {
    const { metadata, images } = await syntheticSubmission(Number(argument));
    const task = await core.submit(identity, metadata.taskId, metadata, images);
    if (command === 'demo') await runOnce(core.worker(identity), new FakeAgent(), [FAKE_PROFILE]);
    process.stdout.write(JSON.stringify(core.get(identity.ownerId, task.submission.taskId)) + '\n');
  } else if (command === 'work') {
    process.stdout.write(JSON.stringify({ worked: await runOnce(core.worker(identity), new FakeAgent(), [FAKE_PROFILE]) }) + '\n');
  } else if (command === 'list') process.stdout.write(JSON.stringify(core.list(identity.ownerId)) + '\n');
  else if (command === 'get') process.stdout.write(JSON.stringify(core.get(identity.ownerId, argument)) + '\n');
  else throw new Error('Usage: local <demo|submit|work|list|get> [private-directory] [1|5|task-id]');
} finally { core.close(); }
