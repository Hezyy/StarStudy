# 星研平台配置与数据边界

本文对应0.4.x开发版本。原有本地功能不要求服务器；平台功能要求真实PostgreSQL和安全的账户服务，不是把本地数据自动暴露给所有人。

## 运行入口

`npm run build`生成前端`out/`和服务端`dist/`，`npm start`启动同源静态站点及API。`DATABASE_URL`留空时为个人本地模式；Next开发服务器只负责界面，不替代本项目账户API。

本地账户联调示例（所有值必须自行生成，不能照搬为公开凭证）：

```sh
export DATABASE_URL='postgres://本人用户:本人随机密码@127.0.0.1:5432/star_study'
export PUBLIC_URL='http://127.0.0.1:3000'
export ALLOW_INSECURE_LOCAL=1
export SESSION_SECRET="$(openssl rand -hex 48)"
export SETUP_TOKEN="$(openssl rand -hex 32)"
npm run build
npm start
```

服务支持读取项目内`.env.local`，Compose生产配置使用`.env`注入。生产`PUBLIC_URL`必须为HTTPS。不要把用户密码/API密钥放URL或命令历史；上方连接串仅说明结构，正式配置写入权限受限的文件。服务器使用[统一管理菜单](DEPLOYMENT.md)，自动准备依赖并生成必要随机值，无需手动编辑环境配置。

新安装使用随机端口与访问前缀。`APP_BASE_PATH`与构建时`NEXT_PUBLIC_BASE_PATH`必须一致；Compose自动传入。`PUBLIC_URL`包括协议、域名、实际端口及前缀，来源校验仍使用其origin；Cookie、API和PWA限定在相同前缀。旧根路径模式保持兼容。不要通过修改代理隐藏前缀，或把真实随机路径写入公开文档。

## 主要配置

| 配置                                                     | 作用                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------- |
| DATABASE_URL                                             | PostgreSQL连接串；空值保留个人本地模式                                 |
| PUBLIC_URL                                               | 浏览器访问的准确来源，用于来源校验和安全Cookie                         |
| SESSION_SECRET                                           | 至少32字符随机值，用于会话相关安全校验                                 |
| SETUP_TOKEN                                              | 随机首次初始化口令；管理员建立后不能重放                               |
| INITIAL_REGISTRATION                                     | 首次初始化时invite或显式public，之后由管理员设置                       |
| ALLOW_INSECURE_LOCAL                                     | 只允许localhost/127.0.0.1等回环测试HTTP                                |
| DEEPSEEK_API_KEY / DEEPSEEK_MODEL                        | 可选服务端DeepSeek密钥/模型                                            |
| OPENAI_API_KEY / OPENAI_CHAT_MODEL                       | 可选其他Provider的密钥/模型                                            |
| AI_TIMEOUT_MS                                            | 模型请求超时，默认45000毫秒                                            |
| AI_INPUT_PRICE_PER_MILLION / AI_OUTPUT_PRICE_PER_MILLION | 自选货币/百万tokens估算单价，空值不提供费用估值                        |
| LAST_BACKUP_AT                                           | 旧部署可选备份元数据；统一脚本改用私有备份状态文件，后台不是实时备份监控 |
| APP_BASE_PATH / NEXT_PUBLIC_BASE_PATH | 运行与构建路径；新服务器首次生成后保留，空值保留根路径模式 |
| HTTPS_PORT / HTTP_PORT | 宿主实际HTTPS端口 / HTTP-01的80端口 |
| INSTALL_ID / COMPOSE_PROJECT_NAME | 持久安装身份及资源归属，不能改成其他项目的名称 |

真实值不得提交Git，不使用`NEXT_PUBLIC_`前缀。`.env.example`仅说明格式。旧版Supabase连接属于兼容入口，不等同于当前内置平台；不要同时把同一缓存连接两套服务器同步。

## 数据模型

服务端采用PostgreSQL、Drizzle Schema与版本化SQL迁移。核心表：

| 表                | 内容与归属                                                |
| ----------------- | --------------------------------------------------------- |
| users             | 账户邮箱、昵称、密码哈希、角色、禁用/引导状态             |
| auth_sessions     | 会话令牌哈希、owner_id、到期时间；不保存原始令牌          |
| invitations       | 邀请码哈希、创建者、有效期与一次性消费状态                |
| platform_settings | 注册模式、AI开关与限额等部署级设置                        |
| data_versions     | 每个owner_id的同步版本及更新时间                          |
| study_records     | owner_id + kind + UUID复合主键，JSONB保存原有13类核心实体 |
| recovery_copies   | 每用户的恢复前完整快照，保留近期副本                      |
| ai_usage          | owner_id、用途、状态、token及估算，不存密钥/请求正文      |
| audit_events      | 管理员等必要脱敏操作元数据                                |

核心学习实体仍包括个人资料、目标、科目、知识点、资源、任务、关联、计时、错题、复习、周复盘、版本及设置。错题图片在浏览器中为Blob，传输/数据库快照中为带MIME的base64，不是临时图片URL。服务端采用按用户隔离的完整快照，尚未拆成所有实体独立REST接口。

SQL参数由Drizzle绑定。API从已认证会话取得owner_id，不能通过请求参数选择另一个用户。普通用户不能访问管理员API；账户切换标识不匹配会拒绝写入，避免另一标签页切换账号后把旧缓存上传到新账户。

密码使用带随机salt的scrypt，Cookie为HttpOnly、SameSite=Lax，HTTPS下启用Secure。修改请求检查准确Origin与会话CSRF。注册默认邀请，首位管理员需初始化口令；最后一位可用管理员受到保护。Cookie和CSRF不是磁盘加密，服务端/数据库拥有者仍拥有基础设施权限。

## 离线缓存与冲突

- 原版个人数据库仍为`star-study`，不会自动迁移或删除。
- 账户缓存采用`star-study-account-<账户UUID>`，不同账户分别打开自己的数据库。
- 初次登录需要联网认证并读取服务器数据；离线只能重新打开已登录缓存，不允许新建离线身份。
- 同步按完整快照和版本检查执行。单设备修改可上传；服务器变化且本机没有未上传修改时可拉取。
- 两边都改动时停止覆盖，保留本机内容，提供导出与明确选择服务器版本。恢复前保留快照。
- 本机计时或任务有未上传修改时不会直接拉取覆盖；未改动的同一计时允许服务器暂停/结束状态收敛，已封闭片段不能改变。两端都修改时需先处理冲突。
- 应用关闭后的持续后台同步、逐条自动合并和多人协同编辑尚未实现。退出账户并不等同于擦除浏览器磁盘缓存。

在「账户与配置」预览本机旧版数据，再确认迁移到空账户；已有学习记录的账户需要先备份、检查冲突，不会静默替换。其他设备通过完整JSON备份迁移。来源改变（域名、协议、端口）会得到另一份浏览器缓存，先导出再迁移。

## 管理与AI

管理员页面显示账户、角色/禁用状态、注册模式、邀请、版本、数据库/备份元数据及脱敏调用统计，不提供浏览私人笔记、错题或AI对话入口。基础设施管理权限必须另行保护。

AI默认关闭，管理员开启后仍需配置密钥。BYOK仅保存在服务端内存，绑定当前登录会话，15分钟有效；不落数据库或浏览器存储。重启、删除密钥、退出登录或到期后需重新提供。调用受每用户频率/每日次数/token预算约束，失败调用保留额度预留以避免绕过。费用只是按配置单价估算，并非服务商账单。

使用者点击发送前应确认内容；服务只发送明确填写的文本，不自动带全部笔记和图片。计划生成/转换结果还需通过标准协议校验；任何AI结果都不直接写任务。未配置或调用失败会返回真实错误，不生成假回复。

## 扩展前的边界

当前限流含进程内限制，部署为单应用实例。多副本部署前应增加共享限流、会话治理、迁移锁与故障恢复测试。全量快照适合个人/小团队初始版本，大量图片或历史需要进一步拆分增量同步、对象存储和分页。

生产前应完成独立测试机的数据库恢复、权限隔离、HTTPS和实机PWA验收。当前Windows下PGlite与浏览器测试不能替代真实Docker、网络PostgreSQL、第三方AI及手机系统安装测试。

## Provider文档

DeepSeek适配按[官方Chat API说明](https://api-docs.deepseek.com/)核对；可选OpenAI适配按[官方Chat Completions参数](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)核对，使用`max_completion_tokens`并设置`store=false`。OpenAI模型必须由部署者显式配置，不绑定可能停用的固定默认模型。此次只执行了假传输协议测试，没有向服务商发送真实请求。
