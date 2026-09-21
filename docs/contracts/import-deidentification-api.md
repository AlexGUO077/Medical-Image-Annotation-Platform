# WP-04 导入与脱敏接口契约

本契约对应源开发手册 §5.2、§7.1～§7.2，需求基线 WP-04、SG-3，以及已批准的 [D-04、D-15、D-17、D-18](../decisions/D-04-D-15-D-17-D-18-import-deidentification.md)和 [D-31 合成数据来源边界](source-authorization-and-data-lifecycle.md)。当前只允许合成数据，真实医学数据入口保持关闭。

## 通用规则

- 本契约接口均要求 Bearer access token，并沿用账号停用、过期、首次改密和管理员 2FA 检查。D-20 尚未确认，当前仅管理员可以导入、查看批次、预览脱敏结果、确认脱敏或审计读取映射。
- 导入使用隔离暂存目录和随机文件名；原始 ZIP、原始报告和原始 DICOM 不进入 PostgreSQL、Orthanc、MinIO 正式对象、Elasticsearch、日志或前端响应。
- 队列逐病例处理。单个病例失败只更新该条失败明细，不中断同批其他病例；批次级 ZIP 安全校验失败时整批拒绝。
- 成功响应使用 snake_case；错误统一为 `{ "code": "HTTP_4xx", "message": "..." }`，不得带原始路径、DICOM 标签、报告内容、映射或模型输出堆栈。

## 批次来源记录

`source` 是必填字段，但不得只作为普通字符串保存。当前合成数据阶段执行以下固定控制：

- 请求中的 `source` 必须精确为 `synthetic`；缺失、空值或其他值均拒绝。
- 服务端在接收批次时派生来源记录：`source=synthetic`、`scope=development_test_only`、`real_data_allowed=false`、`decision=D-31`、`recorded_by` 和 `recorded_at`。
- 来源记录随 Redis 批次元数据保存；正式入库时每个 `cases.source` 写入 `synthetic`；批次接收、病例入库和原始暂存清理的审计详情均记录 `batch_id` 与 `source`，但不记录原始内容。
- 当前记录只证明“合成数据开发准入”，不能替代真实数据所需的提供方、协议、伦理和授权台账。检测到或怀疑为真实数据时必须停止处理并清理暂存，不能通过更换 `source` 字符串绕过。

## POST /api/cases/import

仅管理员。`multipart/form-data`：

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `source` | 是 | 当前只能为 `synthetic` |
| `file` | 是 | ZIP；同时校验扩展名、MIME 和 ZIP 文件签名 |

ZIP 结构和限制按 D-15：一个顶层目录对应一个病例；单病例可直接放在根目录；病例内只允许 `.dcm` 和一个 UTF-8 `report.txt`。禁止嵌套压缩包、符号链接、绝对路径、路径穿越和规范化后重名。默认上限为压缩包 512 MiB、解压后 2 GiB、5000 个文件、总压缩比 100:1。

接收和批次级安全检查通过后返回 `202`：

```json
{
  "batch_id": "uuid",
  "status": "queued",
  "source": "synthetic",
  "source_record": {
    "scope": "development_test_only",
    "real_data_allowed": false,
    "decision": "D-31"
  }
}
```

返回前写 `case_import.batch_accepted` 审计。审计只记录批次号、来源、文件数量和压缩/展开大小，不记录文件名、报告或 DICOM 标签。

## GET /api/cases/import/{batchId}

仅管理员。返回批次阶段、计数和逐病例结果：

```json
{
  "batch_id": "uuid",
  "source": "synthetic",
  "status": "processing",
  "stage": "deidentification",
  "counts": {
    "total": 2,
    "queued": 0,
    "processing": 1,
    "awaiting_confirmation": 1,
    "completed": 0,
    "duplicate": 0,
    "failed": 0
  },
  "items": [{
    "item_id": "uuid",
    "display_name": "case-001",
    "status": "awaiting_confirmation",
    "stage": "manual_confirmation",
    "failure": null,
    "review": {
      "masked_report": "患者：某，年龄 45 岁。",
      "masked_count": 1,
      "ocr_hits": [],
      "ocr_failed": false,
      "suggested_system_code": "resp",
      "classification_confidence": 0.91
    },
    "case_id": null
  }]
}
```

- 批次 `status` 为 `queued | processing | awaiting_confirmation | completed | completed_with_failures | failed`。
- 病例 `status` 为 `queued | processing | awaiting_confirmation | completed | duplicate | failed`。
- `failure` 只返回稳定的 `code` 和脱敏说明，例如 `ZIP_PATH_INVALID`、`UNSUPPORTED_FILE`、`MULTIPLE_STUDIES`、`DICOM_INVALID`、`DEIDENTIFICATION_FAILED`、`OCR_FAILED`、`REPORT_DEIDENTIFICATION_FAILED`；不得返回原始输入。
- `review` 只在 `awaiting_confirmation` 时返回去标识化内容。原始报告、原始身份标签和 `mask_map` 永不由该接口返回。

## GET /api/cases/import/{batchId}/items/{itemId}/preview

仅管理员，且项目必须处于 `awaiting_confirmation`。返回去标识化后的首帧 PNG，叠加当前管理员账号、姓名和时间水印；禁止缓存和下载提示，响应不得暴露原始对象键或内部服务地址。

## POST /api/cases/import/{batchId}/items/{itemId}/confirm

仅管理员。请求体固定为：

```json
{
  "confirmed": true,
  "system_code": "resp",
  "confirm_method": "临床综合诊断"
}
```

`system_code` 必须是八大系统编码之一，默认可采用后端预分类建议，但必须由管理员确认；低置信度时界面必须要求人工选择。`confirm_method` 必须是源手册规定的“病理证实 / 随访确诊 / 临床综合诊断”之一，不能从报告或 DICOM 自动推断。

确认前，处理后的 DICOM 和报告仍在隔离区，不写入正式 Orthanc、PostgreSQL 或 MinIO。确认成功后才执行正式入库事务：

1. 去标识化后的序列写入 Orthanc；
2. 写入 `cases/studies/series/reports`，`cases.source` 固定为 `synthetic`，病例状态为 `已录入`；
3. 报告映射按 D-04 加密写入 MinIO 私有桶，`reports.mask_map_id` 保存映射 UUID；无映射时该字段为 `null`；
4. 写 `case_import.deidentification_confirmed` 和 `case_import.case_committed` 审计；
5. 清理该病例的原始及处理中间暂存文件，并写 `case_import.quarantine_cleaned` 审计。

成功返回 `201`：

```json
{
  "batch_id": "uuid",
  "item_id": "uuid",
  "case_id": "uuid",
  "status": "completed",
  "case_status": "已录入"
}
```

重复确认返回现有完成结果，不重复写入业务数据。未完成自动脱敏、OCR 失败未复核、来源记录缺失或暂存文件已失效时不得确认。

## POST /api/cases/{caseId}/mask-map/audit

仅管理员按单个病例审计读取，不提供列表或批量接口。请求必须填写用途理由：

```json
{ "reason": "核对合成报告脱敏结果" }
```

成功时解密并返回该病例的映射，同时写 `case_import.mask_map_accessed` 审计；审计只记录病例、映射 UUID、操作者和理由，不记录映射内容。无映射返回空数组。业务人员、搜索、导出和普通病例详情接口永不返回映射。

## 处理要求

- DICOM 按已批准 D-37 执行 Basic Application Level Confidentiality Profile、Clean Pixel Data、私有标签默认删除、新 UID 及引用一致性；阅片所需窗宽窗位和像素间距保留。
- 每个序列首帧使用本地 PaddleOCR 检查；置信度不低于 0.80 且命中姓名或患者 ID 规则时标记人工确认。OCR 执行失败也进入人工确认，不得自动放行。
- 报告使用本地 PaddleNLP UIE 和称谓正则，命中取并集；姓名替换为“某”，年龄数字保留；按 `。；;\n` 分句，去空白和空句，`idx` 从 0 开始。
- Paddle 子进程无外部端口。调用失败、超时或输出无效时仅该病例失败并清理暂存，不把原始数据写入正式存储。
- 同一 `(source, study_uid)` 已存在时标记 `duplicate`，不创建病例，也不覆盖现有数据。

## 错误

| 状态 | 触发条件 |
| --- | --- |
| 400 | 缺少或不支持的 `source`、请求体或参数无效、ZIP 目录结构不符合 D-15 |
| 401 | 缺少、过期或无效认证信息 |
| 403 | 非管理员调用；真实数据入口被策略阻断 |
| 404 | 批次、病例条目或病例不存在，或暂存已清理 |
| 409 | 条目状态不允许预览/确认；确认结果与现有状态冲突 |
| 413 | 压缩包、展开大小、文件数或压缩比超过限制 |
| 415 | 不是 ZIP、文件签名不符或包含不支持文件 |
| 422 | DICOM、OCR、报告脱敏或去标识化处理失败 |
| 503 | Redis、Orthanc、MinIO 或本地模型进程不可用 |
