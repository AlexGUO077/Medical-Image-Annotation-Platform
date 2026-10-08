# WP-14 受控导出与审计本地核验

核验日期：2026-10-07。依据源 Word §2.2/§2.6/§4.5/§5.2/§6.3/§8.4、需求基线 WP-14/S10/SG-5、UI §15.6 和用户逐项确认的 [D-13](../decisions/D-13-controlled-exports.md)、[接口契约](../contracts/exports-audit-api.md)。仅合成开发范围，不代替非作者评审、组长权限复核或阶段人工验收。

## 环境与命令

Node 24.14.0、npm 11.9.0；既有 PostgreSQL/Redis/MinIO/Orthanc 和原生 Google Chrome。API 与任务集成各自创建独立合成 schema 并清理；对象包使用测试自有 UUID 私有键与独立持久补偿目录。未替换既有容器、数据卷或真实数据。

- `npm run check`：通过，45 脚本、296 后端、13 Python、175 前端测试，含禁止文件检查、lint、类型和构建。随后仅增补数据库字段核验清单及修正被拒绝申请的空有效期文案；受影响类型与前端用例另作定向检查。
- `npx vitest run src/pages/AdminExportsAudit.test.tsx src/app/App.test.tsx`（web-anno）：23 项通过。
- `node server/test/tasks.integration.cjs`：真实 PostgreSQL/Redis 任务 HTTP、分派并发、审计回滚及迁移保护通过。
- 既有 `server/test/case-entry.integration.cjs`：通过临时隔离包装复用完整 AppModule，在自有完整迁移 schema 上验证真实 PostgreSQL/Redis/MinIO 的手工录入、正文编辑、附件确认与水印预览；OCR/NER 仍使用该入口原有夹具。直接运行时共享旧测试库未补齐后续字段，夹具读取失败；隔离包装只改变数据库作用域并等待原有测试，未修改共享库、业务断言或生产代码。包装与最终输出一并留在忽略证据目录。
- `node server/test/frame-api.integration.cjs`：真实 Nest/PostgreSQL/Redis 全套通过。本次使用既有忽略配置 `MIAP_ENV_FILE`，设置 `MIAP_EXPORTS_REAL_OBJECTS=1`，使 JSON 的 PUT/GET/DELETE 走真实私有 MinIO；设置 `MIAP_EXPORTS_BROWSER_URL`、`MIAP_PLAYWRIGHT_MODULE`、`MIAP_CHROME_EXECUTABLE` 启用现有 Chrome 扩展。默认 CI 不需要 Chrome/MinIO，JSON 对象边界使用内存夹具，HTTP、数据库事务与补偿仍执行新增断言。
- `node server/test/frame-render.integration.cjs`：真实 Orthanc/Redis 合成渲染通过，覆盖像素、尺寸/标定、元数据清除、动态水印和缓存。
- `npm audit --audit-level=high --json`：退出码 0，HIGH/CRITICAL 各 0；保留既有阈值，未强制升级无关依赖或添加豁免。

## 结果与限制

真实 HTTP 覆盖未登录/成员拒绝、当前管理员失权/过期/旧会话、申请人与审批人分离、固定版本、重复/并发审批、本人领取、24 小时到期与并发一次领取。老师样例、下线、软删除、金标准失效或版本改变拒绝批准/领取；读取失败或摘要不匹配不扣次数。上传后失败和审批审计失败回滚，持久补偿删除未提交包；领取审计失败不消耗机会、不返回包。数据库自批/状态/计数约束和有历史迁移回退保护实际生效。

已解析 DX/CT JSON，含必要逻辑标识、标签、金标准几何、报告句序号及定位参数；不含影像、DICOM/UID、报告/临床正文、附件或映射。审批和领取审计可查询；审计 UPDATE/DELETE 被既有触发器拒绝；查询精确过滤、时间与分页校验、必要 detail 投影均通过，私有正文、秘密和对象键不返回。

Chrome 的导出、审计及账号管理请求均转发真实 Nest HTTP，只用合成夹具初始化会话。验证本人不能自批、另一管理员确认后批准、浏览器实际保存 JSON 后不能再次领取、只读审计精确过滤、异常账号启用确认、管理员停用退出和成员直达管理页拒绝。pageErrors 为 0，已查看导出和审计截图。上游帧 HTTP 仍使用合成渲染夹具，真实像素能力另以 Orthanc 渲染测试核验；本结果不外推真实数据或生产验收。

PR #53 合并提交 `c84181df6c86defa304724cb95b8a241b003e7a6` 的 [CI](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/actions/runs/37608199008) 通过，[Security](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/actions/runs/37608199039) 新检出 sharp 0.35.4 携带 librsvg 的 HIGH：[官方 GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)。本批仅将 sharp 固定为 0.35.5 及其对应原生依赖，原生 arm64 实测 librsvg 2.63.2；[官方发布说明](https://sharp.pixelplumbing.com/changelog/) 对应补丁。当前本地 audit 剩余 1 LOW、5 MODERATE，不构成既有 HIGH 阻断；远端 npm/Trivy 检查仍须以本批实际 run 为准。

原始输出与浏览器产物保存于本仓库忽略的 `reports/wp14-exports-20261007/`，包括完整检查、API、任务、渲染、定向前端、类型及依赖扫描输出，以及 `browser/result.json`、`browser/exports.png`、`browser/audit.png`、`browser/synthetic-package.json`。浏览器夹具早期定位问题已修正，最终套件退出码 0。远端证据引用实际 PR/run；WP/SG 当前状态仅维护于 [STATUS](../STATUS.md)。
