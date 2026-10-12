# D-44 部署容器的模型依赖兼容修复

状态：用户于 2026-10-08 在本会话明确“确认 继续推进”，已批准下述最小兼容修复范围；2026-10-08 的 WP-16 打包预检发现实际安全阻断。未更改已批准模型版本，未添加漏洞豁免或降低门槛。

## 实际缺口

以现有 Node 24.14.0、Python 3.11、worker requirements 构建的后端容器成功；按原 HIGH/CRITICAL 门槛扫描失败：Debian 12 系统包 101 条（97 HIGH、4 CRITICAL），Python 依赖 8 条 HIGH。原始结果仅在忽略目录 `reports/wp16-preflight-20261008/server-trivy.json`，不把构建成功当作可部署。

Python 阻断涉及 protobuf、onnx 及构建工具。现有 PaddleNLP 2.6.1 元数据严格要求 protobuf==3.20.2，而扫描要求修复版本；当前间接 Paddle2ONNX 2.1.0 又限制 onnx<=1.17.0，扫描要求至少 1.21.0。不能通过强制安装更高版本或删除依赖声明伪装兼容。

正常 OCR 导入还出现 pyclipper 的 zlib 解压错误；先导入 pyclipper 后曾成功，不能把这种测试顺序当作真实 worker 已通过。尚未运行真实模型推理，需与最终依赖组合一起复核。

独立核对 [PaddleNLP 2.8.1 官方元数据](https://pypi.org/pypi/paddlenlp/2.8.1/json)：Linux 基本依赖放宽为 protobuf>=3.20.2（未启用 autonlp/dev 等 extras）；这是可评估的兼容候选，不是已验证决定。ONNX 转换依赖仍需选择和验证与现有 Paddle 兼容的组合。

## 已批准最小范围

保留既定 Node 24、Python 3.11，以及已批准 UIE-mini、中文 PP-OCRv3、单个本地子进程和现有业务接口。允许仅为关闭已检出问题评估兼容库组合和较新系统底座；不换模型、不增加独立服务、不跳过审计/脱敏/人工确认，也不强制覆盖相互冲突的依赖。

先做真实 Linux 打包、依赖一致性、HIGH/CRITICAL 扫描和既有真实模型/HTTP 链路验证，再固定通过的版本。必要的库版本调整同步既有 D-18 和 requirements 记录；出现需要改变模型或业务结果的情况，另行讨论，不视为本决定授权。

按已批准范围实施并验证，未关闭的风险继续阻断 WP-16/SG-6/SG-7 部署验收。

## 兼容修复实现

保持 PaddlePaddle 2.6.2、PaddleOCR 2.10.0、UIE-mini/中文 PP-OCRv3；PaddleNLP 调为 2.8.1，配合 protobuf 5.29.6、ONNX 1.21.0、Paddle2ONNX 1.3.1、huggingface-hub 0.36.2、datasets 5.0.1 和 fsspec 2026.6.0。由官方元数据共同允许这些版本，执行 `pip check`；不使用 `--no-deps` 强装冲突组合。旧 datasets 3.6.0 的 fsspec 上限不满足扫描，未采用。

2026-10-10，PR #60 的真实推理 CI 在全新安装时解析到间接依赖 PyArrow 26.0.0，虽通过 `pip check`，导入仍报 `requires NumPy 2.0 or newer, found 1.26.4`。现有可运行镜像使用 PyArrow 25.0.1；将该版本显式固定，使宿主 CI 与镜像沿用同一兼容组合，不升级 Paddle 所需的 NumPy 1.x 或更换模型。全新安装的 amd64 镜像构建、`pip check`、按真实 worker 顺序的 Paddle OCR/NER 导入及 Trivy HIGH/CRITICAL=0 已本地验证；实际 OCR/NER 与 HTTP 链路继续由原有远端检查验证。证据位于忽略目录 `reports/security-20261010/`，远端结果见当前 PR checks。

系统候选 Debian 13 仍有阻断，改为固定摘要的 Ubuntu 26.04 底座，并保留官方 Python 3.11 文件。Paddle 2.6 导出的 zlib 符号与后来加载的 Cython 扩展冲突；固定 worker 启动器预先加载系统 `libz.so.1`，不依赖测试中的特殊模块导入顺序，也不传入额外业务秘密。

PyPI pip 的内置旧依赖仍被扫描阻断，不能把顶层 urllib3/setuptools 升级当作内置副本已修复。PaddleNLP 2.8.1 未声明 pip 为正式推理依赖，但 `utils/import_utils.py` 提前导入它。打包层仅把此导入移入可选 `install_package` 函数、置于任何安装/卸载动作之前；固定原文件 SHA256，不匹配立即停止构建。已安装模型依赖不需要调用该函数，运行镜像完整移除 pip/ensurepip。这个补丁不改模型、推理结果、依赖约束或业务控制；真实 OCR/NER 合成检查负责验证。Ubuntu 系统 pip 候选也未采用，不以发行版归类差异绕过内置库风险。

上述改动均用于已批准的打包兼容与已检出漏洞修复；最终证据及尚未通过项统一记录在 WP-16 证据和 STATUS，不以候选构建或局部扫描宣称放行。
