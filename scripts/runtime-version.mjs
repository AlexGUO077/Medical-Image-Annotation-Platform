const REQUIRED_VERSION = 'v20.20.2';

export function assertSupportedRuntime(version) {
  if (version !== REQUIRED_VERSION) {
    throw new Error(`Node 20.20.2 is required; received ${version}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  assertSupportedRuntime(process.version);
}
