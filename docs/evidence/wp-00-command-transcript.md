# WP-00 命令转录

> 重跑时间：2026-09-19 10:16–10:20 CST<br>
> 运行时：Node.js `20.20.2`、npm `10.8.2`<br>
> 边界：仅合成本地数据；未打印 `.env.local`、凭据或医学数据

本文件保留 WP-00 评审重跑的命令、时间、退出状态和关键原始输出。仅做两类脱敏：移除终端 ANSI 控制字符，将绝对工作树路径缩写为 `[worktree]`。测试的重复逐用例输出明确标出省略边界，汇总行和失败计数原样保留。

## 运行时与清洁安装

```text
command=node --version
started_at=2026-09-19 10:16:55 CST
v20.20.2
finished_at=2026-09-19 10:16:55 CST
exit_status=0

command=npm --version
started_at=2026-09-19 10:16:55 CST
10.8.2
finished_at=2026-09-19 10:16:55 CST
exit_status=0
```

```text
command=npm ci
started_at=2026-09-19 10:16:28 CST
npm warn deprecated whatwg-encoding@3.1.1: Use @exodus/bytes instead for a more spec-conformant and faster implementation

> medical-image-annotation-platform@0.0.0 preinstall
> node scripts/runtime-version.mjs

added 523 packages, and audited 526 packages in 16s

107 packages are looking for funding
  run `npm fund` for details

6 vulnerabilities (1 low, 5 moderate)

To address issues that do not require attention, run:
  npm audit fix

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
finished_at=2026-09-19 10:16:44 CST
exit_status=0
```

## 禁止文件、lint 和类型

```text
command=npm run check:forbidden-files
started_at=2026-09-19 10:16:55 CST

> medical-image-annotation-platform@0.0.0 check:forbidden-files
> node scripts/check-forbidden-files.mjs

validator stdout/stderr: (none)
finished_at=2026-09-19 10:16:55 CST
exit_status=0
```

```text
command=npm run lint
started_at=2026-09-19 10:17:03 CST

> medical-image-annotation-platform@0.0.0 lint
> npm run lint --workspaces --if-present

> @miap/server@0.0.0 lint
> tsc --noEmit

> @miap/web-anno@0.0.0 lint
> tsc --noEmit

tsc stdout/stderr beyond npm headers: (none)
finished_at=2026-09-19 10:17:07 CST
exit_status=0

command=npm run typecheck
started_at=2026-09-19 10:17:07 CST

> medical-image-annotation-platform@0.0.0 typecheck
> npm run typecheck --workspaces --if-present

> @miap/server@0.0.0 typecheck
> tsc --noEmit

> @miap/web-anno@0.0.0 typecheck
> tsc --noEmit

tsc stdout/stderr beyond npm headers: (none)
finished_at=2026-09-19 10:17:10 CST
exit_status=0
```

## 测试

`node:test` 的 24 个逐用例块保留首尾用例和完整汇总，中间 22 个均为 `ok` 的详细块用明确范围标记取代：

```text
command=npm test
started_at=2026-09-19 10:17:17 CST

> medical-image-annotation-platform@0.0.0 test
> node --test scripts/*.test.mjs && npm run test --workspaces --if-present

TAP version 13
# Subtest: rejects medical files, credentials, and real environment files
ok 1 - rejects medical files, credentials, and real environment files
[subtests 2 through 23: all `ok`; per-test duration lines omitted]
# Subtest: rejects a different Node major or patch version
ok 24 - rejects a different Node major or patch version
1..24
# tests 24
# suites 0
# pass 24
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 276.5985

> @miap/server@0.0.0 test
> vitest run

RUN  v3.2.7 [worktree]/server
✓ src/modules/health/port-probe.service.spec.ts (1 test) 8ms
✓ src/modules/health/health.service.spec.ts (16 tests) 9ms
✓ src/modules/health/health.controller.spec.ts (2 tests) 14ms

Test Files  3 passed (3)
     Tests  19 passed (19)
  Start at  10:17:19
  Duration  614ms (transform 108ms, setup 0ms, collect 884ms, tests 31ms, environment 0ms, prepare 148ms)

> @miap/web-anno@0.0.0 test
> vitest run

RUN  v3.2.7 [worktree]/web-anno
✓ src/app/AppErrorBoundary.test.tsx (1 test) 175ms
✓ src/app/theme/ThemeBoundary.test.tsx (9 tests) 229ms
✓ src/app/App.test.tsx (16 tests) 606ms

Test Files  3 passed (3)
     Tests  26 passed (26)
  Start at  10:17:20
  Duration  3.24s (transform 152ms, setup 622ms, collect 3.95s, tests 1.01s, environment 2.32s, prepare 252ms)

finished_at=2026-09-19 10:17:23 CST
exit_status=0
```

## 构建

```text
command=npm run build
started_at=2026-09-19 10:17:28 CST

> medical-image-annotation-platform@0.0.0 build
> npm run build --workspaces --if-present

> @miap/server@0.0.0 build
> nest build

> @miap/web-anno@0.0.0 build
> tsc --noEmit && vite build

vite v7.3.6 building client environment for production...
transforming...
✓ 1442 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.41 kB │ gzip:   0.31 kB
dist/assets/index-CVU9AY4F.css    3.26 kB │ gzip:   1.35 kB
dist/assets/index-CrLq60L9.js   529.73 kB │ gzip: 173.02 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 3.15s
finished_at=2026-09-19 10:17:37 CST
exit_status=0
```

## Compose 配置和五服务状态

```text
command=docker compose --env-file .env.local config --quiet
started_at=2026-09-19 10:17:56 CST
stdout/stderr: (none)
finished_at=2026-09-19 10:17:56 CST
exit_status=0

command=docker compose --env-file .env.local up -d
started_at=2026-09-19 10:17:56 CST
Container wp-00-project-skeleton-postgres-1 Running
Container wp-00-project-skeleton-orthanc-1 Running
Container wp-00-project-skeleton-minio-1 Running
Container wp-00-project-skeleton-redis-1 Running
Container wp-00-project-skeleton-elasticsearch-1 Running
finished_at=2026-09-19 10:17:56 CST
exit_status=0

command=docker compose --env-file .env.local ps --format '{{.Service}} {{.State}} {{.Health}}'
started_at=2026-09-19 10:17:56 CST
elasticsearch running healthy
minio running healthy
orthanc running healthy
postgres running healthy
redis running healthy
finished_at=2026-09-19 10:17:56 CST
exit_status=0
```

## 健康接口、故障和恢复

启动命令输出中仅保留可重现的关键行：

```text
command=npm run start:dev --workspace server
started_at=2026-09-19 10:18:27 CST
> @miap/server@0.0.0 start:dev
> nest start --watch
[10:18:29 AM] Found 0 errors. Watching for file changes.
[Nest] LOG [RouterExplorer] Mapped {/api/health, GET} route
[Nest] LOG [RouterExplorer] Mapped {/api/health/live, GET} route
[Nest] LOG [NestApplication] Nest application successfully started
```

```text
command=curl --fail --silent --show-error http://127.0.0.1:3000/api/health/live
started_at=2026-09-19 10:18:50 CST
{"status":"ok","service":"server"}
HTTP 200
finished_at=2026-09-19 10:18:50 CST
exit_status=0

command=curl --fail --silent --show-error http://127.0.0.1:3000/api/health
started_at=2026-09-19 10:18:50 CST
{"status":"ok","dependencies":{"postgres":"up","orthanc":"up","minio":"up","redis":"up","elasticsearch":"up"}}
HTTP 200
finished_at=2026-09-19 10:18:50 CST
exit_status=0
```

```text
command=docker compose --env-file .env.local stop redis
started_at=2026-09-19 10:19:00 CST
Container wp-00-project-skeleton-redis-1 Stopping
Container wp-00-project-skeleton-redis-1 Stopped
finished_at=2026-09-19 10:19:00 CST
exit_status=0

command=curl --silent --show-error --output /private/tmp/miap-readiness-redis-down-review.json --write-out 'HTTP %{http_code}' http://127.0.0.1:3000/api/health; node sanitized-payload validator
started_at=2026-09-19 10:19:14 CST
HTTP 503
{"status":"error","dependency":"redis"}
sanitized_payload_check=pass
finished_at=2026-09-19 10:19:14 CST
curl_exit_status=0
validation_exit_status=0
```

```text
command=docker compose --env-file .env.local up -d --wait --wait-timeout 60 redis
started_at=2026-09-19 10:19:25 CST
Container wp-00-project-skeleton-redis-1 Starting
Container wp-00-project-skeleton-redis-1 Started
Container wp-00-project-skeleton-redis-1 Waiting
Container wp-00-project-skeleton-redis-1 Healthy
finished_at=2026-09-19 10:19:31 CST
exit_status=0

command=curl --fail --silent --show-error http://127.0.0.1:3000/api/health
started_at=2026-09-19 10:19:41 CST
{"status":"ok","dependencies":{"postgres":"up","orthanc":"up","minio":"up","redis":"up","elasticsearch":"up"}}
HTTP 200
finished_at=2026-09-19 10:19:41 CST
exit_status=0
```

Nest watch 进程于恢复检查后收到 `Ctrl-C`，统一执行会话返回 `exit_status=0`。

## 前端可达性

```text
command=npm run dev --workspace web-anno
started_at=2026-09-19 10:19:52 CST
> @miap/web-anno@0.0.0 dev
> vite
VITE v7.3.6 ready in 391 ms
➜ Local: http://localhost:5173/

command=curl --fail --silent --show-error --output /private/tmp/miap-web-review.html --write-out 'HTTP %{http_code}' http://127.0.0.1:5173/; rg React-root validator
started_at=2026-09-19 10:20:05 CST
HTTP 200
react_root_check=pass
finished_at=2026-09-19 10:20:05 CST
curl_exit_status=0
validation_exit_status=0
```

Vite 进程在可达性检查后收到 `Ctrl-C`；该交互式 npm 会话返回 `exit_status=1`，因为是人工中断开发服务器，不是构建或可达性失败。

## 依赖审计

```text
command=npm audit --audit-level=high
started_at=2026-09-19 10:18:06 CST
# npm audit report

@vitest/mocker  2.1.0 - 4.1.10
Severity: moderate
Vitest: Path Traversal / Arbitrary File Read via @vitest/mocker Redirect Mock - https://github.com/advisories/GHSA-82fw-gwwq-j7x9

ajv  7.0.0-alpha.0 - 8.17.1
Severity: moderate
ajv has ReDoS when using `$data` option - https://github.com/advisories/GHSA-2g4f-4pwh-qvx6

react-router  6.0.0 - 7.17.0
Severity: moderate
React Router: Open redirect via backslash in <Link> and useNavigate (CVE-2025-68470 bypass) - https://github.com/advisories/GHSA-wrjc-x8rr-h8h6
React Router: Arbitrary Constructor Injection via deserializeErrors() in React Router SSR Hydration - https://github.com/advisories/GHSA-337j-9hxr-rhxg

webpack  5.49.0 - 5.104.0
webpack buildHttp: allowedUris allow-list bypass via URL userinfo (@) leading to build-time SSRF behavior - https://github.com/advisories/GHSA-8fgc-7cc6-rx7x
webpack buildHttp HttpUriPlugin allowedUris bypass via HTTP redirects → SSRF + cache persistence - https://github.com/advisories/GHSA-38r7-794h-5758

6 vulnerabilities (1 low, 5 moderate)
finished_at=2026-09-19 10:18:07 CST
exit_status=0
```

具体修复候选中包含 breaking-change 升级，本工作包不执行 `npm audit fix --force`。

## 结束状态

```text
command=final process and Compose restoration check
started_at=2026-09-19 10:20:22 CST
server_port_3000=stopped
frontend_port_5173=stopped
elasticsearch running healthy
minio running healthy
orthanc running healthy
postgres running healthy
redis running healthy
finished_at=2026-09-19 10:20:22 CST
exit_status=0 docker_exit_status=0
```
