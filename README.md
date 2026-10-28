# 星研 Star Study

**以星为引，逐梦研途。**

星研是一款开源、可自部署的考研学习管理 PWA。围绕「计划 → 每日任务 → 计时 → 错题复习 → 周复盘 → 调整」工作，支持个人离线使用，也可在配置 PostgreSQL 后启用独立账户与服务器同步。

当前开发版本 **0.4.0**。本次在已有本地产品与交互优化上继续升级，旧版 IndexedDB 和学习记录不会因启用账户而自动迁移或删除。许可证为 [AGPL-3.0-only](LICENSE)。[English](README_EN.md)

续开发入口：[DEVELOPMENT_PROGRESS.md](DEVELOPMENT_PROGRESS.md)，记录已完成阶段、真实测试、已知问题与接续顺序。

## 两种运行方式

| 方式           | 适合                 | 数据位置                      | 需要配置                                            |
| -------------- | -------------------- | ----------------------------- | --------------------------------------------------- |
| 个人本地模式   | 单人、离线备考       | 当前浏览器 IndexedDB          | Node.js，无需账号或付费 AI                          |
| 自部署平台模式 | 多用户、同账户跨设备 | PostgreSQL + 账户独立本机缓存 | Linux、Docker Compose、域名/HTTPS；测试可仅回环地址 |

本地数据库不是云同步。手机、电脑、不同浏览器、不同站点来源各有独立缓存；同一账户连接同一平台，才访问相同服务器数据。没有 API 密钥仍可在外部 ChatGPT、DeepSeek 等工具生成计划，再复制回来校验和导入。

## 本地快速运行

建议使用 **Node.js 24 LTS** 和 npm。精确依赖由 `package-lock.json` 锁定。

```sh
npm ci
npm run build
npm start
```

打开 [本机星研](http://localhost:3000)。默认仅监听 `127.0.0.1:3000`，退出终端后需要重新启动。`DATABASE_URL` 留空时保留个人本地模式。开发界面可使用 `npm run dev`，但 Next 开发服务器不提供本项目账户 API；账户联调应构建后使用 `npm start`。

构建生成 `out/` 静态前端和 `dist/` 服务端。只托管 `out/` 可以使用本地功能，不自动获得注册、同步、AI 或管理员 API。账号模式见 [平台配置与数据边界](docs/PLATFORM.md)。

## Linux 自部署

先准备本人控制的 Linux 服务器，在可信源码目录中安装 Docker Engine 与 Compose v2，再运行：

```sh
bash scripts/install.sh
```

安装脚本检查 Ubuntu 22.04/24.04、Debian 12/13、x86_64、资源、端口和 DNS，生成随机密钥，启动 PostgreSQL、执行迁移并验证健康检查。默认邀请注册，没有默认管理员密码。第一次访问时用安装结果给出的初始化口令创建管理员。

正式服务需要指向服务器的域名和可用的 80/443 端口，由 Caddy 提供 HTTPS。没有域名时只提供 `127.0.0.1:8080` 测试入口，不提供公网 HTTP 登录。当前开发环境没有 Docker/真实 Linux，**脚本静态检查不等于容器部署验收**。请先在空白测试机按 [部署与恢复验收](docs/DEPLOYMENT.md) 验证，再邀请朋友。ARM64 尚未验证，安装脚本会明确拒绝。

```sh
bash scripts/doctor.sh
bash scripts/backup.sh
bash scripts/update.sh vX.Y.Z
bash scripts/restore.sh /绝对路径/备份目录
bash scripts/uninstall.sh
```

`vX.Y.Z` 是用法占位符，需维护者实际发布稳定 Git 标签。默认卸载保留全部数据库卷、备份、源码与配置；`--purge` 需要两次确认并先备份。

## 页面与功能

| 页面                          | 主要功能                                                 |
| ----------------------------- | -------------------------------------------------------- |
| 今日学习 `/`                  | 数学优先任务、打卡撤销、笔记、计时和总结                 |
| 学习计划 `/plan/`             | 日/周/月/列表、任务管理、日期调整预览、拆分与预算提醒    |
| AI计划导入 `/plan/import-ai/` | 目标→提示词→粘贴/文件→校验→差异预览→确认；按月分片       |
| 学习资料 `/resources/`        | 课程、章节、进度、多资源关联；区分B站视频和搜索入口      |
| 知识点 `/knowledge/`          | 五级掌握状态、依赖关系、主动评估历史                     |
| 错题本 `/mistakes/`           | 文字与图片、答案/解析、到期复习、历史、归档与转任务      |
| 每周复盘 `/reviews/`          | 真实记录、困难和考试安排、下周预算、历史与导出           |
| 学习统计 `/analytics/`        | 日/周/月时长、分布、计划差异、掌握度、7/30天报告         |
| 动态排期 `/planner/`          | 预算、知识依赖、缺口、确认调整、版本比较和安全撤销       |
| ChatGPT协作 `/collaboration/` | 可选范围学习报告、已有任务调整协议、导入校验             |
| AI与同步 `/integrations/`     | 平台AI、短期会话密钥、调用记录；本地模式保留旧连接入口   |
| 个人设置 `/settings/`         | 目标、科目、预算、主题、Excel、备份、恢复和安装          |
| 账户配置 `/account/`          | 账户资料、自定义科目、基础、旧版本机迁移、密码管理与删除 |
| 服务管理 `/admin/`            | 管理员邀请、注册模式、账户状态、AI限额、脱敏元数据       |

中文界面，电脑侧栏、手机底栏，支持浅色/深色与减少动态效果。已有设计见 [体验升级](docs/UX_UPGRADE.md) 与 [设计系统](docs/DESIGN_SYSTEM.md)。

## 导入、计划和备份

- 排期读取真实预算、优先级、进度与显式知识依赖；重要调整先预览，本人确认后应用。
- [StarStudy Plan Schema v1.0.0](docs/AI_PLAN_IMPORT.md) 使用外部引用标识，平台由服务端生成内部 UUID。JSON、JSON代码块、CSV/Markdown表格可确定性解析；任意自然语言需要已配置AI，结果仍须校验。
- 原有 [Excel导入](docs/EXCEL_IMPORT.md) 支持 `.xlsx`、多表、列映射、原始字段和去重。私人原件放在被忽略的 `imports/`，不随开源仓库分发。
- 学习记录和已完成任务受保护；范围替换只处理可安全替换的未完成任务。超预算、引用丢失、依赖冲突会显示出来，不能为了完成率丢弃内容。
- [JSON备份](docs/BACKUP.md) 含核心关联、计时、图片、资源、复盘、设置和版本。恢复前校验、预览并保留快照。浏览器清理或设备故障仍可能丢失数据，应定期下载并异机保存。
- 服务器备份含 PostgreSQL（图片存于其中）、必要配置、版本信息和可选旧上传目录。备份含敏感信息，默认在非Web目录且权限受限；应加密异机保存，不能提交GitHub。
- 同步采用完整快照与版本冲突检查，**不会自动合并两台设备彼此冲突的修改**。发生冲突先导出本机副本，再明确选择服务器版本。应用关闭后的持续后台同步尚未实现。

## AI 与资源边界

DeepSeek 为独立服务端 Provider，可选服务器密钥或15分钟、当前登录会话专用的内存 BYOK。密钥不写入数据库、浏览器存储或日志；重启、会话失效后需重新输入。管理员可关闭AI，设置频率与每日额度；调用超时会终止，费用按配置单价估算，不是账单。

没有真实密钥时不会伪造AI回复。AI只接收用户明确选择发送的内容，结果不会自行修改学习记录。B站链接只做浏览器跳转，不下载、托管视频或绕过访问限制。

## PWA 与设备

第一次联网打开生产应用并等待缓存准备后，可离线打开界面、创建/修改本地任务、打卡。更新由用户确认，不在编辑时强制刷新。

- PC：Chrome/Edge安装应用，或直接在浏览器使用。
- iPhone：HTTPS下用Safari打开，选择「分享→添加到主屏幕」。
- Android：HTTPS下用Chrome打开，在菜单中安装。

真实 iPhone/Android、系统级安装与后台行为需要实机验收，桌面模拟不能替代。见 [设备与离线手动验收](docs/DEPLOYMENT.md#设备与离线手动验收)。

## 开发与测试

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run security:check
npx playwright install chromium webkit
npm run test:e2e
npm run test:e2e:platform
```

账户 API 单元测试默认使用 PGlite 嵌入式 PostgreSQL 引擎，不是Docker/网络PostgreSQL实测。可在**专用空测试库**设置 `TEST_POSTGRES_URL` 并运行 `npm run test:postgres`；不得指向生产或个人数据库。最终结果以实际运行记录为准，历史 [0.3.0测试报告](docs/TEST_REPORT.md) 不能替代本轮验收。

浏览器测试使用隔离上下文，产物在被忽略的 `test-results/`、`playwright-report/`。私人Excel原件用例仅在显式设置 `STAR_STUDY_SOURCE_XLSX` 后运行。

## 文档与开源

- [平台配置、数据库与权限](docs/PLATFORM.md)
- [0.4.0交付与真实测试结果](docs/PLATFORM_DELIVERY.md)
- [Linux部署、备份、恢复、更新和验收](docs/DEPLOYMENT.md)
- [新计划协议、提示词与分片导入](docs/AI_PLAN_IMPORT.md)
- [GitHub创建仓库与首次推送](docs/GITHUB_RELEASE.md)
- [数据库](docs/DATABASE.md) · [排期](docs/SCHEDULER.md) · [Excel](docs/EXCEL_IMPORT.md) · [备份](docs/BACKUP.md)
- [贡献](CONTRIBUTING.md) · [安全报告](SECURITY.md) · [行为准则](CODE_OF_CONDUCT.md) · [变更](CHANGELOG.md)

本项目尚未替用户创建远程仓库、推送源码或部署公网服务。公开前须检查隐私与密钥，并为实际部署提供对应版本源码入口。第三方依赖和课程资料仍遵循各自许可证与权利要求。
