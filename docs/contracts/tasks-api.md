# 任务接口契约

WP-06 任务创建与管理：源手册 §2.4、§4.2 表 4-7/4-8、§5.2、§6.3 与 UI §15.2。用户于 2026-09-28 要求启动 M2，并批准评审修复后继续开发。管理员任务列表、候选病例选择与创建已实现；2026-09-29 用户批准 D-09/D-10/D-23 及手动分派/设置权限，已实现管理员手动指派、两级限额、三种分发模式及标注领取/回收；审核分派随提交状态机接入。

## POST /api/tasks

仅已完成认证和管理员安全设置的有效管理员可调用；沿用 AccessTokenGuard 与 AdminGuard，事务内再次核对账号和会话版本。

请求：`name` 去除首尾空白后为 1～200 个 Unicode 码点（2026-09-28 用户评审建议的输入边界）；`source` 为已批准来源 `synthetic` 或 `teacher_provided_teaching`；`system_code` 为八系统编码；`review_mode` 为 `self` 或 `peer`；`priority` 为 PostgreSQL int 范围整数（数值越大优先级越高）；`case_ids` 为非空、无重复的 UUID 数组。以上字段必填；可选 `dispatch_mode` 缺省 auto（用户已批准），支持 auto/manual/pool；未知字段拒绝，防止客户端误以为限额或时长已生效。

成功 201：`{ id, name, source, system_code, review_mode, priority, status: "进行中", dispatch_mode, case_ids, auto_dispatch? }`。不返回报告、临床文本或影像存储标识。

按本次评审批准，单次 `case_ids` 最多 2000 个；这是请求体与事务批量大小的技术边界，不是人员在途上限。2001 个在进入事务前返回 400；不更改 HTTP JSON 请求体的既有大小限制。前端同样校验名称与选择数，服务端仍为最终边界。

- 在单一事务中按病例 ID 固定顺序锁定所选病例；全部必须存在、未软删除、处于“已录入”、来源与系统匹配，并且未关联任何活跃任务关系。
- 脱敏确认沿用 M1 的正式入库审计：`case_import.deidentification_confirmed` 或 `case_manual.confirmed`。缺失确认记录时拒绝，不增加脱敏字段或审批流程。
- 全部检查通过后创建任务与关系，病例统一迁移到“待分配”；写 `tasks.created` 审计，记录任务作用域、病例 ID 和迁移，不记录医学内容。
- 任一病例失败或审计失败时全部回滚；并发创建包含同一病例的任务仅允许一个成功。新增活跃 `case_id` 唯一索引防止跨任务重复关联，历史软删除关系不受影响；旧数据冲突时迁移失败，不自动清理数据。

错误沿用 `{ code: "HTTP_<状态码>", message }`：400 参数无效，401 未认证或会话失效，403 非管理员/账号无效，404 病例缺失或删除，409 来源/系统/状态/任务归属/脱敏确认冲突；内部异常返回通用 500。

## 管理员读取接口

D-12 的任务管理最小补齐范围沿用以上管理员 guard，不向普通成员开放管理列表或候选病例。分页参数 `page` 默认 1、`pageSize` 默认 20，均为十进制正整数；`pageSize` 最大 100；非法参数返回 400。返回 `{ items, total, page, pageSize }`，空列表正常返回 200；读取设置 `Cache-Control: no-store, private`。

- `GET /api/tasks`：可按 `source`、`system_code` 过滤；返回任务 `id/name/source/system_code/review_mode/priority/in_flight_limit/dispatch_mode/status/created_at` 和活跃 `case_count`，按优先级降序、创建时间降序、ID 排序，不返回报告或全部病例 ID。
- `GET /api/tasks/eligible-cases`：必须提供已批准的 `source` 与合法 `system_code`；仅返回已录入、未删除、存在既有脱敏确认审计且未关联活跃任务的病例。每项仅含 `id/case_no/status/source/system_code`，按录入时间和 ID 稳定排序。该列表是选择提示；创建时必须重新锁定和校验，处理读取后被其他管理员选走的竞态。
- `GET /api/tasks/:id/cases`：任务不存在/已删除返回 404，ID 非 UUID 返回 400；返回该任务活跃、未删除病例的上述最小字段及当前 active 标注 assignment_id（无则 null），分页读取，不含临床、报告或影像存储信息。

页面 `/tasks`：管理员使用紧凑任务卡片和分页病例列表；按来源/系统筛选并选择候选病例创建任务。改变创建来源/系统须清空选择，避免混入旧作用域。提交失败保留表单并显示服务端错误，成功后刷新任务列表；不能把刷新失败显示成创建失败并诱导重复提交。成员页面只读取 pool/mine，展示本人在途标注和符合资格的领取池，不请求管理员接口。

## 管理员手动分派与设置（2026-09-29 批准）

源手册 §2.2/§2.4 明确管理员保留手动指派、回收改派及优先级设置权。此切片先实现标注手动指派和两级限额设置，普通成员不获得替他人分派权限；自动分派、领取与回收见下文；审核状态迁移另行接入，不以本切片声称 WP-06 完成。

- `POST /api/tasks/dispatch`：`{ mode: "manual", task_id, case_ids, assignee_id, due_at?: ISO时间|null }`。手动请求的 case_ids 为 1～2000 个不重复 UUID；due_at 缺省/null 不设期限，非空须为带时区且晚于当前时间的有效 ISO 时间。只有进行中任务内、来源/系统匹配且待分配的病例可以派出；承接人必须账号有效、完成安全设置、拥有系统标注资格，自审任务还须审核资格。全部成功才将病例改为标注中，写 active 标注分派和 `tasks.dispatched` 审计，返回 `{ task_id, assignee_id, case_ids, due_at, task_role: "annotate" }`。不抢占原分派，不暴露原始影像。
- `PATCH /api/tasks/:id/settings`：只接受非空字段集合 `priority`（int32）、`in_flight_limit`（正 int32 或 null）、`dispatch_mode`（auto/manual/pool）。返回更新后 id/priority/in_flight_limit/dispatch_mode；任务必须进行中。审核模式保留在创建时设置，本切片不增加在途修改审核模式的能力。
- `PATCH /api/tasks/assignees/:id/limit`：`{ in_flight_limit: 正int32|null }`，设置该人员跨任务在途上限，返回 id/in_flight_limit。仅管理员可调用。

两级上限分别存于 tasks/users 的可空 `in_flight_limit`，无默认值；两级都非空时同时满足。计数合并标注与审核，只计 active、未删除且未到期的分派，并要求活跃任务/病例关系与进行中任务；降低上限不自动回收。分派事务按用户 ID 顺序加行锁，再锁任务和病例，使同人跨任务并发与设置修改串行化；状态和审计同事务提交。设置操作同样复核管理员会话并记录 before/after 审计。

管理员入口使用现有 AccessTokenGuard/AdminGuard；dispatch 按 mode 在服务层区分管理员或本人领取，并在事务内再验证操作者。400 参数无效、401 会话失效、403 无权限/资格、404 目标不存在、409 状态/归属/容量冲突；审计失败则全部回滚。用户容量修改不更新账号安全版本，避免无关设置使登录失效，但仍写独立审计。接口契约先于页面/mock。

## 后续边界

五项决策均已批准，后续不重复确认。自动超时释放、资格挂起释放和审核分派尚未接入；本切片不声称完成这些功能。非空截止时间到期后立即失去分派授权，但自动回池仍待状态机实现。不得把未知字段或未实现的配置当作已生效。

## 管理员分派控制台

任务卡片增加“分派与设置”，仅进行中任务可打开。复用 `GET /api/users?page&pageSize` 的管理员分页列表（不新增读取权限），显示姓名、账号、系统资格、账号状态和人员全局上限，不展示联系方式。仅提示符合账号/系统资格的人员可选；是否有剩余额度由分派事务最终判定。自审要求双资格。

病例列表仅可选择当前任务“待分配”病例，翻页清空病例选择；刷新或成功分派也清空选择。截止时间使用本地日期时间输入并转换为带时区 ISO，初始为空，空值发送 null。提交期间锁定编辑与关闭，失败保留选择并显示服务端错误，成功提示与列表刷新错误分开处理，防止重复提交。

任务设置可修改优先级、每人每任务上限；人员列表可编辑人员全局上限。数值遵循既有 int32 契约，限额留空显式发送 null；不预填业务限额。降低限额不回收已有分派。页面增加分发模式选择、自动派单重试/续批与回收入口；不提供审核分派。

## 三种分发模式与标注领取/回收（2026-09-29 用户批准）

任务保存 `dispatch_mode: auto|manual|pool`。新建缺省 auto；管理员创建/设置时可显式选择。存量任务迁移为 manual，不主动派出既有病例；回滚前必须将所有任务显式设为 manual，防止丢失模式设置。切换只影响待分配病例，不抢占在途工作。

- 新建自动任务或保存自动任务设置后，触发一次自动分派；自动任务回收后也再次触发。自动派单失败不撤销已成功创建/设置/回收的操作，响应额外返回 `auto_dispatch: {status: "completed", ...结果}|{status:"pending"}`，pending 表示任务已保存、可重试派单，不能诱导重复创建。没有人员/容量时保留领取池，响应明确未派原因。后台持续调度、超时与资格释放在后续切片接入，不宣称已自动回收。
- `POST /api/tasks/dispatch`：manual 保留；auto 请求 `{mode:"auto",task_id?:UUID,after_case_id?:UUID}`，管理员可显式重试；不传任务时按优先级处理 auto 任务。一次最多处理 2000 个待派病例（技术批次，剩余等待后续调用），返回 assigned/unassigned 数组及 `next_case_id`（满批时为本批末例 ID，否则 null）。下次携带该 ID 续批，避免不可派前缀饿死后续病例；游标须属于当前自动任务范围，模式/优先级变化后可从头重试。按全局有效在途量、任务有效在途量、用户 ID 升序选择；病例按优先级降序、入任务时间、ID 升序；自审双资格。未知/不合格人员和满额分别返回 `no_eligible_assignee` / `capacity_full`。
- pool 请求 `{mode:"pool",task_id,case_id}`，有效账号只可为自己领取一个标注病例；不允许传承接人、角色或期限。manual 模式任务不开放领取，auto 未派与 pool 待派可领取。期限为 null（未批准默认期限）。事务内复核账号版本/资格、任务/病例归属与状态、两级容量，成功 active 标注分派、病例进入标注中，写 `tasks.claimed`。普通成员不能调用 manual/auto 或管理设置。
- `GET /api/tasks/pool` 与 `GET /api/tasks/mine`：认证后分页，参数同既有列表，可选来源/系统。池只列当前用户资格允许且未分派的 auto/pool 标注病例；我的任务只列本人仍有效的标注分派。字段限于 task_id/task_name/priority/source/system_code/review_mode/case_id/case_no/status，以及本人 assignment_id/due_at；不包含报告、临床内容或影像存储键。读取不改变状态，容量在领取事务最终裁决。
- `POST /api/tasks/reclaim`：管理员传 `{assignment_id,reason:"overdue"|"quality"}`；overdue 要求非空期限已到期。仅回收当前 active 标注分派与标注中病例，原记录变为 released，病例回待分配，写 `tasks.reclaimed`，不删除已有标注。使用分派 ID 防止旧页面回收后来改派的新记录。manual 保留待手动指派，pool 回池，auto 触发自动分派。

所有写入口按用户 ID 锁用户，再锁任务、病例、分派；同人容量和同病例争抢串行化。自动分派在一事务内锁定当前用户集合并计算有效负载；审计失败全部回滚。领取冲突返回 409、资格拒绝 403、会话失效 401，非法参数 400。自动派单与模式设置不跳过既有权限/状态检查。
