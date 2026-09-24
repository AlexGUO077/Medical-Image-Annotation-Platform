# WP-05 病例录入与临床信息接口契约

状态：2026-09-24 按已批准 D-16、D-19、D-20 制定，待接口评审。源开发手册 §4.2、§5.2、§6.3、§7.2 与需求基线 WP-05 为上位要求；批量 ZIP 流程继续使用[导入与脱敏契约](import-deidentification-api.md)。

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

`POST /api/cases/{id}/attachments` 采用分片上传：首片创建服务端 `upload_id`，后续片以该 ID、连续片序号和总片数续传；单片至多 5 MB，总文件至多 50 MB，最终片触发合并、类型和内容校验，并返回 `status=pending_confirmation`。只允许 PDF/JPG/PNG/DOCX/XLSX，客户端文件名仅用于格式提示，不进入响应、对象键或审计。缺片、重复片、超限、类型不符、转换失败或安全检查失败均拒绝；未确认附件只保留在隔离暂存，最长 24 小时。

`GET /api/cases/{id}/attachments/uploads/{uploadId}/preview` 仅供创建该上传的管理员核验隔离区中已转换、已做身份检查且带水印的预览；未经处理或识别失败时不可预览。`POST /api/cases/{id}/attachments/uploads/{uploadId}/confirm` 接收 `{ "confirmed": true, "kind": "检查报告|病理|其他" }`，重新检查来源、类型和处理结果，写入私有对象、附件行和审计后返回 `attachment_id`。转换结果不通过或管理员拒绝时清理暂存。

`GET /api/cases/{id}/attachments/{attachmentId}/preview` 按对象鉴权返回已确认附件的只读水印预览。JPG/PNG 由服务端解码、剥离元数据并输出水印图像；PDF 转换为逐页带水印图像；DOCX/XLSX 先在隔离环境转换为只读页面，再按同一路径水印。分页参数由服务端校验并限幅，响应不含原始对象或下载 URL。转换或水印失败时返回错误；不回退为原件下载。

附件正式入库前须由管理员显式确认脱敏结果，`deid_confirmed=true` 仅由服务端在确认与审计完成后设置。附件列表只展示安全类型、服务端生成的中性名称、大小和确认状态；未确认附件不向一般病例详情或预览接口开放。原件下载接口不提供。
