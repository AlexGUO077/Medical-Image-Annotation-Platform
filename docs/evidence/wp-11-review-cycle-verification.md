# WP-11 首批审核闭环本地验证

日期：2026-10-02。范围：源手册 §2.3/§5.2/§6.3/§7.6、需求基线 WP-11/S9 的审核、发布锁定、打回重交部分。用户本会话回复“确认”，批准 [D-11/D-12/D-41](../decisions/D-11-D-12-D-41-review-cycle.md) 的两项建议；实现按 [审核 API 契约](../contracts/reviews-api.md)。当前 WP/SG 状态只维护于 [STATUS](../STATUS.md)。

## 环境与命令

Node.js 24.14.0、npm 11.9.0、macOS；沿用已有本地 PostgreSQL/Redis 服务，集成测试创建并清理独立合成 schema，不替换容器或数据卷。

```sh
npm run check
npm run test --workspace web-anno -- src/pages/ReviewPage.test.tsx src/reviews/api.test.ts src/reviews/ReviewFeedback.test.tsx
MIAP_ENV_FILE=/Users/guo/College/Medical-Image-Annotation-Platform/worktrees/wp-00-project-skeleton/.env.local node server/test/frame-api.integration.cjs
MIAP_ENV_FILE=/Users/guo/College/Medical-Image-Annotation-Platform/worktrees/wp-00-project-skeleton/.env.local node server/test/tasks.integration.cjs
npm run dev --workspace web-anno -- --host 127.0.0.1 --port 5181 --strictPort
MIAP_PLAYWRIGHT_MODULE=/Users/guo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright MIAP_CHROME_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' MIAP_REVIEW_ARTIFACT_DIR=reports/wp11-20261002/browser node web-anno/test/review.browser.cjs
```

环境文件只由测试进程读取；不记录内容或凭据。Chrome 使用已有 Playwright 运行时，不新增项目依赖。

## 结果与证据位置

- 完整检查通过：45 个脚本测试、263 个后端测试、13 个 Python 测试、146 个前端测试；lint、类型检查、两端构建通过。
- 最终仅调整发布后的提示文案，再运行审核页面/API/批注组件的 7 个定向测试，全部通过（`review-final.log`）。
- 真实 PostgreSQL/Redis 的 HTTP 集成通过：自审/他审隔离、当前分派/会话/资格/期限复核、一票否决、版本与并发冲突、审计失败整笔回滚；DX/CT 当前版本金标准锁定、历史版本保留；打回保存/重交及原人员账号不可用、资格移除、容量满三类异常回池；自审完成后容量计算。
- 审核附件集成通过：未确认/跨病例附件拒绝、分页输入拒绝、存储读取期间分派到期拒绝、读取或图片审计失败不返回内容；原标注工作台、帧 HTTP 和任务派单/回收回归通过。
- Chrome 通过：真实 Cornerstone canvas 绘制合成像素；对象只读、对象/报告关联及规范展示、同色历史轮廓叠加、附件分页、检查与二次确认、通过后禁用后续帧读取、打回批注、退出清理。浏览器 API 为显式合成 mock，不将其表述为真实后端端到端验证。截图已目视核对。
- 本地原始输出与 PNG 位于仓库忽略目录 `reports/wp11-20261002/`（`check.log`、`frame-api.log`、`tasks.log`、`browser.log`、`browser/*.png`）；该位置为本机证据，不作为远端持久 artifact。可再运行上述脚本复现，Git 只保留代码和本记录。远端 CI 以对应提交的 Actions run 为准，不复制其日志。

构建仍提示现有前端 chunk 体积与浏览器模块外部化，jsdom 的 canvas/style 限制仍出现在测试输出；命令退出码均为 0。未以这些提示降低检查或安全阈值。

## 范围与回滚

本批未新增表或迁移；复用 `reviews`、`annotations`、`assignments`、`audit_logs`。自审 diff 已核对服务端权限复核、锁顺序、事务/审计原子性、只读交互、历史对象定位和禁止敏感文件；未发现未解决阻断项。自审不替代另一人评审及权限变更的组长复核。

下线、重启和 D-21 抽检未实施；发布后重新读取/检索随 WP-12 接入。本批不声明完整 WP-11/S9、M3 或 SG-5 通过，也未测定整个 M3 的覆盖率及最终性能指标。数据限合成开发测试。

代码回退使用 `git revert` 本批实现提交，无 schema 回退；已执行的审核记录、病例状态、金标准和分派须保留追溯，不用删除历史来伪造业务回滚。旧代码不提供新审核入口，已写入记录保留于现有兼容字段；实际环境恢复另按备份恢复与兼容性核验执行。
