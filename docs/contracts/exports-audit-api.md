# WP-14 受控导出与审计接口

依据已确认 D-13、D-03/D-34～D-36，源 Word §2.2/§2.6/§4.5/§5.2/§6.3/§8.4、WP-14/S10/SG-5、UI §15.6。全部接口 access/admin 守卫、实时账号/会话检查、no-store；管理员登录已含 2FA，不增加操作挑战。

- `POST /api/exports`：`{case_ids:UUID[]}`，1～20 个不同病例。服务端固定当前已确认脱敏 synthetic 发布金标准版本，记录申请人，返回 `{id,status}`；不创建包。管理员可按 `GET /api/exports/candidates?page&pageSize` 分页选择；只返回安全病例 id/source/system/version，无正文或影像。
- `GET /api/exports?page&pageSize`：全体管理员可查队列；返回 id/requester_id/approver_id/status/case_versions/created_at/expire_at/download_count；仅申请人获得本服务领取路径 url，失效记录仍保留，不把它当作可下载。分页 20、最多 100。
- `POST /api/exports/:id/approve`：`{decision:"approve"|"reject"}`；只能另一管理员处理待审批。批准复核申请人、病例来源/状态/版本/金标准，生成 JSON 存私有 MinIO；批准成功才产生认证领取路径和 24 小时时效。拒绝不生成包。并发/重复处理 409，自批或不可用 403。
- `GET /api/exports/:id/download`：仅申请人当前会话；复核申请人/审批人当前管理员与安全设置及病例范围、版本、到期/次数。读对象/校验 SHA-256 成功后事务原子将 download_count=1 并写领取审计，提交后返回 JSON attachment。响应中断不补次数；对象读取失败 503、审计失败 500，不消耗次数/不返回包。身份/资源/到期/已领取拒绝，不产生匿名链接。

包为 `{schema_version:1,cases:[...]}`，只包含病例 UUID/source/system/version、疾病/征象/部位标签 UUID、金标准标注的逻辑 UUID/工具/几何/帧范围/窗参数/置信度/报告句序号，以及序列逻辑 UUID/模态/帧数/窗参数和代表帧尺寸/标定。JSON 显式投影，不含 UID、Orthanc id、账号、影像、报告/临床正文、附件、映射或私有键。包最多 5 MiB，超限拒绝批准；不是新业务导出格式。S3 失败不公布链接；复用现有持久对象补偿，已提交批准包不会被误删。

既有 export_requests 新增 requester_id、case_versions、download_count、package_sha256 及形状/职责分离约束；旧表有无法归属的记录时迁移拒绝而不补造申请人；存在请求时 down 拒绝，不删除历史。没有新表/部署服务/密钥/调度。对象到期禁止访问，测试包按合成数据规则手工清理。

`GET /api/audit?page&pageSize&actor&action&target&from&to`：管理员全量只读查询，条件 AND，actor UUID、action/target 精确匹配、from/to 可选 ISO 带时区时间戳（含起点不含终点）；稳定 created_at DESC/id DESC，单快照 items/total。返回记录 id/actor/action/target/ip/created_at 及安全 detail 投影；未知/自由正文、映射/私有键/秘密不返回，保留版本、目标关联、结论、次数等追踪字段。无编辑/删除/导出接口；现有触发器和应用 SELECT/INSERT 角色继续验证，不加哈希链/WORM。

`PATCH /api/users` 的既有 status=active 接口用于管理员核实后解锁异常账号；沿用用户事务、即时旧会话失效与审计，不删除限流证据或恢复旧票据。本包提供小型解锁面板，完整账号/资格整合属 WP-15。

所有状态写入与最小审计原子：exports.requested/approved/rejected/downloaded/download_denied。审核/读取对象 I/O 后重新核验到期；未知响应先刷新队列，不自动重复申请/批准/领取。源 Word 人工评审、组长权限复核、SG-5 独立验收继续适用。接口 mock 在 `test/fixtures/synthetic/exports-audit.ts`，先于页面。
