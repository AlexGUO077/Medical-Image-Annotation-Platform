# WP-00 验证证据

> 首次执行：2026-09-19 00:12–00:23 CST<br>
> 评审证据重跑：2026-09-19 10:16–10:20 CST<br>
> 分支：`feature/wp-00-project-skeleton`<br>
> 验证基线：`f61c9c1`<br>
> 数据边界：仅本地合成环境，无真实医学数据、患者信息或生产凭据

## 追踪与范围

- 源开发手册：3.1–3.4、8.1。
- 需求基线：第 2、9、10、12、14 节，`WP-00`、`S1`、`SG-1`。
- 本次验证：monorepo 工程门、前后端骨架、五个中间件、存活/就绪检查、Redis 故障安全响应、依赖漏洞阈值和禁止文件门。
- 不在本次范围：真实数据、生产部署、业务数据库/API 契约、鉴权、DICOM 导入/脱敏、帧服务、标注及审核业务。

## 环境与可重现命令

使用 Node.js `v20.20.2`、npm `10.8.2`。本地从空依赖目录执行：

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
```

后端在独立终端启动，不记录或输出 `.env.local` 值：

```bash
set -a
source .env.local
set +a
npm run start:dev --workspace server
```

另一终端执行：

```bash
curl --fail --silent http://localhost:3000/api/health/live
curl --fail --silent http://localhost:3000/api/health
```

前端可达性验证：

```bash
npm run dev --workspace web-anno
curl --fail --silent http://localhost:5173/
```

## 自动化检查结果

| 时间（CST） | 检查 | 结果 |
| --- | --- | --- |
| 00:12–00:15 | `npm ci` | 通过，安装 523 packages；锁文件未改变 |
| 00:15 | 禁止文件、lint、typecheck | 全部退出 0 |
| 00:16 | `npm test` | scripts 24/24、server 19/19、web 26/26 通过 |
| 00:16 | `npm run build` | server 与 web 构建通过；Vite 仅有已知 529.73 kB chunk 非阻断提醒 |
| 00:17 | Compose 配置与运行状态 | 配置通过；PostgreSQL、Orthanc、MinIO、Redis、Elasticsearch 均 `running healthy` |
| 00:19 | `npm audit --audit-level=high` | 退出 0；0 Critical/High，5 Moderate，1 Low |
| 00:19 | 前端 `http://localhost:5173/` | HTTP 200，React root 存在 |
| 00:22–00:23 | 文档变更后 `npm run check` | 退出 0；scripts 24/24、server 19/19、web 26/26，lint/typecheck/build 通过 |

`npm ci` 在受限网络中的首次尝试因 DNS 不可用未完成；允许访问 npm registry 后的正式重跑退出 0，本表只以该成功重跑为验收结果。

每个命令的开始/结束时间、退出码和经脱敏的原始输出见 [WP-00 命令转录](wp-00-command-transcript.md)。该转录来自评审后的完整重跑；对无输出的成功命令明确记录了 `stdout/stderr: (none)`。

## 运行时健康证据

2026-09-19 00:17:40 CST，五个依赖均健康：

```text
GET /api/health/live -> HTTP 200
{"status":"ok","service":"server"}

GET /api/health -> HTTP 200
{"status":"ok","dependencies":{"postgres":"up","orthanc":"up","minio":"up","redis":"up","elasticsearch":"up"}}
```

## Redis 故障与恢复验证

故障注入：

```bash
docker compose --env-file .env.local stop redis
curl --silent --output /tmp/miap-readiness.json --write-out '%{http_code}' \
  http://localhost:3000/api/health
```

2026-09-19 00:18:05 CST 结果：

```text
HTTP 503
{"status":"error","dependency":"redis"}
```

响应只有 `status` 和 `dependency` 字段；针对 host、port、stack、password、credential、secret、token 的检查通过，未泄露主机、端口、堆栈或凭据。

恢复：

```bash
docker compose --env-file .env.local up -d --wait --wait-timeout 60 redis
curl --fail --silent http://localhost:3000/api/health
```

2026-09-19 00:18:29 CST 结果：

```text
HTTP 200
{"status":"ok","dependencies":{"postgres":"up","orthanc":"up","minio":"up","redis":"up","elasticsearch":"up"}}
```

验证结束后，Redis 与其余四个容器全部恢复为 `running healthy`；Nest 和 Vite 验证进程已停止，3000/5173 无监听进程。

## 安全、D-38 与已知项

- `.env.local` 被 `.gitignore` 命中且不在 `git ls-files` 中；跟踪文件禁止项扫描通过。本次未使用或写入真实医学数据。
- D-38 遵循源手册固定 Node `20.20.2`。Node 20 已结束上游维护，因此仍必须在每个 PR 执行依赖、代码、镜像和配置扫描；任何未批准的 Critical/High 问题都阻断合并和上线。
- 当前 npm 已知 5 Moderate 和 1 Low，高危阈值门通过。不使用 `npm audit fix --force` 自动引入破坏性主版升级；后续在独立依赖更新 PR 中评估和回归。
- Vite 的单 chunk 大于 500 kB 为非阻断性构建提醒，在真实功能路由引入后再评估按路由分包。
- Draft PR #2 已产生首轮远程证据，但安全工作流因 Trivy Action 引用、Gitleaks PR 读权限和私有仓库无 GHAS 的兼容性问题失败。修复已在本地通过，远程重跑仍待控制器推送后验证；在新远程运行通过前，WP-00 状态仍为“等待评审”。
- SG-1 在 WP-00 范围内已建立合成数据边界、本地秘密隔离、健康失败脱敏和扫描门；完整放行仍需 WP-S0 的数据流、信任边界、权限矩阵、密钥/日志/事件方案及威胁清单获得评审批准；在此之前不创建真实数据连接或生产秘密。

## Draft PR #2 首轮远程失败与本地修复

2026-09-19 的首次远程运行已证实三个环境/配置问题：

1. `aquasecurity/trivy-action@0.28.0` 无法解析。核对官方发布和 `v0.36.0` action metadata 后，文件系统/配置与五镜像扫描统一改用 `aquasecurity/trivy-action@v0.36.0`；现有 `scan-type`、`scan-ref`、`image-ref`、`scanners`、`severity`、`exit-code` 和 `skip-dirs` 输入仍与官方 metadata 兼容。
2. Gitleaks 在列取 PR commits 时收到 403。`secret-scan` 作业现仅授予 `contents: read` 和必需的 `pull-requests: read`。
3. 私有仓库的 `security_and_analysis` 未启用，因此 hosted Dependency Review 和 CodeQL SARIF 上传不可用。本修复不开启 GHAS、不产生付费变更；CodeQL 改用 `upload: never`，但仍生成 SARIF 并由仓库内失败关闭门阻断 `security-severity >= 7.0`。Hosted Dependency Review 替换为仓库原生的全锁文件门：先记录允许许可证标识符，阻断 `GPL-2.0`、`GPL-3.0`、`AGPL-1.0`、`AGPL-3.0`，再用 `npm audit --audit-level=high` 阻断 High/Critical。

本地重跑使用项目指定的 Node `20.20.2`。聚焦工作流/依赖政策测试 9/9 通过；根检查脚本 33/33、服务端 19/19、前端 26/26 通过，lint、typecheck 和两端构建通过；workflow YAML、Compose 配置、禁止文件和 diff 检查通过。当前锁文件许可证门记录 11 个允许标识符、6 个未在锁文件中提供许可证元数据的条目，且无禁止标识符；在线 npm 审计仍为 0 Critical/High、5 Moderate、1 Low。GitHub Actions 自身使用 Node 24 的提醒属于外部 action runtime，不改变项目的 Node 20 契约。当前只能声明本地配置与测试结果；Trivy、Gitleaks、CodeQL 本地 SARIF 门和依赖政策的新远程结果仍待 PR #2 重跑，本文不声明远程修复已成功。

第四轮复核补充：`upload: never` 不会关闭独立的数据库上传输入；现已同时设置
`upload-database: false`。回归断言先因该值缺失失败，再在修复后通过。Node
`20.20.2` 下聚焦测试 9/9、根脚本 33/33、服务端 19/19、前端 26/26、两份
workflow YAML 解析、禁止文件和 diff 检查均通过。远程结果仍待控制器推送后验证。

## 回滚

```bash
# 立即停止本地服务，默认保留命名卷
docker compose --env-file .env.local down

# 共享后的文档/代码回退使用可追溯的反向提交
git revert <commit-sha>
```

不对共享分支使用 `git reset --hard` 或强制推送。需删除命名卷时必须另行核对精确卷名、确认仅含合成数据并获得授权；本验收未删除任何卷。
