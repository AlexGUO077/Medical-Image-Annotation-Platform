# 审核首批接口契约

依据源 Word §2.3/§4-11/§5.2/§6.3/§7.6，及用户于 2026-10-02 批准的 [D-11/D-12/D-41](../decisions/D-11-D-12-D-41-review-cycle.md)。业务、comments 输入结构、权限及异常回池规则以该决定为准；本文件固定响应及实现边界。仅 synthetic，不开放抽检、下线/重启、真实来源或已发布检索。

- `GET /api/reviews/:caseId?version=...`：返回工作台既有 `case/series/sentences/attachments`、`disease: {id,name}|null`、`review_mode: self|peer`、`version/current_version/annotations`、`latest_review`。annotations 沿用标注读取类型，id 是 logical_id；latest_review 为 `{id,reviewer_id,result,comments,created_at,is_spotcheck}` 或 null。仅允许 version 查询参数，历史读取不影响提交目标版。
- `POST /api/reviews/:caseId`：输入见 D-11。返回 `{review_id,case_id,version,status,is_gold,reannotation}`；通过时 status=已发布/is_gold=true/reannotation=null。打回时 reannotation 为 `{assignment_id,assignee_id,reason}`：有合法承接人则 status=标注中/reason=null；异常时 status=待分配、两个 ID 为 null、reason 为 account_unavailable/qualification_removed/capacity_full。auto 模式由既有后台继续重派，不建立 reviewer 代管理员派单接口。
- `GET /api/reviews/:caseId/attachments/:attachmentId/preview?page=...`：与工作台已确认附件预览同规则；PNG，`X-Page-Count`，无存储对象键/原文件。审核期限在存储 I/O 后复核，审计失败不输出图片。
- 既有 `GET /api/cases/:caseId/annotations` 增加可空 latest_review；保存、提交请求格式保持既有契约，批注元数据不进入标注写请求或本地草稿。

comments 持久化记录由服务器补充 reviewer_id、created_at（UTC ISO）、annotation_version；客户端不能伪造。审核人必须显式核对三项业务事实；服务端另要求通过时已有疾病标签未删除、属于当前系统的第三级疾病或第四级分型，防止把缺失/跨系统标签以勾选代替。客户端无法提交任意状态或金标准标志。

所有写入按用户 ID 固定顺序→任务→病例→分派加锁，账号/任务/资格/分派/期限、当前版及对象引用在事务内复核，审计与状态同事务。通过仅锁定当前版本，保留旧版；打回先结束审核再校验原标注人容量，新标注分派无默认期限。并发重复结论不插入第二条审核记录。读取在返回前复核有效分派；授权无效及时拒绝。仅业务结论发布 synthetic 状态，不授权公网发布。

接口 mock 固定上述响应后接入页面。最小例：通过响应 `{ "review_id": "<uuid>", "case_id": "<uuid>", "version": 3, "status": "已发布", "is_gold": true, "reannotation": null }`；打回异常响应同结构，status=待分配/is_gold=false，reannotation.reason 明确原因。
