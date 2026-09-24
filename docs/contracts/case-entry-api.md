# WP-05 病例录入与临床信息接口契约

状态：PR #24 已于 2026-09-24 合并；用户明确按该合并结果放行接口实施。合并事实不另写为 GitHub 人工 Review。契约按已批准 D-16、D-19、D-20 制定；源开发手册 §4.2、§5.2、§6.3、§7.2 与需求基线 WP-05 为上位要求；批量 ZIP 流程继续使用[导入与脱敏契约](import-deidentification-api.md)。

## 共同边界

- 以下接口均要求 Bearer token、有效管理员账号和既有管理员 2FA 状态。非管理员返回 403；不存在或无权访问的病例统一返回 404，不泄露对象键、隔离路径、原文或内部异常。
- 来源仅允许 `synthetic` 和 `teacher_provided_teaching`，均只限本项目开发测试。批次／病例审计保存 D-31 所要求的最小来源信息。撤回来源时停止新录入并按来源契约清理。
- 原始报告、原始关键影像和待处理附件仅可存在本机隔离暂存；正式库和 MinIO 仅接收经处理、确认后的内容。客户端文件名不得作为对象键、病例号或响应标识，审计不记录原文、原文件名或识别命中内容。
- 成功字段使用 snake_case；错误为 `{ "code": "...", "message": "安全说明" }`。病例、草稿和上传会话 ID 均为服务端 UUID。所有预览响应使用 `Cache-Control: no-store, private`、`Content-Disposition: inline` 和 `X-Content-Type-Options: nosniff`。

## 手工简版录入

`POST /api/cases/manual/prepare` 接收 `multipart/form-data`：`source`、UTF-8 `report_text` 和一张 `image`。报告非空且不超过 2 MB；影像仅 JPG/PNG、大小不超过 50 MB，校验扩展名、MIME 和实际解码格式，并限制解码像素量。上传使用随机文件名和隔离目录。

服务端调用本地 PaddleNLP UIE＋规则遮蔽报告姓名，并使用本地 PaddleOCR 检查关键影像。识别到疑似姓名/ID 的区域必须在服务端遮盖，再生成剥离元数据的安全 PNG；OCR/NER 失败、格式错误或无法安全遮盖时返回安全错误并清理暂存，不进入确认。成功返回 `draft_id`、`masked_report`、`masked_count`、`image_redaction_count` 和 `expires_at`，不返回原文、原图、原文件名或内部路径。草稿保留在隔离区，最长 24 小时；失效后不可确认。

`GET /api/cases/manual/{draftId}/preview` 仅返回已处理且带账号／姓名／时间水印的 `image/png`。`POST /api/cases/manual/{draftId}/confirm` 请求 `{ "confirmed": true, "system_code": "八大系统编码", "confirm_method": "三种确诊方式之一" }`。服务端重新检查草稿、来源、处理结果与操作者，再将病例置为“已录入”，保存脱敏报告及分句、加密最小映射，并把安全 PNG 作为 `kind=其他` 的附件写入私有对象存储。该病例不建立 `studies` 或 `series`；`attachments.filename` 使用服务端生成的中性名称。正式提交及审计成功后清除隔离草稿；失败时不得留下半提交病例或未引用的正式对象。成功返回 `case_id`、`case_no` 和 `status=已录入`，前端进入 `/cases/{caseId}`。

## 病例与临床信息

`GET /api/cases/{id}` 返回管理员可编辑的病例号、状态、来源、系统、确诊方式、已脱敏临床信息、年龄段、性别、教学字段和附件元数据；不返回 DICOM 原文件、脱敏映射、MinIO 对象键或原始附件内容。`GET /api/cases/{id}/report` 仅返回已脱敏报告全文和稳定 `idx` 的句子。

`PUT /api/cases/{id}/clinical` 接收 `{ "clinical_text": "...", "age_band": "...", "sex": "...", "confirm_method": "..." }`；服务端保存前按既有本地 NER＋规则脱敏，失败时不保存。响应仅返回脱敏值和安全的 `masked_count`，前端只据该响应显示“遮蔽 N 处”。`PATCH /api/cases/{id}/teaching` 接收 `{ "difficulty": "...", "applicable_level": "...", "sign_points": ["..."] }`，字符串与数组均限长，文本先按相同规则处理，再写入已有 `cases.teaching_fields`。仅未删除且当前允许编辑的病例可更新，写入审计。

## 附件上传与预览

`POST /api/cases/{id}/attachments` 接收 `multipart/form-data`，每次恰好一片：`chunk`、从 0 开始的 `part_index`、`part_count`、`file_size`（整个文件字节数）、`format`（`pdf|jpg|png|docx|xlsx`）；首片不传 `upload_id`，服务端创建并返回，后续片必须带该 ID。单片至多 5 MB，整文件至多 50 MB；片序必须连续、总片数和总大小必须与首片一致。浏览器发送通用 multipart 文件名，不传原文件名。重复片、缺片、超限或会话不属于当前病例／操作者时拒绝，不覆盖已接收内容。

上传响应为 `{ "upload_id": "UUID", "status": "receiving|processing", "next_part_index": 1, "part_count": 4 }`。最后一片接收后进入 `processing`，在隔离区合并并校验扩展声明、MIME、文件签名和可解码内容；失败时不进入正式存储。`GET /api/cases/{id}/attachments/uploads/{uploadId}` 返回 `{ "status": "receiving|processing|pending_confirmation|failed", "next_part_index": 1, "part_count": 4, "page_count": 1, "failure_code": null }`，只提供安全错误码，不返回原文或路径。上传会话与暂存最长保留 24 小时。

处理 JPG/PNG 时剥离元数据；PDF 及转换后的 DOCX/XLSX 逐页检查文字层与渲染图。发现疑似身份标识或识别／转换失败时拒绝该附件并要求提交已去标识化版本，不向浏览器回传未处理页面。正式存储只保存经过确认的只读处理结果，原始上传文件在隔离区清理；不提供原件下载。

`GET /api/cases/{id}/attachments/uploads/{uploadId}/preview?page=1` 仅供创建该上传的管理员核验 `pending_confirmation` 状态下已处理且带水印的 `image/png`；页码从 1 开始，不在 `page_count` 内时返回 404。`POST /api/cases/{id}/attachments/uploads/{uploadId}/confirm` 接收 `{ "confirmed": true, "kind": "检查报告|病理|其他" }`，重新检查来源、类型和处理结果，写入私有对象、附件行和审计后返回 `{ "attachment_id": "UUID", "filename": "服务端中性名称", "size": "字节数字符串", "deid_confirmed": true }`。确认失败须清理未引用正式对象，拒绝或失效则清理暂存。

`GET /api/cases/{id}/attachments/{attachmentId}/preview?page=1` 按对象鉴权返回已确认附件的只读水印 `image/png`。JPG/PNG 解码、剥离元数据后作为单页；PDF 转换为逐页图像；DOCX/XLSX 先在隔离环境转换为只读页面，再按同一路径水印。页码按已处理的 `page_count` 校验，响应不含原始对象或下载 URL。转换或水印失败时返回错误；不回退为原件下载。

附件正式入库前须由管理员显式确认脱敏结果，`deid_confirmed=true` 仅由服务端在确认与审计完成后设置。附件列表只展示安全类型、服务端生成的中性名称、大小和确认状态；未确认附件不向一般病例详情或预览接口开放。原件下载接口不提供。
