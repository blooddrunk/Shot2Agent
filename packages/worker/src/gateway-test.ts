import https from 'node:https';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateGateway, assertGatewayVision } from './gateway.ts';
import type { GatewayConfig } from './gateway.ts';
import { requireValue } from '../../core/src/model.ts';

export interface GatewayTestResult { status: 'synthetic_image_passed'; requestsSent: 1; model: string }
export interface GatewayResponse { status: number; body: string }
type GatewayRequest = (url: string, token: string, body: string) => Promise<GatewayResponse>;
const SYNTHETIC_IMAGE = fileURLToPath(new URL('../../../scripts/fixtures/glm-vision.png', import.meta.url));

function requestOnce(url: string, token: string, body: string): Promise<GatewayResponse> {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
      'anthropic-version': '2023-06-01', Authorization: `Bearer ${token}`,
    } }, response => {
      let output = ''; let overflow = false;
      response.on('data', chunk => {
        if (Buffer.byteLength(output) + chunk.length > 1_048_576) { overflow = true; request.destroy(); }
        else output += chunk.toString('utf8');
      });
      response.on('error', () => reject(new Error('GATEWAY_RESPONSE_INTERRUPTED')));
      response.on('end', () => overflow ? reject(new Error('GATEWAY_RESPONSE_LIMIT')) : resolve({ status: response.statusCode ?? 0, body: output }));
    });
    const timer = setTimeout(() => request.destroy(new Error('GATEWAY_REQUEST_TIMEOUT')), 90000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', () => reject(new Error('GATEWAY_REQUEST_FAILED')));
    request.end(body);
  });
}

/** One explicit, non-retrying, direct synthetic-image request. Never follows redirects. */
export async function testGatewayVision(config: GatewayConfig, token: string, send: GatewayRequest = requestOnce,
  image: Uint8Array = readFileSync(SYNTHETIC_IMAGE)): Promise<GatewayTestResult> {
  validateGateway(config);
  assertGatewayVision({ ...config, vision: 'operator-attested' });
  requireValue(typeof token === 'string' && /^[\x21-\x7e]{8,2048}$/.test(token), 'INVALID_GATEWAY_TOKEN');
  requireValue(image.length > 0 && image.length <= 1024 * 1024, 'SYNTHETIC_IMAGE_INVALID');
  const body = JSON.stringify({ model: config.model, max_tokens: 256, messages: [{ role: 'user', content: [
    { type: 'text', text: 'Read the text in this synthetic image and reply only with the exact text. Do not use tools.' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(image).toString('base64') } },
  ] }] });
  const response = await send(`${config.baseUrl}/v1/messages`, token, body);
  requireValue(response.status < 300 || response.status >= 400, 'GATEWAY_REDIRECT_REFUSED');
  requireValue(response.status === 200, response.status === 401 || response.status === 403 ? 'GATEWAY_AUTH_FAILED' : 'GATEWAY_ENDPOINT_FAILED');
  let parsed: { model?: unknown; content?: { type?: unknown; text?: unknown }[] };
  try { parsed = JSON.parse(response.body); } catch { throw new Error('GATEWAY_RESPONSE_INVALID'); }
  const text = Array.isArray(parsed.content) ? parsed.content.filter(item => item?.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n') : '';
  requireValue(parsed.model === config.model, 'GATEWAY_MODEL_MISMATCH');
  requireValue(/SHOT2AGENT\s+42/.test(text), 'GATEWAY_SYNTHETIC_VISION_FAILED');
  return { status: 'synthetic_image_passed', requestsSent: 1, model: config.model };
}
