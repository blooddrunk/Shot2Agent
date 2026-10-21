import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  { ignores: ['dist/**', 'node_modules/**', '**/node_modules/**', '**/ui-dist/**', '**/target/**', 'build/**'] },
  js.configs.recommended, ...ts.configs.recommended,
  { files: ['**/*.mjs'], languageOptions: { globals: { Response: 'readonly', AbortController: 'readonly', clearTimeout: 'readonly', Buffer: 'readonly', process: 'readonly', URL: 'readonly', fetch: 'readonly', FormData: 'readonly', Blob: 'readonly', setTimeout: 'readonly' } } },
);
