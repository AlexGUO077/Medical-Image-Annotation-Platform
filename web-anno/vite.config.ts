import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // AntD DOM/form tests need a consistent budget on shared CI runners.
    testTimeout: 20_000,
    setupFiles: ['./src/test/setup.ts'],
  },
});
