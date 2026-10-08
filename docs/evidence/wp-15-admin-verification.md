# WP-15 系统管理整合本地核验

核验日期：2026-10-08。依据源 Word §2.1/§2.2/§5.1/§5.2/§6.1/§6.3/§8.4、需求基线 WP-15/S10/SG-5、UI §15.6、已批准 D-03 和[既有账号契约](../contracts/auth-api.md)。仅合成开发范围，不替代非作者评审、组长权限复核或阶段验收。

## 环境与命令

Node 24.14.0、npm 11.9.0；既有 PostgreSQL/Redis/私有 MinIO；本地 Vite 5183 与原生 Google Chrome，使用已有 Playwright。HTTP 与任务套件各自建立独立 schema、测试自有 Redis 键和对象/补偿目录并清理，未修改共享库或更换容器/卷。无需新迁移、表、依赖或部署服务。

- `npm run check`：通过，45 脚本、299 后端、13 Python、179 前端测试，含禁止文件、lint、类型和构建。随后修复账号对话框的稳定位置与确认层级；受影响前端以最终定向测试、类型、构建及真实 Chrome 复核，未重复整套验收。
- `npx vitest run src/modules/users/users.service.spec.ts src/modules/exports/exports-input.spec.ts`（server）：10 项通过，当前管理员复核、无效参数与账号审计安全投影覆盖。
- `npx vitest run src/pages/AdminAccountsPanel.test.tsx src/pages/AdminExportsAudit.test.tsx src/app/App.test.tsx`（web-anno）：最终 27 项通过；最终 `npm run typecheck`、`npm run build --workspace=web-anno` 通过。
- `node server/test/tasks.integration.cjs`：真实 PostgreSQL/Redis 任务事务、权限/资格释放、并发、审计回滚及迁移保护通过。
- `node server/test/frame-api.integration.cjs`：最终真实 Nest/PostgreSQL/Redis/MinIO 全套通过。既有忽略配置通过 MIAP_ENV_FILE 加载；MIAP_EXPORTS_REAL_OBJECTS=1 验证原有私有 JSON 存储回归。设置 MIAP_ADMIN_BROWSER_URL、MIAP_ADMIN_BROWSER_OUTPUT、MIAP_PLAYWRIGHT_MODULE、MIAP_CHROME_EXECUTABLE，启用本批 Chrome 扩展；CI 不需要浏览器，新增账号断言沿用现有 HTTP 集成入口。

## 实际结果

账号开通只在当前管理员事务复核后提交，审计失败回滚且不交接密码。生成密码的散列校验与真实登录/首次改密通过；改密挑战及未完成安全设置的账号不能访问业务接口。列表/创建/更新 no-store；列表单快照分页、未知/重复参数、偏移溢出、非法资格/角色及无效日历日期拒绝；列表和审计不返回初始密码、散列或 TOTP 密钥。

真实 HTTP 验证资格挂起释放在途标注，旧 JWT 立即失效；其他系统资格保留，恢复资格不恢复旧分派。账号启停、有效期到期、另一管理员 MFA 重置即时拒绝旧会话；本人停用/MFA 重置及通过更新接口改角色拒绝。创建和修改审计失败原子回滚；既有安全 detail 投影保留权限变更 before/after、有效期、角色及 MFA 重置标记，秘密继续排除。

Chrome 所有管理/账号请求转发真实 Nest HTTP，仅用合成夹具初始化会话。验证跨页账号查找、八系统标注/审核双列、明确创建/变更确认、初始密码仅内存且关闭清除、资格挂起的实际分派释放与旧会话拒绝、恢复不恢复旧分派、启停、另一管理员 MFA 重置和本人按钮禁用。账号审计可只读追踪；失权时编辑器与旧数据清除并退出；成员直达管理页拒绝且不请求 users。页面错误为 0，已查看账号、资格编辑和审计截图。

对话框置于动态列表布局外并使用高于编辑层的确认层级，防止刷新重用实例或编辑框遮挡确认；新增只出现一个凭据框及清除断言，Chrome 使用正常点击验证。夹具的测试 ID/异步分页等待问题已修正，最终套件退出码 0。未将失败或模拟像素结果当作生产验收；帧 HTTP 上游仍是既有合成渲染夹具，OCR/NER、真实数据、生产和规模性能不由本包放行。

原始输出与截图位于本仓库忽略的 `reports/wp15-admin-20261008/`：完整检查、后端/前端定向、任务、最终类型/构建与 API/Chrome 输出，`browser/result.json`、`browser/qualification-editor.png`、`browser/accounts.png`、`browser/account-audit.png`。不保存初始密码、JWT 或完整会话 HTML。远端 CI 以对应 PR/run 为证据；当前 WP/SG 状态仅见 [STATUS](../STATUS.md)。
