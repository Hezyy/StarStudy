#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
[[ "$(uname -s)" == Linux ]] || die '生产安装仅支持Linux；Windows请使用本地开发方式'
[[ -f /etc/os-release ]] || die '无法识别Linux发行版'
source /etc/os-release
case "${ID}:${VERSION_ID}" in ubuntu:22.04|ubuntu:24.04|debian:12|debian:13) ;; *) die '当前只支持Ubuntu22.04/24.04、Debian12/13';; esac
[[ "$(uname -m)" == x86_64 ]] || die 'ARM64尚未完成部署验证，请勿用于正式服务'
[[ ! -e .env ]] || die '.env已存在，安装不会覆盖；更新请运行update.sh'
mem_kb=$(awk '/MemTotal/{print $2}' /proc/meminfo)
disk_kb=$(df -Pk . | awk 'NR==2{print $4}')
((mem_kb>=2000000)) || die '至少需要2GB内存；构建建议4GB'
((disk_kb>=5000000)) || die '至少需要5GB可用磁盘空间'
need_docker
command -v openssl >/dev/null || die '请先安装openssl'
command -v curl >/dev/null || die '请先安装curl，以验证HTTPS与健康检查'
command -v ss >/dev/null || die '需要ss命令检查端口（iproute2）'
read -r -p '域名（留空进入仅本机测试模式）：' domain
if [[ -n "$domain" ]]; then
 [[ "$domain" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ && "$domain" == *.* ]] || die '域名格式无效，请勿输入协议或路径'
 getent ahosts "$domain" >/dev/null || die 'DNS尚未解析。请将域名解析到本服务器后重试'
 printf 'DNS解析结果如下，请自行核对是否为本机公网IP：\n'; getent ahosts "$domain" | awk '!seen[$1]++{print $1}'
 read -r -p '确认DNS指向本机，且80/443端口已开放？输入YES：' dns_ok
 [[ "$dns_ok" == YES ]] || die '已取消'
 ! ss -ltnH | awk '{print $4}' | grep -E ':(80|443)$' >/dev/null || die '80或443端口已被占用'
 public_url="https://$domain";site_address="$domain";bind=0.0.0.0;http_port=80;https_port=443;insecure=0
else
 printf '本机测试模式：仅绑定127.0.0.1，不接受公网HTTP登录。\n'
 ! ss -ltnH | awk '{print $4}' | grep -E ':(8080|8443)$' >/dev/null || die '本机8080或8443端口已被占用'
 public_url=http://127.0.0.1:8080;site_address=http://:80;bind=127.0.0.1;http_port=8080;https_port=8443;insecure=1
fi
read -r -p '注册模式：默认邀请。输入public才启用公开注册：' registration
registration_mode=invite;[[ "$registration" != public ]] || registration_mode=public
db_password=$(openssl rand -hex 32);session_secret=$(openssl rand -hex 48);setup_token=$(openssl rand -hex 32)
cat > .env <<ENV
POSTGRES_PASSWORD=$db_password
SESSION_SECRET=$session_secret
SETUP_TOKEN=$setup_token
PUBLIC_URL=$public_url
SITE_ADDRESS=$site_address
BIND_ADDRESS=$bind
HTTP_PORT=$http_port
HTTPS_PORT=$https_port
ALLOW_INSECURE_LOCAL=$insecure
INITIAL_REGISTRATION=$registration_mode
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-flash
ENV
chmod 600 .env
mkdir -p -- "$(backup_root)"
docker compose up -d --build
health || die '健康检查失败。保留全部数据，请运行doctor.sh查看状态'
curl --fail --silent --show-error --retry 5 --retry-delay 3 --max-time 15 "$public_url/api/platform/health" >/dev/null || die '容器已启动，但访问地址或HTTPS验证未通过；不会关闭证书校验，请检查DNS、防火墙并运行doctor.sh'
printf '星研已启动：%s\n首次管理员初始化口令：%s\n请立即打开应用创建管理员，并妥善保管.env。\n' "$public_url" "$setup_token"
