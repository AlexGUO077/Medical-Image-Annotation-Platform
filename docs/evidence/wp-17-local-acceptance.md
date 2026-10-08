# WP-17 本地合成验收准备

2026-10-08；基于 PR #57 merge `7e1b727`，本地分支 `feature/wp-17-synthetic-acceptance`。用户确认云端资源暂未准备，先完成本地验收。本记录只保存本轮事实；当前状态与阻塞见 [STATUS](../STATUS.md)。没有把自动检查或 PR 合并当成人工验收。

## 环境与实际检查

macOS arm64 / Docker Desktop，本地隔离七服务 `miap-synthetic-wp17`，入口仅 loopback HTTP 18082 / HTTPS 18445。使用 WP-16 已验证的部署方式、实际 Python OCR/NER 模型缓存和本地证书；没有安装 cron、签发公网证书或上传异地备份。私有配置、账号、TOTP、全新生成的合成 DICOM/报告均留在忽略目录 `.credentials/wp17-local`，没有进入 Git 或输出。

`server/test/generate-m3-synthetic.py` 生成一例 DX、一例 3 帧 CT，均 512×512；这些小样本只用于业务链路，不作为 300 帧性能证据。`server/test/m3-deployed.integration.cjs` 仅通过真实 HTTPS API，未直接写数据库、伪造登录 Token 或 mock 脱敏。

- 管理员真实登录、首次改密、TOTP 初始化及验证；成员通过管理员 API 开通并首次改密。
- DX/CT ZIP 导入、实际 OCR/NER、虚构姓名脱敏、PNG 水印预览及明确确认均通过。
- API 分派并保存矩形、点、多边形、画笔及报告关联；真实已构建前端通过 Chrome 登录、任务入口进入 DX/CT 工作台，显示四类对象和报告关联。此项验证 API 保存与 UI 呈现，不宣称本轮重新验证了每个工具的鼠标绘制操作。
- 帧票据无登录 401、另一成员 403、所属账号 200；帧 PNG 为 `no-store, private`。成员访问管理员账号/审计接口被拒绝；猜测的原图 API 返回 404。
- 浏览器工作台、成员任务列表和病例库没有下载/导出/打印按钮；没有触发下载或页面运行错误。Cache Storage 和 sessionStorage 为空，localStorage 只有按字段核对过的既有查看器能力/日志配置；IndexedDB 草稿记录为空。人工检查 CT 截图可见账号、姓名、时间的平铺水印。

浏览器使用实际 Google Chrome 和独立临时 profile，只信任该本地证书公钥，结束后删除 profile。截图 `reports/wp17-local/workbench-DX.png`、`workbench-CT.png` 仅含合成数据；不保存 HAR、Trace、响应正文或票据。测试完成或失败后回收本轮标注分派，保留合成病例供后续闭环使用。

## 本轮发现与修复

实际导入后的 512×512 预览返回 500：旧逻辑固定叠加 520×180 SVG，超过底图尺寸。修复 `06bd1ee` 复用现有按底图尺寸适配的水印函数，保留安全预览与水印要求。256×128、512×512、800×400 的真实像素回归、禁止 processing 阶段预览，以及真实 HTTPS 下 DX/CT 预览均通过。修复镜像为 `miap/server:wp17-preview`；部署验证针对这一修复镜像，不宣称后续测试工具/文档所在最终提交已重新构建和扫描。

完整链路随后因疾病标签缺失而停止。实际录入没有疾病标签维护入口，而审核发布要求有效标签；既有分段测试直接在夹具中填写该字段掩盖了此缺口。最小接口与权限方案见 [D-45](../decisions/D-45-case-disease-label.md)，待用户确认，未实施。当前集成脚本在该检查处退出 1，不能列作完整闭环通过，也没有加入 CI 成功门。

## 可复现命令与结果

以下从仓库根目录运行，私有实例须已由部署工具初始化；模型运行使用现有本地 Python 环境。

```sh
MIAP_M3_INSTANCE="$PWD/.credentials/wp17-local" MIAP_PYTHON="$PWD/../.runtime/deid-venv/bin/python" node server/test/m3-deployed.integration.cjs
MIAP_M3_INSTANCE="$PWD/.credentials/wp17-local" MIAP_CHROME_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' MIAP_PLAYWRIGHT_MODULE=/Users/guo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node server/test/m3-deployed.integration.cjs --reuse-imports
npm run test:coverage --workspace=server
npm run test:coverage --workspace=web-anno
npm run lint
npm run typecheck
npm run build
node --test scripts/*.test.mjs
python3 -m unittest discover -s deploy -p 'test_*.py'
node scripts/check-dependency-policy.mjs package-lock.json
npm run check:forbidden-files
```

两次部署脚本的前半链路通过，均在 D-45 必需标签检查处退出 1。`--reuse-imports` 用于验证前端时复用已经实际脱敏确认的病例，避免重复推理，不视为重做导入验证。

其余结果：后端 41 文件 / 302 测试、前端 37 文件 / 179 测试、仓库脚本 45 测试、部署备份 7 测试通过；lint、类型检查、构建及禁入文件检查通过。许可证策略检查通过；本轮没有执行最终镜像完整安全扫描，不以许可证检查替代安全门。

新增与 Vitest 同版本的 `@vitest/coverage-v8` 3.2.7，只用于测量，未调整 CI 阈值或排除低覆盖业务文件。

| 范围 | 行覆盖率 | 分支覆盖率 | 函数覆盖率 |
| --- | --- | --- | --- |
| server `src/**/*.ts` | 51.48%（3201/6217） | 81.51% | 57.03% |
| web `src/**/*.{ts,tsx}` | 77.18%（2625/3401） | 76.40% | 49.06% |

手册 §9.3 要求单元测试覆盖率 ≥70%；后端行覆盖率未达到要求。现有独立 HTTP/数据库集成未被本次 Vitest 单元覆盖率仪器计入，不用分段集成已通过来替代该结果。审核、质量审核、分派、帧业务服务仍需有针对性的测试补足。

本地原始输出保存在忽略目录 `reports/wp17-local/`；覆盖率 JSON/LCOV 保存在 `reports/wp17-coverage/{server,web}/`。本批未推送；后续完成 D-45、审核发布/检索/打回重交/抽检的实际闭环、覆盖率缺口和剩余安全/性能检查后，再集中验证、自审并推送。云端和人工放行仍按原手册条件处理。
