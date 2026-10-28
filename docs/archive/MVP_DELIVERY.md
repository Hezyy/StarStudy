# 星研第一阶段交付记录

版本：0.1.0。交付日期：2026-10-27（Asia/Shanghai）。

## 已完成

项目初始化与依赖锁定、Next.js App Router、React、TypeScript strict、Tailwind、Radix / shadcn 风格基础组件、Dexie、date-fns、ExcelJS、Vitest 与 Playwright。无外部 API 与账号依赖。

统一品牌和图标；桌面与移动导航；本地数据库及迁移；今日真实指标、任务 CRUD、笔记、网课、状态与计时；日周月历和列表；手动日期变更预览、拆分及审计；设置、科目切换、Excel 导入、完整 JSON 备份恢复、恢复前快照与事务保护；生产离线缓存及更新提示。

## 主要新增文件

| 文件组                                                               | 作用                                             |
| -------------------------------------------------------------------- | ------------------------------------------------ |
| package.json、package-lock.json、tsconfig.json、next.config.ts       | 可复现依赖、严格类型、静态导出                   |
| src/app/**                                                           | 7 条中文产品路由、错误页、品牌元数据、响应式样式 |
| src/components/**                                                    | 数据订阅、主题、响应式壳层、反馈、PWA 与基础 UI  |
| src/features/today/**、tasks/**、plan/**                             | 每日任务、编辑器、计时条与日历 / 调整预览        |
| src/features/import/**、backup/**、settings/**                       | 数据导入、恢复预览及个人偏好                     |
| src/db/index.ts、src/types/index.ts、src/schemas/index.ts            | 13 类核心实体、索引、v1→v2 迁移及输入校验        |
| src/services/tasks.ts、timer.ts、statistics.ts、settings.ts          | 独立业务规则和实际时间归属                       |
| src/services/excel.ts、backup.ts                                     | 解析、去重、原始内容、结构与关联验证、事务恢复   |
| src/scheduler/README.md                                              | 二期排期边界与安全撤销约束                       |
| public/manifest.webmanifest、public/icons/**、public/favicon.ico     | PWA 与原创统一图标                               |
| scripts/icons.mjs、precache.mjs、serve.mjs                           | 图标生成、版本预缓存和静态服务                   |
| tests/unit/**、tests/e2e/**、vitest.config.mts、playwright.config.ts | 逻辑、迁移和浏览器验收                           |
| README.md、docs/**                                                   | 运行、数据库、导入、备份、测试、限制和路线图     |

构建产物 `out/`、依赖目录、本地浏览器、缓存和测试结果不纳入源代码。没有提交用户学习数据，也没有创建示例学习记录。既有 Git 元数据保留，未创建远程仓库或推送。

## 验证与问题

确切命令、测试数量、浏览器覆盖及真实 iPhone 未测事项见 `TEST_REPORT.md`。当前限制见 `KNOWN_ISSUES.md`。

## 下一阶段

先验收用户提供的原始 Excel 与日常使用，再按 `ROADMAP.md` 实现知识点、资料、错题、周复盘、统计、纯函数排期和安全撤销。本地 MVP 的学习记录必须可迁移，不得因为加入新模块清空数据库。
