#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
need_docker; need_env
stamp=$(date -u +%FT%TZ)
destination="$(backup_root)/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p -- "$destination"
destination=$(cd -- "$destination" && pwd -P)
case "$destination" in "$STAR_ROOT/out"|"$STAR_ROOT/out/"*|"$STAR_ROOT/public"|"$STAR_ROOT/public/"*) die '备份不得位于Web目录';; esac
for web_directory in "$STAR_ROOT/public" "$STAR_ROOT/out";do
 if [[ -d "$web_directory" ]];then
  resolved_web_directory=$(cd -- "$web_directory" && pwd -P)
  case "$destination" in "$resolved_web_directory"|"$resolved_web_directory/"*) die '备份不得位于Web目录或其符号链接目标';; esac
 fi
done
case "$destination" in
 "$STAR_ROOT/"*) case "$destination" in "$STAR_ROOT/backups/"*) ;; *) die '仓库内备份仅允许被忽略的backups目录；自定义路径请放仓库外';; esac;;
esac
trap 'printf "备份失败，原数据保留；请检查不完整备份：%s\n" "$destination" >&2' ERR
if [[ -e uploads || -L uploads ]]; then
 [[ -d uploads && ! -L uploads ]] || die 'uploads必须为普通目录，不能跟随符号链接'
 [[ -z "$(find uploads ! -type f ! -type d -print -quit)" ]] || die 'uploads含符号链接或特殊文件，请先核对后备份'
fi
docker compose exec -T database pg_dump -U star_study -d star_study --format=custom > "$destination/database.dump"
[[ -s "$destination/database.dump" ]] || die '数据库转储为空，备份未完成'
cp -- .env compose.yaml Caddyfile "$destination/"
[[ ! -d uploads ]] || cp -a -- uploads "$destination/"
git rev-parse HEAD > "$destination/source-revision.txt" 2>/dev/null || printf 'unknown\n' > "$destination/source-revision.txt"
version=$(sed -n 's/.*"version": "\([0-9][0-9.]*\)".*/\1/p' package.json | head -1)
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || version=unknown
printf '{"app":"星研","formatVersion":1,"createdAt":"%s","appVersion":"%s","images":"PostgreSQL study_records JSONB base64","database":"PostgreSQL17"}\n' "$stamp" "$version" > "$destination/manifest.json"
# Checksums include optional legacy uploads, not only the database/config files.
(cd -- "$destination" && find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS)
docker compose exec -T database pg_restore --list < "$destination/database.dump" >/dev/null
# This is deployment metadata only. The running app reads it after its next recreation.
if grep -q '^LAST_BACKUP_AT=' .env; then sed -i "s/^LAST_BACKUP_AT=.*/LAST_BACKUP_AT=$stamp/" .env;else printf 'LAST_BACKUP_AT=%s\n' "$stamp" >> .env;fi
printf '完整备份：%s\n含敏感配置，请加密后异机保存。错题图片已包含在数据库中。\n' "$destination"
