#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
need_docker; need_env
[[ $# == 1 && "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die '用法：bash scripts/update.sh vX.Y.Z（只接受明确稳定标签）'
command -v git >/dev/null || die '请先安装Git；更新脚本需要可追踪的源码版本'
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die '当前目录不是Git工作区；源码包安装请先接入可信版本库，不能自动猜测更新来源'
git remote get-url origin >/dev/null 2>&1 || die '尚未配置可信origin远程，更新不会自动添加来源；请按发布教程配置后重试'
working_changes=$(git status --porcelain --untracked-files=no)
[[ -z "$working_changes" ]] || die '有未提交源码改动，请先保存；更新不会覆盖'
old_revision=$(git rev-parse HEAD)
bash scripts/backup.sh
git fetch --tags origin
git rev-parse --verify "refs/tags/$1" >/dev/null || die '远程标签不存在'
printf '当前源码：%s\n目标稳定版本：%s\n' "$old_revision" "$1"
trap 'printf "更新中断；未清理数据。旧源码版本：%s。若服务已停止，请先诊断迁移状态并按文档恢复，不要盲目启动不兼容的旧代码。\n" "$old_revision" >&2' ERR
# Prevent the old application from writing while a new schema is being installed.
# The second backup is the final, quiescent pre-update snapshot with old-version metadata.
docker compose stop app caddy
bash scripts/backup.sh
git switch --detach "$1"
if ! docker compose build || ! docker compose run --rm migrate || ! docker compose up -d || ! health; then
 printf '更新失败，未删除数据。旧源码版本：%s\n请先诊断；需要回退时检出该版本，并使用更新前备份恢复兼容数据库。不要盲目运行旧版本。\n' "$old_revision" >&2
 exit 1
fi
printf '已更新到%s。更新前源码版本%s；请验证数据与登录。\n' "$1" "$old_revision"
