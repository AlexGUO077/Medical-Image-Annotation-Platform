const REQUIRED_VERSION = 'v24.14.0';

export function assertSupportedRuntime(version) {
  if (version !== REQUIRED_VERSION) {
    throw new Error(`Node 24.14.0 is required; received ${version}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  assertSupportedRuntime(process.version);
}
