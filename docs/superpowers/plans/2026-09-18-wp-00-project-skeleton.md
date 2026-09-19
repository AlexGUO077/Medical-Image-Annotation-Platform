# WP-00 Project Skeleton Implementation Plan

> **历史计划，执行流程已退役（2026-09-19）。** 后续只按 [AGENTS.md](../../../AGENTS.md) 执行；本文保留需求、接口及既有决定的追溯信息，下面的步骤和命令不再作为执行清单。停止 Superpowers、默认双代理、强制 RED/GREEN、owner/文件占用登记、实现交接及全文证据转录。当前状态统一见 [STATUS](../../STATUS.md)。

**Goal:** Build a reproducible Node 20 monorepo skeleton with a NestJS health API, React/Ant Design application shell, five local infrastructure services, CI, tests, and security scanning without opening any real-data path.

**Architecture:** Use npm workspaces for `server` and `web-anno`. The NestJS modular monolith exposes `/api/health` and performs minimal dependency readiness probes; the React application provides only route and theme scaffolding. Docker Compose supplies PostgreSQL, Orthanc, MinIO, Redis, and Elasticsearch for synthetic local development, while CI verifies lint, types, tests, builds, Compose configuration, secret scanning, dependency risk, and infrastructure configuration.

**Tech Stack:** Node.js 20.20.2, npm 11, NestJS 11.2.5, React 18.3.1, Vite 7.3.6, Ant Design 5.29.3, TypeScript 5.x, Vitest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-18-wp-s0-wp-00-foundation-design.md`

## Global Constraints

- Source manual and engineering baseline remain authoritative; this plan implements only WP-00, S0-S1, SG-1 preparation.
- Node.js is fixed at `20.20.2` by D-38; this does not waive critical/high vulnerability gates.
- Use NestJS 11.x because it supports Node 20; do not use NestJS 12 generators that require newer Node versions.
- Use React 18.3.1 and Ant Design 5.x; do not install Ant Design 6 or React 19.
- No business tables, authentication, DICOM import, frames, annotation, review, search, export, or production deployment in this plan.
- Only synthetic or approved anonymous test data may enter local volumes.
- Real `.env`, credentials, medical data, patient information, mappings, backups, and production logs must not enter Git.
- Every task begins by recording owner and files in `/Users/guo/College/Medical-Image-Annotation-Platform/local-engineering-log/YYYY-MM-DD.md`.
- Root configuration, `package-lock.json`, Compose, CI, contracts, and shared types have one active owner at a time.
- PR #1 must be merged before implementation; create `feature/wp-00-project-skeleton` from the latest `origin/main`.

---

### Task 1: Freeze the Node 20 workspace contract

**Files:**
- Create: `.nvmrc`
- Create: `.npmrc`
- Create: `.editorconfig`
- Create: `package.json`
- Create: `scripts/runtime-version.mjs`
- Test: `scripts/runtime-version.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: D-38 decision requiring Node.js `20.20.2`.
- Produces: `assertSupportedRuntime(version: string): void`; root workspace scripts consumed by every later task.

- [ ] **Step 1: Create the failing runtime contract test**

```js
// scripts/runtime-version.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSupportedRuntime } from './runtime-version.mjs';

test('accepts the approved Node 20 patch version', () => {
  assert.doesNotThrow(() => assertSupportedRuntime('v20.20.2'));
});

test('rejects a different Node major or patch version', () => {
  assert.throws(() => assertSupportedRuntime('v24.14.0'), /Node 20\.20\.2 is required/);
  assert.throws(() => assertSupportedRuntime('v20.19.0'), /Node 20\.20\.2 is required/);
});
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `node --test scripts/runtime-version.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/runtime-version.mjs`.

- [ ] **Step 3: Implement the runtime guard and root workspace**

```js
// scripts/runtime-version.mjs
const REQUIRED_VERSION = 'v20.20.2';

export function assertSupportedRuntime(version) {
  if (version !== REQUIRED_VERSION) {
    throw new Error(`Node 20.20.2 is required; received ${version}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  assertSupportedRuntime(process.version);
}
```

```json
{
  "name": "medical-image-annotation-platform",
  "private": true,
  "version": "0.0.0",
  "workspaces": ["server", "web-anno"],
  "engines": { "node": "20.20.2", "npm": ">=10 <12" },
  "scripts": {
    "preinstall": "node scripts/runtime-version.mjs",
    "lint": "npm run lint --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test": "node --test scripts/*.test.mjs && npm run test --workspaces --if-present",
    "build": "npm run build --workspaces --if-present",
    "check": "npm run lint && npm run typecheck && npm test && npm run build"
  }
}
```

Set `.nvmrc` to `20.20.2`. Set `.npmrc` to `engine-strict=true` and `save-exact=true`. Extend `.gitignore` with `.env.local`, `.env.*.local`, `reports/`, and `.security-cache/` while preserving `!.env.example`.

- [ ] **Step 4: Switch to the approved runtime and run the test**

Run: `nvm install 20.20.2 && nvm use 20.20.2 && node --test scripts/runtime-version.test.mjs`

Expected: 2 tests PASS and `node --version` prints `v20.20.2`.

- [ ] **Step 5: Commit the workspace contract**

```bash
git add .nvmrc .npmrc .editorconfig .gitignore package.json scripts/runtime-version.mjs scripts/runtime-version.test.mjs
git commit -m "chore: establish Node 20 workspace contract"
```

### Task 2: Build the minimal NestJS application and liveness endpoint

**Files:**
- Create: `server/package.json`
- Create: `server/nest-cli.json`
- Create: `server/tsconfig.json`
- Create: `server/tsconfig.build.json`
- Create: `server/src/main.ts`
- Create: `server/src/app.module.ts`
- Create: `server/src/modules/health/health.module.ts`
- Create: `server/src/modules/health/health.controller.ts`
- Test: `server/src/modules/health/health.controller.spec.ts`
- Create: `server/vitest.config.ts`

**Interfaces:**
- Consumes: root npm workspace and Node runtime guard.
- Produces: `GET /api/health/live -> { status: "ok", service: "server" }` and Nest `HealthModule`.

- [ ] **Step 1: Create the server workspace manifest and TypeScript configuration**

Create `server/package.json` before invoking npm so the declared workspace exists:

```json
{
  "name": "@miap/server",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "start:dev": "nest start --watch",
    "lint": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "nest build"
  }
}
```

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true }
}
```

Set `server/tsconfig.json` to target ES2022/CommonJS with decorators, metadata, strict mode, `src` as `rootDir`, and `dist` as `outDir`. Make `server/tsconfig.build.json` extend it and exclude specs and `dist`. Configure `server/vitest.config.ts` with the Node environment.

```json
// server/tsconfig.json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "moduleResolution": "node",
    "declaration": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "rootDir": "src",
    "outDir": "dist",
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

```json
// server/tsconfig.build.json
{
  "extends": "./tsconfig.json",
  "exclude": ["dist", "node_modules", "src/**/*.spec.ts"]
}
```

```ts
// server/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'node' } });
```

- [ ] **Step 2: Add exact NestJS 11 dependencies**

Run:

```bash
npm install --workspace server --save-exact @nestjs/common@11.2.5 @nestjs/core@11.2.5 @nestjs/platform-express@11.2.5 reflect-metadata@0.2.2 rxjs@7.8.2
npm install --workspace server --save-dev --save-exact @nestjs/testing@11.2.5 @nestjs/cli@11.0.10 typescript@5.9.2 vitest@3.2.4 @types/node@20.19.14
```

- [ ] **Step 3: Write the failing controller test**

```ts
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns the application liveness contract', async () => {
    const module = await Test.createTestingModule({ controllers: [HealthController] }).compile();
    expect(module.get(HealthController).live()).toEqual({ status: 'ok', service: 'server' });
  });
});
```

- [ ] **Step 4: Run the test and verify it fails**

Run: `npm run test --workspace server -- health.controller.spec.ts`

Expected: FAIL because `health.controller.ts` does not exist.

- [ ] **Step 5: Implement the liveness endpoint**

```ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get('live')
  live() {
    return { status: 'ok' as const, service: 'server' as const };
  }
}
```

Configure `main.ts` with `app.setGlobalPrefix('api')` and port `3000`. `HealthModule` owns the controller; `AppModule` imports only `HealthModule`.

- [ ] **Step 6: Verify test, typecheck, and build**

Run: `npm run test --workspace server && npm run typecheck --workspace server && npm run build --workspace server`

Expected: all commands exit 0.

- [ ] **Step 7: Commit the server liveness slice**

```bash
git add package-lock.json server
git commit -m "feat: add server liveness endpoint"
```

### Task 3: Add dependency readiness without business connections

**Files:**
- Create: `server/src/modules/health/dependency.config.ts`
- Create: `server/src/modules/health/port-probe.service.ts`
- Create: `server/src/modules/health/health.service.ts`
- Modify: `server/src/modules/health/health.controller.ts`
- Modify: `server/src/modules/health/health.module.ts`
- Test: `server/src/modules/health/health.service.spec.ts`
- Test: `server/src/modules/health/health.controller.spec.ts`

**Interfaces:**
- Consumes: environment variables ending in `_HOST` and `_PORT`; no credentials or medical data.
- Produces: `HealthService.ready(): Promise<{status:"ok"; dependencies: Record<string,"up">}>`; `GET /api/health` returns 200 only when all five dependencies accept TCP connections, otherwise 503.

- [ ] **Step 1: Write failing readiness tests with a fake port probe**

```ts
it('returns every dependency as up when all probes succeed', async () => {
  const probe = { check: vi.fn().mockResolvedValue(undefined) };
  const service = new HealthService(probe as never, testDependencies);
  await expect(service.ready()).resolves.toEqual({
    status: 'ok',
    dependencies: {
      postgres: 'up', orthanc: 'up', minio: 'up', redis: 'up', elasticsearch: 'up'
    }
  });
});

it('throws 503 without exposing connection details when one probe fails', async () => {
  const probe = { check: vi.fn().mockRejectedValueOnce(new Error('socket details')) };
  const service = new HealthService(probe as never, testDependencies);
  await expect(service.ready()).rejects.toMatchObject({ status: 503 });
});

it('fails fast with the missing configuration key but no secret value', () => {
  expect(() => loadDependencies({})).toThrow(/POSTGRES_HOST/);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test --workspace server -- health.service.spec.ts`

Expected: FAIL because `HealthService` and dependency configuration are missing.

- [ ] **Step 3: Implement a timeout-bounded TCP probe and readiness aggregation**

Use `node:net`; default timeout is 750 ms. `loadDependencies(env: NodeJS.ProcessEnv): DependencyTarget[]` validates every required `_HOST` and `_PORT` key at startup and reports only the missing key name. Error responses may name the unavailable dependency but must not return host, port, socket error text, credentials, or stack. The dependency order is fixed: PostgreSQL, Orthanc, MinIO, Redis, Elasticsearch.

- [ ] **Step 4: Expose readiness at `/api/health`**

Keep `/api/health/live` independent of dependencies. Add `@Get()` to call `HealthService.ready()`.

- [ ] **Step 5: Verify positive and negative tests**

Run: `npm run test --workspace server && npm run typecheck --workspace server && npm run build --workspace server`

Expected: all commands exit 0, including the explicit 503 test.

- [ ] **Step 6: Commit readiness checks**

```bash
git add server/src/modules/health
git commit -m "feat: add infrastructure readiness checks"
```

### Task 4: Add the five-service synthetic development environment

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `scripts/create-local-env.mjs`
- Test: `scripts/local-env.test.mjs`
- Create: `docs/contracts/container-images.md`

**Interfaces:**
- Consumes: untracked `.env.local` generated with random local-only values.
- Produces: healthy `postgres`, `orthanc`, `minio`, `redis`, and `elasticsearch` services on a private Compose network; server readiness environment values.

- [ ] **Step 1: Write the failing environment-generator test**

```js
test('generates every required local key without patient data fields', () => {
  const env = createLocalEnv(() => 'fixed-random-value');
  assert.match(env, /^POSTGRES_PASSWORD=/m);
  assert.match(env, /^MINIO_ROOT_PASSWORD=/m);
  assert.doesNotMatch(env, /PATIENT|DICOM_FILE|REPORT_TEXT/);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test scripts/local-env.test.mjs`

Expected: FAIL because `create-local-env.mjs` does not exist.

- [ ] **Step 3: Implement local environment generation**

Use `node:crypto.randomBytes(32).toString('base64url')`. The script writes only `.env.local`, refuses to overwrite an existing file without `--force`, and never prints secret values to stdout. `.env.example` contains variable names and non-secret host/port defaults, with secret values empty.

- [ ] **Step 4: Define Compose services and health checks**

Use the source-manual major lines: `postgres:16`, `redis:7`, `docker.elastic.co/elasticsearch/elasticsearch:8`, `orthancteam/orthanc`, and `minio/minio`. Do not publish these ports in production configuration; this file is explicitly local development. Set resource limits for Elasticsearch and all named volumes under project-specific names. Record the exact resolved image digests after the first pull in `docs/contracts/container-images.md`.

- [ ] **Step 5: Validate configuration before starting containers**

Run:

```bash
node scripts/create-local-env.mjs
docker compose --env-file .env.local config --quiet
docker compose --env-file .env.local up -d
docker compose --env-file .env.local ps
```

Expected: config exits 0 and all five services reach `healthy`.

- [ ] **Step 6: Verify the server aggregate health endpoint**

Run: `npm run start:dev --workspace server`

In another terminal run: `curl --fail --silent http://localhost:3000/api/health`

Expected: JSON contains `"status":"ok"` and all five dependencies are `"up"`.

- [ ] **Step 7: Commit infrastructure without local secrets or volumes**

```bash
git status --short
git add docker-compose.yml .env.example scripts/create-local-env.mjs scripts/local-env.test.mjs docs/contracts/container-images.md package-lock.json
git commit -m "chore: add local infrastructure environment"
```

Before committing, verify `.env.local`, volumes, and generated runtime data are absent from `git status`.

### Task 5: Build the React 18 and Ant Design 5 application shell

**Files:**
- Create: `web-anno/package.json`
- Create: `web-anno/index.html`
- Create: `web-anno/tsconfig.json`
- Create: `web-anno/vite.config.ts`
- Create: `web-anno/src/main.tsx`
- Create: `web-anno/src/app/App.tsx`
- Create: `web-anno/src/app/AppErrorBoundary.tsx`
- Create: `web-anno/src/app/routes.tsx`
- Create: `web-anno/src/app/theme/tokens.ts`
- Create: `web-anno/src/app/theme/ThemeBoundary.tsx`
- Create: `web-anno/src/pages/ModulePlaceholderPage.tsx`
- Create: `web-anno/src/test/setup.ts`
- Create: `web-anno/src/styles/global.css`
- Test: `web-anno/src/app/App.test.tsx`
- Test: `web-anno/src/app/AppErrorBoundary.test.tsx`
- Test: `web-anno/src/app/theme/ThemeBoundary.test.tsx`

**Interfaces:**
- Consumes: official route list and design-token constraints from the UI requirements.
- Produces: application shell for `/login`, `/tasks`, `/workbench/:caseId`, `/review/:caseId`, `/cases/import`, `/cases/:id`, `/library`, `/dashboard`, and `/admin`; `ThemeBoundary` selects dark theme only for workbench/review routes.

- [ ] **Step 1: Create the frontend workspace manifest and build configuration**

Create `web-anno/package.json` before invoking npm so the declared workspace exists:

```json
{
  "name": "@miap/web-anno",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "lint": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "tsc --noEmit && vite build"
  }
}
```

Create `index.html` with `#root`, configure TypeScript for strict React JSX and bundler resolution, and configure Vite with the React plugin plus Vitest `jsdom` and the test setup file.

```json
// web-anno/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vite.config.ts"]
}
```

```ts
// web-anno/vite.config.ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

```ts
// web-anno/src/test/setup.ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 2: Install exact frontend dependencies**

Run:

```bash
npm install --workspace web-anno --save-exact react@18.3.1 react-dom@18.3.1 antd@5.29.3 react-router-dom@6.30.1
npm install --workspace web-anno --save-dev --save-exact vite@7.3.6 @vitejs/plugin-react@4.7.0 typescript@5.9.2 vitest@3.2.4 jsdom@26.1.0 @testing-library/react@16.3.0 @testing-library/jest-dom@6.8.0 @types/react@18.3.24 @types/react-dom@18.3.7
```

- [ ] **Step 3: Write failing route and theme tests**

```tsx
it.each(['/login', '/tasks', '/cases/import', '/library', '/dashboard', '/admin'])(
  'renders a neutral module placeholder for %s',
  async (path) => {
    render(<App initialEntries={[path]} />);
    expect(await screen.findByRole('heading')).toBeInTheDocument();
    expect(screen.queryByText(/已完成|可用|成功/)).not.toBeInTheDocument();
  },
);

it('uses the dark workbench theme without changing business state', () => {
  render(<App initialEntries={['/workbench/synthetic-case']} />);
  expect(screen.getByTestId('theme-boundary')).toHaveAttribute('data-theme', 'dark');
});

it('shows a non-sensitive recovery message when rendering fails', () => {
  render(<AppErrorBoundary><ThrowingComponent /></AppErrorBoundary>);
  expect(screen.getByRole('alert')).toHaveTextContent('页面暂时无法显示，请刷新后重试');
  expect(screen.queryByText(/stack|token|password/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 4: Run and confirm failure**

Run: `npm run test --workspace web-anno -- App.test.tsx ThemeBoundary.test.tsx AppErrorBoundary.test.tsx`

Expected: FAIL because `App`, `ThemeBoundary`, and `AppErrorBoundary` do not exist.

- [ ] **Step 5: Implement route metadata and theme boundaries**

Centralize route labels and implementation WP in `routes.tsx`. Placeholder pages state only “该模块将在对应工作包实现” and never simulate permissions, counts, statuses, patients, or completed workflows. Configure shared Ant Design seed tokens; define distinct light and low-luminance dark algorithms without duplicating business logic. `AppErrorBoundary` catches render failures, displays the fixed recovery copy from the test, and never renders stack traces or environment values.

- [ ] **Step 6: Verify accessibility basics, types, tests, and build**

Run: `npm run test --workspace web-anno && npm run typecheck --workspace web-anno && npm run build --workspace web-anno`

Expected: all commands exit 0; generated `dist/` remains ignored.

- [ ] **Step 7: Commit the frontend shell**

```bash
git add package-lock.json web-anno
git commit -m "feat: add frontend application shell"
```

### Task 6: Add CI and security evidence gates

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/security.yml`
- Create: `.github/dependabot.yml`
- Create: `scripts/check-forbidden-files.mjs`
- Test: `scripts/check-forbidden-files.test.mjs`
- Modify: `package.json`
- Create: `docs/security/wp-00-scan-policy.md`

**Interfaces:**
- Consumes: root `check` command, Compose config, D-38 risk controls.
- Produces: required CI checks and `check:forbidden-files`; security results block critical/high findings unless a separately documented exception satisfies project rules.

- [ ] **Step 1: Write failing forbidden-file tests**

```js
test('rejects medical files, credentials, and real environment files', () => {
  assert.equal(findForbidden(['sample.dcm', '.env', 'backup.dump']).length, 3);
});

test('allows an explicitly reviewed synthetic fixture path', () => {
  assert.deepEqual(findForbidden(['server/test/fixtures/synthetic/readme.md']), []);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test scripts/check-forbidden-files.test.mjs`

Expected: FAIL because `check-forbidden-files.mjs` does not exist.

- [ ] **Step 3: Implement tracked-file policy validation**

The script reads `git ls-files -z`, rejects `.env`, key/token extensions, medical-image extensions, dumps/backups, and runtime storage paths, while allowing only the two synthetic fixture roots named by `.gitignore`. Add `check:forbidden-files` to root scripts and include it in `check`.

- [ ] **Step 4: Implement CI**

`ci.yml` must use Node `20.20.2`, run `npm ci`, `npm run check:forbidden-files`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `docker compose --env-file .env.example config --quiet`. It must not start real-data services or print environment values.

- [ ] **Step 5: Implement security workflow**

`security.yml` runs CodeQL for JavaScript/TypeScript, dependency review, secret scanning, `npm audit --audit-level=high`, and Trivy filesystem/configuration scanning with `HIGH,CRITICAL` exit-code blocking. Configure dependency review to reject GPL-2.0, GPL-3.0, AGPL-1.0, and AGPL-3.0 additions unless the approved license policy is changed in a reviewed PR; record every other detected license in the job summary. D-38 is referenced in the scan policy, which explicitly says Node 20 is not a blanket exception.

- [ ] **Step 6: Run local equivalents**

Run:

```bash
npm run check:forbidden-files
npm audit --audit-level=high
npm run check
docker compose --env-file .env.example config --quiet
```

Expected: commands exit 0. If Node 20 or a package produces a high/critical finding, record the evidence and stop; do not mark WP-00 complete.

- [ ] **Step 7: Commit CI and security gates**

```bash
git add .github package.json package-lock.json scripts/check-forbidden-files.mjs scripts/check-forbidden-files.test.mjs docs/security/wp-00-scan-policy.md
git commit -m "security: add foundation verification gates"
```

### Task 7: Verify the WP-00 deliverable and open the Draft PR

**Files:**
- Modify: `README.md`
- Create: `docs/evidence/wp-00-verification.md`
- Modify: `/Users/guo/College/Medical-Image-Annotation-Platform/local-engineering-log/YYYY-MM-DD.md` (outside Git)

**Interfaces:**
- Consumes: all WP-00 tasks.
- Produces: reproducible start/stop instructions, verification evidence, remote commit, and Draft PR mapped to WP-00/S1/SG-1.

- [ ] **Step 1: Document exact local commands**

README must include Node activation, dependency install, local env generation, Compose start/stop, server start, frontend start, full check, and the prohibition on real medical data.

- [ ] **Step 2: Run the complete verification sequence**

```bash
nvm use 20.20.2
npm ci
npm run check:forbidden-files
npm run lint
npm run typecheck
npm test
npm run build
docker compose --env-file .env.local config --quiet
docker compose --env-file .env.local up -d
docker compose --env-file .env.local ps
# Keep this process running in a second terminal before the curl checks:
npm run start:dev --workspace server
curl --fail --silent http://localhost:3000/api/health/live
curl --fail --silent http://localhost:3000/api/health
```

Expected: every command exits 0, all five dependencies report up, and no real-data file is present. Record exact outputs and timestamps in `docs/evidence/wp-00-verification.md` without secrets.

- [ ] **Step 3: Verify failure behavior**

Stop Redis with `docker compose --env-file .env.local stop redis`, call `/api/health`, and verify HTTP 503 without host, port, stack, or credentials. Restart Redis and verify health returns 200.

- [ ] **Step 4: Commit documentation and evidence**

```bash
git add README.md docs/evidence/wp-00-verification.md
git commit -m "docs: record WP-00 verification evidence"
```

- [ ] **Step 5: Push and open a Draft PR**

```bash
git push -u origin feature/wp-00-project-skeleton
gh pr create --draft --base main --head feature/wp-00-project-skeleton --title "chore: establish WP-00 project skeleton" --body-file .github/pull_request_template.md
```

Complete the PR body with source chapters 3.1-3.4 and 8.1, baseline sections 2, 9, 10, 12, 14, WP-00, S1, SG-1, all verification outputs, D-38 impact, rollback commands, and remote SHA.

- [ ] **Step 6: Release file ownership**

Update the external daily log: mark all claimed files released, record branch/SHA/PR, list scan findings, and state whether WP-00 is complete, conditionally blocked, or awaiting review. Do not mark complete if any required check or security gate failed.
