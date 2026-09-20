# DICOM 去标识化 Profile / Options（D-37 草案）

状态：待医学影像负责人、数据责任人和安全负责人批准；在 WP-04/SG-3 完成实现、一致性测试与人工复核证据前，不得处理真实 DICOM。

标准基线：[DICOM PS3.15 2026c, Attribute Confidentiality Profiles](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_e.html)。源开发手册 §7.1～§7.3 与 [需求基线](../医学影像标注平台-需求拆解与实施基线.md) §8.5、D-37 同时适用；标准版本变化时复核本文件。

## 1. 候选配置

| Profile / Option | 草案选择 | 项目规则 |
| --- | --- | --- |
| Basic Application Level Confidentiality Profile | 启用 | 按 Table E.1-1 处理非像素属性；不得只删除少量已知姓名字段 |
| Clean Pixel Data Option | 启用 | 检查烧录身份信息；OCR 只作辅助，命中/不确定均进入人工复核；清除后记录 `Burned In Annotation (0028,0301)=NO` 的依据 |
| Clean Graphics Option | 启用 | 清理图形、文本注释和 overlay 中的身份信息 |
| Clean Descriptors Option | 启用 | 自由文本字段走与报告一致的脱敏/白名单策略 |
| Clean Structured Content Option | 存在结构化内容时启用 | 未支持的结构化内容不得静默放行，应隔离或拒绝 |
| Clean Recognizable Visual Features Option | 可能含面部/表面可识别特征时启用 | 头面部 CT、照片等进入人工风险判定；无法可靠处理时拒绝入库 |
| Retain UIDs Option | 默认不启用 | 生成不可逆的新 UID，并在单批次内保持引用一致；对照只进入隔离加密映射 |
| Retain Safe Private Option | 默认不启用 | 私有标签默认删除；确需保留时逐标签、逐设备版本白名单并记录理由和测试 |
| 日期保留选项 | 默认不启用 | 默认移除 DICOM 日期/时间；若业务确认必须保持纵向关系，先批准一致日期偏移方案和重识别风险 |
| Retain Patient Characteristics / Device / Institution Identity | 默认不启用 | 只有经处理目的证明必要、字段最小化和责任单位批准后才能逐项启用 |

## 2. 输出与隔离规则

- 原始对象只存在于不可由 Web 访问的隔离区；去标识化、扫描和人工复核均通过后才写正式 Orthanc。
- `PatientID`、姓名、访问号、机构/人员标识等按 profile 处理；原值不得写日志。新伪标识与来源批次关联，映射独立加密存储。
- UID 重映射须覆盖 Study/Series/SOP 及所有引用，保证引用完整而不保留原 UID；同一批次同一原 UID 映射稳定，不同环境不得共用映射密钥。
- 报告、临床文本和附件不能因 DICOM 文件通过而自动视为已脱敏，必须走各自检测与人工复核。
- 失败、不支持的 SOP Class、无法解析对象、OCR/人工复核不确定结果均保持隔离并失败关闭，不得部分入库。
- 原始暂存包清理、输出对象摘要、采用的 profile/options、软件版本、规则版本、自动检查和人工复核结果写入批次证据，不记录原始敏感值。

## 3. SG-3 一致性测试基线

- 使用合成 DICOM 覆盖 Table E.1-1 涉及的主要动作、嵌套序列、引用 UID、日期/时间、自由文本、overlay、私有标签和多帧对象。
- 构造烧录姓名/编号的合成像素样本，验证检测、清除及清除后的人工可读性检查。
- 验证私有标签默认删除和显式白名单；白名单外标签必须失败。
- 验证同批次引用一致、跨批次不可关联、映射访问受控、日志和错误中无原值。
- 对每个计划支持的模态/SOP Class 建立阳性与阴性样本；未列入支持矩阵的对象拒绝入库。
- 自动检查后必须保留人工复核步骤；未取得医学影像负责人签字不得宣称 SG-3 通过。
