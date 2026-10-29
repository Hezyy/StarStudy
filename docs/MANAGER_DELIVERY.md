# 星研统一管理脚本交付与测试

日期：2026-10-29。范围仅部署运维及必要的路径前缀兼容，不重新设计学习应用，不修改数据库结构。

## 功能与文件

- `starstudy.sh`：统一中文菜单、真实终端输入、系统/依赖/Docker准备、固定官方提交下载、安全自更新、安装身份保护、操作锁与失败返回。
- `scripts/common.sh`、`deployment-config.sh`、`deployment-validation.py`：配置作为数据读取，域名/DNS、随机端口、资源归属、校验/脱敏与健康检查。
- `scripts/install.sh`、`update.sh`、`doctor.sh`、`uninstall.sh`：安装/保留配置重试、真实稳定版更新、状态/日志/重启/诊断、普通和双确认永久卸载。
- `scripts/backup.sh`、`restore.sh`、`verify-backup.sh`：PG/图片/配置/证书和ACME状态完整备份、严格校验、恢复前快照、SQL事务及失败阶段反馈。
- `compose.yaml`、`Dockerfile`、`Caddyfile`、`scripts/Caddyfile.legacy`、`.env.example`：高端口与前缀构建、HTTP-01、邮箱选填、持久数据卷与安装标签；旧回环配置保留内部兼容。
- `next.config.ts`、`scripts/base-path.mjs`、`serve.mjs`、`api.mjs`、`precache.mjs`、`server/api.ts`、`src/lib/app-path.ts`与相关URL调用点：路由/资源/API/Cookie/PWA前缀一致，保留原交互和根路径数据库。
- 测试：`scripts/test-manager.sh`、`test-deployment.sh`、`test-compose-integration.sh`、`test-compose-api.py`、`tests/unit/base-path.test.ts`、`prefix-api.test.ts`、`tests/prefix-e2e/`及CI矩阵。WebKit持久目录兼容仅限Windows，平台测试输出独立，避免测试互相清理产物。
- 文档、隐私忽略和源码白名单同步更新；用户原有`next-env.d.ts`字节保持不变，不纳入本次提交。

## 实际验证（接续验收中）

| 检查 | 实际结果 | 验证层次 |
| --- | --- | --- |
| strict TypeScript / ESLint | 通过 | 本机，lint 0错误0警告 |
| 完整Vitest | 22文件，119通过、1可选私人原件用例跳过 | 隔离IndexedDB/PGlite；不等于Docker |
| 私人426天Excel专门用例 | 显式提供私有原件后2通过 | 原件未提交或上传 |
| 根路径与前缀生产构建 | 两种均通过 | Windows Node构建 |
| 前缀浏览器 | 4通过、0失败 | Chromium1440px/WebKit375px；登录/退出、资源、端口重定向、PWA离线和重连同步 |
| 管理脚本语法与隔离故障测试 | 通过 | Git Bash；不安装系统包或Docker |
| 运维控制流程 | 19组通过 | Mock覆盖恢复/证书失败、坏备份、迁移失败、外来资源、卸载残留/枚举失败、DNS与端口 |
| 真实终端管道菜单 | 输入错误返回菜单、Ctrl+C提示、0退出；无TTY时返回失败 | Windows控制终端；未跳过生产Linux/root保护执行安装 |
| 原有本地和账户浏览器 | 本地102通过/10预定与可选跳过；原件另4通过；账户36通过 | 合计本地106通过和6预定跳过，均0失败；失败批次不计通过 |
| Linux/Docker CI | 真实生命周期通过 | Compose、Caddy4种配置、PG、私有CA高端口HTTPS与备份恢复/卸载均实际运行 |
| 独立PostgreSQL17 CI | 通过 | 实际网络数据库，非PGlite |

## 明确限制

1. 本地Windows没有Docker或Linux发行版；本机mock不证明真实部署。Linux CI实际容器/网络PG验收已通过；空白服务器APT/Docker自动安装未做全发行版矩阵实测。
2. Docker验收使用合成账号、数据及Caddy私有CA，不能证明用户域名的公网DNS、HTTP-01、可信公网证书和续期。没有替任何真实服务器安装或卸载。
3. 仓库当前没有正式稳定发行版，因此应用更新应明确停止；固定开发快照首次安装需要额外确认。真实跨稳定版本升级尚需未来发行版与测试。
4. 备份恢复仅自动接受相同应用版本；跨版本/异机需要先核对源码、迁移和私有配置。SQL提交之后的证书复制/健康失败不能回滚数据库，只保留恢复前完整备份并报告阶段。
5. DNS、云安全组与防火墙由用户控制。必须开放公网TCP80和实际HTTPS端口；不支持无需DNS授权的自动修改、DNS-01或绕过入站限制。
6. 真实iPhone/Android主屏幕安装、系统文件权限和后台生命周期未验收；已有页面业务及数据不因部署改造重建。

## 上传与公开验证

首轮开发提交915a755，独立公开提交66cd048已正常接续main；没有公开私有祖先或强制覆盖远程。普通GitHTTPS连接失败后使用现有授权和GitHub官方Git对象接口上传，每文件blob、完整文件树、提交标识及main均复核。

首轮实际请求唯一Raw地址得到HTTP200，内容与公开提交一致。敏感格式扫描通过；私有原件、备份、测试库、凭据和用户next-env.d.ts修改均未公开。

GitHub[首轮Linux验收](https://github.com/Hezyy/StarStudy/actions/runs/40894578054)的真实部署及独立PG作业通过。部署日志逐项确认生产Caddy4种配置、内部CA高端口HTTPS、Secure Cookie、学习记录/计时/图片、数据库与Caddy状态备份恢复、普通卸载后保留数据、完全卸载不影响无关容器/卷且保留最终备份。ShellCheck与前缀测试发现的静态提示/缺少临时父目录已修复，第二轮继续验证，不把首轮整套标为通过。

安装及日常管理见[部署说明](DEPLOYMENT.md)，未完成的验证不能视为成功。
