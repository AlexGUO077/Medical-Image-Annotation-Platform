# 学生教学功能本地验证

日期：2026-10-27。分支：`feat/student-teaching`。范围依据 [D-46](../decisions/D-46-student-teaching-scope.md) 与 [接口契约](../contracts/education-api.md)。本页记录开发验证，不代替人工验收或原 WP/SG 放行。

## 2026-11-18 同病例闭环和阅片交互

- 在本地 HTTPS 实例导入全新的三帧合成 CT 和配套模拟医生报告，经脱敏预览、确认入库、填写疾病标签、分派生产任务，标注员保存两个对象并提交。审核员打回，标注员调整边界后再提交，审核员通过，病例库得到第 2 版金标准。
- 将同一病例通过考核发布接口分配给两个本地测试身份。验证学生使用独立的多点和矩形对象作答，保存、重新打开、交卷。从反馈接口逐项比对病例 ID、原文、所见、诊断意见、金标准版本及两个对象的几何，均与本例发布结果一致。管理员可以查看这份提交。以上生产步骤通过正常业务接口完成。
- 另在 Chrome 从管理员页面发布考核，学生在 DX 用画笔补画、新增另一病灶，在 CT 给同一病灶跨帧加三个点、退出点工具，再给第二个病灶加两个点。重开草稿和交卷后验证两组点仍各自归属原对象。三种长文本均以 40 行验证侧栏滚动和输入框完整展开。提交前后分别检查可见内容。
- 视觉核对覆盖 1440×900 的任务页、学生工作台、对照页和病例库阅片器。1100×800 下两侧栏可切换，参考和对象均可访问。最左侧主导航通过鼠标移入移出、键盘打开和 Esc 收起验证。仅查看 student_demo 列表，确认新练习第 1 题显示「开始作答」。
- HTTP / PostgreSQL / Redis 集成验证跨帧点随答卷冻结，某点越过其本帧的像素边界会拒绝整次保存。生产点仍按单点协议验证。浏览器使用 `server/test/education.browser.cjs`，数据库集成使用 `server/test/education.integration.cjs`，同病例本机验证位于忽略目录 `reports/student-education/nov18-cycle/`，截图位于 `reports/student-education/nov18-browser/`。
- `npm run check` 通过，覆盖 45 项工程脚本、517 项后端测试、13 项 Python 测试、230 项前端测试和生产构建。完整本机输出保存在 `reports/student-education/nov18-check.log`。

## 2026-11-12 病灶考核复验

- 管理员在 Chrome 中选择两例合成阳性病例，核对取自脱敏原文的所见和诊断意见，选取验证学生并发布。新任务只分配给验证账号。
- 同一学生在 DX 和三帧 CT 中各用画笔画两处，给第一处补画时仍为一条记录。新增第二处后分别填写位置和描述。重新打开后两处均可定位、读取；交卷后看到分项原文和两个参考轮廓。
- HTTP / PostgreSQL / Redis 集成验证缺项和非原文摘录拒绝发布、提交前参考访问被拒、零对象旧草稿可存但不可交、多对象文字与冻结参考在提交后完整保留。
- 全量检查通过（脚本 45、后端 516、Python 13、前端 228）。随后调整管理员勾选学生的交互，重新构建前端并通过上述真实浏览器流程。输出在忽略目录 reports/student-education/ 的 v11-check.log、v11-admin-browser.log 和 browser/。
- 使用原密码核验 student_demo 登录，新分配的“影像阅片与病灶标注（合成练习）”两题均未开始；重复运行准备脚本后仅有一份新任务。原题和原答卷保留。

## 2026-10-27 首版验证

- `student` 身份、预录名册、一次性激活、自设密码与登录后改密；管理员管理考核和提交。
- 复用影像布局、绘制和水印帧；独立保存整份答案，保护多人、并发版本与站内离页。
- 每题一次提交，提交后不可改写；展示冻结的已有参考报告与可用金标准轮廓，无自动评分。
- 首版使用病例多序列、全量通用部位选项、对象级器官/位置文字；当时允许明确的零病灶回答，11 月修订后只允许保存空对象草稿。
- 纯合成 DX、三帧 CT 演示题；`student_demo` 保持未提交供用户使用，`student_check` 承担浏览器验证。凭据只在本机忽略目录，不进入证据或 Git。

## 验证环境与证据位置

Node.js 24.14.0；现有 `miap-synthetic-m3-closeout` 本地 Docker 服务；PostgreSQL、Redis、Orthanc、HTTPS nginx；本机 Chrome + 已安装的 Playwright。所有新夹具为合成内容，未改写原老师样例。

本地原始输出保存在忽略目录 `reports/student-education/`，包括 `check.log`、`integration.log`、`final-targeted.log`、`final-build.log`、`browser.log`；浏览器截图位于 `browser/student-workbench-{DX,CT}.png`、`student-feedback-{DX,CT}.png`。截图只包含合成图像与合成学生身份；未保存 HAR、浏览器 trace、Token 或密码。

## 检查及结果

1. `npm run check`：禁止文件、lint、类型、全部测试、构建。最终通过：脚本45项、后端517项、Python13项、前端225项，lint/类型/构建通过；一次运行遭遇本机睡眠/唤醒，出现长时间间隔与worker超时，核对系统睡眠记录后以临时 caffeinate 防止本次检查期间空闲睡眠并重跑。期间发现的旧渲染测试高并发超时通过限制 DOM 测试 worker 为2处理，未增加原60秒测试超时。登录页独立组件兼容、jsdom Request/AbortSignal 跨运行环境问题和选中对象可空类型已修复。
2. `node server/test/education.integration.cjs`：在容器临时目录使用本分支编译产物执行，连接实际 PostgreSQL/Redis；创建独立随机 schema，结束删除；Orthanc/渲染在这一层明确替换为合成边界。通过名册激活与实际密码登录、同IP多学生激活、本人权限、跨学生拒绝、并发保存409、几何范围拒绝、重复提交同结果、数据库提交后不可变、参考冻结、52条提交分页、教育帧票据与渲染中撤权、下线拒绝、改密旧会话失效、含教学数据拒绝回滚迁移。
3. 前端专项：`npm run test --workspace web-anno -- src/education/StudentWorkflow.test.tsx src/pages/AdminAccountsPanel.test.tsx`。11项通过，覆盖学生不能进入生产工作台、作答期无参考、立即离页保存、保存中继续编辑、退出失败保留答卷、已保存答卷离线退出、只读反馈及管理账号回归。
4. `node server/test/education.browser.cjs`：使用显式 `MIAP_EDUCATION_INSTANCE`、`MIAP_EDUCATION_CREDENTIALS` 及本机 Playwright/Chrome 运行。实际管理员登录并新建测试考核；实际学生登录，DX和CT逐题绘制、填写对象与报告、保存、离开重读、提交、查看冻结报告与金标准叠加；验证管理端能查到两份提交、页面无运行错误。未提交用户的 `student_demo` 答卷。
5. `node --check` 检查新增集成、浏览器、演示准备脚本；`git diff --check` 和文档相对链接检查。

## 审查与修复

按 HIGH 风险增加一名只读 reviewer，未安排多实现者。发现并修复 DELETE 触发器返回值、激活密码首尾空格、共享网络限流、提交分页、SPA离页保存和已保存答卷离线退出。修复后复用同一 reviewer 仅复核发现点，全部发现已关闭。真实PG测试另发现 TypeORM 的 UPDATE RETURNING 返回数组与影响行数元组，教育写接口改用 CTE SELECT，返回版本及提交结果已通过实际并发测试。

## 本地运行与回退边界

现有实例以 `deploy/compose.yml` 加忽略的 `reports/student-education/compose.local.json` 运行，将本分支 `server/dist`、`web-anno/dist` 只读挂载到原服务；镜像、持久卷及老师影像不复制或清空。当前入口 `https://localhost:18447/login`，管理员新增 `/education`，学生 `/student`。

增量迁移已应用并授予现有最小应用账号新表权限。已有学生与答卷时 down 明确拒绝，不能强制删表或将 student 降为 member；应用回退应先关闭教学入口并保留兼容 schema，优先向前修复。

本次仅本地分支开发与验证，不推送、不创建PR、不宣称云端或人工验收完成。教师身份、独立器官字典、计时与重复练习、忘记密码重置、自动报告分析和评分均属后续扩展。
