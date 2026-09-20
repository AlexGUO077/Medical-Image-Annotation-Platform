# 工作包与安全门状态

核验日期：2026-09-20。此表是当前状态入口；状态发生变化或核验纠正时更新。范围、依赖和放行标准仍见需求基线 §9/§10，本表不新增或替代验收条件。

本次已读取 PR #2 的远端状态和检查结果，并核对主线文件及既有验证记录。PR 合并、检查通过、WP 完成和 SG 放行分别记录，不相互推定；“未记录”表示未取得相应证据，不等同于失败或已批准。

| WP / SG | 当前状态 | 关联提交 / 证据 | 阻塞或下一步 |
| --- | --- | --- | --- |
| WP-00 / PR #2 | PR 已合并；项目 CI 和安全扫描通过；工作包完整放行仍待相关 SG 证据核对 | [PR #2](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/pull/2)；head `a43592ef52741f41620fea3aff25a92ca62d8fe5`；merge `3cf94f7cfbab7f430d4033015f1aea018848ee09`；[CI](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/actions/runs/35442391874)、[Security](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/actions/runs/35442391920)；[本地验收历史](evidence/wp-00-verification.md) | 不重做 PR2；不得把合并或扫描通过推定为 SG-0/SG-1 已批准 |
| WP-S0 | 已形成数据/授权、鉴权、威胁模型、DICOM、密钥/审计/事件及测试基线草案；尚未放行 | [门禁记录](security/wp-s0-gate-evidence.md)；[D-38](decisions/D-38-node20-runtime.md)；[需求基线 §9](医学影像标注平台-需求拆解与实施基线.md#9-可独立交付的工作包) | D-30～D-37 均须取得对应人工批准/实证；在此之前不启动依赖 WP-S0 的 WP-01～WP-17 |
| SG-0 | 未放行；学生阶段临时责任角色已指定，工程处理清单、影响评估及来源台账草案已形成 | [数据处理、来源授权与生命周期契约](contracts/source-authorization-and-data-lifecycle.md)；[门禁记录](security/wp-s0-gate-evidence.md) | 当前仅用合成数据；未来接入真实数据前，责任单位须确认合法基础、授权、影响评估、正式分类分级及等保适用性 |
| SG-1 | 未放行；学生阶段临时责任角色已指定，数据流、权限、秘密/日志/事件及威胁缓解草案已形成 | [架构与威胁模型](security/wp-s0-architecture-threat-model.md)；[鉴权与会话](contracts/authorization-and-session-policy.md)；[密钥、审计与事件响应](security/secrets-audit-and-incident-response.md) | 临时角色完成 D-30～D-37 工程草案确认后，仍须保留正式责任单位和实现实证门；不创建真实数据连接或生产秘密 |
| WP-01～WP-17 | 本次核对范围内未记录启动或完成 | 主线 `3cf94f7`；需求基线 §9/§10 | 本次仅更新工作流；后续按各 WP 实际依赖推进，启动时拆分相应状态行 |
| SG-2～SG-7 | 未记录放行 | 需求基线 §10.4 | 在各门原定时点核验，不提前宣称通过；发生变化时拆分相应状态行 |

历史日志、旧计划和 PR2 验证材料保留当时状态，不再作为当前状态维护表。新增证据只在本表链接，不复制全文输出。
