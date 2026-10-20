import { RemoteClient } from '../../../services/relay/src/client.ts';
import { runOnce } from '../../../packages/worker/src/worker.ts';
import { FAKE_PROFILE, FakeAgent } from '../../../packages/worker/src/fake.ts';
import { syntheticSubmission } from './fixture.ts';
const [command = 'submit', argument = '1'] = process.argv.slice(2);
if (!process.env.SHOT2AGENT_RELAY_URL || !process.env.SHOT2AGENT_TOKEN) throw new Error('Remote mode requires explicit Relay URL and device token');
const client = new RemoteClient(process.env.SHOT2AGENT_RELAY_URL, process.env.SHOT2AGENT_TOKEN);
if (command === 'submit') {
  const { metadata, images } = await syntheticSubmission(Number(argument));
  process.stdout.write(JSON.stringify(await client.submit(metadata.taskId, metadata, images)) + '\n');
} else if (command === 'work') process.stdout.write(JSON.stringify({ worked: await runOnce(client, new FakeAgent(), [FAKE_PROFILE]) }) + '\n');
else if (command === 'list') process.stdout.write(JSON.stringify(await client.list()) + '\n');
else if (command === 'get') process.stdout.write(JSON.stringify(await client.get(argument)) + '\n');
else throw new Error('Usage: remote <submit|work|list|get> [1|5|task-id]');
