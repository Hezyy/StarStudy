#!/usr/bin/env bash
set -Eeuo pipefail
STAR_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd -- "$STAR_ROOT"
umask 077
die() { printf '错误：%s\n' "$*" >&2; exit 1; }
need_docker() { command -v docker >/dev/null || die '请先从 https://docs.docker.com/engine/install/ 安装Docker'; docker info >/dev/null 2>&1 || die 'Docker未启动或当前用户无权限'; docker compose version >/dev/null || die '需要Docker Compose v2'; }
need_env() { [[ -f .env ]] || die '请先运行 bash scripts/install.sh'; }
backup_root() { printf '%s' "${STAR_BACKUP_DIR:-$STAR_ROOT/backups/server}"; }
health() { for ((attempt=0;attempt<40;attempt++)); do if docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/platform/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then return 0; fi; sleep 3; done; return 1; }
