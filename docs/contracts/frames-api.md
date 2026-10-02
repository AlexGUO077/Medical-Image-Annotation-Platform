# 帧服务接口

依据源 Word §5.2、§7.3、§8.4，基线 WP-07 / S6 / SG-4，以及已批准 D-24/D-25。仅合成开发验证；本实现和 PR 不替代 SG-4 人工验收。

- `POST /api/frames/ticket`：Bearer 认证，JSON `{case_id,series_uid,frame_index,window?:{center,width}|null}`；frame_index 为序列内从 0 开始的平铺帧索引，拒绝未知字段/越界。省略 window 使用序列已保存默认窗，null 使用渲染器默认窗。数据库从 case→study→series 验证活跃归属；只允许当前有效标注/审核分派，管理员也不能绕过分派。检索库访问随发布/检索切片接入，当前不开放。
- 返回 `{url,expires_in:300}`；票据绑定当前用户、Bearer 会话、病例、序列、帧号及窗。票据不包含 Orthanc 地址/ID 或影像数据。
- `GET /api/frames/{token}`：必须携带签发时相同 Bearer；拒绝 query 改参。验签后复核实时权限、限流及资源归属，通过后仅返回带当前账号、姓名、响应时间水印的 PNG。渲染缓存 TTL=1800 秒、不含用户水印；缓存命中也复核权限、重新加水印并写全量帧审计。
- Orthanc 序列映射由服务器读取，核对 SeriesInstanceUID、实例归属和帧总数，严格解析固定帧路径再调用单帧 rendered API；不转发任意 URL、原始 DICOM、序列包或可拼接像素分片。
- 两条路由均 `Cache-Control: no-store, private`、`Referrer-Policy: no-referrer`；响应无存储键/上游错误/凭据。输出前审计失败、权限失效、水印失败、Redis/Orthanc 不可用时不输出影像。

## 配置与验证

`FRAME_TOKEN_SECRET` 必须独立于 JWT_SECRET，至少 32 字节。`FRAME_RATE_WINDOW_SECONDS` 与 `FRAME_RATE_CR/DX/CT/MR/US` 显式配置正整数，CT/MR 各自必须大于 CR/DX；没有默认阈值，无效配置不开放帧接口。按用户+病例+账号版本+模态计数，ticket/read 分开预算、使用相同配置，避免取帧重放绕过；Redis INCR 与首次过期原子执行，窗口从首次计数开始。

用户于 2026-09-30 批准复用账号停用/启用：超限事务停用账号并递增安全版本，释放失效在途标注，写 frames.locked 审计（触发请求的真实用户）及不含业务数据的服务告警，提交后返回 429。审计失败不输出帧，下次重试锁定事务。管理员使用既有 PATCH /api/users 启用并写 users.updated 审计；用户必须重新登录，新账号版本重新计数，不恢复历史分派。人工停用和异常停用均不自动解锁。

审计 frames.ticket_issued / frames.viewed 记录真实用户、病例、序列 UID、帧索引、窗、模态、IP、时间；不存 token、凭据或影像。重复取帧在有效会话/票据期间允许，但每次计数与审计；跨用户/会话、改参、过期或分派失效拒绝。

映射调用采用部署版本已验证的 [Orthanc REST API](https://orthanc.uclouvain.be/book/users/rest-cheatsheet.html) `/series/{id}/ordered-slices`；上游将该接口标为 deprecated，升级 Orthanc 时需复核映射契约，不以任意实例排序替代。

## 工作台坐标与标定

授权帧 PNG 响应增加 `X-Frame-Geometry` JSON 头：`width/height` 为原 DICOM Columns/Rows，`row_spacing/column_spacing` 为毫米像素间距或 null。取值仅来自已授权实例的尺寸与 PixelSpacing（优先逐帧，其次共享功能组，再顶层），不向浏览器暴露完整标签、实例存储标识或患者信息。参考 [Orthanc 标签接口](https://orthanc.uclouvain.be/book/users/rest.html)。

输出必须在现有帧资格、票据、限流、水印、审计及输出前再次校验边界内完成；PNG 尺寸与 DICOM 不一致则失败，不猜测缩放比例。缺少有效 PixelSpacing 时禁用毫米画笔及物理测量，不用 ImagerPixelSpacing 或 1mm 冒充标定。普通点、框、多边形仍使用原图像素坐标。保存服务按授权病例与序列重新核验几何范围/掩膜尺寸，不信任客户端头副本。

客户端仅保留一个相邻帧的已水印 PNG 预加载结果在内存；消费前重新申请票据，实时复核账号/分派和限流，失败不显示该预取帧。退出工作台、病例切换或登出取消预加载并清除引用；不写 CacheStorage、IndexedDB 或浏览器磁盘缓存。300 帧客户端合成测试不代替真实部署链路或 SG-4 人工验收。

## 本地真实链路验收

`npm run test:m2:browser --workspace server` 使用真实本机 PostgreSQL/Redis/Orthanc/MinIO、Nest HTTP、Vite 代理和 Chrome；仅初始化页面会话，业务 API 不做 mock。依赖显式提供 `MIAP_ENV_FILE`（库名须含 synthetic）、`MIAP_PYTHON`（已有 pydicom/numpy 环境）、`MIAP_PLAYWRIGHT_MODULE` 和 `MIAP_CHROME_EXECUTABLE`。可选 `MIAP_M2_ARTIFACT_DIR` 仅保存合成界面截图，不写 HAR、Bearer 或签名 URL。设置 `MIAP_M2_WAIT_EXPIRY=1` 时实际等待票据到期，验证旧票据 403、相同账号和分派下新票据仍可取帧；常规运行不重复这段等待。

脚本临时生成 512×512 DX 与 300 层 CT，使用独立 schema、随机会话密钥及明确测试限流预算；结束清理本次 schema、影像、Redis 键和临时文件，不修改已有开发数据或部署阈值。从待分配开始经真实领取接口进入标注，覆盖附件分页水印预览、拖拽调窗、绘制、属性/报告关联、保存与提交待审核、审核分派，以及浏览器影像响应和本地存储检查；输出预加载后的翻帧实测值。附件使用即时生成的已确认合成页，清理本次 MinIO 对象，不重复 M1 的 OCR/脱敏验收。

本地核验结果见 [M2 合成验收记录](../evidence/m2-acceptance-20261002.md)。本机开发链路不等同于生产 HTTPS/Nginx 网络隔离、完整浏览器磁盘取证或 SG-4 人工放行。源 Word §9.1 将云端部署、审核台、发布与检索归入 M3；这些项目不另加为 M2 的开发前置条件，真实数据及生产条件仍保持关闭。限流使用显式测试预算，正式环境阈值另行配置。

## M2 工作台附件与拖拽调窗

依据手册 §6.2/§8.4，`GET /api/workbench/:caseId/attachments/:attachmentId/preview?page=1` 为当前合成病例标注人提供已确认附件的分页 PNG 预览。仅接受正整数页号和 page 查询字段；沿用现有对象 PNG/页清单，不提供原件、外部地址或下载入口。读取需有效账号会话、系统资格、标注分派、病例来源/脱敏确认和附件归属；输出前在同一事务重新鉴权并写 `workbench.attachment_viewed` 审计。加账号/姓名/时间水印，no-store/private、no-referrer、nosniff；失败不返回源内容。前端仅保留当前页临时 Blob URL，切换/关闭/离开页面撤销。

影像区增加“拖拽调窗”模式：横向拖动调整窗宽、纵向调整窗位，显示候选数值；松手后一次调用既有帧服务渲染，避免每个 pointermove 都请求帧。窗口仍由服务器绑定到票据，不在浏览器处理原始 DICOM；输入框、CT 预设及平移继续可用。取消拖动不应用候选值。
