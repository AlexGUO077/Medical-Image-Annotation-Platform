# WP-01 数据库契约与数据字典

本文件是源 Word《医学影像标注平台-开发手册（学生版）V1.0》第四章的数据字典副本，用于核对 TypeORM migrations。源 Word 优先；本文件不新增物理表或业务字段。当前环境只允许合成数据。

## 通用字段

16 张业务表均包含以下字段。TypeORM 自身的 `typeorm_migrations` 仅为迁移元数据，不属于业务表。

| 字段 | PostgreSQL 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `uuid` | 是 | 主键，默认 `gen_random_uuid()` |
| `created_at` | `timestamptz` | 是 | UTC 创建时间 |
| `updated_at` | `timestamptz` | 是 | UTC 更新时间 |
| `deleted_at` | `timestamptz` | 否 | 软删除时间；`audit_logs` 虽保留通用字段，但数据库触发器禁止更新和删除 |

## 16 张业务表

“否”表示源手册明确可选、可后补或业务阶段尚未产生；其余字段按当前契约设为必填。

| 表 | 业务字段及类型 | 关键约束 |
| --- | --- | --- |
| `users` | `username varchar`、`password_hash varchar`、`real_name varchar`、`email varchar?`、`phone varchar?`、`role varchar`、`quals jsonb`、`status varchar`、`expire_at date` | `username` 活跃记录唯一；`role=admin/member`；`status=active/disabled`；`quals` 使用 GIN |
| `cases` | `case_no varchar`、`status varchar`、`source varchar`、`system_code varchar`、`disease_tag_id uuid?`、`clinical_text text?`、`age_band varchar?`、`sex varchar?`、`confirm_method varchar`、`teaching_fields jsonb?` | `case_no` 活跃记录唯一；状态、八大系统编码和三种确诊方式受检查约束；`disease_tag_id → taxonomy_nodes.id` |
| `studies` | `case_id uuid`、`study_uid varchar`、`study_date date` | `study_uid` 活跃记录唯一；`case_id → cases.id` |
| `series` | `study_id uuid`、`modality varchar`、`series_uid varchar`、`orthanc_id varchar`、`frame_count int`、`default_window jsonb?` | UID 和 Orthanc ID 活跃记录唯一；CT 的 `default_window` 必填；`study_id → studies.id` |
| `reports` | `case_id uuid`、`raw_text text`、`sentences jsonb`、`mask_map_id uuid?` | 一个病例最多一条活跃报告；简版病例可没有报告行；源手册未定义脱敏映射表，因此 `mask_map_id` 暂不建外键或新增表 |
| `attachments` | `case_id uuid`、`kind varchar`、`object_key varchar`、`filename varchar`、`size varchar`、`deid_confirmed bool` | `case_id → cases.id`；`kind=检查报告/病理/其他`；50MB 限制由上传服务执行 |
| `taxonomy_nodes` | `parent_id uuid?`、`level int`、`name varchar`、`synonyms jsonb`、`icd varchar?` | 四级树；根节点 `parent_id` 为空；自引用外键；活跃的层级和名称唯一 |
| `sign_tags` | `name varchar`、`system_code varchar`、`definition text` | 八大系统编码；活跃的系统和名称组合唯一 |
| `tasks` | `name varchar`、`source varchar`、`system_code varchar`、`review_mode varchar`、`priority int`、`status varchar` | `review_mode=self/peer`；状态为进行中/已完成/已归档 |
| `task_cases` | `task_id uuid`、`case_id uuid` | 两个字段分别外键到 `tasks`、`cases`；活跃组合唯一 |
| `task_assignments` | `case_id uuid`、`assignee_id uuid`、`task_role varchar`、`due_at timestamptz`、`state varchar` | 外键到 `cases`、`users`；`task_role=annotate/review` |
| `annotation_objects` | `case_id uuid`、`series_id uuid`、`tool varchar`、`geometry jsonb`、`frame_start int`、`frame_end int`、`window_preset varchar?`、`report_sent_ids jsonb`、`part_id uuid`、`confidence varchar`、`measurements jsonb?`、`version int`、`is_gold bool`、`created_by uuid`、`task_id uuid` | 工具、帧范围、置信度受检查约束；`report_sent_ids` 使用 GIN；`part_id` 的目标表源手册未明确，因此暂不添加外键 |
| `annotation_tags` | `annotation_id uuid`、`sign_tag_id uuid` | 外键到 `annotation_objects`、`sign_tags`；活跃组合唯一；至少一条由保存标注业务事务校验 |
| `reviews` | `case_id uuid`、`reviewer_id uuid`、`result varchar`、`comments jsonb`、`is_spotcheck bool` | 外键到 `cases`、`users`；`result=通过/打回` |
| `audit_logs` | `actor uuid`、`action varchar`、`target varchar`、`detail jsonb`、`ip varchar` | `actor → users.id`；触发器和角色权限共同保证只增不改不删 |
| `export_requests` | `status varchar`、`approver_id uuid?`、`expire_at timestamptz?`、`url varchar?` | 申请初始阶段审批人、链接和过期时间可为空；`approver_id → users.id`；申请人与审批人不同由导出业务事务校验 |

## 种子数据

- 1 个合成数据管理员；密码只在运行 seed 时从 `SEED_ADMIN_PASSWORD` 读取，并以带随机盐的 scrypt 散列写入，明文不进入 Git。
- 8 个一级系统节点：`cns`、`headneck`、`resp`、`circ`、`digest`、`uro`、`repro`、`bone` 对应源手册中文名称。
- 每个系统 1 个明确标记为“合成示例”的征象标签，仅验证征象库结构，不作为医学判断依据。正式医学征象内容在 WP-03 评审后维护。

## 敏感字段和最小数据库角色

| 类别 | 字段 | 当前控制 |
| --- | --- | --- |
| 认证凭据 | `users.password_hash` | scrypt 单向散列；seed 明文仅从运行环境读取 |
| 人员标识 | `users.real_name/email/phone` | 当前仅合成值；真实数据阶段依照部署加密和访问控制要求重新验收 |
| 医学与临床信息 | `cases.clinical_text`、`reports.raw_text/sentences`、附件元数据、标注与审核内容 | 当前仅合成值；数据库和备份静态加密属于部署要求，不在表结构中增加自定义加密字段 |
| 脱敏映射 | `reports.mask_map_id` | 只保留源手册字段；映射实体尚未定义，不擅自增加第 17 张表 |
| 审计信息 | `audit_logs.detail/ip` | `miap_app` 仅可查询和新增；触发器拒绝更新和删除 |

`miap_app` 是无登录能力的最小权限组角色：可对普通业务表执行所需 CRUD，只能对 `audit_logs` 执行 `SELECT/INSERT`，不能访问 `typeorm_migrations` 或在 `public` schema 建对象。实际部署账号由部署管理员加入该组，迁移账号与应用账号分离。

## 本地命令

在仓库要求的 Node.js 24.14.0 下执行：

```bash
npm run migration:run --workspace server
npm run db:provision-role --workspace server
npm run db:seed --workspace server
npm run db:verify --workspace server
```

`db:verify-cycle` 会执行全部迁移、seed、全量回滚并重建，只能用于空的一次性数据库，且必须显式设置 `WP01_VERIFY_EMPTY_DATABASE=1`。
