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

## WP-05 手工录入与附件

管理员在“病例录入 → 手工简版录入”提交来源、报告和一张 JPG/PNG，核对服务端脱敏报告及水印预览后确认，进入病例页补充临床信息和教学字段。批量导入已完成行也可进入病例详情。已发布等处理中/锁定状态不开放编辑。

附件支持 PDF/JPG/PNG/DOCX/XLSX，每片最多 5 MB、整文件最多 50 MB。后台处理完成后须逐页核对并显式确认，正式存储仅保存处理后的 PNG 页面。Office 外部链接、宏、公式/活动字段、加密文档、超过 100 页或 200 MB 处理结果会安全拒绝；这类文件请先生成静态、已去标识化的版本再上传。预览使用服务端账号/姓名/时间水印，不提供原件下载。

WP-16 容量与备份规划需按转换后的 PNG 总量评估附件放大系数，并计入备份副本、保留周期及隔离暂存峰值，不能只按上传文件大小估算。当前单附件处理结果上限为 200 MB；该上限不包含备份副本与转换中间文件。100 页 PDF 的逐页文本识别和渲染仍可能触及 worker 600 秒时限，超时会标记失败且不得确认入库。后续按真实环境的页数、耗时和输出大小测量结果，再评估降低页数上限或分段处理；本轮不改变现有限制。

运行附件处理的本地 Python 环境除 `server/workers/requirements.txt` 外，还需 PATH 中可调用 `soffice`（LibreOffice Writer/Calc）、`pdfinfo`、`pdftotext`、`pdftoppm`（Poppler）。转换使用独立隔离目录与 Office 用户配置。模型应预先缓存，OCR/NER 或转换不可用时拒绝入库。macOS ARM 原生 Paddle 推理在既有环境有兼容性问题，真实推理须使用已验证的 Linux 环境，不应通过关闭 OCR/NER 绕过。

独立验证入口（只针对合成开发环境）：

```bash
# 实际 HTTP + PostgreSQL + Redis + MinIO；明确替换 OCR/NER 边界。
# MIAP_ENV_FILE 指向正在运行的本地开发服务配置，勿启动共用数据卷的第二套服务。
MIAP_ENV_FILE=/absolute/path/to/.env.local npm run test:case-entry:integration --workspace server
# WP-06 任务创建：实际 HTTP 认证与 PostgreSQL 事务/并发/迁移回滚。
# 在合成数据库中新建临时 schema，结束后删除该 schema；不操作既有病例。
MIAP_ENV_FILE=/absolute/path/to/.env.local npm run test:tasks:integration --workspace server
# 实际五格式转换与元数据剥离；OCR/NER 在这层也显式替换。
python3 server/workers/verify_attachment_formats.py
```

隔离暂存最长 24 小时；启动及定时清理过期草稿。`IMPORT_QUARANTINE_DIR/object-compensation` 仅保存服务器生成的对象键和映射 ID，正式写入前登记、事务成功后解除；存储中断时保留并重试，删除前检查数据库引用。不要把此目录当作普通缓存清空，否则会失去未完成补偿记录。集成验证会清除自己创建的病例和对象、停用合成账号，并保留追加式审计。

## 任务管理（WP-06 开发中）

管理员在“任务列表”可按来源、系统查看任务，新建任务时填写名称、审核模式和优先级，勾选同来源、同系统下已确认脱敏且尚未进入任务的病例。任务按卡片展示，点击“查看病例”分页查看编号和状态。切换创建来源或系统会清空已选病例；创建时服务端再次校验，冲突时保留表单供调整。

任务名去除首尾空白后最多 200 字符，单次创建最多 2000 例；这两项是已批准的输入技术边界，不是人员在途限额。当前完成任务创建和管理员查看，分派、领取、超时回收及普通成员个人任务仍在后续 WP-06 范围，未设置 5/10/24 默认规则。
