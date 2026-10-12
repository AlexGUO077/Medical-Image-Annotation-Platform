# M3 最新版本本地收尾复验

核验基线：2026-10-12 主线 `29c3fbf6b61c22412ce52aeea74879c2180c8191`（PR #58/#60/#61/#62 已合并）。用户明确批准先完成本地收尾，云端待资源准备后验收。当前状态仅维护于 [STATUS](../STATUS.md)。本记录区分实际部署/浏览器复验、历史证据和人工批准，不将自动运行替代阶段验收。

## 环境与范围

- 新建独立七服务实例 `miap-synthetic-m3-closeout`，HTTP 18083 / HTTPS 18447 仅绑定本机。数据库、对象存储、影像、Redis、ES 使用独立卷；旧 WP-17 演示及共享开发环境未替换。
- 后端与前端从上述主线按仓库 Dockerfile 全新构建；后端 `miap/server:m3-29c3fbf`（amd64），前端 `miap/nginx:m3-29c3fbf`（arm64）。ES 使用同 Dockerfile 的原生 arm64 `lz4-1.11.4-arm64-smoke`；MinIO 使用 PR #62 已修复镜像。七服务版本、镜像标识、健康状态及端口检查保存于 `reports/m3-closeout-20261012/runtime.json`。
- OCR/NER 复用既有模型的只读副本；实际推理、登录、存储和业务 API 不做 mock，不直接写库补业务数据或伪造登录令牌。
- 测试用 DX、300 帧 CT 与账号仅为合成数据。输入、密码、TOTP 和私有配置位于忽略目录 `.credentials/m3-closeout-20261012`；不进入 Git、输出或证据截图。浏览器使用临时 profile，仅信任该本地证书公钥，结束删除 profile，不保存 HAR/trace/原始响应/帧票据。

## 执行记录

最新构建的功能闭环与覆盖率复验已完成；CT 在最后一轮空闲环境诊断中达标，但前两轮超时原因未关闭，性能波动保留为本地收尾待复核项。产品代码、接口、权限及配额未修改，M3 尚未正式验收。

| 核验项 | 本轮实际结果 |
| --- | --- |
| 部署与真实输入 | 独立七服务健康；DX/300 帧 CT ZIP 经实际 OCR/NER、预览和明确脱敏确认入库；D-45 管理员疾病标签保存通过，成员越权拒绝 |
| 新版标注页面 | DX/CT 均实际操作矩形、画笔、多边形、点并撤销；置信度调整、报告句取消/重新关联、保存；整页刷新后重新登录，确认服务器版本、4 个对象及属性/关联仍正确 |
| 审核/发布/检索 | 实际页面提交、只读审核、三项检查、CT 打回意见及重交、发布金标准锁定；PG 组合与 Elasticsearch 全文可查；CT 返工几何修改通过实际 API 完成 |
| 生命周期/质量 | 实际 API 下线/重启、旧票据拒绝、新版非金标准重派；页面抽检打回下线、同标注人全面复核通过、新版进入新抽检轮并通过；重启后的常规重提交部分使用 API |
| 管理页面 | 管理员实际 2FA；看板打开及 API 精确口径：普通结论 5、通过版本 4、打回率 1/5，抽检 2、通过率 1/2；页面申请、另一管理员批准、申请人一次领取 JSON；自批/他人领取/二次领取均 403；导出不含影像、正文或原始 UID；页面只读审计及本轮病例/导出事件均可追溯 |
| 单测覆盖率 | 后端 52 文件/498 测试通过，语句/行 70.91%；前端 43 文件/215 测试通过，语句/行 81.52%。均包含全部生产源码，达到手册 ≥70%；日志中的 jsdom 未实现绘图提示不冒充真实浏览器结果 |

功能证据为 `functional.log` 与 `functional-continuation.log` 的连续状态链，后者退出码 0；不是一次未中断执行。新脚本曾因整页导航丢失内存登录、AntD 动态下拉定位而中断，修正为真实菜单/链接、刷新后重新登录和键盘选择。首批中断任务的审核分派已通过管理员 API 回收。最终功能任务使用新导入的 DX/CT；其首例尚未作结论的审核从实际“审核中”续跑，未重复审核结论或改变统计分母。测试修正不算产品缺陷修复。页面截图为 `editable-*.png`、`review-*.png`、`published-*.png`、`admin-*.png`；均仅含本轮合成数据。

首轮 CT 299 次预加载后切换 P95 120.5 ms、最大 203.0 ms，超过手册 200 ms 要求，保留为失败；未修改阈值。发现本机同时运行多套旧演练环境后，记录并暂时停止两个自有 WP-16 演练实例以排除资源争用，保留数据卷，测试后恢复原运行容器。首轮结果保存在 `e2e-first-attempt.log`、`ct-300-performance-contended.json`；资源调整后的复测另行记录，不覆盖失败结论。

第二轮复测与首轮处于同一 600 秒计数窗口，累计请求触发 `frames.locked`，后续请求 403，故该轮中止且不计性能通过。已通过实际管理员 API 核对本轮标注账号锁定审计并重新启用；账号版本变更开启新计数窗口，不修改产品阈值。保留 `e2e-rate-window-attempt.log` 和 `unlock.log`。同时修正测试清理异常掩盖原始失败的问题。

清空本轮账号计数窗口、减少后台演练实例后的完整复测仍失败：299 次切换 P95 152.7 ms、最大 418.1 ms；仅第 109 次切换超过 200 ms。结果保存在 `e2e-isolated-performance.log`、`ct-300-performance-isolated.json`。目前不能归因于资源争用，也不能据此断言 PR #60 引入性能回归；需区分实时票据复核、PNG 解码和渲染器初始化耗时。未降低阈值、移除权限复核或过滤离群样本。后续功能复验使用 `MIAP_M3_FUNCTIONAL_ONLY=1` 明确跳过性能门，不能作为该门通过证据。

完成全部功能与覆盖率运行后进行一次定向性能诊断，未继续反复运行取最好值：299 次切换全部 ≤200 ms，P95 73.7 ms、最大 155.6 ms；浏览器 1700×1100、DPR 1，实际影像画布 998×986。票据请求中位数 15.7 ms、P95 23.4 ms、最大 71.9 ms；最慢帧含 59 ms 长任务。数字保存在 `ct-300-diagnostics.json`，该轮结果为 `ct-300-performance-diagnostic.json`、`performance-diagnostic.log`（退出码 0）。本轮没有复现 >200 ms，故不能用这些数字反推前两轮离群根因，也不宣称性能缺陷已修复。下一步在人工复验中重点复核翻帧波动；再现超时时只诊断受影响链路，保持实时权限校验和 200 ms 门槛。

测试结束恢复暂停前正在运行的两个 WP-16 实例共 12 个容器，名单保存在 `restored-test-containers.json`；未删除或重置旧卷。最新独立实例保留供后续人工复验。

本批只扩展验收脚本并更新证据。修正旧“下一帧”文字定位为新版既有 `aria-label`；新增真实页面绘制/撤销、属性和报告关联保存重载、提交、审核及管理操作，保留 API 对状态和权限的独立断言。

## 复现

先按 `deploy/README.md` 初始化独立实例并使用上述最新镜像；保留明确测试预算（600 秒，CR/DX/US 各 100、CT/MR 各 1000），不新增产品默认额度。在仓库根目录执行：

```sh
MIAP_M3_INSTANCE="$PWD/.credentials/m3-closeout-20261012" \
MIAP_M3_PROJECT=miap-synthetic-m3-closeout \
MIAP_M3_CT_FRAMES=300 MIAP_M3_UI_ACTIONS=1 \
MIAP_PYTHON="$PWD/../.runtime/deid-venv/bin/python" \
MIAP_CHROME_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
MIAP_PLAYWRIGHT_MODULE=<本机 Playwright 模块路径> \
MIAP_M3_ARTIFACT_DIR="$PWD/reports/m3-closeout-20261012" \
node server/test/m3-deployed.integration.cjs
```

`MIAP_M3_FUNCTIONAL_ONLY=1` 仅跳过已单独记录的性能门，输出明确 SKIP；不能据其退出码宣称完整 M3 通过。`MIAP_M3_DIAGNOSTICS=1` 额外记录票据请求、长任务与画布尺寸的数字摘要，不输出 URL/令牌或降低断言。

`--reuse-imports` 仅用于尚未发布、已回收的本轮病例；避免重复导入。`--management-only` 在已完成闭环的本轮任务上复验管理页面，不重跑发布/抽检改变统计分母。命令不打印凭据，失败仅记录阶段和源码位置。

覆盖率使用现有 Vitest 和全部源码范围，在对应 workspace 执行（仓库根目录命令）：

```sh
(cd server && ../node_modules/.bin/vitest run --coverage --coverage.include='src/**/*.ts' --coverage.reporter=text-summary --coverage.reporter=json-summary --coverage.reporter=lcov --coverage.reportsDirectory=../reports/m3-closeout-20261012/coverage/server --maxWorkers=2)
(cd web-anno && ../node_modules/.bin/vitest run --coverage --coverage.include='src/**/*.{ts,tsx}' --coverage.reporter=text-summary --coverage.reporter=json-summary --coverage.reporter=lcov --coverage.reportsDirectory=../reports/m3-closeout-20261012/coverage/web --maxWorkers=2)
```

复验原始输出及截图均在被 Git 忽略的 `reports/m3-closeout-20261012/`，私有续跑/诊断入口在 `.credentials/m3-closeout-20261012/`。Git 仅保存本记录、状态和通用测试脚本。

## 源手册 §8.4 与正式验收边界

| 手册检查 | 本日证据与边界 |
| --- | --- |
| 1 成员无影像下载/导出/打印 | 新版任务、标注台、审核台、病例库/只读详情无相应按钮；成员管理接口均 403；两个成员角色无浏览器下载事件 |
| 2 仅服务端 PNG 帧 | 实际帧为 `image/png`、`no-store, private`，猜测原始影像路由不返回 DICOM；无 Cache Storage/会话存储或持久化影像；仅允许 GPU 能力和日志级别的非敏感 localStorage |
| 3 票据时效和绑定 | 本日无登录 401、跨账号 403、下线及重启后旧版本票据 403；真实约 301 秒过期及同账号跨会话拒绝沿用 [M2 本地核验](m2-acceptance-20261002.md)，未写成当日重跑 |
| 4 平铺账号/姓名/时间水印 | 本日 DX/CT 实际截图可见平铺水印；附件分页水印保留 M2 像素核验及最新 CI 测试，未再次逐页人工核对 |
| 5 频控和解锁 | 本日累计预载请求实际触发账号锁定、后续 403，管理员核对本轮 `frames.locked` 后重新启用；本日脚本未单独捕获触发瞬间的 429 响应，429 证据沿用 M2 及当前帧集成 |
| 6 审计 | 实际查询本轮病例阅片/保存/提交/审核/发布及本轮导出申请/批准/领取事件；只读页面可查，成员拒绝 |
| 7 中间件隔离 | 新实例仅 Nginx 18083/18447 绑定 127.0.0.1，数据服务无发布端口；公网/云防火墙测试待资源 |
| 8 双管理员导出 | 新版页面实际双人审批；本人自批、非申请人领取、二次领取均拒绝；批准后的实际有效期 23～24 小时，一次包领取成功；未等待 24 小时做真实时间过期，本地过期/撤权用例见 WP-14 与当前 CI |

本日自动复验不替代人工全流程复验；历史有效证据与本日新证据分别保留。主代理修改、一次独立只读复核及发现点定向核对未发现测试证据失真或安全边界变更；代理复核不作人工批准。

云端 HTTPS 可访问、外网直连数据服务隔离、每日异地备份及实际定时任务按用户决定延后；本地备份/三例恢复证据见 [WP-16](wp-16-packaging-preflight.md)。源手册之外的派生独立渗透或事件演练不新增为本次本地验收阻断。10 月 8 日 ZAP 的中低危提示保留作后续复核，不把历史警告写成新扫描通过。

另一人代码评审、涉及权限/脱敏/帧服务的组长复核与最终人工验收来源仍须如实记录；本次不补造日期、人名或 GitHub Review。M3 正式验收须满足源 Word §9.1 的完整闭环、§8.4 全通过及云端可访问。
