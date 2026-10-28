#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
need_docker;need_env
printf '星研诊断（不输出环境变量、密钥或用户内容）\n'
docker version --format '{{.Server.Version}}'
docker compose ps
df -h .
docker compose exec -T database pg_isready -U star_study -d star_study
if health;then printf '应用与数据库健康检查通过\n';else printf '应用健康检查失败\n';fi
# Count error categories rather than dumping upstream logs that could contain secrets.
error_count=$(docker compose logs --no-color --tail=100 app 2>/dev/null | grep -Eic 'error|failed|exception' || true)
printf '最近100行应用日志中异常关键词计数：%s（原文不导出）\n' "$error_count"
public_url=$(sed -n 's/^PUBLIC_URL=//p' .env)
if [[ "$public_url" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]]; then
 if curl --fail --silent --show-error --max-time 15 "$public_url/api/platform/health";then printf '\nHTTPS验证完成\n';else printf '\nHTTPS验证失败，请核对DNS、证书与防火墙\n';fi
else printf '当前为本机HTTP测试模式或地址无效，不能作为正式公网登录服务。\n';fi
printf '最近备份清单：\n'
find "$(backup_root)" -maxdepth 2 -name manifest.json -print 2>/dev/null | tail -5 || true
