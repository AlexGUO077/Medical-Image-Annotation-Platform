# 工作包与安全门状态

核验日期：2026-09-21。此表是当前状态入口；状态发生变化或核验纠正时更新。范围、依赖和放行标准仍见需求基线 §9/§10，本表不新增或替代验收条件。

本次已读取 PR #2 的远端状态和检查结果，并核对主线文件及既有验证记录。PR 合并、检查通过、WP 完成和 SG 放行分别记录，不相互推定；“未记录”表示未取得相应证据，不等同于失败或已批准。

| WP / SG | 当前状态 | 关联提交 / 证据 | 阻塞或下一步 |
| --- | --- | --- | --- |
| WP-00 / PR #2 | PR 已合并；项目 CI 和安全扫描通过；工作包完整放行仍待相关 SG 证据核对 | [PR #2](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/pull/2)；head `a43592ef52741f41620fea3aff25a92ca62d8fe5`；merge `3cf94f7cfbab7f430d4033015f1aea018848ee09`；[CI](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/actions/runs/35442391874)、[Security](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/actions/runs/35442391920)；[本地验收历史](evidence/wp-00-verification.md) | 不重做 PR2；不得把合并或扫描通过推定为 SG-0/SG-1 已批准 |
| WP-S0 | 合成数据阶段最小方案已由郝鹏翼老师终审通过；PR 已合并 | [门禁决定](security/wp-s0-gate-evidence.md)；[D-39](decisions/D-39-node24-runtime.md)；[PR #13](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/pull/13)；merge `18362b1cb9a1a8db604334512b9de010d1f8ff64` | 当前仅限合成数据；未来接入真实医学数据前重新核验授权、伦理/合规及安全条件 |
| SG-0 | 当前不触发真实数据放行；仅允许合成数据 | [数据来源与保留最小契约](contracts/source-authorization-and-data-lifecycle.md)；[门禁决定](security/wp-s0-gate-evidence.md) | 真实数据入口保持关闭；未来接入前重新核验正式责任与授权 |
| SG-1 | 合成数据阶段的源手册架构与安全红线已确认；实现证据随对应 WP 验收 | [最小安全边界](security/wp-s0-architecture-threat-model.md)；[鉴权与会话](contracts/authorization-and-session-policy.md)；[秘密、审计与事件](security/secrets-audit-and-incident-response.md)；[PR #13](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/pull/13) | 当前仅限合成数据；不创建真实数据连接、生产秘密或额外安全平台 |
| WP-01 | 人工评审与 CI 完成；PR 已合并 | [PR #14](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/pull/14)；head `002be928fa8718f3e66f8ee4e83ddcfdf9630323`；merge `1b4561f27eca5d57e56ed00b3d5bfb039438900a`；[CI](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/actions/runs/35516827814)、[Security](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/actions/runs/35516827810)；[数据库契约与数据字典](contracts/database-schema.md) | WP-02 可在 D-03 管理员 2FA 契约确认后实施 |
| WP-02 | D-03 已批准；人工评审、CI 和安全检查完成；PR 已合并 | [PR #15](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/pull/15)；head `c9e7288c94e26a66ce1bcfba141a423bcd31ae90`；merge `29cda813f64efea485205106683f3cabc7267c8e`；[CI](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/actions/runs/35556444857)、[Security](https://github.com/AlexGUO077/Medical-Image-Annotation-Platform/actions/runs/35556444729)；[D-03](decisions/D-03-admin-2fa.md)；[认证接口契约](contracts/auth-api.md) | 资格挂起后的在途任务释放须在 D-09 明确并由 WP-06 状态机接入后再核验；D-22 当前仅采用创建响应一次性交接，正式发送渠道启用前另行确认 |
| WP-03 | 已启动；读取契约、四级合成 seed、标签树/征象读取接口及管理员只读子模块实现中 | 源手册 §4.2、§5.2、§6.3；需求基线 WP-03；[读取接口契约](contracts/taxonomy-api.md) | D-28 未确认，不开放标签与征象写接口；完成全量检查和评审后提交 PR |
| WP-04～WP-17 | 本次核对范围内未记录启动或完成 | 需求基线 §9/§10 | 后续按源手册和实际依赖推进，启动时拆分相应状态行 |
| SG-2～SG-7 | 未记录放行 | 需求基线 §10.4 | 在各门原定时点核验，不提前宣称通过；发生变化时拆分相应状态行 |

历史日志、旧计划和 PR2 验证材料保留当时状态，不再作为当前状态维护表。新增证据只在本表链接，不复制全文输出。
