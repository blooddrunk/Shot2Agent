import { readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import https from 'node:https';
import { readGatewayToken } from './runtime/dist/packages/worker/src/gateway.js';
if (process.platform !== 'win32' || !process.argv.includes('--authorized-once')) throw Error('EXPLICIT_WINDOWS_ONE_REQUEST_AUTHORIZATION_REQUIRED');
const here = new URL('./', import.meta.url);
const receiptFile = new URL('GLM-ONCE-RECEIPT.json', here);
const evidence = { endpoint: 'https://open.bigmodel.cn/api/anthropic', model: 'glm-5.3-flash', authorizedRequests: 1, requestsSent: 0, redirectsFollowed: 0, retries: 0, transport: 'direct-anthropic-image-block; not Claude CLI', startedAt: new Date().toISOString() };
// A lock serializes clicks; durable receipt reserves the single request before sending.
const lockFile = new URL('GLM-ONCE-RUNNING.lock', here);
const lock = openSync(lockFile, 'wx');
if (existsSync(receiptFile)) {
 let prior; try { prior = JSON.parse(readFileSync(receiptFile, 'utf8')); } catch { closeSync(lock); unlinkSync(lockFile); throw Error('PRIOR_RECEIPT_UNREADABLE_NO_REQUEST'); }
 if (prior.requestsSent !== 0) { closeSync(lock); unlinkSync(lockFile); throw Error('ONE_REQUEST_ALREADY_RESERVED_NO_RETRY'); }
}
writeFileSync(receiptFile, JSON.stringify(evidence, null, 2));
try {
 const settings = JSON.parse(readFileSync(join(process.env.LOCALAPPDATA, 'Shot2Agent-Codex', 'settings.json'), 'utf8'));
 const candidates = settings.agents?.profiles?.filter(p => p.provider === 'claude-compatible-endpoint' && p.policy.gateway.baseUrl === evidence.endpoint && p.policy.gateway.model === evidence.model) ?? [];
 const approved = candidates.find(p => p.policy.id === settings.agents.selected.id && p.policy.version === settings.agents.selected.version);
 if (!approved) throw Error('MATCHING_APPROVED_PROFILE_REQUIRED');
 const token = await readGatewayToken(approved.policy.gateway.credentialRef);
 const png = readFileSync(new URL('Synthetic GLM screenshot.png', here));
 const body = JSON.stringify({ model: evidence.model, max_tokens: 2048, messages: [{ role: 'user', content: [{ type: 'text', text: 'Read the text in this synthetic image. Reply only with the text you see. Do not call any tools.' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } }] }] });
 evidence.requestsSent = 1;
 writeFileSync(receiptFile, JSON.stringify(evidence, null, 2));
 const response = await new Promise((resolve, reject) => {
  const req = https.request(evidence.endpoint + '/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'anthropic-version': '2023-06-01', Authorization: `Bearer ${token}` } }, res => {
   let data = '';
   res.on('data', chunk => { data += chunk; if (data.length > 1048576) req.destroy(Error('RESPONSE_LIMIT')); });
   res.on('end', () => resolve({ status: res.statusCode, data }));
   res.on('error', () => reject(Error('RESPONSE_INTERRUPTED')));
  });
  const deadline = setTimeout(() => req.destroy(Error('REQUEST_TIMEOUT')), 90000);
  req.on('close', () => clearTimeout(deadline));
  req.on('error', () => reject(Error('HTTPS_REQUEST_FAILED_NO_RETRY')));
  req.end(body);
 });
 evidence.httpStatus = response.status;
 if (response.status !== 200) throw Error(response.status >= 300 && response.status < 400 ? 'REDIRECT_REFUSED' : 'ENDPOINT_REQUEST_FAILED');
 let parsed; try { parsed = JSON.parse(response.data); } catch { throw Error('INVALID_RESPONSE'); }
 const text = (parsed.content ?? []).filter(c => c.type === 'text' && typeof c.text === 'string').map(c => c.text).join('\n');
 evidence.imageBlockSent = true;
 evidence.markerRecognized = /SHOT2AGENT\s+42/.test(text);
 evidence.recognizedMarker = evidence.markerRecognized ? 'SHOT2AGENT 42' : null;
 evidence.responseModelMatches = parsed.model === evidence.model;
 evidence.usage = Object.fromEntries(Object.entries(parsed.usage ?? {}).filter(([k,v]) => ['input_tokens','output_tokens'].includes(k) && Number.isSafeInteger(v)));
 evidence.status = evidence.markerRecognized ? 'PASS_DIRECT_ENDPOINT_IMAGE_RECOGNITION' : 'FAIL_MARKER_NOT_RECOGNIZED';
} catch (error) {
 evidence.status = 'FAILED_OR_UNKNOWN_NO_RETRY';
 evidence.errorCode = /^[A-Z_]+$/.test(error?.message) ? error.message : 'SAFE_PROBE_FAILURE';
}
evidence.finishedAt = new Date().toISOString();
writeFileSync(receiptFile, JSON.stringify(evidence, null, 2) + '\n');
closeSync(lock); unlinkSync(lockFile);
process.stdout.write(JSON.stringify(evidence) + '\n');
process.exitCode = evidence.status === 'PASS_DIRECT_ENDPOINT_IMAGE_RECOGNITION' ? 0 : 1;
