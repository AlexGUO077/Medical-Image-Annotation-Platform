# M1 合成数据阶段验收核验

核验日期：2026-09-28。依据源开发手册及需求基线 §10.3/§10.4；本记录保存核验事实，当前 WP/SG 状态以 [STATUS](../STATUS.md) 为准。所有执行数据均为即时生成的合成数据，不代表真实数据准入、生产部署或指导教师最终验收。

| 核验点 | 证据与结果 | 边界 |
| --- | --- | --- |
| 合规/来源与架构基线（WP-S0、SG-0、SG-1） | 合成数据阶段最小方案、来源限制、架构及安全红线见[既有门禁决定](../security/wp-s0-gate-evidence.md)和[来源契约](../contracts/source-authorization-and-data-lifecycle.md)；STATUS 已记录郝鹏翼老师对合成阶段方案的终审 | `synthetic` 与受限 `teacher_provided_teaching` 以外来源仍不授权 |
| 主线版本与自动检查 | PR [#32](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/pull/32) 于 2026-09-28 合并，main `427290ba0faa3624ce951b7c19a92be8fd50e580`；[CI](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/actions/runs/36384057368)、[安全扫描](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/actions/runs/36384057339)、[真实 worker 合成验证](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/actions/runs/36384792531) 均对该提交成功 | GitHub PR #32 的 `reviews` 为空，不伪造平台人工 Review |
| 本地回归与手工 HTTP 闭环 | macOS 开发机 Node 24.14.0 / npm 11.9.0，`npm run check` 成功：仓库脚本 45、服务端 121、Python worker 13、前端 57；以当前 main 构建产物和既有合成服务执行 `MIAP_ENV_FILE=<本地合成环境文件> node server/test/case-entry.integration.cjs` 成功 | HTTP、PostgreSQL、Redis、MinIO、权限拒绝及水印预览为真实服务；该脚本显式 mock OCR/NER |
| 真实模型单层 | 上述 main worker run 在 Linux/Python 3.11 对即时生成的合成手工报告、影像、ZIP/DICOM、附件使用真实 UIE-mini 与 PP-OCRv3，验证人名/烧录标识遮蔽及带标识附件拒绝 | 单层 worker 通过不自动推出完整 HTTP/存储通过 |
| WP-05 完整合成病例链路 | PR #33 的 [Linux 验收运行](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/actions/runs/36388170055) 对提交 `f8aa1090d8d8a06641f0f0bf1927548e43adf780` 成功：真实 OCR/NER 下，一例手工病例与一例 ZIP/DICOM 病例经 HTTP 预览、显式确认，核对遮蔽数量、数据库病例/Study/Series/报告、MinIO 映射/手工影像和 Orthanc DICOM 写入；运行后清理合成病例、对象及临时服务卷 | PR #33 已待人工评审，尚未合并 main；只证明合成单例闭环，未测试 100 页/高负载路径 |
| Orthanc Linux 存储与认证边界 | 同一运行验证新数据卷可由非 root Orthanc 写入；宿主机回环绑定保持，未认证 `/system` 返回 401，认证后返回 200；[项目 CI](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/actions/runs/36388170059)和[安全扫描](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/actions/runs/36388170065) 对同一提交成功 | 为使容器网络中的服务可访问 Orthanc，将本地 Compose 的 `RemoteAccessAllowed` 设为 true，仍强制认证且只绑定宿主机 `127.0.0.1`；不代表公网部署配置已验收 |
| SG-2 身份与权限技术证据 | 本次 `npm run check` 包含管理员 2FA、会话撤销、资格/分派/资源校验单测；上述真实 HTTP 集成包含未登录、非管理员、跨账号、停用后立即拒绝 | 安全门负责人的独立放行决定仍需单独记录 |
| SG-3 导入与脱敏 | 已批准的合成阶段 DICOM profile/Clean Pixel Data、隔离、OCR、报告遮蔽与人工确认边界见[导入契约](../contracts/import-deidentification-api.md)；main 真实 worker 和 PR #33 完整合成闭环均通过 | 不扩展到真实数据来源 |

用户于 2026-09-28 转达组长已复核并批准放行；此为线下复核陈述，实际复核日期、复核人身份和平台 Review 记录未提供。M1 阶段签收与 SG-2 独立放行不从这句话自动推定。

PR [#33](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/pull/33) 的首轮真实链路运行揭示 Linux 新 Orthanc 卷无法由非 root 用户写入，修复为镜像预建属主目录；随后揭示容器的 localhost-only 设置拒绝宿主机转发访问，修复为保持回环绑定和认证的受控网络访问。上述成功运行验证两项修复。附件转换的 PDF 页数上限为 100；50 MB PDF 转页可能在 MinIO 放大为数百 MB，WP-16 容量与备份规划需据实计入。该性能/容量风险不改变当前脱敏失败闭锁边界。
