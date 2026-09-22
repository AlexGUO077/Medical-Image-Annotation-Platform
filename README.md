# Medical-Image-Annotation-Platform

医学影像标注平台，按源开发手册和已审定的实施基线分阶段建设。

## 本地开发快速开始

前提：Docker Desktop 已启动，本地安装了 `nvm`。仓库按 D-39 固定使用 Node.js `24.14.0`，不允许其他 Node 版本跳过运行时校验。

```bash
nvm install 24.14.0
nvm use 24.14.0
node --version
npm ci
```

导入与脱敏进程另需 Python 3.11。依赖安装在仓库内已忽略的本地虚拟环境，不得把模型缓存或运行产物提交到 Git：

```bash
python3.11 -m venv .venv
.venv/bin/pip install -r server/workers/requirements.txt
export DEID_WORKER_PYTHON="$PWD/.venv/bin/python"
```

PaddleOCR 与 PaddleNLP 模型必须在导入真实样例前完成本地下载和预热；实际识别只在本地子进程执行，不调用云端 OCR/NER，也不得把原始内容写入日志。

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
nvm use 24.14.0
npm run dev --workspace web-anno
```

本地默认地址：

- 前端：`http://localhost:5173`
- 后端存活检查：`http://localhost:3000/api/health/live`
- 后端就绪检查：`http://localhost:3000/api/health`

## 验证与停止

本地完整检查：

```bash
nvm use 24.14.0
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

- 本地和自动化验证默认只允许合成/匿名测试数据。D-31 已批准的 `teacher_provided_teaching` 仅可在本项目开发测试环境按既有隔离、脱敏、人工确认流程导入；原始 DICOM、原始报告和患者信息不得进入 Git 或日志，正式卷只保存去标识化结果及按 D-04 加密的最小映射。
- `.env.local` 只存在本地且已被 Git 忽略；不得将密码、Token、API key、私钥或生产凭据复制到代码、日志、PR 或 Issue。
- SG-1 未完整放行前，不创建真实数据连接和生产秘密。

## 开发基线

- [项目执行规则](AGENTS.md)：单一实现者、按需阅读、风险分级和精简证据。
- [工作包与安全门状态](docs/STATUS.md)：当前状态、关联提交、证据和阻塞。

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
