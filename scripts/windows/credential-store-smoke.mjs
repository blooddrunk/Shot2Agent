import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const modulePath = process.argv[2];
if (!modulePath) throw new Error('PACKAGED_GATEWAY_MODULE_REQUIRED');
const { saveGatewayToken, readGatewayToken, deleteGatewayToken } = await import(pathToFileURL(modulePath).href);
const reference = `Shot2Agent-Gateway-${randomUUID()}`;
const token = 'synthetic-fixture-only-credential';
try {
  await saveGatewayToken(reference, token);
  if (await readGatewayToken(reference) !== token) throw new Error('PACKAGED_CREDENTIAL_READBACK_FAILED');
  process.stdout.write('PASS packaged Windows Credential Manager lifecycle with ZoneId=3; synthetic token only\n');
} finally {
  await deleteGatewayToken(reference);
}
