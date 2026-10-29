#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
source scripts/deployment-config.sh
mode=${1:---diagnose}
case "$mode:${2:-}:$#" in --status::1|--restart::1|--logs::1|--logs:--follow:2|--diagnose::0|--diagnose::1) ;; *) die '请通过sudo starstudy菜单选择状态、日志、重启或诊断';; esac
need_docker;need_env
[[ ! -f .starstudy-install ]] || verify_project_ownership
if [[ "$mode" == --logs ]];then
 if [[ "${2:-}" == --follow ]];then
  printf '实时脱敏日志（不输出已知密钥和随机路径）；按Ctrl+C退出并返回菜单。\n'
  trap 'printf "\n已退出实时日志。\n";exit 0' INT
  docker compose logs --no-color --tail=100 --follow app caddy database 2>&1 | redact_stream
 else docker compose logs --no-color --tail=100 app caddy database 2>&1 | redact_stream;fi
 exit 0
fi
if [[ "$mode" == --restart ]];then
 lock_operation
 # Start only our project. This also resumes a normal uninstall while retaining volumes.
 docker compose up -d 2>&1 | redact_stream
 docker compose restart app caddy 2>&1 | redact_stream
 health || die '重启后内部健康检查失败，请选择日志或诊断；用户数据和配置保留'
 local_https_health || die '重启后HTTPS检查失败，请核对证书、DNS与端口；未声称重启成功'
 printf '星研服务已重启，内部与HTTPS健康检查通过。\n'
 exit 0
fi
printf '星研%s（不显示随机路径、密钥或用户学习内容）\n' "$([[ "$mode" == --status ]] && printf 状态 || printf 诊断)"
version=$(python3 -c 'import json;print(json.load(open("package.json"))["version"])')
printf '应用版本：%s\nDocker：' "$version"
docker version --format '{{.Server.Version}}'
printf 'Compose：';docker compose version --short
printf '容器状态：\n';docker compose ps 2>&1 | redact_stream
url=$(env_value PUBLIC_URL);domain=$(python3 scripts/deployment-validation.py url-domain "$url")
printf '域名/主机：%s\n实际HTTPS端口：%s\n' "$domain" "$(env_value HTTPS_PORT)"
if docker compose exec -T database pg_isready -U star_study -d star_study >/dev/null 2>&1;then printf '数据库连接：通过\n';else printf '数据库连接：失败，请查看数据库容器日志\n';fi
# Status must remain useful for stopped services without waiting the full installation timeout.
if docker compose exec -T app node -e "fetch('http://127.0.0.1:3000'+(process.env.APP_BASE_PATH||'')+'/api/platform/health',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1;then printf '内部健康检查：通过\n';else printf '内部健康检查：未通过或服务已停止\n';fi
if [[ "$url" == https://* ]];then
 if expiry=$(certificate_expiry);then printf '证书到期：%s\n' "${expiry#notAfter=}";else printf '证书到期：无法读取，请核对Caddy运行状态\n';fi
 if local_https_health;then printf '本机HTTPS/可信证书：通过\n';else printf '本机HTTPS：失败，请检查证书日志、DNS与公网80\n';fi
else printf '当前为本机HTTP测试部署，不代表已签发公网证书。\n';fi
if [[ "$mode" == --status ]];then exit 0;fi
printf '磁盘空间：\n';df -h .
if [[ "$url" == https://* ]];then
 if (dns_check "$domain");then printf 'DNS诊断：通过\n';else printf 'DNS诊断：未通过。请核对A/AAAA指向本机公网IP、等待生效并关闭CDN代理；脚本不修改DNS。\n';fi
 if public_health;then printf '服务器访问公开HTTPS地址：通过（仍需手机移动网络验证公网入站）\n';else printf '公开访问失败：检查实际HTTPS端口安全组/防火墙/NAT，以及持续开放的HTTP-01 TCP80。\n';fi
fi
printf '本机监听80/网站端口（本机监听不等于公网可达）：\n'
ss -ltnH | awk -v site="$(env_value HTTPS_PORT)" '$4 ~ /:80$/ || $4 ~ (":"site"$") {print $1,$4}'
error_count=$(docker compose logs --no-color --tail=100 app caddy 2>/dev/null | grep -Eic 'error|failed|exception' || true)
printf '最近日志异常关键词计数：%s；详情请选择菜单5查看脱敏日志。\n' "$error_count"
printf '最近备份清单（含敏感凭据，请妥善保存）：\n'
find "$(backup_root)" -maxdepth 2 -name manifest.json -print 2>/dev/null | tail -5 || true
printf '诊断只读：未修改防火墙、SSH、DNS，也未清理数据或其他项目。\n'
