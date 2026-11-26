import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

afterEach(cleanup);

// Data-router navigation constructs Request with jsdom's AbortSignal. Node's native
// Request only accepts its own realm's signal; retain the signal for router tests
// without passing it to the native constructor. No network loaders run in these tests.
const NativeRequest = globalThis.Request;
globalThis.Request = class extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, { ...init, signal: undefined });
    if (init?.signal) Object.defineProperty(this, 'signal', { value: init.signal });
  }
};
