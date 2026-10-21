/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const useSupabase = Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY);
  const backend = fileURLToPath(new URL(`./src/lib/data/${useSupabase ? 'supabase' : 'local'}.ts`, import.meta.url));
  return {
  plugins: [react()],
  resolve: {
    // Pick the data adapter at build time so only one is bundled.
    alias: [
      { find: /^\.\/backend$/, replacement: backend },
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
  },
};
});
