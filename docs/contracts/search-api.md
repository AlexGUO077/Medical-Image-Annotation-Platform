# 已发布库与全文检索契约

依据用户 2026-10-06 批准的 [D-29](../decisions/D-29-published-library-and-es.md)、源 Word §2.2/§5.2/§6.3/§9.4。仅 synthetic 已确认脱敏、已发布且当前标注全部为金标准的病例（合法阴性零标注版本以当前版本发布审计判定）；对应系统 annotate/review 任一资格，管理员无旁路。所有接口 Bearer、实时账号/资格校验、no-store；仅读当前版本。

- `GET /api/search`：D-29 所列参数，不允许重复/未知参数；page 默认 1、pageSize 默认 20、上限 100；q 最多 200 字符，普通文本。系统/模态/来源枚举、UUID 及标签层级严格验证。部位匹配疾病所在部位或当前金标准标注部位，疾病包含子分型，征象仅匹配当前金标准，模态为任一活跃序列。条件 AND；全文使用 standard 的 cross_fields/AND，在报告、临床两个字段合并匹配词项。空 q 使用 PG，非空 q 使用 ES；ES 故障、超时或分片部分失败返回 503，不返回不完整命中。
- 响应 `{items,page,pageSize,total}`；item 为 `{id,case_no,system_code,source,version,disease:{id,name}|null,signs:[{id,name}],modalities:[],thumbnail:{id,series_uid,modality,frame_count,default_window,frame_index}|null}`。缩略图定位本身不含像素或存储键。只返回授权当前病例，分页/总数不采用未经 PG 复核的 ES 聚合。全文按相关性再按病例 ID 排序，空 q 按 updated_at DESC、ID ASC。
- `GET /api/library/:caseId`：返回既有 Workbench 的 case/series/sentences/attachments，加 `{version,current_version,annotations,disease,teaching_fields}`；病例 status 恒为已发布、version=current_version。只读标注不含修改接口或审核提交资格；没有原始 DICOM、映射或对象存储键。
- `GET /api/library/:caseId/attachments/:attachmentId/preview?page=N&version=V`：版本必填，仅已确认附件，PNG、水印、no-store、X-Page-Count；资格/来源/状态/版本实时复核。
- 库帧仍走 `POST /api/frames/ticket`，新增显式 `{access_mode:'library',expected_version:V}`，其余字段沿用帧契约。这两个字段须一起提供；非库请求完全沿用现有分派门。签名票据绑定访问模式及发布版本，旧版即使重新发布也不能使用；读取时和渲染后复核。库帧沿用现有限流、水印和审计，不允许库权限通过保存/提交/审核接口。

401 为会话失效，403 为无资格/不可访问（包括未发布、失效来源、旧版本），400 为输入无效；帧/附件权限失效必须清除已显示影像，详情刷新失败不得保留旧内容。空结果不表述为 ES 故障。

索引 `miap-published-v1`（测试使用独立同前缀索引）strict mapping：case_id/revision_key/system_code/source 为 keyword；脱敏 report_text/clinical_text 为 standard text。revision_key 由 PG 病例 ID、标注版本、病例及报告更新时间组成，权限和版本仍由 PG 决定；ES 不返回 _source 给业务 API。全文命中限定当前 PG 可见版本，最终 PG 再验证并分页。索引重建从 PG 生成；专用 ES 服务账号只授权该索引前缀，凭据仅在本地环境，应用明确拒绝 elastic 管理员作为检索账号。专用角色仅 create_index/view_index_metadata/read/write 于 miap-published-*，没有集群或安全管理权限。

提交后请求同步；失败保留待重试 ID，启动全量恢复及每日对账补偿进程丢失，不依赖内存队列作为业务事实。对账覆盖现有 PG 病例及 ES 孤儿文档，部分写入失败不视为成功，不删业务数据。重建/对账只提供内部命令，无公众 HTTP 入口。无新增表/部署服务/运行时依赖；既有索引与 JSONB 约束足以支持本批，无空迁移。
