# 工作台读取与本地阅片切片

源手册 §5.2/§6.2、基线 WP-08/S7，UI §7～§9。基于尚待远端验证的 PR #40 本地开发，不放行 SG-4。此切片仅允许 synthetic 病例；真实/教学影像仍须完成帧安全门验收。

`GET /api/workbench/{caseId}` 必须认证且持有当前有效标注分派，管理员无旁路。与释放共享用户行锁，复核会话版本、资格、期限、任务和病例状态，确认脱敏入库审计。返回最小病例字段（id/case_no/source/system_code/status/clinical_text/age_band/sex/confirm_method）、按 idx 排序的只读报告句、附件 id/filename/kind、序列 id/series_uid/modality/frame_count/default_window。禁止返回 Orthanc ID、对象键、脱敏映射和原始 DICOM；写 workbench.viewed 审计后返回，失败无业务内容。Cache-Control 为 no-store, private。

本地骨架提供三区布局、报告/临床/附件清单、序列切换、逐帧导航、服务端窗宽窗位与 Cornerstone3D 缩放/平移。自定义 loader 仅请求既有票据/PNG 接口，拒绝非同源固定帧 URL、重定向和非 PNG，Bearer 不放入 URL。切换病例/序列/窗口、权限错误、登出或卸载时取消请求并销毁视口和该帧内存缓存；迟到响应不能恢复旧图。像素只在内存解码，不用持久存储。

当前不预取相邻帧、不支持标注写入/测量/审核/提交，不宣称完成 WP-08 或 ≤200ms 翻帧验收；避免在尚无已批准物理像素间距时伪造毫米测量。标注版本、代表帧、部位和“报告未提及”随 D-05～D-08 确认后接入。

本地浏览器回归：先在 `web-anno` 启动 Vite（示例端口 5179），再从仓库根运行 `node web-anno/test/workbench.browser.cjs`。脚本使用合成 HTTP 响应，覆盖实际 GPU 像素、RGB 条纹、切帧、专注模式不重取、错误清图/清缓存和登出；不替代真实后端集成或 SG-4。可用 `MIAP_PLAYWRIGHT_MODULE` 指向外部已安装 Playwright，`MIAP_CHROME_EXECUTABLE` 指向本机 Chrome，`MIAP_BROWSER_BASE_URL` 指定本地 Vite 地址；截图输出到独立临时目录。该可选本地回归不新增 Actions 作业或自动下载浏览器。
