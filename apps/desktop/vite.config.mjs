import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({ root: 'apps/desktop', plugins: [vue()], build: { outDir: 'ui-dist', emptyOutDir: true } });
