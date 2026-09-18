# Medical-Image-Annotation-Platform

医学影像标注平台，按源开发手册和已审定的实施基线分阶段建设。

## 本地开发快速开始

前提：Docker Desktop 已启动，本地安装了 `nvm`。仓库按 D-38 固定使用 Node.js `20.20.2`，不允许其他 Node 版本跳过运行时校验。

```bash
nvm install 20.20.2
nvm use 20.20.2
node --version
npm ci
```

首次启动时生成只用于本地合成环境的 `.env.local`；生成器不会输出密码，且默认拒绝覆盖已有文件。

```bash
node scripts/create-local-env.mjs
docker compose --env-file .env.local config --quiet
docker compose --env-file .env.local up -d --wait --wait-timeout 120
docker compose --env-file .env.local ps
```

启动后端前，在当前终端加载本地环境变量：

```bash
set -a
source .env.local
set +a
npm run start:dev --workspace server
```

在另一个终端启动前端：

```bash
nvm use 20.20.2
npm run dev --workspace web-anno
```

本地默认地址：

- 前端：`http://localhost:5173`
- 后端存活检查：`http://localhost:3000/api/health/live`
- 后端就绪检查：`http://localhost:3000/api/health`

## 验证与停止

本地完整检查：

```bash
nvm use 20.20.2
npm run check
docker compose --env-file .env.local config --quiet
npm audit --audit-level=high
```

`npm run check` 依次执行禁止文件、lint、类型、测试和构建门。如需与 CI 逐项对齐，依次执行：

```bash
npm run check:forbidden-files
npm run lint
npm run typecheck
npm test
npm run build
```

停止并保留本地合成数据卷：

```bash
docker compose --env-file .env.local stop
# 或删除容器和网络，但仍保留命名卷：
docker compose --env-file .env.local down
```

## 数据与凭据边界

- 本地和自动化验证只允许合成/匿名测试数据；严禁将真实 DICOM、原始报告、患者信息、脱敏映射、生产日志或备份放入本仓库或本地 Compose 卷。
- `.env.local` 只存在本地且已被 Git 忽略；不得将密码、Token、API key、私钥或生产凭据复制到代码、日志、PR 或 Issue。
- SG-1 未完整放行前，不创建真实数据连接和生产秘密。

## 开发基线

- [需求拆解与实施基线](docs/医学影像标注平台-需求拆解与实施基线.md)
- [UI 与交互设计要求](docs/医学影像标注平台-UI与交互设计要求.md)
- [GitHub 版本管理与回滚规范](docs/GitHub版本管理与回滚规范.md)

## 仓库纪律

- `main` 只保存通过验证的稳定版本。
- 功能、修复、安全、文档和工作包均在独立分支完成，通过 Pull Request 合并。
- 每个有意义、可评审、可回滚的变更必须提交并推送到 GitHub；本地提交不作为阶段完成证据。
- 真实 DICOM、患者信息、原始报告、脱敏映射、数据库备份、密钥、Token 和 `.env` 严禁进入 Git。

## 回滚

已共享的提交使用 `git revert <commit>` 创建可追溯的反向提交；禁止对共享分支执行强制推送或用 `git reset --hard` 改写历史。基础设施回退时先停止本地服务，默认不删除命名卷；任何卷删除都必须先确认精确目标和数据性质。
