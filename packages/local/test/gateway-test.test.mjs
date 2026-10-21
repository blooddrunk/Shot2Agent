import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testGatewayVision } from '../../worker/src/gateway-test.ts';

const config = () => ({ kind: 'claude-compatible-endpoint', baseUrl: 'https://open.bigmodel.cn/api/anthropic', model: 'glm-5.3-flash',
  models: { sonnet: 'glm-5.3-flash', opus: 'glm-5.3-flash', haiku: 'glm-5.3-flash' },
  credentialRef: `Shot2Agent-Gateway-${randomUUID()}`, vision: 'not-verified' });

test('GUI Gateway test sends one synthetic image request and records only selected model + exact marker result', async () => {
  const gateway = config(); let calls = 0;
  const result = await testGatewayVision(gateway, 'synthetic-token-only', async (url, token, raw) => {
    calls++;
    assert.equal(url, `${gateway.baseUrl}/v1/messages`); assert.equal(token, 'synthetic-token-only');
    const body = JSON.parse(raw); assert.equal(body.model, gateway.model); assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].content[1].type, 'image'); assert.equal(body.messages[0].content[1].source.media_type, 'image/png');
    return { status: 200, body: JSON.stringify({ model: gateway.model, content: [{ type: 'text', text: 'SHOT2AGENT 42' }] }) };
  });
  assert.deepEqual(result, { status: 'synthetic_image_passed', requestsSent: 1, model: gateway.model });
  assert.equal(calls, 1);
});

test('Gateway test refuses redirects, bad recognition, and unsupported models without retry or token leakage', async () => {
  const gateway = config(); let calls = 0;
  await assert.rejects(testGatewayVision(gateway, 'synthetic-token-only', async () => { calls++; return { status: 302, body: '' }; }), /GATEWAY_REDIRECT_REFUSED/);
  assert.equal(calls, 1);
  await assert.rejects(testGatewayVision(gateway, 'synthetic-token-only', async () => {
    calls++; return { status: 200, body: JSON.stringify({ model: gateway.model, content: [{ type: 'text', text: 'no marker' }] }) };
  }), /GATEWAY_SYNTHETIC_VISION_FAILED/);
  assert.equal(calls, 2);
  await assert.rejects(testGatewayVision({ ...gateway, model: 'glm-5-text-only' }, 'synthetic-token-only', async () => {
    calls++; return { status: 200, body: '{}' };
  }), /GATEWAY_MODEL_VISION_UNSUPPORTED/);
  assert.equal(calls, 2);
});
