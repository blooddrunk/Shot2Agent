// Offline by construction: explicit mock sender and synthetic Token only.
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const modulePath = resolve(process.argv[2] ?? 'dist/packages/worker/src/gateway-test.js');
const { testGatewayVision } = await import(pathToFileURL(modulePath).href);
const model = 'glm-5.3-flash';
const gateway = {kind:'claude-compatible-endpoint',baseUrl:'https://open.bigmodel.cn/api/anthropic',model,models:{sonnet:model,opus:model,haiku:model},credentialRef:'Shot2Agent-Gateway-00000000-0000-4000-8000-000000000000',vision:'not-verified'};
let calls = 0;
const sender = async (url, token, raw) => {
  calls++; assert.equal(url, gateway.baseUrl + '/v1/messages'); assert.equal(token, 'synthetic-offline-token');
  const payload = JSON.parse(raw); const image = payload.messages[0].content.find(block => block.type === 'image');
  const png = Buffer.from(image.source.data, 'base64'); assert.equal(png.subarray(1,4).toString(), 'PNG');
  assert.ok(png.length > 100); return {status:200,body:JSON.stringify({model,content:[{type:'text',text:'SHOT2AGENT 42'}]})};
};
await testGatewayVision(gateway, 'synthetic-offline-token', sender);
assert.equal(calls, 1);
// Reproduce a broken portable resource layout in a disposable copy, never by
// removing a file from the actual build or operator installation.
const dir = mkdtempSync(join(tmpdir(),'shot2agent-fixture-refusal-'));
try {
  const distRoot = resolve(modulePath, '../../../..');
  cpSync(join(distRoot,'packages'), join(dir,'packages'), {recursive:true});
  writeFileSync(join(dir,'package.json'), '{"type":"module"}');
  mkdirSync(join(dir,'scripts','fixtures'),{recursive:true});
  const broken = await import(pathToFileURL(join(dir,'packages/worker/src/gateway-test.js')).href);
  await assert.rejects(broken.testGatewayVision(gateway, 'synthetic-offline-token', sender), /GATEWAY_SYNTHETIC_IMAGE_UNAVAILABLE/);
  assert.equal(calls, 1, 'missing resource refuses before the mock sender is called');
} finally { rmSync(dir,{recursive:true,force:true}); }
process.stdout.write('PASS compiled/package Gateway synthetic image: bundled resource, mock recognition, missing-resource refusal; zero live requests\n');
