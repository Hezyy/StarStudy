#!/usr/bin/env bash
set -Eeuo pipefail
STAR_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd -- "$STAR_ROOT"
umask 077
die() { printf '错误：%s\n' "$*" >&2; exit 1; }
need_command() { command -v "$1" >/dev/null 2>&1 || die "缺少依赖$1，请通过sudo starstudy准备系统环境"; }
need_docker() { need_command docker;docker info >/dev/null 2>&1 || die 'Docker未启动或无权限，请通过统一管理菜单诊断';docker compose version >/dev/null 2>&1 || die '需要Docker Compose 2或以上版本'; }
tty_ready() {
 if [[ "${STAR_STUDY_TTY_FD:-}" =~ ^[0-9]+$ ]] && { : >&"$STAR_STUDY_TTY_FD"; } 2>/dev/null;then return;fi
 exec 3<>/dev/tty 2>/dev/null || die '需要真实交互终端，请通过SSH终端运行sudo starstudy'
 STAR_STUDY_TTY_FD=3;export STAR_STUDY_TTY_FD
}
ask() { tty_ready;printf '%s' "$2" >&2;IFS= read -r "$1" <&"$STAR_STUDY_TTY_FD" || die '终端输入已中断，未继续操作'; }
env_value() { python3 scripts/deployment-validation.py env .env "$1"; }
marker_value() { python3 scripts/deployment-validation.py env .starstudy-install "$1"; }
lock_operation() {
 if [[ "${STAR_STUDY_LOCK_ROOT:-}" == "$STAR_ROOT" ]] && { : >&9; } 2>/dev/null;then return;fi
 need_command flock
 [[ ! -L .starstudy-operation.lock ]] || die '操作锁文件不能是符号链接'
 exec 9>.starstudy-operation.lock
 flock -n 9 || die '另一项星研安装/更新/备份操作正在运行，请稍后再试'
 STAR_STUDY_LOCK_ROOT=$STAR_ROOT;export STAR_STUDY_LOCK_ROOT
}
need_env() {
 need_command python3
 [[ -f .env && ! -L .env ]] || die '缺少安全的.env，请通过sudo starstudy安装或恢复配置'
 if [[ "$(uname -s)" == Linux && "${STAR_STUDY_MANAGED:-0}" == 1 ]];then
  [[ "$(stat -c %u .env)" == 0 ]] && (( (8#$(stat -c %a .env) & 8#077)==0 )) || die '.env必须为root所有且仅本人可读写'
 fi
 python3 scripts/deployment-validation.py config .env >/dev/null || die '配置校验失败，不会重新生成凭据'
 COMPOSE_PROJECT_NAME=$(env_value COMPOSE_PROJECT_NAME)
 COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-star-study};export COMPOSE_PROJECT_NAME
 [[ "$COMPOSE_PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || die 'Compose项目名无效'
 if [[ "$(env_value SITE_ADDRESS)" == http://* ]];then CADDY_CONFIG_FILE=scripts/Caddyfile.legacy;else CADDY_CONFIG_FILE=Caddyfile;fi
 export CADDY_CONFIG_FILE
 CADDY_DOMAIN=$(python3 scripts/deployment-validation.py url-domain "$(env_value PUBLIC_URL)");export CADDY_DOMAIN
 if [[ "${STAR_STUDY_MANAGED:-0}" == 1 ]];then need_marker;fi
}
need_marker() {
 python3 scripts/deployment-validation.py marker .starstudy-install "$STAR_ROOT" || die '无法确认此目录为星研安装，已停止'
 [[ "$(marker_value COMPOSE_PROJECT_NAME)" == "$COMPOSE_PROJECT_NAME" ]] || die '安装标记与Compose项目名不同'
 [[ "$(marker_value INSTALL_ID)" == "$(env_value INSTALL_ID)" ]] || die '安装标记与.env身份不同'
}
backup_root() {
 if [[ -n "${STAR_BACKUP_DIR:-}" ]];then printf '%s' "$STAR_BACKUP_DIR";return;fi
 if [[ -f .starstudy-install ]];then printf '/var/backups/starstudy/%s' "$(marker_value INSTALL_ID)";else printf '%s/backups/server' "$STAR_ROOT";fi
}
health() {
 local attempt
 for ((attempt=0;attempt<40;attempt++));do
  if docker compose exec -T app node -e "fetch('http://127.0.0.1:3000'+(process.env.APP_BASE_PATH||'')+'/api/platform/health',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1;then return 0;fi
  sleep 3
 done
 return 1
}
public_health() { local url;url=$(env_value PUBLIC_URL);curl --noproxy '*' --fail --silent --max-time 20 --connect-timeout 8 "$url/api/platform/health" >/dev/null; }
local_https_health() {
 local url domain port
 url=$(env_value PUBLIC_URL);domain=$(python3 scripts/deployment-validation.py url-domain "$url");port=$(env_value HTTPS_PORT);port=${port:-443}
 if [[ "$url" != https://* ]];then public_health;return;fi
 curl --noproxy '*' --fail --silent --max-time 20 --connect-timeout 8 --resolve "$domain:$port:127.0.0.1" "$url/api/platform/health" >/dev/null
}
redact_stream() { python3 -u scripts/deployment-validation.py redact .env; }
verify_project_ownership() {
 need_marker
 local identifier project service label volume expected consumer identifiers volumes consumers network
 project=$COMPOSE_PROJECT_NAME
 identifiers=$(docker ps -a --filter "label=com.docker.compose.project=$project" --format '{{.ID}}') || die '无法枚举项目容器，停止操作'
 while IFS= read -r identifier;do
  [[ -z "$identifier" ]] && continue
  [[ "$identifier" =~ ^[a-f0-9]+$ ]] || die '容器标识无效'
  label=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$identifier")
  [[ "$label" == "$project" ]] || die '容器归属不一致，停止操作'
  label=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$identifier")
  [[ "$label" == "$STAR_ROOT" ]] || die '容器来自其他安装目录，停止操作'
  service=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}' "$identifier")
  [[ "$service" =~ ^(database|app|migrate|caddy)$ ]] || die '项目中存在未知容器，停止自动操作'
 done <<<"$identifiers"
 volumes=$(docker volume ls --filter "label=com.docker.compose.project=$project" --format '{{.Name}}') || die '无法枚举项目数据卷，停止操作'
 # A foreign volume can use the expected name without carrying our project label.
 # Inspect known names too, before Compose has a chance to mount an existing volume.
 for expected in postgres_data caddy_data caddy_config;do
  volume="${project}_${expected}"
  if docker volume inspect "$volume" >/dev/null 2>&1;then volumes+=$'\n'"$volume";fi
 done
 while IFS= read -r volume;do
  [[ -z "$volume" ]] && continue
  case "$volume" in "${project}_postgres_data"|"${project}_caddy_data"|"${project}_caddy_config") ;; *) die '项目中存在未知或共享数据卷，停止自动操作';; esac
  expected=${volume#"${project}_"}
  label=$(docker volume inspect --format '{{ index .Labels "com.docker.compose.project" }}' "$volume")
  [[ "$label" == "$project" ]] || die '数据卷Compose归属不一致'
  label=$(docker volume inspect --format '{{ index .Labels "com.docker.compose.volume" }}' "$volume")
  [[ "$label" == "$expected" ]] || die '数据卷用途标签不一致'
  label=$(docker volume inspect --format '{{ index .Labels "io.starstudy.installation" }}' "$volume")
  [[ "$label" == "$(marker_value INSTALL_ID)" ]] || die '数据卷安装身份无法确认，停止操作'
  consumers=$(docker ps -a --filter "volume=$volume" --format '{{.ID}}') || die '无法枚举数据卷使用方，停止操作'
  while IFS= read -r consumer;do
   [[ -z "$consumer" ]] && continue
   [[ "$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$consumer")" == "$project" ]] || die '数据卷正被其他项目使用，停止操作'
  done <<<"$consumers"
 done <<<"$volumes"
 network="${project}_default"
 if docker network inspect "$network" >/dev/null 2>&1;then
  [[ "$(docker network inspect --format '{{ index .Labels "com.docker.compose.project" }}' "$network")" == "$project" && "$(docker network inspect --format '{{ index .Labels "com.docker.compose.network" }}' "$network")" == default && "$(docker network inspect --format '{{ index .Labels "io.starstudy.installation" }}' "$network")" == "$(marker_value INSTALL_ID)" ]] || die '网络归属或安装身份不一致，停止操作'
 fi
}
