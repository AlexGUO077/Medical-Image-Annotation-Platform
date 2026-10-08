# WP-16 打包预检

日期：2026-10-08。源 Word §8.1～§8.3、WP-16/SG-6；当前仅打包预检，未实施公网部署、备份停写、异地传输或阶段放行。待确认 [D-43](../decisions/D-43-synthetic-deployment-backup.md) 与 [D-44](../decisions/D-44-worker-container-security-compatibility.md)。

## 环境与实际验证

macOS arm64 Docker Desktop 29.8.0，构建目标 linux/amd64（对应既有真实推理 CI）。现有五个中间件容器/数据卷保持原状；临时离线检查容器自动删除，无端口发布。

- Docker 官方 Node 24.14.0、Python 3.11 slim Bookworm、nginx Alpine 的实际 manifest 摘要已核验并固定在 Dockerfile。运行时源码仅显式复制；构建上下文排除环境文件、秘密、影像、备份和报告目录，前端测试 TypeScript mock 只进入构建阶段。
- `docker build --platform linux/amd64 -f deploy/nginx/Dockerfile -t miap/nginx:wp16-preflight .`：最终通过（初次类型检查缺少仓库既有合成 mock，已补构建阶段复制并重建）；静态运行镜像 UID 101，nginx 1.31.6，静态首页存在；无前端源码/测试夹具/node_modules/环境文件/秘密或 DICOM。未安装 nginx 部署配置，未运行 HTTPS 接口验收。
- `docker build --platform linux/amd64 -f deploy/server/Dockerfile -t miap/server:wp16-preflight .`：构建通过；运行 UID 10001，Node v24.14.0、Python 3.11.17；soffice/pdftoppm 存在，真实 sharp 生成 8×8 PNG。Python 模型正常导入失败，未据构建成功宣称模型推理可用；问题见 D-44。
- `aquasec/trivy:0.70.0 image --input ... --scanners vuln --severity HIGH,CRITICAL --exit-code 1 --format json`：镜像通过离线 tar 输入扫描，漏洞数据库更新；nginx 返回 0、HIGH/CRITICAL=0。server 返回 1，实际阻断与依赖约束见 D-44。没有 ignore-unfixed 或任何豁免。

## 上游合并检查

PR #55 合并提交 `923ca70e1aa8cd261ca347942241ec5a55c53829` 的 Security 已通过；第一次 CI 在 Maven JAR 下载校验处失败，多个不同 JAR 收到同一异常散列。独立 HTTPS 读取 jsoup 1.23.2（537806 bytes）同时匹配仓库固定 SHA256 与 Maven SHA512；未修改固定值或依赖版本，仅重跑失败 CI 作业。实际最终结果仅在 [STATUS](../STATUS.md) 更新。

原始构建、导入与扫描输出保存在忽略目录 `reports/wp16-preflight-20261008/`，包含两个 image tar、两个 Trivy JSON、运行/导入日志、包元数据和上游失败日志。没有私有环境文件、JWT、密码、患者或老师样例数据。当前本地预检记录不替代非作者评审、组长复核、SG-6 或云端/3 例恢复验收。
