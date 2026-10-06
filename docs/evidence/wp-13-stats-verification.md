# WP-13 统计看板本地核验

核验日期：2026-10-06。依据源 Word §2.1/§2.2/§5.2/§6.1、需求基线 WP-13/S10/SG-5、UI §15.5、用户全部确认的 [D-42](../decisions/D-42-stats-metrics.md) 和 [接口契约](../contracts/stats-api.md)。仅合成开发范围；本记录不代替非作者评审、组长权限复核或阶段人工验收。

## 环境与命令

Node 24.14.0、npm 11.9.0；现有本地 PostgreSQL/Redis，测试自建独立 schema 并在 finally 清理；Vite 5183、原生 Google Chrome，经现有 Playwright 运行。未替换运行容器、数据卷、镜像或真实数据。

- `npm run check`：通过，45 脚本、292 后端、13 Python、171 前端测试，含禁止文件检查、lint、类型与构建。其后仅新增一个服务端失败路径单测及调整浏览器测试夹具；生产代码未改动。
- `npx vitest run src/modules/dashboard/stats-input.spec.ts`（server）：最终 19 项通过，含新增的账号状态拒绝和查询超时 503。
- `npx vitest run src/dashboard/api.test.ts src/pages/DashboardPage.test.tsx src/app/App.test.tsx`（web-anno）：31 项通过；最终 `npm run typecheck` 通过。
- `node server/test/frame-api.integration.cjs`：真实 PostgreSQL/Redis/Nest HTTP 全套通过。本次设置 `MIAP_ENV_FILE` 指向既有忽略的本地配置，并设置 `MIAP_STATS_BROWSER_URL=http://127.0.0.1:5183`、`MIAP_PLAYWRIGHT_MODULE` 为现有运行时模块、`MIAP_CHROME_EXECUTABLE` 为本机 Chrome。可选浏览器扩展同套通过；CI 不需要 Chrome，沿用原集成入口执行新增统计断言。

## 结果与限制

真实 HTTP 覆盖 DX/CT 提交、打回重交、下线重启；普通审核、spotcheck、recheck 和待审核分母分离；历史版本/任务/提交人归属、早期缺少 review_kind 的普通结论兼容；北京时间 16:00 UTC 边界与含起止日；五维分组、AND 筛选、全范围总览/趋势与服务端分页、空范围补零和 null 比例。后续下线、任务完成、人员停用/资格变化保留历史；病例/任务软删除、非 synthetic、缺少人工确认、提交审计或结论审计则排除。

未登录 401、成员 403、停用/过期/需改密/无 2FA 管理员 403、旧会话 401；管理员无阅片资格可读聚合。响应不含临床/报告/几何/存储键/IP/凭据，使用 no-store；查询超时返回 503，数据库异常返回不泄露 SQL 的 500，均不返回部分指标。

Chrome 的统计及任务/人员选项请求均转发到本套真实 Nest HTTP，只用夹具初始化会话。验证跨页任务选项、任务筛选、系统分组、普通打回 1/2、无抽检时“暂无”、只读无导出、管理员停用后清除指标并退出、成员直达重定向且不请求统计；pageErrors 为 0。已查看截图。现有帧测试上游仍使用合成渲染响应，不能据此宣称真实影像或生产验收通过。

本次小规模合成快照为 37 病例、45 审核、354 审计；未筛选 GET 实测 8.3ms，含多种分组与负向范围的查询集 98.5ms。这是本机该数据量的一次测量，不代表规模性能或生产 SLO。

原始输出与截图保存在本仓库忽略的 `reports/wp13-stats-20261006/`：`miap-stats-check.log`、`miap-stats-server-targeted.log`、`miap-stats-web-tests.log`、`miap-stats-types.log`、`miap-stats-browser-integration.log`、`browser/result.json`、`browser/dashboard.png`。浏览器夹具初次运行的样式导入/定位问题已修正，最终退出码 0；不把失败夹具输出当作产品验收结果。远端检查引用实际 PR/run，当前 WP/SG 状态仅维护于 [STATUS](../STATUS.md)。
