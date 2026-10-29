#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
need_docker;need_env;lock_operation
[[ ! -f .starstudy-install ]] || verify_project_ownership
root=$(backup_root);mkdir -p -- "$root";root=$(cd -- "$root" && pwd -P)
chmod 700 "$root"
for web_directory in "$STAR_ROOT/public" "$STAR_ROOT/out";do
 [[ ! -d "$web_directory" ]] && continue
 resolved_web=$(cd -- "$web_directory" && pwd -P)
 case "$root" in "$resolved_web"|"$resolved_web/"*) die '备份不能位于Web目录或其符号链接目标';; esac
done
case "$root" in "$STAR_ROOT"|"$STAR_ROOT/"*) case "$root" in "$STAR_ROOT/backups"|"$STAR_ROOT/backups/"*) ;; *) die '仓库内备份只允许放在被忽略的backups目录';; esac;; esac
pending=$(mktemp -d "$root/.pending-XXXXXXXX")
trap 'printf "备份失败，禁止继续更新/恢复/永久清理。原数据未删除，不完整备份：%s\n" "$pending" >&2' ERR
if [[ -e uploads || -L uploads ]];then
 [[ -d uploads && ! -L uploads && -z "$(find uploads ! -type f ! -type d -print -quit)" ]] || die 'uploads含链接或特殊文件，备份已停止'
fi
docker compose exec -T database pg_dump -U star_study -d star_study --format=custom > "$pending/database.dump"
[[ -s "$pending/database.dump" ]] || die '数据库转储为空，备份不完整'
docker compose exec -T database pg_restore --list < "$pending/database.dump" >/dev/null
cp -- .env compose.yaml Caddyfile "$pending/"
[[ ! -f scripts/Caddyfile.legacy ]] || cp -- scripts/Caddyfile.legacy "$pending/Caddyfile.legacy"
[[ ! -d uploads ]] || cp -a -- uploads "$pending/"
format=1;identity=''
if [[ -f .starstudy-install ]];then
 need_marker;format=2;identity=$(marker_value INSTALL_ID)
 cp -- .starstudy-install "$pending/"
 for name in caddy_data caddy_config;do
  docker volume inspect "${COMPOSE_PROJECT_NAME}_${name}" >/dev/null || die 'Caddy证书/配置卷缺失，不能生成完整备份'
 done
 # Compose run works even when the existing Caddy container was stopped for an update/restore.
 docker compose run -T --rm --no-deps --entrypoint tar caddy -C /data -cf - . > "$pending/caddy-data.tar"
 docker compose run -T --rm --no-deps --entrypoint tar caddy -C /config -cf - . > "$pending/caddy-config.tar"
 python3 scripts/deployment-validation.py tar "$pending/caddy-data.tar"
 python3 scripts/deployment-validation.py tar "$pending/caddy-config.tar"
fi
revision=$(git rev-parse HEAD 2>/dev/null || printf unknown)
printf '%s\n' "$revision" > "$pending/source-revision.txt"
version=$(python3 -c 'import json;print(json.load(open("package.json"))["version"])')
stamp=$(date -u +%FT%TZ)
python3 - "$pending/manifest.json" "$format" "$identity" "$COMPOSE_PROJECT_NAME" "$version" "$stamp" <<'PY'
import json,sys
path,version,identity,project,app_version,stamp=sys.argv[1:]
with open(path,'w',encoding='utf-8') as f:json.dump({'app':'星研','formatVersion':int(version),'complete':True,'installationId':identity,'composeProjectName':project,'appVersion':app_version,'createdAt':stamp,'database':'PostgreSQL17','images':'PostgreSQL study_records JSONB base64','certificatesIncluded':int(version)==2},f,ensure_ascii=False,indent=2)
PY
(cd -- "$pending" && find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS)
python3 scripts/deployment-validation.py backup "$pending" >/dev/null
destination="$root/backup-$(date -u +%Y%m%dT%H%M%SZ)-${pending##*.pending-}"
[[ ! -e "$destination" ]] || die '备份目标已存在，不会覆盖'
mv -- "$pending" "$destination"
printf 'LAST_BACKUP_AT=%s\nDIRECTORY=%s\n' "$stamp" "$destination" > .starstudy-backup-state
chmod 600 .starstudy-backup-state
printf '完整备份已验证：%s\n数据库、错题图片、配置%s已保存。备份包含敏感凭据，请加密后另存到其他设备。\n' "$destination" "$([[ "$format" == 2 ]] && printf '及Caddy证书/ACME状态' || printf '（旧版备份不含证书，当前证书卷将保留）')"
