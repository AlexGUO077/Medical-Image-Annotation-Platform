# WP-02 认证与账号接口契约

依据源开发手册 §2.1～§2.2、§3.4、§5.1～§5.2 和已批准 [D-03](../decisions/D-03-admin-2fa.md)。本契约只补足手册未定义的多阶段认证响应，不改变既有路径和账号/资格模型。

## 登录状态

`POST /api/auth/login` 接收 `username/password`。响应始终包含 `token/role/quals/must_change_password/next`：

- `next=change_password`：`token` 是 5 分钟改密凭证，只能调用 `POST /api/auth/password`；
- `next=setup_2fa`：仅管理员，调用 `POST /api/auth/2fa/setup`；
- `next=verify_2fa`：仅已绑定管理员，调用 `POST /api/auth/2fa/verify`；
- `next=authenticated`：`token` 是 8 小时正式 JWT，可调用受保护接口。

认证失败统一返回“用户名或密码错误”，不说明账号是否存在、停用或过期。
已识别账号的登录、改密、TOTP 失败和触发 15 分钟限流均写入 `audit_logs`，详情只记录失败范围和结果，不记录密码、动态码、JWT 或 TOTP 密钥。

## 首次改密与 TOTP

- `POST /api/auth/password`：Bearer 使用改密凭证或正式 JWT；请求为 `current_password/new_password`。
- `POST /api/auth/2fa/setup`：Bearer 使用 5 分钟绑定凭证；返回 Microsoft Authenticator 可扫描的二维码、手工密钥和 5 分钟验证凭证。
- `POST /api/auth/2fa/verify`：Bearer 使用绑定或登录验证凭证；请求为六位 `code`；成功后返回正式登录响应。

TOTP 密钥、密码、JWT、完整二维码和动态码不得写入日志或审计详情。

## 账号管理

- `POST /api/users`：管理员创建账号；请求为手册字段 `real_name/email/phone/role/quals/expire_at`。服务端生成用户名和初始密码，合成数据阶段仅在本次响应中向当前管理员交接一次，不启用邮件、短信或长期可查渠道。
- `GET /api/users?page=1&pageSize=20`：管理员分页查询，不返回密码散列或 TOTP 密钥。
- `PATCH /api/users`：管理员按 `id` 更新 `status/expire_at/quals`；可用 `reset_mfa=true` 重置另一名管理员的 TOTP。管理员不能通过接口停用自己或重置自己的 TOTP。

前端显隐不构成权限边界。账号、资格和 MFA 变更均由后端鉴权并写审计。

### WP-15 管理页整合

`/admin` 提供账号开通、按八大系统的标注/审核双列资格编辑、启停和有效期更新；另一管理员可确认重置 TOTP，本人停用/重置入口禁用。仅使用上述既有 GET/POST/PATCH 接口，不增加角色编辑、删除、密码重置或注册流程；恢复资格须由管理员按已确认能力重新勾选，旧分派不恢复。所有变更先二次确认，未知写入响应不自动重试，刷新列表核对。

创建所需有效期无默认值，继续 YYYY-MM-DD 与既有服务端有效期判定。用户名/初始密码只在本次成功响应后的内存对话框交接，关闭或离开账号页后清除，不写浏览器存储、日志或 URL，不开放邮件/短信。账号列表、创建和修改响应均 no-store；列表和创建也在事务内锁定并复核当前管理员账号/会话，参数遵守既有字段及分页范围，未知字段拒绝。

管理页汇总既有标签、导出、审计和异常账号子页，提供任务管理、病例录入与统计看板的既有路由入口；不新增运行控制接口或部署平台。成员路由拒绝，401/403 清除管理结果并退出；权限变化由现有 updated_at 会话和分派释放事务即时生效。既有审计查询仅增补账号 role/status/expire_at/quals/mfa_reset 的安全变更投影，仍不显示密码或 TOTP 密钥。接口 mock 为 `test/fixtures/synthetic/admin-users.ts`，无需数据库迁移。

### 账号变更与标注分派释放

WP-06 接入后，PATCH /api/users 在用户行锁内重新校验管理员当前会话，并将账号更新、失效标注分派释放及双方审计置于同一事务。新增响应 `released_assignments`；资格挂起使用既有 quals 更新语义，不新增资格状态表。自审任务丢失审核资格也释放其标注分派，其他系统资格不受影响；任一审计失败全部回滚。后台释放不冒用人工账号，见任务契约的系统审计约束。

帧请求异常限流按 2026-09-30 已批准方案复用 status=disabled，记录 frames.locked 并使当前会话失效、释放在途标注。管理员复核后通过既有 PATCH status=active 启用，写 users.updated 审计；重新登录后按新账号版本计数，旧分派不恢复。见[帧接口契约](frames-api.md)。
