# 学生教学接口（第一版）

依据 D-46 与学生功能手册，2026-10-27 用户授权按手册实施。采用手册推荐的管理员组织、预录学号+一次性激活码、一次提交、病例多序列、同应用独立入口方案。首版只对照，不评分。器官使用对象级文字，部位使用现有二级字典，2026-11-12 修订后，学生题限定为有病灶的病例。

学生身份仅可调用 education、education 激活、认证改密和具有 education 绑定的 frames；生产接口由 AccessTokenGuard 拒绝。每次读写仍检查当前账号、updated_at、任务状态、学生分配及病例脱敏/来源/下线状态。学生响应禁止包含临床、疾病标签、参考报告或标准标注，反馈接口例外且要求已提交。响应 no-store。

## 路径

- `POST /api/education/activate`：公开激活入口，student_no/activation_code/password。学号5次/15分钟、共享网络1000次/15分钟限流；名册行锁；一次性散列验证；登录名为 student_no。返回 username，随后正常登录。密码沿既有至少12位字母数字规则。
- `GET/POST /api/education/roster`：管理员分页名册/预录身份（student_no/real_name/class_name/expire_at）；创建仅一次返回 activation_code，7天有效，不记日志。`POST /roster/:id/activation` 管理员重新签发未激活身份的激活码；已激活身份使用现有改密接口。忘记密码管理员重置不纳入首版。
- `GET /api/education/candidates`：管理员分页选择已确认脱敏、有报告和序列的 synthetic/teacher_provided_teaching 病例。
- `POST /api/education/tasks`：管理员 title/instructions/case_ids/roster_ids/reference_sections。每个所选病例提供一个 {case_id, findings, impression}，两项须为各自的非空脱敏原文摘录。服务端在事务内核对摘录并冻结全文、所见、诊断及可用标准几何。组织人员在现有管理员病例报告接口核对原文和病灶后发布。
- `GET /api/education/tasks`：学生本人获准任务及每题作答状态；管理员组织任务。
- `PATCH /api/education/tasks/:id`：管理员 status=closed/revoked。closed 禁止新作答与编辑，允许已提交反馈；revoked 拒绝全部学生访问。
- `GET /api/education/tasks/:id/submissions`：管理员统一管理任务的学生提交，按 page 分页，每页50条；返回作答内容，不提供改写入口。
- `POST /api/education/items/:id/attempts`：学生创建或取得本人唯一作答。
- `GET /api/education/attempts/:id/workbench`：学生白名单题面、序列、本人答案/版本/状态及全量通用部位/征象选项，不按正确系统过滤。
- `PUT /api/education/attempts/:id/draft`：expected_version/answer；原子更新全部对象与文字；409 冲突；2MB文档、200对象、每字段上限，现有几何解析及序列/帧/坐标验证。
- `POST /api/education/attempts/:id/submit`：expected_version；确认已保存版本、必填项，提交锁定；重复提交同版返回原结果。
- `GET /api/education/attempts/:id/feedback`：本人已提交，返回学生快照及 reference（report 全文、findings 医生所见、impression 医生诊断、annotations、part_names、version）。历史冻结参考可仅有全文与既有标准字段。详细临床与附件始终不开放。

answer={body_part_id:null|uuid,findings:string,impression:string,objects:[{...Annotation,organ:string,description:string}]}。学生对象 report_sent_ids 固定空；不调用生产报告关联提交。提交需部位、影像所见、诊断意见和 1–200 个病灶；每个病灶都须填写器官 / 位置和描述。空对象草稿可保存。旧客户端传入的布尔 normal 字段在保存时忽略，不能用于零对象提交。历史已提交答案保留原貌。

教学答卷的点工具以一个病灶 ID 保存一组独立点。首点沿用代表帧的 `geometry.x/y`，其余点存为可选的 `geometry.additional_points: [{frame_index,x,y}]`。每个点均须位于同一授权序列、对象帧范围及该帧像素边界内。多点只在各自落点的帧上显示，依原有单点格式保存的范围仍按原方式显示。草稿、提交快照及对照读取同一份坐标。生产标注的点接口仍使用原有单点契约。

帧 POST /frames/ticket 新增 access_mode=education,attempt_id；票据签名绑定 attempt。签发和输出前重复校验本人/学生关系/题目/序列范围/病例/任务。student 使用工作或 library 模式拒绝。反馈只复用本人影像授权，不开放原始 DICOM。

迁移含 education_roster/tasks/items/students/attempts，旧表只扩展 student role 及空 quals 约束。提交后数据库触发器拒绝更新/删除。down 存在任何教学数据时拒绝，防丢答案。生产 cases.annotation_version/status 不被教育服务更新。
