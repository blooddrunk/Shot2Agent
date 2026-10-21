import { copyFileSync, mkdirSync } from 'node:fs';
copyFileSync(new URL('../packages/local/src/clipboard.ps1', import.meta.url), new URL('../dist/packages/local/src/clipboard.ps1', import.meta.url));
copyFileSync(new URL('../packages/worker/src/claude-policy.ps1', import.meta.url), new URL('../dist/packages/worker/src/claude-policy.ps1', import.meta.url));

copyFileSync(new URL('../packages/worker/src/gateway-credential.ps1', import.meta.url), new URL('../dist/packages/worker/src/gateway-credential.ps1', import.meta.url));

// gateway-test resolves this resource relative to its compiled module, never cwd.
mkdirSync(new URL('../dist/scripts/fixtures/', import.meta.url), { recursive: true });
copyFileSync(new URL('./fixtures/glm-vision.png', import.meta.url), new URL('../dist/scripts/fixtures/glm-vision.png', import.meta.url));
