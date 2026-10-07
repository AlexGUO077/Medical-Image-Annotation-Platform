# WP-13 管理员统计接口

依据源 Word §2.1/§2.2/§5.2/§6.1、基线 WP-13、UI §15.5、已确认 D-42。仅用于已确认脱敏且未软删除的 synthetic 病例、未软删除任务；管理员只读聚合，成员 403。使用既有 access 会话/安全设置和实时账号状态，管理员不需要阅片资格。响应 `Cache-Control: no-store, private`，不含病例/报告/几何/附件/存储键/审计 IP，不新增导出。

## GET /api/stats

条件 AND；未知、重复/非标量或格式错误参数 400。

| 参数 | 类型/默认 |
| --- | --- |
| task_id / person_id | 可选 UUID；person_id 是版本提交人，不是审核人；不存在或被范围排除时返回空统计 |
| system_code | 可选既有八系统代码；按审核审计绑定任务的系统归组 |
| source | 可选 synthetic / teacher_provided_teaching；本批后者不入统计，返回空结果 |
| from / to | YYYY-MM-DD，成对且 from ≤ to；北京时间自然日，含起止；未给时最近 30 日（含今天）；使用 reviews.created_at |
| group_by | task（默认）/ person / system / source / day |
| page / pageSize | 正整数，默认 1 / 20；pageSize ≤ 100；页偏移须是安全整数 |

响应 `{filters,summary,trend,items,page,pageSize,total}`。filters 返回实际生效参数及 `timezone: "Asia/Shanghai"`；summary、trend 是完整过滤范围，items 是分组分页，total 是分组数；按稳定分组 key 排序，翻页不改变 summary/trend。trend 按日补零。无数据返回零计数、空明细，比例 null。

每组及 summary/trend 返回：completed（普通通过的不同 case/version 数）、normal_passed、normal_returned、normal_total（普通审核次数）、return_rate；spotcheck_passed、spotcheck_returned、spotcheck_total、spotcheck_pass_rate。比例为 0～1 或 null，用原始计数计算，禁止平均各组百分比。items 另含 key/label，trend 另含 day。

普通审核、抽检分别统计；全面复核不计入这些指标。返工/重启新版本另计一次；后续下线/重启不移除历史结论。提交人用相同病例/任务/版本且不晚于审核的 annotations.submitted 审计绑定，不用当前分派或当前版本，停用/资格变更不抹除历史量。review 通过 reviews.decided 的 review_id、病例 target、审核人和结果匹配绑定任务/版本/类型，兼容早期未写 review_kind 的普通审核。没有可信关联时不推测归属。case/task 当前软删除、来源或缺少人工确认记录则排除；不要求任务仍进行中或病例仍已发布。

单次 PG 聚合快照生成总览/趋势/分组分页；既有 target+created_at 审计索引用于关联。数据库查询超时/失败不返回部分统计；默认错误过滤不泄露 SQL。不开新表/服务/统计缓存/周期任务/图表依赖。性能针对本批合成数据量实测，未来数据量扩大再据实际计划调整索引。

契约 mock：`test/fixtures/synthetic/stats.ts`，先于 Dashboard 页面。
