# 创建GitHub仓库与首次发布

当前已有本地Git基线与开发分支，尚未创建远程仓库、公开源码或推送。本文是供本人决定后执行的教程，不代表已经获得或执行公开发布授权。

## 发布前检查

1. 运行lint、类型、单元、构建、安全与相关浏览器检查；检查实际结果。
2. 查看`git status`、`git diff --stat`和待提交文件。`.env`、私有Excel、备份、数据库、上传、测试产物、证书和密钥必须被忽略。
3. 运行`npm run security:check`，并人工检查文件及Git历史。自动扫描不能保证发现全部秘密。
4. 代码中的示例必须是合成数据；不要把真实账号、笔记、错题图片或学习计划附在Issue/截图中。历史0.3.x截图属于当时验收资料，发布前仍应检查是否包含私人内容。
5. 如果凭证曾进入提交，先撤销/轮换，再决定如何清理历史。不要在不告知合作者的情况下改写已有历史。
6. 确认AGPL-3.0-only许可证、第三方声明，以及实际部署对应源码的获取方式。当前开发分支没有已发布稳定标签。

旧基线保存过原版个人默认配置，因此请保留`codex/open-platform`作为私有开发历史。`npm run release:prepare`会用当前已提交、已扫描的源码准备`codex/public-release`：首次提交没有私有开发父历史，后续只接续该发布分支；历史验收截图不进入发布树。脚本不切换工作区、不删除文件、不重写旧提交、不创建远程或推送。公开前仍需本人审查当前源码。

常用检查命令：

```sh
git status --short
git diff --stat
git ls-files
git log --oneline --all
git remote -v
npm run security:check
```

## 在GitHub网页创建

1. 登录自己的GitHub账户，点击右上角「+ → New repository」。
2. 填仓库名称，例如`star-study`，写简短说明。
3. 自己决定Public或Private。尚未确认隐私/密钥检查时可先选Private。
4. **不要勾选初始化README、.gitignore或LICENSE**，因为本地已经存在。
5. 创建后复制HTTPS或SSH仓库地址。不要把个人访问令牌嵌在远程URL里。

当前环境没有可用的GitHub CLI授权，不应声称自动建仓已完成。以后使用gh建仓也应先由本人明确同意。

## 本人确认后首次推送

先在本地完成自己的Git身份配置；邮箱可使用GitHub提供的隐私邮箱。以下所有`YOUR_...`占位必须替换为本人信息，命令不会自动替本人选择公开范围。

```sh
git config user.name "YOUR_NAME"
git config user.email "YOUR_PRIVATE_OR_NOREPLY_EMAIL"
git status
git add .
git diff --cached --stat
git commit -m "feat: prepare Star Study self-hosted platform"
```

先准备并检查专门的发布分支，然后本人确认远程仓库公开范围后推送。不要把私有开发分支直接推到公开仓库，也不要推送全部分支：

```sh
npm run release:prepare
git log --oneline codex/public-release
git remote add origin https://github.com/YOUR_USERNAME/star-study.git
git remote -v
git push origin codex/public-release:main
```

若origin已存在，不重复执行add；先检查它确实是本人的预期仓库，再考虑`git remote set-url origin ...`。若Git提示身份或凭证错误，按GitHub正常授权登录处理，不把令牌写入源码、聊天或.shell_history。

推送后在GitHub检查README、LICENSE、文件列表和Actions。发现私密文件时立即限制访问并处理泄露；删除网页文件并不能自动移除Git历史。

## 标签与后续更新

等待CI、真实部署和恢复验收完成后，维护者再决定是否发布稳定版本。不要为了让更新脚本可用而冒充已经验收。正式标签示例：

```sh
git tag -a v0.4.0 codex/public-release -m "Star Study 0.4.0"
git push origin v0.4.0
```

这些是未来本人执行的命令，本次未创建或推送标签。安装与更新脚本只接受实际存在的稳定标签，不自动选择任意分支。

## AGPL说明

用户已选择AGPL-3.0，项目使用AGPL-3.0-only。MIT通常允许保留许可声明后进行更宽松的再分发；AGPL含网络服务相关的对应源码提供要求。运行修改版网络服务时，应向使用者提供实际部署版本的对应源码，包含修改与构建/部署所需内容；不能只链接到一个不匹配的上游版本。完整约束以[LICENSE](../LICENSE)和[GNU说明](https://www.gnu.org/licenses/agpl-3.0.html)为准。

构建时自动生成 `/source/star-study-source.zip`，登录页和应用页脚都提供「对应源码 · AGPL-3.0」下载。源码包由明确白名单生成，包含该次构建的源码、迁移、锁文件及部署说明，不包含Git历史、密钥、私有Excel、浏览器数据库或备份。部署修改版时必须重新构建，确保源码包与实际运行版本一致，也可补充真实仓库链接。第三方课程内容和依赖不因本项目AGPL而自动变成可任意分发的资料。
