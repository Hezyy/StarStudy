#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
source scripts/deployment-config.sh
managed=0;resume=0
for argument in "$@";do case "$argument" in --managed) managed=1;; --resume) resume=1;; *) die '内部用法：install.sh --managed [--resume]，普通用户请运行sudo starstudy';; esac;done
[[ "$(uname -s)" == Linux ]] || die '生产安装仅支持Linux，请通过支持的Linux服务器运行sudo starstudy'
[[ -f /etc/os-release ]] || die '无法识别Linux发行版'
source /etc/os-release
case "${ID}:${VERSION_ID}" in ubuntu:22.04|ubuntu:24.04|debian:12|debian:13) ;; *) die '仅支持Ubuntu22.04/24.04、Debian12/13';; esac
[[ "$(uname -m)" == x86_64 ]] || die 'ARM64尚未验证，不会假装兼容'
((EUID==0)) || die '请使用sudo starstudy启动管理界面'
for dependency in python3 openssl curl ss dig ip timeout;do need_command "$dependency";done
need_docker;lock_operation
mem_kb=$(awk '/MemTotal/{print $2}' /proc/meminfo)
disk_kb=$(df -Pk . | awk 'NR==2{print $4}')
((mem_kb>=2000000)) || die '至少需要2GB内存，镜像构建建议4GB'
((disk_kb>=5000000)) || die '至少需要5GB可用磁盘空间'
if [[ -e .env || -L .env ]];then
 ((resume==1)) || die '发现已有.env，安装不会覆盖；请在统一菜单选择保留配置重试或更新'
 need_env
 [[ -f .starstudy-install ]] || die '已有配置没有可验证安装标记，已停止；请先核对原部署归属'
 need_marker
 printf '保留已有域名、端口、访问路径、密钥及数据库，重试服务启动。\n'
else
 if [[ -e .starstudy-install || -L .starstudy-install ]];then
  python3 scripts/deployment-validation.py marker .starstudy-install "$STAR_ROOT" || die '已有目录归属不明，不会覆盖'
  identity=$(marker_value INSTALL_ID);project=$(marker_value COMPOSE_PROJECT_NAME)
 else
  [[ "$managed" == 1 || -f .starstudy-bootstrap ]] || printf '建议从sudo starstudy统一菜单启动安装。\n'
  identity=$(openssl rand -hex 16);project="starstudy_${identity:0:12}"
 fi
 ask domain '域名（必填，不填协议或端口）：'
 domain=${domain,,};domain=${domain%.}
 python3 scripts/deployment-validation.py domain "$domain" || die '域名格式无效'
 ask email '证书联系邮箱（选填，直接回车跳过）：'
 if [[ -n "$email" ]];then [[ "$email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$ ]] || die '邮箱格式无效，可重试时留空';fi
 requested_port=''
 ask requested_port 'HTTPS端口（选填，回车自动从20000—60000选择）：'
 dns_check "$domain"
 port_free 80 || die '本机80端口已被占用，HTTP-01验证不能开始；不会停止其他服务'
 https_port=$(choose_https_port "$requested_port")
 printf '本机80与HTTPS端口%s空闲（含Docker端口检查），这不代表公网可达。\n请在云安全组和防火墙仅放行TCP80及TCP%s；HTTP-01必须通过公网80。脚本不修改防火墙或SSH。\n' "$https_port" "$https_port"
 prefix="/$(openssl rand -hex 16)";db_password=$(openssl rand -hex 32);session_secret=$(openssl rand -hex 48);setup_token=$(openssl rand -hex 32)
 [[ "$identity" =~ ^[a-f0-9]{32}$ && "$prefix" =~ ^/[a-f0-9]{32}$ ]] || die '安全随机数生成失败'
 # Refuse to overwrite either file, including when another process created it after the checks.
 if [[ ! -f .starstudy-install ]];then
  (set -o noclobber;printf 'APP=StarStudy\nFORMAT_VERSION=1\nINSTALL_ID=%s\nCOMPOSE_PROJECT_NAME=%s\nROOT_PATH=%s\nCREATED_AT=%s\n' "$identity" "$project" "$STAR_ROOT" "$(date -u +%FT%TZ)" > .starstudy-install) || die '安装标记已出现，停止覆盖'
  chmod 600 .starstudy-install
 fi
 acme_directive='';[[ -z "$email" ]] || acme_directive="email $email"
 (set -o noclobber;cat > .env <<ENV
INSTALL_ID=$identity
COMPOSE_PROJECT_NAME=$project
POSTGRES_PASSWORD=$db_password
SESSION_SECRET=$session_secret
SETUP_TOKEN=$setup_token
PUBLIC_URL=https://$domain:$https_port$prefix
SITE_ADDRESS=$domain
APP_BASE_PATH=$prefix
ACME_EMAIL=$email
ACME_EMAIL_DIRECTIVE=$acme_directive
BIND_ADDRESS=0.0.0.0
HTTP_PORT=80
HTTPS_PORT=$https_port
ALLOW_INSECURE_LOCAL=0
INITIAL_REGISTRATION=invite
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-flash
ENV
 ) || die '.env已存在或写入失败，未覆盖旧配置'
 chmod 600 .env
 need_env;need_marker
fi
[[ "$(env_value PUBLIC_URL)" == https://* ]] && dns_check "$(env_value SITE_ADDRESS)"
verify_project_ownership
mkdir -p -- "$(backup_root)";chmod 700 "$(backup_root)"
docker compose config --quiet
printf '正在构建并启动星研；失败会保留配置与数据，可从菜单保留配置重试。\n'
if ! docker compose up -d --build 2>&1 | redact_stream;then die '构建或启动失败，请通过菜单查看脱敏日志后重试';fi
health || die '内部健康检查失败，不会声称安装成功；请查看菜单中的状态与日志'
local_https_health || die '证书或本机HTTPS检查未通过。请核对公网80、DNS及证书日志；原配置保留，可安全重试'
public_health || die '本机HTTPS已通过，但公开访问地址验证失败；请检查实际HTTPS端口的安全组/NAT/防火墙，原配置保留'
version=$(python3 -c 'import json;print(json.load(open("package.json"))["version"])')
tty_ready
printf '\nStarStudy 星研安装成功，版本%s\n网站地址：%s/\nHTTPS：可信证书检查已通过，Caddy自动续期已配置（公网80需持续开放）。\n服务健康检查：通过。\n首次管理员：打开上述私有地址，输入初始化口令：%s\n后续管理：sudo starstudy\n菜单4状态、5日志、6重启、7备份、8恢复、2更新、3卸载。\n注意：本机及从服务器访问成功不等于所有公网客户端可达，请再用手机移动网络验证实际HTTPS端口。\n' "$version" "$(env_value PUBLIC_URL)" "$(env_value SETUP_TOKEN)" >&"$STAR_STUDY_TTY_FD"
