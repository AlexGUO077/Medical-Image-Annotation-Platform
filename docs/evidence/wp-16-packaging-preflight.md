# WP-16 打包预检

日期：2026-10-08。源 Word §8.1～§8.3、WP-16/SG-6；前两节记录最初打包预检，后续本地实施见下节。D-43/D-44 已获用户确认；当前 WP/SG 状态仅以 STATUS 为准，未执行公网部署或异地传输。

## 环境与实际验证

macOS arm64 Docker Desktop 29.8.0，构建目标 linux/amd64（对应既有真实推理 CI）。现有五个中间件容器/数据卷保持原状；临时离线检查容器自动删除，无端口发布。

- Docker 官方 Node 24.14.0、Python 3.11 slim Bookworm、nginx Alpine 的实际 manifest 摘要已核验并固定在 Dockerfile。运行时源码仅显式复制；构建上下文排除环境文件、秘密、影像、备份和报告目录，前端测试 TypeScript mock 只进入构建阶段。
- `docker build --platform linux/amd64 -f deploy/nginx/Dockerfile -t miap/nginx:wp16-preflight .`：最终通过（初次类型检查缺少仓库既有合成 mock，已补构建阶段复制并重建）；静态运行镜像 UID 101，nginx 1.31.6，静态首页存在；无前端源码/测试夹具/node_modules/环境文件/秘密或 DICOM。未安装 nginx 部署配置，未运行 HTTPS 接口验收。
- `docker build --platform linux/amd64 -f deploy/server/Dockerfile -t miap/server:wp16-preflight .`：构建通过；运行 UID 10001，Node v24.14.0、Python 3.11.17；soffice/pdftoppm 存在，真实 sharp 生成 8×8 PNG。Python 模型正常导入失败，未据构建成功宣称模型推理可用；问题见 D-44。
- `aquasec/trivy:0.70.0 image --input ... --scanners vuln --severity HIGH,CRITICAL --exit-code 1 --format json`：镜像通过离线 tar 输入扫描，漏洞数据库更新；nginx 返回 0、HIGH/CRITICAL=0。server 返回 1，实际阻断与依赖约束见 D-44。没有 ignore-unfixed 或任何豁免。

## 上游合并检查

PR #55 合并提交 `923ca70e1aa8cd261ca347942241ec5a55c53829` 的 Security 已通过；第一次 CI 在 Maven JAR 下载校验处失败，多个不同 JAR 收到同一异常散列。独立 HTTPS 读取 jsoup 1.23.2（537806 bytes）同时匹配仓库固定 SHA256 与 Maven SHA512；未修改固定值或依赖版本，仅重跑失败 CI 作业。实际最终结果仅在 [STATUS](../STATUS.md) 更新。

原始构建、导入与扫描输出保存在忽略目录 `reports/wp16-preflight-20261008/`，包含两个 image tar、两个 Trivy JSON、运行/导入日志、包元数据和上游失败日志。没有私有环境文件、JWT、密码、患者或老师样例数据。当前本地预检记录不替代非作者评审、组长复核、SG-6 或云端/3 例恢复验收。


## 已批准方案的本地实施验证

在独立 `miap-synthetic-wp16` 与 `miap-synthetic-wp16-restored` 项目验证；原开发项目五个容器/卷未重建。测试只用生成的 synthetic，所有 `.env`、测试会话、备份和密钥在忽略的私有目录中。

- `python3 -m unittest discover -s deploy -p 'test_*.py' -v`：7 项通过，覆盖停止失败不 dump 且恢复原运行服务、坏 dump、未公布批次、危险 tar 路径/链接、已有目标、错误密钥和最近 30 份 PG 保留；旧影像/对象不自动删除。
- `npm run check` 的文件检查、lint、typecheck 通过；新增两种运行镜像后，既有安全矩阵覆盖测试发现其契约未扩展，已同步契约和测试。随后 `npm test && npm run build` 通过：脚本安全门测试通过、server 41 文件/299 项、worker 13 项、web 37 文件/179 项；构建只有既有前端 chunk 大小提示。
- 通过实际 `manage.py init/up` 启动：迁移/seed 和 owner 账号仅在一次性初始化容器使用，应用使用 `miap_runtime`。修复保密 umask 下非 root MinIO 无法读取无秘密策略文件的问题；公开测试 CA 可读，私钥和环境文件仍为 0600。
- 生产依赖安装后，Nest 默认 ESM 适配器加载无法定位 workspace 中的 platform-express。后端显式传入已使用的 ExpressAdapter，并同时复制根/workspace 两处运行依赖；不改变路由或鉴权。
- 宿主 `curl --cacert <测试 CA>`：HTTP 301 至对应 HTTPS、源/恢复实例 `/api/health` 都返回 200；未用跳过证书检查替代客户端 TLS 验证。
- `deploy/test-restore.cjs`：原实例三例经实际 HTTPS 鉴权分别返回 256×256 PNG 影像及附件，共六次预览，并解密三份合成映射；无认证访问/单有帧票据访问均拒绝。运行账号不能删除审计、读迁移表、建非项目桶或调用 ES 管理接口。MinIO 桶列表会返回有权限的项目桶，断言据此验证只出现两个项目桶并拒绝创建其他桶。
- `manage.py backup`：成功批次 `20261008T085744Z-0c2e4001` 同含 PG/Orthanc/MinIO；另一次在服务恢复失败时保留 `.partial-*`，未公布/同步为完整备份，随后修复镜像启动再成功执行。
- `manage.py restore`：新空实例恢复同批数据、验证仅 synthetic、重建搜索；再次运行三例 HTTPS/映射/权限检查全部通过，并实际拒绝原实例 JWT。核对 JWT、帧密钥和服务密码变化，MFA/映射/UID 密钥保留；无秘密值输出。
- 两实例均实际核对七服务 healthy，只有 nginx 绑定回环 HTTP/HTTPS；server 不含 PG owner、MinIO root、ES elastic 或 seed 管理秘密，保留 cap_drop=ALL。

上述部署/恢复功能验证使用已有依赖候选加最终 Express 入口的临时功能镜像。它仍含未采用的系统 pip，不视为最终安全镜像或部署放行；最终无 pip 镜像与远端原生 Linux 核验尚需单独完成。修复候选中的真实模型测试已验证固定 PaddleNLP 惰性 pip 导入补丁 + datasets 5.0.1/fsspec 2026.6.0：手工 NER/OCR、ZIP DICOM/报告及附件清洁接受/标识拒绝全部通过。

最终干净镜像构建期间官方 PyPI 下载显著变慢：126 MB Paddle wheel 实际耗时 9 分 12 秒；主机和容器的 1 MB 分段探测均正常但只有低速，不把停滞误记为成功。未降低 HIGH/CRITICAL 阈值或添加豁免。原始输出继续放 `reports/wp16-preflight-20261008/`，最终证据补齐前不标记 WP-16/SG-6 完成。
