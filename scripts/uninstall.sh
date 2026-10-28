#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
need_docker;need_env
[[ $# -le 1 && ( $# == 0 || "$1" == --purge ) ]] || die '用法：bash scripts/uninstall.sh [--purge]'
if [[ "${1:-}" != --purge ]]; then docker compose down;printf '服务已停止。数据库卷、备份、源码和配置全部保留。重新运行docker compose up -d可恢复。\n';exit 0;fi
read -r -p '将永久删除本部署数据库卷和全部账户数据。输入DELETE：' answer
[[ "$answer" == DELETE ]] || die '已取消'
read -r -p '再次确认不可恢复删除？输入YES：' second
[[ "$second" == YES ]] || die '已取消'
bash scripts/backup.sh
docker compose down --volumes
printf '部署数据卷已删除；备份和配置仍保留，请自行安全保存或清理。\n'
