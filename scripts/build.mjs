import { copyFileSync } from 'node:fs';
copyFileSync(new URL('../packages/local/src/clipboard.ps1', import.meta.url), new URL('../dist/packages/local/src/clipboard.ps1', import.meta.url));
