# D-39 Node.js 24 运行时决策

## 状态

已批准，2026-09-20 生效；取代 D-38 的 Node.js 20 决定。

## 决策

后端和前端构建运行时统一固定为 Node.js `24.14.0`，npm 固定在 11.x。`.nvmrc`、根 `package.json`、本地运行时校验和 GitHub Actions 使用同一版本。

## 依据

- 郝鹏翼老师确认项目可以改用 Node.js 24，用户要求后续开发及源开发手册统一采用 Node.js 24；
- 源 Word 中 3 处 Node.js 版本要求已由 Node 20 更新为 Node 24；
- [Node.js 官方发布页](https://nodejs.org/en/about/previous-releases)将 Node.js 24 列为 LTS，而 Node.js 20 已结束维护；
- 当前 NestJS 11、Vite 7、TypeScript 5、Vitest 3 和 TypeORM 1 依赖范围均兼容 Node.js `24.14.0`。

## 强制控制

1. 开发、测试和 CI 使用完全相同的 Node.js `24.14.0`；
2. 已兼容 Node.js 24 的业务代码和依赖不因本决策额外重写；只有运行时门禁、文档或实测冲突才修改；
3. 每次 PR 继续执行依赖、代码、秘密、文件系统、配置和容器镜像扫描；运行时升级不豁免严重或高危问题；
4. 后续升级 Node.js 补丁或主版本须同步更新源手册、决策、`.nvmrc`、包引擎、CI 和验证证据。

## 历史决定

[D-38](D-38-node20-runtime.md)保留为 2026-09-18 至 2026-09-20 的历史记录，不再作为当前运行时要求。
