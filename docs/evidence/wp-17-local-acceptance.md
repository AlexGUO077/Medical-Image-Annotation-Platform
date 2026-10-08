# WP-17 本地合成闭环与验收证据

2026-10-08；基于 PR #57 merge `7e1b727`，分支 `feature/wp-17-synthetic-acceptance`。用户确认云端资源暂未准备，先完成本地验收；D-45 本轮明确批准。当前状态与阻塞以 [STATUS](../STATUS.md) 为准。自动检查、代码合并不代替非作者评审、组长权限复核和 M3 人工验收。

## 实施与环境

- D-45：管理员通过既有病例详情 / 临床保存接口维护所属系统三级疾病或四级分型；仅“已录入/待分配”可改。省略保留原值，显式空值拒绝；开始标注后沿用回收再修正。复用审核标签校验，标签与临床字段、标识级审计同事务，不新增表、服务或角色。契约见 [D-45](../decisions/D-45-case-disease-label.md) 与 [病例录入接口](../contracts/case-entry-api.md)。
- 实际导入小图预览 500 修复 `06bd1ee`：520×180 固定水印超出底图，改为既有尺寸自适应水印；256×128、512×512、800×400 实际像素回归通过。
- macOS arm64 / Docker Desktop；隔离七服务项目 `miap-synthetic-wp17`，仅 loopback HTTP 18082 / HTTPS 18445。复用 WP-16 部署方式与真实 Python OCR/NER 模型缓存，使用本地证书。私有配置、账号/TOTP、合成 DICOM/报告留在忽略目录 `.credentials/wp17-local`。
- 本轮部署 `miap/server:wp17-d45`（linux/amd64，manifest `sha256:ce28b62d5aeed959690600ca48a51d4e21fa0c29424ff274514612187872aae7`）和 `miap/nginx:wp17-d45`（linux/arm64，manifest `sha256:ba4c88d859a98209dbe69bd721bd06ce4e92cf4fb8d4e1980dc68251b3f08a85`）。此后仅修改测试及文档，生产代码未变；不把本机 arm64 前端镜像结果替代远端 amd64 构建检查。

## 真实 HTTPS 闭环

`server/test/m3-deployed.integration.cjs` 使用实际登录、HTTPS、队列与运行服务；没有直接写库补业务数据、伪造登录令牌或 mock 脱敏。生成一例 DX 与一例 300 帧 CT（512×512），以下完整链路退出 0：

1. 管理员密码 / 2FA 登录，成员由管理员 API 开通并首次改密；DX/CT ZIP 经真实 OCR/NER、虚构姓名遮蔽、水印预览、显式脱敏确认入库。
2. 管理员通过 D-45 接口补疾病标签、详情回显；成员同接口 403。建任务并分派，四工具对象、部位/征象及报告关联通过 API 保存。
3. 真实已构建前端 Chrome 登录、从任务页进入 DX/CT 工作台，画布呈现保存对象和报告关联。此项验证 API 保存与 UI 呈现，不宣称本轮重新执行了全部工具鼠标绘制。
4. CT 提交 → 他审打回并返回可定位意见 → 修改生成新版本 → 重提 → 他审通过；DX 审核通过。已发布金标准不可修改；PostgreSQL 组合检索和 Elasticsearch 全文检索可见正确版本。
5. DX 下线 → 病例库/检索不可见且旧帧票据拒绝 → 原任务重启 version+1、非金标准副本 → 重分派/审核/再次发布；旧版本票据仍拒绝。
6. 两个候选抽 1 个，同版本再次抽样为 0；抽检须显式开始，失败立即下线，仅本轮同标注人另一例进入全面复核，期间保持发布，复核通过。失败例管理员重启并再次发布，新版本能进入新轮抽检并通过。

质量夹具只临时调整前轮同脚本创建、精确匹配名称的合成审核成员资格，`finally` 恢复；发现其他有资格人员则停止，避免影响无关账号。测试保留合成已发布病例供人工复验；正常结束没有残留标注分派。

浏览器使用独立临时 profile，仅信任本地证书公钥，退出后删除。没有下载事件或页面运行错误；Cache Storage/sessionStorage 为空，localStorage 只包含核对过字段的查看器能力/日志设置，IndexedDB 草稿为空。成员工作台、任务列表、病例库无下载/导出/打印按钮。帧票据无登录 401、跨成员 403、所属账号 200，PNG 为 `no-store, private`；猜测原图 API 为 404。截图已目视核对合成水印包含账号、姓名和时间；临床诊断可读性仍需人工复验。

## 性能与单元覆盖率

在以上同一轮真实 CT 300 帧序列中，逐帧等待相邻 PNG 预加载完成，再从“下一帧”点击计时至 `data-frame-ready`；299 次连续切换全部 ≤200ms，P95 **45.8ms**、最大 **64.0ms**。该口径是手册规定的预加载后响应，未计入首次下载与预加载等待，不代表公网性能。逐样本 JSON 与第 300 帧截图位于 `reports/wp17-local/`。

新增服务测试覆盖标注版本、任务容量/派单、普通/质量审核、下线重启、帧渲染后失权、库检索、附件水印、受控导出、口令/2FA 和映射认证加密。依赖可模拟，但返回值、输出阻断与外部调用效果有断言；事务回滚由下述真实数据库集成另证，不将 mock 当成数据库证明。

| 范围 | 行覆盖率 | 分支覆盖率 | 函数覆盖率 |
| --- | --- | --- | --- |
| server `src/**/*.ts` | 70.91%（4423/6237） | 87.06% | 73.80% |
| web `src/**/*.{ts,tsx}` | 76.94%（2637/3427） | 76.75% | 48.98% |

保留全源码测量口径（含既有启动、数据库脚本等），未删除低覆盖业务文件或用独立集成测试替代单元统计。覆盖率插件为 Vitest 同版本 3.2.7；未修改远端安全阈值。

## D-45 数据库集成与必要检查

D-45 接入已有 `case-entry.integration.cjs`：同系统三级/四级接受，跨系统/部位/删除祖先拒绝；成员 403、不可编辑状态 409、省略保留；注入仅针对本轮夹具病例的审计失败后，标签与临床信息实际回滚。入口与附件原有回归同时通过。该分段集成仅 OCR/NER 使用已有 mock，真实推理由上述部署闭环覆盖。

原默认开发环境鉴权失败后，切换旧共享环境的测试被自动审批拒绝，未执行。随后在 **WP-17 自有 PostgreSQL** 创建专用 `miap_synthetic_wp17_checks`，使用私有 `checks.env`，完成迁移/种子和测试；没有操作旧共享数据库。测试容器 `miap/wp17-tests:local` 不发布端口。

本轮必要检查命令如下（从仓库根目录执行）：

```sh
# 已初始化的本地 WP-17 私有实例；重新运行会新增合成病例和任务
MIAP_M3_INSTANCE="$PWD/.credentials/wp17-local" \
MIAP_PYTHON="$PWD/../.runtime/deid-venv/bin/python" MIAP_M3_CT_FRAMES=300 \
MIAP_CHROME_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
MIAP_PLAYWRIGHT_MODULE=/Users/guo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright \
node server/test/m3-deployed.integration.cjs
# 独立已迁移/播种的 WP-17 检查库，不得替换成共享开发环境
docker run --rm --network miap-synthetic-wp17_data --env-file .credentials/wp17-local/checks.env \
  -v "$PWD/server/test:/app/server/test:ro" miap/wp17-tests:local node server/test/case-entry.integration.cjs
npm run test:coverage --workspace server
npm run test:coverage --workspace web-anno -- --maxWorkers=2
npm run lint
npm run typecheck
npm run build
node --test scripts/*.test.mjs
(cd server && python3 -m unittest workers/test_deid_worker.py)
python3 -m unittest discover -s deploy -p 'test_*.py'
node scripts/check-dependency-policy.mjs package-lock.json
npm run check:forbidden-files
```

已通过后端 52 文件 / 498 测试、前端 37 文件 / 180 测试、worker 13 测试、仓库脚本 45 测试、部署备份 7 测试；lint、类型检查和构建通过。第一次前端全量检查发现 App 页测试未模拟新增标签读取，修复夹具并隔离模拟恢复；未改业务行为。资源竞争的一次并行前端测量中止，改为两 worker 顺序测量，不放宽断言或超时。

## 安全扫描与留存

- Trivy 0.70.0 更新漏洞数据库后扫描上述两个实际镜像，均退出 0，HIGH/CRITICAL=0；没有 ignore-unfixed 或漏洞豁免。镜像 tar 与 JSON 位于 `reports/wp17-local/security/`。
- `npm audit --audit-level=high` 通过：HIGH/CRITICAL=0，保留 6 moderate、1 low 的原始报告，不声明全级别零漏洞。全锁文件许可证策略通过。
- 官方校验过的 Gitleaks 8.24.3 扫描 server/src、server/test、web-anno/src，未发现秘密；测试新增固定合成口令首次触发通用规则，改为运行时随机生成后通过，无白名单。
- 官方 ZAP 2.17.0（镜像 digest `sha256:781a2bdaea47324e7bab583e2263f21d257b0aee61ed51521a5be45f5f5081ef`）在 WP-17 edge 网络对 `https://nginx:8443/login` 按[官方被动扫描方式](https://www.zaproxy.org/docs/docker/baseline-scan/)运行，`-m 1 -T 5 -s -J zap-baseline.json -r zap-baseline.html`。退出 **2（有警告）**，59 规则通过、8 规则警告，报告分为 1 medium / 6 low / 3 informational，HIGH=0；未忽略规则或把退出 2 写成通过。中危为入口无 CSP，低危含 HSTS/跨源/Permissions-Policy 响应头和静态 JS 时间戳，信息项为静态页缓存及 SPA 识别；均保留在本地报告待后续安全复核。此轮没有登录，未覆盖认证后 API，不能替代独立渗透或人工安全门。
- 最终提交的 CodeQL、全仓秘密/IaC 及七镜像远端扫描由本批 PR 运行，不能引用旧 head 的成功作为本批放行。

本地原始输出、PNG、性能 JSON 保存在忽略目录 `reports/wp17-local/`；覆盖率 JSON/LCOV 为 `reports/wp17-coverage/{server,web}/`。不保留 HAR/Trace/原始响应/帧令牌。私有账号、环境、原始合成输入和映射不进入 Git/PR。

## 剩余放行事项

本批关闭 D-45 导致的真实发布阻断、后端行覆盖率和本机 300 帧性能缺口。后续按用户安排开展全流程人工复验及 UI 交互调整：四工具操作/报告定位、自审与他审、抽检/复核、管理员受控导出与审计、水印可读性和各角色导航。已有分段权限/导出测试证据继续保留，不当作本次全量人审。

本地被动扫描不代表独立认证/访问控制/上传/注入/XSS/SSRF/跨域/并发滥用专项测试已完成；独立安全复核、事件演练、负责人签字及 SG-5～SG-7 均待记录。云端服务器/域名/邮箱、异地备份目标与定时窗口未提供，未执行公网证书签发、异地传输、cron 或公网端口测试，云端验收仍待资源。M3 未放行。
