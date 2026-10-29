#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
need_docker;need_env;lock_operation
for dependency in git curl python3 sha256sum;do need_command "$dependency";done
[[ $# -le 1 ]] || die '请通过统一菜单选择正式稳定版本'
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die '不是可追踪的源码仓库，停止更新'
origin=$(git remote get-url origin)
case "$origin" in https://github.com/Hezyy/StarStudy|https://github.com/Hezyy/StarStudy.git|git@github.com:Hezyy/StarStudy.git) ;; *) die 'origin不是官方星研仓库，停止自动更新';; esac
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || die '存在未提交源码/未跟踪文件，请先保存；不会覆盖本地改动'
tag=${1:-}
[[ -z "$tag" || "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die '仅接受vX.Y.Z正式版本'
endpoint=https://api.github.com/repos/Hezyy/StarStudy/releases/latest
[[ -z "$tag" ]] || endpoint="https://api.github.com/repos/Hezyy/StarStudy/releases/tags/$tag"
release=$(curl --proto '=https' --tlsv1.2 -fsSL --connect-timeout 8 --max-time 20 "$endpoint") || die '没有可读取的正式稳定发行版，未执行更新；开发分支不会被伪装成稳定版'
target=$(python3 -c 'import json,re,sys;v=json.load(sys.stdin);t=v.get("tag_name","");assert re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+",t) and not v.get("draft") and not v.get("prerelease") and v.get("published_at");print(t)' <<<"$release") || die '发行版未通过正式发布校验'
[[ -z "$tag" || "$target" == "$tag" ]] || die '返回的版本与请求不符'
old_revision=$(git rev-parse HEAD)
git fetch --no-tags origin "refs/tags/$target:refs/tags/$target"
new_revision=$(git rev-parse --verify "refs/tags/$target^{commit}")
[[ "$old_revision" != "$new_revision" ]] || { printf '当前已是所选正式版本%s，未重复迁移。\n' "$target";exit 0; }
# Old pre-manager tags cannot safely operate the new identity/certificate format.
# Check the immutable target before stopping services or executing its deployment files.
for required_file in starstudy.sh scripts/common.sh scripts/deployment-validation.py scripts/deployment-config.sh scripts/backup.sh scripts/restore.sh scripts/doctor.sh compose.yaml Caddyfile Dockerfile;do
 git cat-file -e "$new_revision:$required_file" || die '目标发行版缺少统一管理协议文件，未停止服务；请使用支持当前部署格式的正式版'
done
target_version=$(git show "$new_revision:package.json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["version"])') || die '目标版本元数据不可读'
[[ "v$target_version" == "$target" ]] || die '发行标签与应用版本不同，未执行更新'
[[ ! -f .starstudy-install ]] || verify_project_ownership
env_checksum=$(sha256sum .env)
printf '当前源码：%s\n目标正式版本：%s\n' "$old_revision" "$target"
bash scripts/backup.sh
docker compose stop app caddy || die '无法停止旧服务写入，未迁移数据库'
final_backup='尚未生成'
trap 'result=$?;if ((result!=0));then printf "更新失败；用户数据和备份保留，旧源码：%s，最终备份：%s。服务可能保持停止，请从菜单查看日志；回退前需核对数据库与源码版本，不会自动删除数据。\n" "$old_revision" "$final_backup" >&2;fi' EXIT
bash scripts/backup.sh
final_backup=$(python3 scripts/deployment-validation.py env .starstudy-backup-state DIRECTORY)
python3 scripts/deployment-validation.py backup "$final_backup" >/dev/null || die '更新前最终备份验证失败，尚未执行迁移'
git switch --detach "$target"
[[ "$env_checksum" == "$(sha256sum .env)" ]] || die '.env发生意外变化，停止启动；原凭据保存在更新前备份'
docker compose config --format json | python3 scripts/deployment-validation.py compose-project "$COMPOSE_PROJECT_NAME"
docker compose build 2>&1 | redact_stream
docker compose run -T --rm migrate 2>&1 | redact_stream
docker compose up -d 2>&1 | redact_stream
health || die '更新后内部健康检查失败，保留数据与备份，未声称更新成功'
local_https_health || die '更新后证书/本机HTTPS检查失败，请从菜单检查，不会自动回退数据'
public_health || die '更新后公开访问检查失败，请核对实际HTTPS端口；数据及备份均保留'
printf '已更新到正式版本%s，健康检查和HTTPS检查通过。域名、端口、路径、.env及持久化卷保持不变。\n更新前源码：%s\n最终备份：%s\n' "$target" "$old_revision" "$final_backup"
