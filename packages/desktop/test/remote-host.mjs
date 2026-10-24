// Isolated process host for M10 tests. Uses the production controller and pipe server.
import { DesktopController } from '../src/controller.ts';
import { serve, waitForParent } from '../src/protocol.ts';
import { FakeAgent, FAKE_PROFILE } from '../../worker/src/fake.ts';
import { credentialStore } from '../../../apps/desktop/tests/fixtures.mjs';
let executions = 0;
const desktop = new DesktopController(process.argv[2], { session: 'remote-process', async sequence() { return '1'; }, async readImage() {}, close() {} },
  { profile: FAKE_PROFILE, adapter: { name: 'fake', version: '1', async execute(...args) { executions++; return new FakeAgent().execute(...args); } } },
  'legacy', async () => [], { credentials: credentialStore() });
await desktop.start(); await waitForParent(process.stdin);
const dispatch = desktop.dispatch.bind(desktop);
desktop.dispatch = async request => { const result = await dispatch(request); if (request.command === 'snapshot') result.testExecutions = executions; return result; };
serve(desktop, process.stdin, process.stdout, 30);
