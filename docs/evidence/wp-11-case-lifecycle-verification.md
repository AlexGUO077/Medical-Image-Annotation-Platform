# WP-11 下线与重新启用本地验证

日期：2026-10-02。用户本会话明确批准“先完成下线和重启”，范围及接口以 [D-12 补充契约](../decisions/D-12-case-offline-reactivation.md) 为准。下线保留金标准，重启复制为下一版非金标准重标起点，并复用原任务分派。WP/SG 当前状态只维护于 [STATUS](../STATUS.md)。

## 环境与命令

macOS、Node.js 24.14.0、npm 11.9.0；真实本地 PostgreSQL/Redis，集成创建并清理独立合成 schema；沿用容器和数据卷。前端先通过接口响应 mock 再接入页面，无新增依赖、表或迁移。

```sh
npm run check
MIAP_ENV_FILE=/Users/guo/College/Medical-Image-Annotation-Platform/worktrees/wp-00-project-skeleton/.env.local node server/test/frame-api.integration.cjs
MIAP_ENV_FILE=/Users/guo/College/Medical-Image-Annotation-Platform/worktrees/wp-00-project-skeleton/.env.local node server/test/tasks.integration.cjs
npm run dev --workspace web-anno -- --host 127.0.0.1 --port 5181 --strictPort
MIAP_PLAYWRIGHT_MODULE=/Users/guo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright MIAP_CHROME_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' MIAP_LIFECYCLE_ARTIFACT_DIR=reports/wp11-lifecycle-20261002/browser node web-anno/test/case-lifecycle.browser.cjs
```

只记录环境文件路径，不记录凭据或内容。

## 结果

- 完整检查通过：45 脚本、263 后端、13 Python、151 前端测试，lint、类型检查及两端构建通过。
- 实际 HTTP/数据库事务通过：管理员边界、未知载荷字段、版号/状态冲突、来源与脱敏确认拒绝、到期 JWT 拒绝；下线/重启并发各只完成一次；最终审计失败时状态、分派释放、标注与标签复制及种子审计整笔回滚。
- 保留旧标注和标签的完整行快照（包括 gold、作者及时间）不变；新版本稳定 logical_id、几何、标签和原作者延续，is_gold=false。CT 重启后重新保存/提交/审核/发布通过；空对象版本的重启种子可被标注人及审核人读取并再发布，不伪造人工保存记录。任务失效/关联移除、版本上限拒绝。
- 已下线病例拒绝既有帧票据读取、新票据、审核读取及标注保存；残留 active 分派释放。原任务 manual/auto/pool 的重标分发路径通过；原工作台、提交、审核、帧/限流/审计及任务集成回归通过。
- Chrome 合成 mock 检查通过：管理员详情二次确认、下线状态、原任务冲突后强制重读、重启版本与待分配反馈、权限失效清除病例/报告内容；确认弹窗和重启结果截图已目视核对。浏览器 mock 不表述为真实后端端到端验证。

原始本地日志及 PNG 位于忽略目录 `reports/wp11-lifecycle-20261002/`（`check.log`、`frame-api.log`、`tasks.log`、`browser.log`、`browser/*.png`），不是远端持久 artifact；可用已提交脚本复现。现有 jsdom canvas/style 和构建 chunk/浏览器模块提示仍存在，未降低检查门槛。测试固定件的 UID/审计准备和 Testing Library 参数已修正后通过；生产审计追加约束保留。

## 自审与限制

已核对管理员实时会话复核、固定锁顺序、事务审计、旧金标准不可变、空版本读取、未知结果重读及页面权限失效清理；无未解决阻断项。自审不替代非作者评审和组长权限复核。

D-21 抽检仍未确认及实施，WP-12 检索/索引及其下线不可见验证留待对应工作包；本批不声称完整 WP-11/S9、SG-5 或 M3 通过。仅合成测试，不开放真实来源或生产访问。

代码回退使用 `git revert` 本批实现提交，无 schema 回退；旧代码可以读取新增标注行，但不能识别仅有种子审计的空历史版本，且缺少新生命周期接口。因此已有重启数据时，回退前须保留兼容读取补丁或经验证的兼容版本/备份，保留审核、旧金标准和种子追溯，不删除历史伪造回滚。
