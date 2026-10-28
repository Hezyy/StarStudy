# 星研0.4.0平台交付与验收

日期：2026-10-28（Asia/Shanghai）。在现有仓库继续开发，由主代理整合3个原生子代理的后端安全、账户前端、部署文档成果；未重建项目，未创建远程仓库或推送，未公开部署。

## 项目保护

- 升级前基线：55项单元测试通过；原有浏览器回归98项通过、6项预定跳过。
- 通过原应用界面下载真实浏览器完整JSON并验证：1份个人资料、1份目标、4科目、1份设置，任务/计时/错题均为0。已保存到私有忽略目录backups；源码另有升级前压缩包，不能混称数据库备份。
- 本地保存0.3.0基线提交d5e8335，在codex/open-platform分支开发，无远程仓库。
- 私人Excel、浏览器缓存、环境变量、数据库、上传和备份均排除版本控制。原版star-study数据库保留，账户采用独立数据库名。
- 用户选择AGPL-3.0-only，完整LICENSE已写入；构建自动提供实际版本的对应源码下载，源码包采用白名单且不含私有数据和Git历史。

## 已实现且已测试

- 账户：首次管理员安全初始化、邀请/公开注册配置、登录退出、scrypt密码哈希、修改密码、资料导出、确认删除、最后管理员保护、禁用撤销会话与普通用户权限隔离。
- 数据：PostgreSQL/Drizzle版本迁移、owner_id归属、事务、版本CAS；离线账户缓存、重连同步、双设备冲突提示与保留本机、恢复前快照、确认恢复、丢失同步光标修复、计时片段防覆盖。
- 计划：/plan/import-ai分步向导、提示词、Schema1.0.0、JSON/单个Markdown JSON块/CSV/Markdown表格、复用Excel多表映射；安全URL、引用、日期、预算、依赖、重复与同ID变化检查；预览确认、3种导入模式、401天分片去重、服务端内部UUID、历史版本。
- 课程：B站精确视频/搜索区分、选集参数、安全链接、多个任务关联、观看标记、行内修改链接，保留人工核实状态。
- AI接口：独立Provider、管理员开关、用户额度和频率、超时与响应大小限制、用量估算、会话BYOK15分钟、无密钥与错误反馈、非法输出不写学习表。测试使用假传输，未调用服务商。
- UI与PWA：保持原版交互和计时局部刷新，新增账户引导、真实表单反馈和移动布局；原有任务、错题图片、复盘、统计、Excel、排期、安全撤销、备份和离线全部回归。

## 实际测试记录

主要实现位置如下，完整文件差异保存在本地Git提交中：

| 位置 | 内容 |
| --- | --- |
| `server/`、`server/migrations/` | 认证、权限隔离、数据版本、事务、AI服务与数据库迁移 |
| `src/features/platform/`、`src/app/account/`、`src/app/admin/` | 账户、新手引导、后台、同步与真实操作反馈 |
| `src/schemas/study-plan.ts`、`src/services/study-plan.ts`、`src/services/plan-tables.ts` | 标准计划协议、确定性解析、去重与预览确认 |
| `src/lib/video-link.ts`、`src/features/tasks/task-resources.tsx` | 资源链接分类、选集、安全跳转与观看记录 |
| `src/services/excel.ts`、`src/services/xlsx-xml.ts`、任务类型/表单/详情 | Excel兼容、长说明持久化与展示 |
| `Dockerfile`、`compose.yaml`、`Caddyfile`、`scripts/`、`.github/workflows/ci.yml` | 部署、备份恢复、对应源码、发布准备与CI |
| `tests/unit/`、`tests/e2e/`、`tests/platform-e2e/` | 本地功能、权限/事务、跨设备、离线和交互回归 |

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| Vitest | 93通过，0失败，0跳过；18个文件 | 数据库/图片、任务计时、Excel原件、备份恢复、排期、AI导入、PG引擎权限/事务/持久化、AI假传输与额度、独立发布历史 |
| 原有Playwright回归 | 98通过、6跳过、0失败，共104组合 | 1440px桌面、375px手机Chromium、768px平板、375px Windows WebKit |
| 新平台Playwright | 32通过、0失败、0跳过、0 flaky | 注册重试与真实Cookie、账户权限、AI加载/未配置、导入确认、第二会话读取、离线、恢复、同步并发确认、光标恢复、账户筛选隔离；三种宽度及Windows WebKit |
| 追加定向浏览器 | 长说明4通过；新夹具下WebKit24通过、2个预定跳过 | 编辑/展示/刷新保留；夹具变更影响复验，不重复累加到上述总数 |
| TypeScript strict | 通过 | 全项目 |
| ESLint | 0错误、0警告 | 已整理Hook依赖及未使用导入；账户异步逻辑保持数据库作用域 |
| 生产构建 | 通过 | 静态out及打包服务端dist；本机Node26.7，Docker目标Node24尚未实跑 |
| npm audit | 0项告警 | 本轮完整依赖审计及生产依赖审计 |
| 发布前扫描 | 通过 | 私有目录、密钥格式；白名单源码包未含私有目录，不能代替人工审查 |
| Shell / YAML | 语法和静态隔离约束通过 | 非真实Docker运行 |
| 部署脚本流程 | 隔离mock通过 | 取消、校验、事务参数和默认不删卷；不等同真实数据库恢复 |

6项跳过为：3个重复的持久化上下文重开用例只在桌面执行；3个原生拖动用例只在桌面执行，其他端验证修改日期替代路径。真实私人Excel仅在显式STAR_STUDY_SOURCE_XLSX测试环境中读取，未进入源码。

Windows Playwright WebKit需要每例独立的持久化资料目录以保存Blob；另通过最小HTTP实验定位到WinCairo在含中文资料路径下丢弃Cookie的测试环境限制。夹具使用输出目录下的ASCII哈希子目录，第二设备通过真实登录建立会话，没有注入或伪造登录Cookie。Windows测试输出目录的祖先路径也应使用ASCII；可通过`--output C:/temp/star-study-tests`指定。此限制不能推定为真实iPhone Safari行为。

本轮修复包括：新用户空专业阻止保存、登录广播触发本页重载、重连等待轮询、丢失同步游标无法恢复、下载时并发编辑保护、账号切换在途请求误用全局DB、同外部ID内容变化被跳过、跨科目关联、邀请消费复活、跨账户筛选串用、AI个人开关跨标签页不同步、超限请求中断keep-alive连接，以及带命名空间前缀的Excel流式解析等待。长任务说明新增独立字段，不再受章节500字限制。

同步还修复了后台请求会吞掉已确认的手动拉取问题：手动操作现在串行排队并保持按钮加载，等待期间发生新编辑时拒绝覆盖并要求重新确认。以真实响应闸门验证该竞态和后续重新确认；失败批次不计为通过。最终记录见[续开发进度](../DEVELOPMENT_PROGRESS.md)。

## 已实现但尚未完整验证

Docker镜像构建、Compose安装、真实网络PostgreSQL、容器重启与升级、真实pg_dump/pg_restore、Caddy证书、GitHub Actions、iPhone/Android系统安装与后台生命周期。本机没有Docker/原生PG/生产域名/真实设备，不从嵌入式或mock测试推定成功。网络PG测试命令在缺少TEST_POSTGRES_URL时明确拒绝运行，CI已配置独立star_study_test库。

## 需要外部配置

服务器与域名、HTTPS、真实PostgreSQL和随机会话/初始化密钥；可选DeepSeek API Key及模型，或OpenAI Key与显式模型配置。未配置AI仍可通过外部工具生成计划后导入。首次公开注册、GitHub建库/推送须由用户决定。

## 尚未实现

逐条增量同步与自动冲突合并、持久化加密BYOK、邮箱验证/邮件找回、OAuth、关闭应用后的持续同步/Web Push、多实例共享限流和迁移锁、ARM64部署支持（脚本目前明确拒绝未验证架构）。

## 使用与发布

本地：npm ci → npm run build → npm start，打开http://localhost:3000；DATABASE_URL空值保留原本地模式。

平台：在本人Linux服务器安装Docker/Compose，运行bash scripts/install.sh；根据向导设置域名/HTTPS，使用随机初始化口令创建管理员，默认邀请注册。

- [完整README](../README.md)
- [平台配置与数据归属](PLATFORM.md)
- [Linux部署、真实恢复演练与实机验收](DEPLOYMENT.md)
- [AI计划协议与分片教程](AI_PLAN_IMPORT.md)
- [GitHub建库和首次推送教程](GITHUB_RELEASE.md)
- [已知问题](KNOWN_ISSUES.md) · [后续路线](ROADMAP.md)

所有个人数据只用于当前私有本机；没有向AI服务商发送真实笔记/图片，没有创建或公开远程仓库，没有删除真实学习数据。
