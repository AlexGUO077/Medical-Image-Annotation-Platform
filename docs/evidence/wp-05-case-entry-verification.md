# WP-05 录入与病例维护阶段验证

日期：2026-09-26。范围依据源手册 §4.2、§5.2、§6.1/§6.3、§7.2，需求基线 WP-05 / S4 和已批准病例录入契约。只使用即时生成的合成数据；不将自动验证或 agent 自审代替人工评审及阶段验收。

## 已执行

- Node.js 24.14.0 / npm 11.9.0，`npm run check` 通过：仓库脚本 45、服务端 119、Python worker 13、前端 57 项；禁止文件检查、lint、类型检查和两端生产构建通过。
- `MIAP_ENV_FILE=<正在运行的本地合成环境配置> npm run test:case-entry:integration --workspace server`：真实编译产物、HTTP、PostgreSQL、Redis、MinIO 闭环通过。包含未登录/非管理员/跨账号拒绝，手工确认不创建 Study，临床/教学保存，分片附件处理与确认，正式水印预览，发布状态拒写、停用账号立即失效。该测试明确替换 OCR/NER 边界，不作为模型推理证据；测试清理自己的病例/对象并停用合成账号，保留追加式审计。
- Python 3.11.16、Pillow 12.3.0、NumPy 1.26.4、LibreOffice 26.8 开发版、Poppler 26.05.0：`python3 server/workers/verify_attachment_formats.py` 验证 JPG/PNG/PDF/DOCX/XLSX 的实际解码/转换及剥离元数据，另验证手工 JPG/PNG 的 ICC/EXIF 不进入输出。此项也显式替换 OCR/NER。
- 单元/交互测试覆盖重复与不一致分片、类型/大小、跨病例/账号、过期、OCR/NER 失败闭锁、Office 外链/宏/活动字段/实体拒绝、页码越界、显式人工确认、事务失败补偿、数据库/存储中断后重试和已提交对象保护、白底/黑底水印。UI 使用合成数据在浏览器检查病例概况、临床表单、教学字段及附件区，无截断或重叠。
- `docker compose --env-file .env.example config --quiet` 通过；`npm audit --audit-level=high` 通过阈值，当前仍报告 5 moderate / 1 low，无 high/critical，未添加豁免或执行破坏性依赖升级。
- 一名独立只读 reviewer 完成高风险检查。发现的 ICC 残留、白底水印不可见、存储中断缺少持久补偿均修复；限定复核未发现剩余明确阻断项。运行集成另外修复 CasesModule 的 AuthModule 导入及 CommonJS/Sharp 编译兼容问题。

## 尚未宣称完成的验收

- 本阶段真实 Paddle OCR/NER 的完整手工/DICOM 端到端验收尚待 Linux 推理环境完成核验。已知原 macOS ARM Paddle 环境存在 SIGBUS 兼容问题，见既有运行记录；不得关闭识别检查绕过。本轮尝试构建 Linux amd64 环境，但依赖下载约 60–70 kB/s，未完成安装即停止临时构建；未产生真实推理通过结论。
- 首轮 CI 发现模块测试依赖本地环境配置，已改为独立配置；CodeQL 报告文件系统路径传播，已在隔离文件系统入口增加规范化后的根目录包含校验并补充越界、悬空符号链接及 macOS canonical 路径回归测试，保留原 UUID/白名单限制，不增加规则豁免。本地回归通过；对应代码提交 CI 的结果链接统一见 STATUS。
- GitHub 项目/安全 CI 以本 PR 对应提交的 run 为准。另一人评审、组长安全复核和负责人阶段验收尚未取得，本记录不放行新的 SG，也不将 WP-05 标为已完成。

## 运行与回滚

无新增业务表、迁移、独立服务或对外发布能力。按 README 安装本地转换命令；安全处理不可用时拒绝确认。隔离草稿最长 24 小时；不含原文的对象补偿记录保留到数据库引用检查及对象清理成功。回滚通过反向提交恢复代码，不删除正式数据、开发数据卷或尚未完成的补偿记录。
