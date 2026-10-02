# WP-11 抽检与全面复核本地验证

日期：2026-10-02。用户逐项批准 [D-21](../decisions/D-21-spotchecks.md)：任务分批 10% 向上取整、本轮同标注人范围、失败下线、独立互审及持久待派。WP/SG 当前状态只维护于 [STATUS](../STATUS.md)。

## 环境与复现

macOS、Node.js 24.14.0、npm 11.9.0；真实本地 PostgreSQL/Redis，测试创建并清理独立合成 schema 和自己的 Redis keys；沿用既有容器/数据卷。迁移及接口 mock 先于页面接入；在既有任务模块内实现，无新增表、依赖或部署服务。

```sh
npm run check
MIAP_ENV_FILE=/Users/guo/College/Medical-Image-Annotation-Platform/worktrees/wp-00-project-skeleton/.env.local node server/test/frame-api.integration.cjs
MIAP_ENV_FILE=/Users/guo/College/Medical-Image-Annotation-Platform/worktrees/wp-00-project-skeleton/.env.local node server/test/tasks.integration.cjs
npm run dev --workspace=web-anno -- --host 127.0.0.1 --port 5181 --strictPort
MIAP_PLAYWRIGHT_MODULE=/Users/guo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright MIAP_CHROME_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' MIAP_QUALITY_ARTIFACT_DIR=reports/wp11-spotchecks-20261002 node web-anno/test/quality-reviews.browser.cjs
```

仅记录环境文件路径，不记录凭据。构建与读取 dist 的集成测试顺序执行，避免构建清空测试正在读取的输出。

## 结果与自审

- 完整检查通过：45 脚本、264 后端、13 Python、156 前端测试，以及 lint、类型检查和两端构建。最终补齐已发布质量分派的管理员回收按钮及正确的开始提示后，定向前端类型检查、TaskDispatchPanel/MemberTasksPanel 测试及构建另行核对，结果见本地日志。
- 真实 HTTP/事务通过：11 例抽 2 例、零候选不建轮次、同版不重抽、并发只生成一轮、新发布版本再参与；无资格/容量不足持久待派，后台按互审及两级容量补派；自审任务的提交人也不得抽检本人病例，只有审核资格的其他成员可以承接。
- 开始前、非本人及旧普通结论被拒绝；质量审核只读帧与已确认附件通过本人有效分派获取。失败后旧帧票据拒绝；重复结论只写一笔，另一请求 409。抽样与全面复核审计失败时，状态、审核结果及分派整笔回滚。
- 失败病例下线并保留旧金标准；本轮同标注人的其他候选生成全面复核，已有抽检目标复用。复核通过保持发布，复核打回下线且不递归扩展；每轮每人只生成一次扩展记录。管理员回收和实际账号资格变更将质量工作退回待派；旧会话立即失效。管理员下线取消未完成工作；重新启用、保存、提交、普通审核再发布后新版本参与抽检；原任务失效取消目标。
- 最新迁移在无质量历史时往返通过；已有质量历史时回滚拒绝，普通空审核人/待派记录被数据库约束拒绝。旧迁移测试改为按名称核对；帧缓存计数使用本段测试的渲染基线和病例审计范围，避免其他阅片用例干扰。原任务、标注、提交、普通审核、下线重启、帧限流/水印/审计回归通过。
- Chrome 合成 mock 通过管理员抽样/待派数量、个人质量队列与显式开始、真实 Cornerstone 像素、目标分派 ID、三项检查及二次确认、下线立即清除影像和全面复核反馈；确认与结果截图已目视核对。浏览器 mock 不表述为真实后端端到端验证。

已自审类型/版本/开始门、非提交人资格、来源/任务匹配、容量串行化、固定锁顺序、旧金标准不可变及审计原子性；后台沿用已有 task-worker 事件白名单。自审不替代另一人评审或组长权限复核。

本地独有日志与 PNG 在忽略目录 `reports/wp11-spotchecks-20261002/`：`check.log`、`frame-api.log`、`quality-reclaim-ui.log`、`sampling-pending.png`、`quality-confirmation.png`、`offlined-expanded.png`。未上传为远端持久 artifact，可通过提交脚本复现。原任务集成通过结果记录于本次工具输出；不为补写日志重复运行。现有 jsdom style/canvas 与构建 chunk 提示保留，不降低门槛。

## 限制与回滚

仍仅合成范围；WP-12 发布检索与完整 M3 链路、SG-5 及人工阶段验收另行核验。首次运行抽检前须应用 `QualityReviewAssignments1790942400000` 迁移。

出现权限、版本、抽样范围或事务异常时停止质量派单并向前修复；回退代码使用本批提交的 `git revert`，保留兼容 schema 和全部历史。存在质量工作/结果时不能回滚删除字段；旧代码无法维护质量待派或开始上下文，因此回退前先停相关 worker、备份并保留兼容授权/维护处理，不删除待派、金标准或不可变审计来制造兼容。
