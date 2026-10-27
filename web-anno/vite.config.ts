import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Bound concurrent AntD/Cornerstone DOM workers to avoid memory pressure and false timeouts.
    maxWorkers: 2,
    minWorkers: 1,
    // AntD DOM/form tests need a consistent budget on development machines and shared CI runners.
    testTimeout: 60_000,
    setupFiles: ['./src/test/setup.ts'],
  },
});
