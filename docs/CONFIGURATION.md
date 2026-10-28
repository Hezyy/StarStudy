# 星研可选服务与部署

本轮环境没有 OpenAI API 密钥、模型配置、网关口令或 Supabase 项目凭证。配置检测真实返回未配置。本地学习、规则排期、ChatGPT 文件协作、备份和PWA均不依赖这些服务。

## 本机与静态部署

`npm start` 使用 `scripts/serve.mjs`，默认 `127.0.0.1:3000`，读取 `.env.local`。前端生产输出 `out/`。当前 `.env.local` 仅开启私人原件本机读取，`imports/` 与该配置文件均被Git忽略，不属于静态导出。

- 纯静态HTTPS托管：部署`out/`即可运行本地学习和PWA。AI网关需另行部署并保持同源接口，不能把密钥放到静态文件。
- 本机联调手机：可显式设置`HOST=0.0.0.0`并配置防火墙，再访问电脑局域网地址。手机的localhost不是电脑。Safari PWA离线安装仍需HTTPS安全来源。
- Node服务HTTPS：通过反向代理提供HTTPS，保留正确Host。AI接口检查同站Origin，要求网关口令，限制每IP每分钟5次、请求2MB、上游45秒超时。
- `/api/local-import` 仅在`STAR_STUDY_LOCAL_IMPORT=1`、非production、请求来自回环地址且没有转发头时开放，返回固定的本机附件。不应在生产开放；源文件不会预缓存或上传。

## 可选服务端AI

复制`.env.example`需要的空配置项到自己的`.env.local`，填写：

```text
OPENAI_API_KEY=自己的服务端密钥
OPENAI_MODEL=账户可用的模型标识
STAR_STUDY_AI_TOKEN=自己设置的独立强访问口令
```

重新启动`npm start`。进入「云同步与AI」，在页面中填写网关访问口令并主动请求。该口令不是OpenAI密钥，只在页面内存中保留。模型密钥只供Node服务调用，前端不读取、不打包。不要使用`NEXT_PUBLIC_`保存模型密钥。

服务端通过Responses API发送用户明确提交的内容，设置`store:false`，解析`output_text`。未配置返回503，口令不符返回401，跨站拒绝403，限流429；上游失败明确提示，不返回模拟结果。没有在本轮调用任何付费模型。

规划默认不发送私人笔记、图片和错题文本；错题分析只发送用户输入的文字。建议返回后仍是文本，只有通过星研JSON格式和业务校验、预览并确认，才能修改计划。

参考：[OpenAI官方文本生成指南](https://developers.openai.com/api/docs/guides/text)。本轮只验证请求协议、错误路径与密钥隔离代码，没有真实密钥联调、额度或模型输出质量验证。

## 可选Supabase账户与快照同步

1. 创建自己的Supabase项目，按需要配置Email/Password、确认邮件及生产邮件发送。
2. 阅读并执行`supabase/schema.sql`。该脚本新建`study_snapshots`，每用户一条带递增版本号的完整备份快照；图片包含在备份Base64中。
3. RLS限制authenticated用户只能读写`auth.uid() = user_id`的行；anon没有表权限。浏览器只使用公开publishable/anon key，不使用service_role/secret key。
4. Node服务设置`SUPABASE_URL`和`SUPABASE_ANON_KEY`。纯静态构建使用`NEXT_PUBLIC_SUPABASE_URL`与`NEXT_PUBLIC_SUPABASE_ANON_KEY`后重新构建。这两个变量只允许公开密钥；检测到secret/service_role时会拒绝构建或连接。
5. 在应用中注册、按项目设置完成邮件验证，再登录。认证会话由Supabase SDK保存在当前浏览器，不放进星研JSON备份。退出不会清空本地学习数据。

同步流程：检查云端版本 → 上传本机快照，或下载云端快照并预览恢复。首次连接已有云端数据时必须明确选择版本。更新使用期望revision的条件写入，云端变化会停止上传。选择本机覆盖时先下载一份云端旧快照；选择云端恢复时，先校验并自动保存本机恢复前快照。

离线点上传会记录队列，应用打开、网络恢复时再次检查版本再上传。冲突不会静默覆盖。当前是完整快照同步，不是逐条记录自动合并；本地学习空间不随登录账户自动切换，上传前确认数据属于当前账户。

参考：[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[条件更新](https://supabase.com/docs/reference/javascript/update)、[密码登录](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)。

### 配置后的必要手动验收

- 用两个测试账户验证A无法读取/更新B的快照，匿名请求也不能读取。
- 两设备先同步同一revision，随后各自离线修改；第一台上传后，第二台必须报告冲突。
- 分别选择保留本机/云端，检查覆盖前备份、任务、计时、图片与关联。
- 验证刷新会话、邮件验证、网络失败重试、存储额度和大图快照大小。

真实Supabase和RLS隔离未在本轮环境执行，不将协议单元测试等同于生产联调。

## 本机提醒

「云同步与AI」可选择每日时间并主动授权通知。应用打开时每分钟检查一次任务和到期错题，每日最多一次；iPhone可能需要先安装到主屏幕。关闭应用后的后台推送需要额外服务，目前未实现。
