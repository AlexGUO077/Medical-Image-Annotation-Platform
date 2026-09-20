# WP-02 认证与账号接口契约

依据源开发手册 §2.1～§2.2、§3.4、§5.1～§5.2 和已批准 [D-03](../decisions/D-03-admin-2fa.md)。本契约只补足手册未定义的多阶段认证响应，不改变既有路径和账号/资格模型。

## 登录状态

`POST /api/auth/login` 接收 `username/password`。响应始终包含 `token/role/quals/must_change_password/next`：

- `next=change_password`：`token` 是 5 分钟改密凭证，只能调用 `POST /api/auth/password`；
- `next=setup_2fa`：仅管理员，调用 `POST /api/auth/2fa/setup`；
- `next=verify_2fa`：仅已绑定管理员，调用 `POST /api/auth/2fa/verify`；
- `next=authenticated`：`token` 是 8 小时正式 JWT，可调用受保护接口。

认证失败统一返回“用户名或密码错误”，不说明账号是否存在、停用或过期。

## 首次改密与 TOTP

- `POST /api/auth/password`：Bearer 使用改密凭证或正式 JWT；请求为 `current_password/new_password`。
- `POST /api/auth/2fa/setup`：Bearer 使用 5 分钟绑定凭证；返回 Microsoft Authenticator 可扫描的二维码、手工密钥和 5 分钟验证凭证。
- `POST /api/auth/2fa/verify`：Bearer 使用绑定或登录验证凭证；请求为六位 `code`；成功后返回正式登录响应。

TOTP 密钥、密码、JWT、完整二维码和动态码不得写入日志或审计详情。

## 账号管理

- `POST /api/users`：管理员创建账号；请求为手册字段 `real_name/email/phone/role/quals/expire_at`。服务端生成用户名和初始密码，初始密码只在本次响应返回。
- `GET /api/users?page=1&pageSize=20`：管理员分页查询，不返回密码散列或 TOTP 密钥。
- `PATCH /api/users`：管理员按 `id` 更新 `status/expire_at/quals`；可用 `reset_mfa=true` 重置另一名管理员的 TOTP。

前端显隐不构成权限边界。账号、资格和 MFA 变更均由后端鉴权并写审计。
