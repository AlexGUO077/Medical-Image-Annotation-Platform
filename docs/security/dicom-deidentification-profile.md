# DICOM 去标识化最小配置

状态：D-37 已按合成数据阶段最小方案批准。真实数据接入前由项目负责人和郝鹏翼老师结合实际模态重新复核。

依据：源开发手册 §7.1～§7.2；[DICOM PS3.15 Basic Application Level Confidentiality Profile](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_e.html)。

## 配置

| 项目 | 最小决定 |
| --- | --- |
| Profile | Basic Application Level Confidentiality Profile |
| Option | Clean Pixel Data，用于源手册要求的烧录文字检查 |
| 身份字段 | 清除或改写 `PatientName`、`PatientID`、`BirthDate` 等身份字段 |
| 影像字段 | 保留窗宽窗位、像素间距等阅片必需字段 |
| 私有标签 | 默认删除；当前阶段不建设设备级私有标签白名单系统 |
| UID | 生成新 UID，并保持 Study、Series、SOP 引用一致 |
| 烧录文字 | 按源手册检查首帧 OCR；疑似姓名或 ID 时标记人工确认 |
| 报告与临床文本 | NER 与规则取并集，人名替换为“某”，映射加密存储 |

不提前启用 Clean Graphics、Clean Descriptors、Clean Structured Content、Recognizable Visual Features 或各种 Retain Options。实际数据证明需要时再单独评审。

## 入库与验证

- 自动脱敏完成后必须由录入人员点击“脱敏确认”，之后病例才能进入“待分配”。
- 合成测试覆盖身份字段清除、阅片字段保留、UID 引用一致、首帧 OCR 命中和未确认时阻断。
- 原始身份值、映射和 token 不得写入普通日志或前端响应。
