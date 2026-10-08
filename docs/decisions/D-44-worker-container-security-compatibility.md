# D-44 部署容器的模型依赖兼容修复

状态：待确认；2026-10-08 的 WP-16 打包预检发现实际安全阻断。未更改已批准模型版本，未添加漏洞豁免或降低门槛。

## 实际缺口

以现有 Node 24.14.0、Python 3.11、worker requirements 构建的后端容器成功；按原 HIGH/CRITICAL 门槛扫描失败：Debian 12 系统包 101 条（97 HIGH、4 CRITICAL），Python 依赖 8 条 HIGH。原始结果仅在忽略目录 `reports/wp16-preflight-20261008/server-trivy.json`，不把构建成功当作可部署。

Python 阻断涉及 protobuf、onnx 及构建工具。现有 PaddleNLP 2.6.1 元数据严格要求 protobuf==3.20.2，而扫描要求修复版本；当前间接 Paddle2ONNX 2.1.0 又限制 onnx<=1.17.0，扫描要求至少 1.21.0。不能通过强制安装更高版本或删除依赖声明伪装兼容。

正常 OCR 导入还出现 pyclipper 的 zlib 解压错误；先导入 pyclipper 后曾成功，不能把这种测试顺序当作真实 worker 已通过。尚未运行真实模型推理，需与最终依赖组合一起复核。

独立核对 [PaddleNLP 2.8.1 官方元数据](https://pypi.org/pypi/paddlenlp/2.8.1/json)：Linux 基本依赖放宽为 protobuf>=3.20.2（未启用 autonlp/dev 等 extras）；这是可评估的兼容候选，不是已验证决定。ONNX 转换依赖仍需选择和验证与现有 Paddle 兼容的组合。

## 建议最小范围

保留既定 Node 24、Python 3.11，以及已批准 UIE-mini、中文 PP-OCRv3、单个本地子进程和现有业务接口。允许仅为关闭已检出问题评估兼容库组合和较新系统底座；不换模型、不增加独立服务、不跳过审计/脱敏/人工确认，也不强制覆盖相互冲突的依赖。

先做真实 Linux 打包、依赖一致性、HIGH/CRITICAL 扫描和既有真实模型/HTTP 链路验证，再固定通过的版本。必要的库版本调整同步既有 D-18 和 requirements 记录；出现需要改变模型或业务结果的情况，另行讨论，不视为本决定授权。

确认前，仅保留失败证据、核对上游元数据，不实施上述模型库版本调整；未关闭的风险继续阻断 WP-16/SG-6/SG-7 部署验收。
