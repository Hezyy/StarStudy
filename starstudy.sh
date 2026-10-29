#!/usr/bin/env bash
# StarStudy managed entrypoint. Repository: Hezyy/StarStudy
set -Eeuo pipefail
umask 077

SS_REPOSITORY='Hezyy/StarStudy'
SS_REPOSITORY_URL='https://github.com/Hezyy/StarStudy.git'
SS_API_ROOT='https://api.github.com/repos/Hezyy/StarStudy'
SS_INSTALL_ROOT='/opt/starstudy'
SS_CONFIG_ROOT='/etc/starstudy'
SS_COMMAND_PATH='/usr/local/bin/starstudy'
SS_TEMPORARY=''
SS_LOCK_HELD_ROOT=''

ss_message() { printf '%s\n' "$*" >&3; }
ss_fail() { ss_message "错误：$*";return 1; }
ss_read() {
  local target_name=$1 prompt_text=$2
  [[ "$target_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || return 1
  printf '%s' "$prompt_text" >&3
  IFS= read -r -u 3 "${target_name?}"
}
ss_field() {
  local source_file=$1 field_name=$2
  awk -v key="$field_name" 'index($0,"=") {k=substr($0,1,index($0,"=")-1);if(k==key){n++;v=substr($0,index($0,"=")+1)}} END{if(n!=1)exit 1;print v}' "$source_file"
}
ss_owned() {
  local path_value=$1 file_mode
  [[ -e "$path_value" && ! -L "$path_value" ]] || return 1
  [[ "$(stat -c %u -- "$path_value")" == 0 ]] || return 1
  file_mode=$(stat -c %a -- "$path_value")
  (( (8#$file_mode & 8#022)==0 ))
}
ss_check_manager_config() {
  ss_owned "$SS_CONFIG_ROOT" && [[ -d "$SS_CONFIG_ROOT" ]] || return 1
  ss_owned "$SS_CONFIG_ROOT/manager.conf" && [[ -f "$SS_CONFIG_ROOT/manager.conf" ]] || return 1
  [[ "$(ss_field "$SS_CONFIG_ROOT/manager.conf" APP)" == StarStudyManager && "$(ss_field "$SS_CONFIG_ROOT/manager.conf" FORMAT_VERSION)" == 1 && "$(ss_field "$SS_CONFIG_ROOT/manager.conf" REPOSITORY)" == "$SS_REPOSITORY" && "$(ss_field "$SS_CONFIG_ROOT/manager.conf" ROOT_PATH)" == "$SS_INSTALL_ROOT" ]]
}
ss_repo_owned() {
  local origin_value
  ss_owned "$SS_INSTALL_ROOT" && [[ -d "$SS_INSTALL_ROOT" ]] || return 1
  ss_owned "$SS_INSTALL_ROOT/.git" && [[ -d "$SS_INSTALL_ROOT/.git" ]] || return 1
  origin_value=$(git -c core.hooksPath=/dev/null -C "$SS_INSTALL_ROOT" remote get-url origin 2>/dev/null) || return 1
  [[ "$origin_value" == "$SS_REPOSITORY_URL" || "$origin_value" == "https://github.com/$SS_REPOSITORY" ]]
}
ss_install_owned() {
  local marker="$SS_INSTALL_ROOT/.starstudy-install" install_id project_name
  ss_repo_owned && ss_owned "$marker" && [[ -f "$marker" ]] || return 1
  [[ "$(ss_field "$marker" APP)" == StarStudy && "$(ss_field "$marker" FORMAT_VERSION)" == 1 && "$(ss_field "$marker" ROOT_PATH)" == "$SS_INSTALL_ROOT" ]] || return 1
  install_id=$(ss_field "$marker" INSTALL_ID) || return 1
  project_name=$(ss_field "$marker" COMPOSE_PROJECT_NAME) || return 1
  [[ "$install_id" =~ ^[0-9a-f]{32}$ && "$project_name" == "starstudy_${install_id:0:12}" ]] || return 1
  if [[ -e "$SS_INSTALL_ROOT/.env" || -L "$SS_INSTALL_ROOT/.env" ]];then
    ss_owned "$SS_INSTALL_ROOT/.env" && [[ -f "$SS_INSTALL_ROOT/.env" ]] || return 1
    [[ "$(ss_field "$SS_INSTALL_ROOT/.env" INSTALL_ID)" == "$install_id" && "$(ss_field "$SS_INSTALL_ROOT/.env" COMPOSE_PROJECT_NAME)" == "$project_name" ]] || return 1
  fi
}
ss_bootstrap_owned() {
  local marker="$SS_INSTALL_ROOT/.starstudy-bootstrap" commit_value
  ss_repo_owned && ss_owned "$marker" && [[ -f "$marker" ]] || return 1
  [[ "$(ss_field "$marker" APP)" == StarStudyBootstrap && "$(ss_field "$marker" FORMAT_VERSION)" == 1 && "$(ss_field "$marker" REPOSITORY)" == "$SS_REPOSITORY" && "$(ss_field "$marker" ROOT_PATH)" == "$SS_INSTALL_ROOT" ]] || return 1
  commit_value=$(ss_field "$marker" COMMIT_SHA) || return 1
  [[ "$commit_value" =~ ^[0-9a-f]{40}$ && "$(git -c core.hooksPath=/dev/null -C "$SS_INSTALL_ROOT" rev-parse HEAD)" == "$commit_value" ]]
}
ss_require_install() {
  command -v git >/dev/null || { ss_fail '未检测到Git，请先选择1检查/准备环境。';return 1; }
  ss_install_owned || { ss_fail '没有可确认归属的星研安装；未操作任何目录或Docker资源。首次安装请选择1。';return 1; }
  [[ -f "$SS_INSTALL_ROOT/.env" ]] || { ss_fail '此安装尚未完成配置，请选择1安全重试。';return 1; }
}
ss_check_docker_target() {
  [[ -z "${DOCKER_HOST:-}" || "${DOCKER_HOST:-}" == unix:///var/run/docker.sock ]] || { ss_fail '检测到非默认DOCKER_HOST，不会操作远程或其他Docker守护进程。';return 1; }
  [[ -z "${DOCKER_CONTEXT:-}" || "${DOCKER_CONTEXT:-}" == default ]] || { ss_fail '检测到自定义DOCKER_CONTEXT，不会切换或操作未知Docker环境。';return 1; }
  if command -v docker >/dev/null;then
    [[ "$(docker context show 2>/dev/null)" == default ]] || { ss_fail '当前Docker context不是default，请先人工核对。';return 1; }
  fi
}
ss_supported_system() {
  local system_id system_version memory_kb disk_kb
  [[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { ss_fail '安装仅支持Linux x86_64；ARM64和其他平台尚未完成验证。';return 1; }
  [[ -r /etc/os-release ]] || { ss_fail '无法识别Linux发行版。';return 1; }
  system_id=$(ss_field /etc/os-release ID | tr -d '"') || return 1
  system_version=$(ss_field /etc/os-release VERSION_ID | tr -d '"') || return 1
  case "$system_id:$system_version" in
    ubuntu:22.04) SS_DOCKER_OS=ubuntu;SS_DOCKER_SUITE=jammy;;
    ubuntu:24.04) SS_DOCKER_OS=ubuntu;SS_DOCKER_SUITE=noble;;
    debian:12) SS_DOCKER_OS=debian;SS_DOCKER_SUITE=bookworm;;
    debian:13) SS_DOCKER_OS=debian;SS_DOCKER_SUITE=trixie;;
    *) ss_fail '只支持Ubuntu22.04/24.04或Debian12/13，不会修改当前系统。';return 1;;
  esac
  memory_kb=$(awk '/MemTotal/{print $2}' /proc/meminfo) || return 1
  if [[ -d /opt ]];then disk_kb=$(df -Pk /opt | awk 'NR==2{print $4}') || return 1
  else disk_kb=$(df -Pk / | awk 'NR==2{print $4}') || return 1;fi
  [[ "$memory_kb" =~ ^[0-9]+$ && "$disk_kb" =~ ^[0-9]+$ ]] || { ss_fail '无法读取可用内存或磁盘空间。';return 1; }
  ((memory_kb>=2000000 && disk_kb>=5000000)) || { ss_fail '需要至少2GB内存、/opt所在磁盘5GB可用空间，构建建议4GB内存。';return 1; }
}
ss_prepare_tools() {
  local tool missing=0
  for tool in curl git jq openssl ss dig python3 tar sha256sum flock;do command -v "$tool" >/dev/null || missing=1;done
  [[ -s /etc/ssl/certs/ca-certificates.crt ]] || missing=1
  if ((missing));then
    ss_message '正在从系统APT源安装缺少的基础依赖；不升级现有软件包。'
    apt-get update || { ss_fail 'APT索引更新失败，未继续安装。请检查网络和系统软件源。';return 1; }
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends --no-upgrade ca-certificates curl git jq openssl iproute2 dnsutils python3 tar coreutils util-linux || { ss_fail '基础依赖安装失败，未继续部署。';return 1; }
  fi
  for tool in curl git jq openssl ss dig python3 tar sha256sum flock;do command -v "$tool" >/dev/null || { ss_fail "基础依赖未就绪：$tool";return 1; };done
}
ss_temporary() {
  if [[ -z "$SS_TEMPORARY" ]];then SS_TEMPORARY=$(mktemp -d /tmp/starstudy-manager.XXXXXXXX) || return 1;fi
  [[ "$SS_TEMPORARY" == /tmp/starstudy-manager.* && -d "$SS_TEMPORARY" && ! -L "$SS_TEMPORARY" ]]
}
ss_cleanup() {
  case "$SS_TEMPORARY" in /tmp/starstudy-manager.*) [[ ! -L "$SS_TEMPORARY" ]] && rm -rf -- "$SS_TEMPORARY";;esac
  SS_TEMPORARY=''
}
ss_api() {
  local api_url=$1 output_path=$2 status_value
  status_value=$(curl --proto '=https' --proto-redir '=https' --tlsv1.2 --silent --show-error --location --connect-timeout 10 --max-time 40 --retry 2 -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' --output "$output_path" --write-out '%{http_code}' "$api_url") || { ss_fail '官方GitHub API访问失败；请检查网络后重试，不会替换已有文件。';return 1; }
  case "$status_value" in 200) return 0;;404) return 4;;*) ss_fail "官方GitHub API返回HTTP $status_value，可能限流或网络异常。";return 1;;esac
}
ss_commit() {
  local reference_value=$1 output_variable=$2 commit_value
  [[ "$reference_value" == main || "$reference_value" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  ss_temporary || return 1
  ss_api "$SS_API_ROOT/commits/$reference_value" "$SS_TEMPORARY/commit.json" || return 1
  commit_value=$(jq -er '.sha | select(type=="string")' "$SS_TEMPORARY/commit.json") || { ss_fail '官方提交JSON格式无效。';return 1; }
  [[ "$commit_value" =~ ^[0-9a-f]{40}$ ]] || { ss_fail '官方提交标识无效，已停止下载。';return 1; }
  printf -v "$output_variable" '%s' "$commit_value"
}
ss_latest_release() {
  local response_code=0 tag_value
  SS_RELEASE_TAG=''
  ss_temporary || return 1
  ss_api "$SS_API_ROOT/releases/latest" "$SS_TEMPORARY/release.json" || response_code=$?
  if ((response_code==4));then return 0;fi
  ((response_code==0)) || return 1
  tag_value=$(jq -er 'select(.draft==false and .prerelease==false) | .tag_name | select(type=="string")' "$SS_TEMPORARY/release.json") || { ss_fail '未取得可确认的正式稳定版本。';return 1; }
  [[ "$tag_value" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { ss_fail '发布标签不是支持的稳定语义版本，未执行更新。';return 1; }
  SS_RELEASE_TAG=$tag_value
}
ss_download() {
  local download_url=$1 output_file=$2
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --silent --show-error --location --connect-timeout 10 --max-time 180 --retry 2 --output "$output_file" "$download_url" || { ss_fail '官方文件下载失败，原文件保持不变。';return 1; }
  [[ -s "$output_file" ]] || { ss_fail '下载文件为空，未安装。';return 1; }
}
ss_compose_plugin() {
  local compose_tag asset_digest computed_digest plugin_path=/usr/local/lib/docker/cli-plugins/docker-compose
  ss_temporary || return 1
  ss_api 'https://api.github.com/repos/docker/compose/releases/latest' "$SS_TEMPORARY/compose-release.json" || return 1
  compose_tag=$(jq -er 'select(.draft==false and .prerelease==false)|.tag_name' "$SS_TEMPORARY/compose-release.json") || return 1
  [[ "$compose_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { ss_fail 'Docker Compose正式版本标识无效。';return 1; }
  asset_digest=$(jq -er '.assets[]|select(.name=="docker-compose-linux-x86_64")|.digest' "$SS_TEMPORARY/compose-release.json") || return 1
  [[ "$asset_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { ss_fail '官方Compose资产缺少SHA256，不能安全安装。';return 1; }
  [[ ! -e "$plugin_path" && ! -L "$plugin_path" ]] || { ss_fail 'Compose目标已存在但不可用；不会覆盖未知插件，请先人工核对。';return 1; }
  ss_download "https://github.com/docker/compose/releases/download/$compose_tag/docker-compose-linux-x86_64" "$SS_TEMPORARY/docker-compose" || return 1
  computed_digest=$(sha256sum "$SS_TEMPORARY/docker-compose" | awk '{print $1}') || return 1
  [[ "sha256:$computed_digest" == "$asset_digest" ]] || { ss_fail 'Compose下载校验失败，未安装。';return 1; }
  if [[ ! -e /usr/local/lib/docker/cli-plugins ]];then
    ss_owned /usr/local/lib || { ss_fail 'Docker插件父目录归属异常，未安装。';return 1; }
    install -d -m 755 /usr/local/lib/docker/cli-plugins || return 1
  fi
  ss_owned /usr/local/lib/docker/cli-plugins || { ss_fail 'Compose插件目录归属或权限异常。';return 1; }
  install -m 755 -o root -g root "$SS_TEMPORARY/docker-compose" "$plugin_path" || return 1
  docker compose version >/dev/null || return 1
}
ss_prepare_docker() {
  local conflict_package repository_file=/etc/apt/sources.list.d/starstudy-docker.sources key_file=/etc/apt/keyrings/starstudy-docker.asc existing_source
  ss_check_docker_target || return 1
  if command -v docker >/dev/null;then
    ss_message '检测到现有Docker：保留现有引擎，不升级、不重启其他项目。'
    if ! docker compose version >/dev/null 2>&1;then ss_compose_plugin || return 1;fi
  else
    for conflict_package in docker.io docker-compose docker-compose-v2 podman-docker containerd runc;do
      if dpkg-query -W -f='${Status}' "$conflict_package" 2>/dev/null | grep -qx 'install ok installed';then ss_fail "发现现有运行时包$conflict_package；不会自动卸载，请先核对其他项目。";return 1;fi
    done
    existing_source=$(grep -sl 'download.docker.com/linux/' /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources 2>/dev/null || true)
    if [[ -n "$existing_source" && "$existing_source" != "$repository_file" ]];then ss_fail '已有其他Docker APT源而引擎未就绪，不会覆盖；请先人工核对来源。';return 1;fi
    if [[ -e "$repository_file" || -L "$repository_file" ]];then ss_owned "$repository_file" && grep -qx '# Managed by StarStudy manager' "$repository_file" || { ss_fail 'Docker源文件归属未知，不会覆盖。';return 1; };fi
    if [[ -e "$key_file" || -L "$key_file" ]];then ss_owned "$key_file" && [[ -e "$repository_file" ]] || { ss_fail 'Docker签名密钥归属未知，不会覆盖。';return 1; };fi
    ss_temporary || return 1
    ss_download "https://download.docker.com/linux/$SS_DOCKER_OS/gpg" "$SS_TEMPORARY/docker.asc" || return 1
    grep -q '^-----BEGIN PGP PUBLIC KEY BLOCK-----' "$SS_TEMPORARY/docker.asc" || { ss_fail 'Docker官方APT签名密钥格式无效。';return 1; }
    if [[ ! -e /etc/apt/keyrings ]];then install -d -m 755 /etc/apt/keyrings || return 1;fi
    ss_owned /etc/apt/keyrings && ss_owned /etc/apt/sources.list.d || { ss_fail 'APT配置目录归属或权限异常，未继续。';return 1; }
    install -m 644 "$SS_TEMPORARY/docker.asc" "$key_file" || return 1
    printf '# Managed by StarStudy manager\nTypes: deb\nURIs: https://download.docker.com/linux/%s\nSuites: %s\nComponents: stable\nArchitectures: amd64\nSigned-By: %s\n' "$SS_DOCKER_OS" "$SS_DOCKER_SUITE" "$key_file" > "$repository_file" || return 1
    chmod 644 "$repository_file" || return 1
    apt-get update || { ss_fail 'Docker软件源更新失败，未继续安装。';return 1; }
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin || { ss_fail 'Docker安装失败，未启动应用。';return 1; }
  fi
  if ! docker info >/dev/null 2>&1;then
    command -v systemctl >/dev/null || { ss_fail 'Docker未运行且没有systemd，未擅自修复；请先检查服务。';return 1; }
    if systemctl is-active --quiet docker;then ss_fail 'Docker服务运行但无法访问，未重启守护进程，请人工诊断。';return 1;fi
    ss_message 'Docker未运行，正在启动Docker服务；不会重启已运行的引擎。'
    systemctl start docker || { ss_fail 'Docker服务启动失败，请通过菜单9诊断。';return 1; }
  fi
  docker info >/dev/null || { ss_fail '无法访问Docker，未继续部署。';return 1; }
  # Compose v2 command interface is also implemented by newer compatible plugin majors.
  docker compose version >/dev/null || { ss_fail 'Docker Compose命令接口不可用。';return 1; }
}
ss_verified_manager() {
  local commit_value=$1 output_variable=$2 blob_value size_value computed_blob candidate
  [[ "$commit_value" =~ ^[0-9a-f]{40}$ ]] || return 1
  ss_temporary || return 1
  ss_api "$SS_API_ROOT/contents/starstudy.sh?ref=$commit_value" "$SS_TEMPORARY/manager-asset.json" || return 1
  blob_value=$(jq -er 'select(.type=="file" and .path=="starstudy.sh")|.sha' "$SS_TEMPORARY/manager-asset.json") || { ss_fail '管理脚本JSON缺少可验证的blob。';return 1; }
  size_value=$(jq -er '.size|select(type=="number")' "$SS_TEMPORARY/manager-asset.json") || { ss_fail '管理脚本JSON缺少有效长度。';return 1; }
  [[ "$blob_value" =~ ^[0-9a-f]{40}$ && "$size_value" =~ ^[0-9]+$ ]] && ((size_value>100 && size_value<500000)) || { ss_fail '官方管理脚本元数据无效。';return 1; }
  candidate="$SS_TEMPORARY/starstudy-$commit_value.sh"
  ss_download "https://raw.githubusercontent.com/$SS_REPOSITORY/$commit_value/starstudy.sh" "$candidate" || return 1
  [[ "$(wc -c < "$candidate")" == "$size_value" ]] || { ss_fail '管理脚本下载长度不符，未替换。';return 1; }
  computed_blob=$(git hash-object --no-filters -- "$candidate") || { ss_fail '无法计算管理脚本blob，未替换。';return 1; }
  [[ "$computed_blob" == "$blob_value" ]] || { ss_fail '管理脚本Git blob校验失败，未替换。';return 1; }
  bash -n "$candidate" || { ss_fail '管理脚本Bash语法检查失败，未替换。';return 1; }
  grep -qx '# StarStudy managed entrypoint. Repository: Hezyy/StarStudy' "$candidate" || { ss_fail '管理脚本标识缺失，未替换。';return 1; }
  SS_MANAGER_BLOB=$blob_value
  printf -v "$output_variable" '%s' "$candidate"
}
ss_install_manager() {
  local commit_value=$1 candidate_path=$2 target_directory temporary_command temporary_config previous_command='' existing_blob
  [[ "$commit_value" =~ ^[0-9a-f]{40}$ && "${SS_MANAGER_BLOB:-}" =~ ^[0-9a-f]{40}$ ]] || return 1
  [[ -f "$candidate_path" && ! -L "$candidate_path" && "$(git hash-object --no-filters -- "$candidate_path")" == "$SS_MANAGER_BLOB" ]] || { ss_fail '待安装脚本在验证后发生变化，未替换。';return 1; }
  bash -n "$candidate_path" || return 1
  target_directory=$(dirname -- "$SS_COMMAND_PATH") || return 1
  ss_owned "$target_directory" && [[ -d "$target_directory" ]] || { ss_fail '本机命令目录归属/权限异常，未替换。';return 1; }
  ss_lock || return 1
  if [[ -e "$SS_COMMAND_PATH" || -L "$SS_COMMAND_PATH" ]];then
    ss_check_manager_config && ss_owned "$SS_COMMAND_PATH" && [[ -f "$SS_COMMAND_PATH" ]] && grep -qx '# StarStudy managed entrypoint. Repository: Hezyy/StarStudy' "$SS_COMMAND_PATH" || { ss_fail '已存在未知同名starstudy命令，未覆盖。';return 1; }
    existing_blob=$(ss_field "$SS_CONFIG_ROOT/manager.conf" MANAGER_BLOB_SHA) || return 1
    [[ "$existing_blob" =~ ^[0-9a-f]{40}$ && "$(git hash-object --no-filters -- "$SS_COMMAND_PATH")" == "$existing_blob" ]] || { ss_fail '本机管理脚本有未确认修改，未覆盖；请先人工保存并核对。';return 1; }
  fi
  temporary_command=$(mktemp "$target_directory/.starstudy.XXXXXXXX") || return 1
  install -m 755 -o root -g root "$candidate_path" "$temporary_command" || return 1
  temporary_config=$(mktemp "$SS_CONFIG_ROOT/.manager.conf.XXXXXXXX") || return 1
  printf 'APP=StarStudyManager\nFORMAT_VERSION=1\nREPOSITORY=%s\nROOT_PATH=%s\nMANAGER_COMMIT=%s\nMANAGER_BLOB_SHA=%s\n' "$SS_REPOSITORY" "$SS_INSTALL_ROOT" "$commit_value" "$SS_MANAGER_BLOB" > "$temporary_config" || return 1
  chmod 600 "$temporary_config" || return 1
  if [[ -f "$SS_COMMAND_PATH" ]];then
    previous_command=$(mktemp "$target_directory/.starstudy.previous.XXXXXXXX") || return 1
    cp -p -- "$SS_COMMAND_PATH" "$previous_command" || return 1
  fi
  mv -T -- "$temporary_command" "$SS_COMMAND_PATH" || { ss_fail '本机管理脚本替换失败，旧命令保持不变。';return 1; }
  if ! mv -T -- "$temporary_config" "$SS_CONFIG_ROOT/manager.conf";then
    if [[ -n "$previous_command" ]];then
      mv -T -- "$previous_command" "$SS_COMMAND_PATH" || { ss_fail '管理元数据写入失败且旧命令恢复失败，请保留临时文件并人工修复。';return 1; }
    else
      # Only this operation's newly installed command is removed, never an unknown existing command.
      [[ "$(git hash-object --no-filters -- "$SS_COMMAND_PATH")" == "$SS_MANAGER_BLOB" ]] && rm -- "$SS_COMMAND_PATH"
    fi
    ss_fail '管理元数据替换失败，未保留不一致的新命令。';return 1
  fi
  if [[ -n "$previous_command" ]];then rm -- "$previous_command" || return 1;fi
  ss_message '本机管理命令已验证安装，后续运行：sudo starstudy'
}
ss_prepare_manager_state() {
  local configuration_staging parent_directory
  if [[ -e "$SS_CONFIG_ROOT" || -L "$SS_CONFIG_ROOT" ]];then
    ss_check_manager_config || { ss_fail '/etc/starstudy已有未知配置，未覆盖。';return 1; }
    return 0
  fi
  [[ ! -e "$SS_COMMAND_PATH" && ! -L "$SS_COMMAND_PATH" ]] || { ss_fail '已存在未知同名starstudy命令，未创建配置或覆盖命令。';return 1; }
  parent_directory=$(dirname -- "$SS_CONFIG_ROOT") || return 1
  ss_owned "$parent_directory" || { ss_fail '管理配置父目录归属异常。';return 1; }
  configuration_staging=$(mktemp -d "$parent_directory/.starstudy-config.XXXXXXXX") || return 1
  printf 'APP=StarStudyManager\nFORMAT_VERSION=1\nREPOSITORY=%s\nROOT_PATH=%s\nMANAGER_COMMIT=\nMANAGER_BLOB_SHA=\n' "$SS_REPOSITORY" "$SS_INSTALL_ROOT" > "$configuration_staging/manager.conf" || return 1
  chmod 600 "$configuration_staging/manager.conf" || return 1
  mv -T -n -- "$configuration_staging" "$SS_CONFIG_ROOT" || return 1
  [[ ! -e "$configuration_staging" ]] || { ss_fail '配置目录出现并发变化，未覆盖；请重试。';return 1; }
  ss_check_manager_config
}
ss_lock() {
  local lock_path="$SS_CONFIG_ROOT/operation.lock"
  if [[ "$SS_LOCK_HELD_ROOT" == "$SS_CONFIG_ROOT" ]];then return 0;fi
  ss_prepare_manager_state || return 1
  command -v flock >/dev/null || { ss_fail '缺少flock，请选择1准备基础环境。';return 1; }
  if [[ -e "$lock_path" || -L "$lock_path" ]];then ss_owned "$lock_path" && [[ -f "$lock_path" ]] || { ss_fail '运维锁归属异常。';return 1; };fi
  exec 9>>"$lock_path" || return 1
  chmod 600 "$lock_path" || return 1
  flock -n 9 || { ss_fail '另一项星研运维正在进行，请等待结束；未重复提交操作。';return 1; }
  SS_LOCK_HELD_ROOT=$SS_CONFIG_ROOT
  export STAR_STUDY_LOCK_ROOT="$SS_INSTALL_ROOT"
}
ss_checkout_project() {
  local commit_value=$1 staged_root
  [[ ! -e "$SS_INSTALL_ROOT" && ! -L "$SS_INSTALL_ROOT" ]] || { ss_fail '安装目录已存在，不会覆盖。';return 1; }
  if [[ ! -e /opt && ! -L /opt ]];then
    ss_owned / || { ss_fail '根目录归属异常，未创建/opt。';return 1; }
    install -d -m 755 /opt || return 1
  fi
  ss_owned /opt && [[ -d /opt ]] || { ss_fail '/opt目录归属或权限异常。';return 1; }
  staged_root=$(mktemp -d /opt/.starstudy-download.XXXXXXXX) || return 1
  git -c core.hooksPath=/dev/null init --quiet "$staged_root" || return 1
  git -c core.hooksPath=/dev/null -C "$staged_root" remote add origin "$SS_REPOSITORY_URL" || return 1
  git -c core.hooksPath=/dev/null -C "$staged_root" fetch --quiet --depth=1 origin "$commit_value" || { ss_fail '固定提交下载失败，未移动到安装目录。';return 1; }
  git -c core.hooksPath=/dev/null -C "$staged_root" checkout --quiet --detach "$commit_value" || return 1
  [[ "$(git -C "$staged_root" rev-parse HEAD)" == "$commit_value" && -f "$staged_root/scripts/install.sh" && -f "$staged_root/compose.yaml" ]] || { ss_fail '下载的项目不符合锁定版本，临时目录保留以供检查。';return 1; }
  printf 'APP=StarStudyBootstrap\nFORMAT_VERSION=1\nREPOSITORY=%s\nROOT_PATH=%s\nCOMMIT_SHA=%s\n' "$SS_REPOSITORY" "$SS_INSTALL_ROOT" "$commit_value" > "$staged_root/.starstudy-bootstrap" || return 1
  chmod 600 "$staged_root/.starstudy-bootstrap" || return 1
  [[ ! -e "$SS_INSTALL_ROOT" && ! -L "$SS_INSTALL_ROOT" ]] || { ss_fail '下载期间安装目录出现变化，未覆盖。';return 1; }
  mv -T -n -- "$staged_root" "$SS_INSTALL_ROOT" || return 1
  [[ ! -e "$staged_root" ]] || { ss_fail '安装目录出现并发变化，未覆盖；临时下载已保留。';return 1; }
}
ss_operation() {
  local script_name=$1;shift
  ss_require_install || return 1
  ss_check_docker_target || return 1
  [[ "$script_name" =~ ^(install|update|uninstall|backup|restore|doctor)\.sh$ ]] || return 1
  ss_owned "$SS_INSTALL_ROOT/scripts" && ss_owned "$SS_INSTALL_ROOT/scripts/$script_name" && [[ -f "$SS_INSTALL_ROOT/scripts/$script_name" ]] || { ss_fail '运维脚本归属或权限异常，拒绝执行。';return 1; }
  case "$script_name:${1:-}" in doctor.sh:--status|doctor.sh:--logs|doctor.sh:) ;;*) ss_lock || return 1;;esac
  STAR_STUDY_MANAGED=1 STAR_STUDY_TTY_FD=3 bash "$SS_INSTALL_ROOT/scripts/$script_name" "$@"
}
ss_install() {
  local selected_commit candidate_path confirmation_value existing_marker
  ss_supported_system || return 1
  if [[ -e "$SS_INSTALL_ROOT" || -L "$SS_INSTALL_ROOT" ]];then
    ss_owned "$SS_INSTALL_ROOT" && [[ -d "$SS_INSTALL_ROOT" ]] || { ss_fail '/opt/starstudy为未知已有目录，未安装依赖或覆盖内容；请先人工核对归属。';return 1; }
    if [[ -e "$SS_INSTALL_ROOT/.starstudy-install" || -L "$SS_INSTALL_ROOT/.starstudy-install" ]];then existing_marker="$SS_INSTALL_ROOT/.starstudy-install"
    else existing_marker="$SS_INSTALL_ROOT/.starstudy-bootstrap";fi
    ss_owned "$existing_marker" && [[ -f "$existing_marker" ]] && [[ "$(ss_field "$existing_marker" ROOT_PATH)" == "$SS_INSTALL_ROOT" && "$(ss_field "$existing_marker" FORMAT_VERSION)" == 1 ]] || { ss_fail '已有目录缺少有效的归属标记，未安装依赖或改动目录。';return 1; }
  fi
  ss_prepare_tools || return 1
  if [[ -e "$SS_INSTALL_ROOT" || -L "$SS_INSTALL_ROOT" ]];then
    if ss_install_owned;then
      ss_message '检测到已有星研安装，不会覆盖.env、端口、随机路径、证书或数据。可保留原配置重试未完成的安装。'
      ss_read confirmation_value '输入 RESUME INSTALL 保留配置重试，其他返回：' || return 1
      [[ "$confirmation_value" == 'RESUME INSTALL' ]] || return 0
      ss_lock || return 1
      if ! ss_check_manager_config || ! ss_owned "$SS_COMMAND_PATH";then
        ss_commit main selected_commit || return 1
        ss_verified_manager "$selected_commit" candidate_path || return 1
        ss_install_manager "$selected_commit" "$candidate_path" || return 1
      fi
      ss_prepare_docker || return 1
      if [[ -f "$SS_INSTALL_ROOT/.env" ]];then ss_operation install.sh --managed --resume || return 1
      else ss_owned "$SS_INSTALL_ROOT/scripts/install.sh" || return 1;STAR_STUDY_MANAGED=1 STAR_STUDY_TTY_FD=3 bash "$SS_INSTALL_ROOT/scripts/install.sh" --managed || return 1;fi
      return
    elif ss_bootstrap_owned && [[ ! -e "$SS_INSTALL_ROOT/.env" && ! -L "$SS_INSTALL_ROOT/.env" ]];then
      selected_commit=$(ss_field "$SS_INSTALL_ROOT/.starstudy-bootstrap" COMMIT_SHA) || return 1
      ss_message "恢复此前已锁定的下载：${selected_commit:0:12}；不会改用新的开发提交。"
    else ss_fail '/opt/starstudy目录归属无法确认或包含未知数据。已停止；请人工核对，不会覆盖或清理。';return 1;fi
  else
    ss_latest_release || return 1
    if [[ -n "$SS_RELEASE_TAG" ]];then
      ss_commit "$SS_RELEASE_TAG" selected_commit || return 1
      ss_message "将安装官方稳定版本 $SS_RELEASE_TAG（${selected_commit:0:12}）。"
    else
      ss_commit main selected_commit || return 1
      ss_message "当前仓库尚无正式稳定版。锁定的main开发快照：${selected_commit:0:12}。此快照未完成真实生产环境验收。"
      ss_read confirmation_value '仅在理解上述限制后输入 INSTALL DEVELOPMENT SNAPSHOT，其他取消：' || return 1
      [[ "$confirmation_value" == 'INSTALL DEVELOPMENT SNAPSHOT' ]] || return 0
    fi
  fi
  ss_verified_manager "$selected_commit" candidate_path || return 1
  ss_lock || return 1
  ss_install_manager "$selected_commit" "$candidate_path" || return 1
  ss_prepare_docker || return 1
  if [[ ! -e "$SS_INSTALL_ROOT" && ! -L "$SS_INSTALL_ROOT" ]];then ss_checkout_project "$selected_commit" || return 1;fi
  ss_owned "$SS_INSTALL_ROOT/scripts/install.sh" || { ss_fail '安装脚本归属异常。';return 1; }
  STAR_STUDY_MANAGED=1 STAR_STUDY_TTY_FD=3 bash "$SS_INSTALL_ROOT/scripts/install.sh" --managed
}
ss_update() {
  local update_choice selected_commit candidate_path
  ss_message '1. 更新应用到正式稳定版';ss_message '2. 安全更新本机管理脚本';ss_message '0. 返回'
  ss_read update_choice '请选择：' || return 1
  case "$update_choice" in
    1)
      ss_require_install || return 1
      ss_latest_release || return 1
      if [[ -z "$SS_RELEASE_TAG" ]];then ss_message '当前没有可用的正式稳定版，未更新应用。不会无条件拉取main。';return 0;fi
      ss_message "目标正式稳定版：$SS_RELEASE_TAG；将先备份并保留现有域名、端口和随机路径。"
      ss_operation update.sh "$SS_RELEASE_TAG";;
    2)
      ss_check_manager_config && ss_owned "$SS_COMMAND_PATH" || { ss_fail '尚无可确认的本机管理脚本，请先选择1安装。';return 1; }
      for update_choice in curl git jq;do command -v "$update_choice" >/dev/null || { ss_fail '管理脚本更新依赖未就绪，请先选择1检查环境。';return 1; };done
      ss_commit main selected_commit || return 1
      ss_verified_manager "$selected_commit" candidate_path || return 1
      ss_install_manager "$selected_commit" "$candidate_path" || return 1
      ss_message '本机管理脚本已更新；当前会话不热替换代码，退出后运行sudo starstudy使用新版本。';;
    0) return 0;;
    *) ss_message '无效选择，未执行任何更新。';;
  esac
}
ss_uninstall() {
  local uninstall_choice
  ss_require_install || return 1
  ss_message '1. 普通卸载：仅移除星研服务，保留数据库、配置、证书和备份'
  ss_message '2. 完全卸载：先列出可确认归属的数据，再二次确认永久删除'
  ss_message '0. 返回主菜单'
  ss_read uninstall_choice '请选择：' || return 1
  case "$uninstall_choice" in 1) ss_operation uninstall.sh;;2) ss_operation uninstall.sh --purge;;0) return 0;;*) ss_message '无效选择，未执行卸载。';;esac
}
ss_logs() {
  local log_choice
  ss_require_install || return 1
  ss_message '1. 查看最近日志（默认脱敏）';ss_message '2. 跟随实时日志（Ctrl+C返回菜单）';ss_message '0. 返回'
  ss_read log_choice '请选择：' || return 1
  case "$log_choice" in 1) ss_operation doctor.sh --logs;;2) ss_operation doctor.sh --logs --follow;;0) return 0;;*) ss_message '无效选择，未读取日志。';;esac
}
ss_restore() {
  local install_id backup_directory selected_index entry count=0
  local -a backup_directories=()
  ss_require_install || return 1
  install_id=$(ss_field "$SS_INSTALL_ROOT/.starstudy-install" INSTALL_ID) || return 1
  backup_directory="/var/backups/starstudy/$install_id"
  [[ -d "$backup_directory" && ! -L "$backup_directory" ]] || { ss_message '尚未找到此安装的本机备份。';return 0; }
  ss_owned "$backup_directory" || { ss_fail '备份目录归属或权限异常。';return 1; }
  while IFS= read -r -d '' entry;do
    [[ -f "$entry/manifest.json" && -f "$entry/SHA256SUMS" && ! -L "$entry" ]] || continue
    backup_directories+=("$entry");count=$((count+1));ss_message "$count. $(basename -- "$entry")"
  done < <(find "$backup_directory" -mindepth 1 -maxdepth 1 -type d -print0 | sort -zr)
  ((count>0)) || { ss_message '没有可预览的完整备份；不完整目录请先人工核对。';return 0; }
  ss_message '0. 返回（恢复前会验证目标、停写、备份当前数据并再次明确确认）'
  ss_read selected_index '选择备份序号：' || return 1
  [[ "$selected_index" == 0 ]] && return 0
  [[ "$selected_index" =~ ^[1-9][0-9]{0,5}$ ]] && ((selected_index<=count)) || { ss_message '无效选择，未执行恢复。';return 0; }
  ss_operation restore.sh "${backup_directories[selected_index-1]}"
}
ss_diagnostics() {
  ss_message "系统：$(uname -s) $(uname -m)；磁盘："
  if [[ -d /opt ]];then df -h /opt || return 1;else df -h / || return 1;fi
  if command -v docker >/dev/null;then ss_check_docker_target || return 1;docker compose version || return 1;else ss_message '尚未安装Docker，选择1可自动准备受支持环境。';fi
  if command -v git >/dev/null && ss_install_owned && [[ -f "$SS_INSTALL_ROOT/.env" ]];then ss_operation doctor.sh;else ss_message '未识别到完整星研安装，未尝试修改配置或清理资源。';fi
}
ss_execute() {
  local action_function=$1;shift
  local action_status
  set +e
  (
    set -Eeuo pipefail
    trap 'ss_message "当前操作已中断；未执行自动卸载或清理，请从状态/诊断检查后继续。";exit 130' INT
    trap 'ss_message "当前操作未完成，已有配置和数据保留。请修正提示的问题后重试。"' ERR
    trap ss_cleanup EXIT
    "$action_function" "$@"
  )
  action_status=$?
  set -e
  if ((action_status!=0));then ss_message "操作返回状态$action_status，现已回到管理菜单。";fi
  return 0
}
ss_dispatch() {
  case "$1" in
    1) ss_execute ss_install;;2) ss_execute ss_update;;3) ss_execute ss_uninstall;;
    4) ss_execute ss_operation doctor.sh --status;;5) ss_execute ss_logs;;
    6) ss_execute ss_operation doctor.sh --restart;;7) ss_execute ss_operation backup.sh;;
    8) ss_execute ss_restore;;9) ss_execute ss_diagnostics;;
    *) ss_message '无效输入，请输入0—9，未执行任何操作。';;
  esac
}
ss_main() {
  if ! { exec 3<>/dev/tty; } 2>/dev/null;then printf '星研管理需要真实交互终端。请通过SSH终端运行以下命令；未执行安装或修改。\ncurl -fsSL https://raw.githubusercontent.com/Hezyy/StarStudy/main/starstudy.sh | sudo bash\n已有本机命令时可运行：sudo starstudy\n' >&2;return 1;fi
  [[ -t 3 ]] || { ss_fail '未取得真实终端，请在SSH会话中运行。';return 1; }
  [[ "${EUID:-$(id -u)}" == 0 ]] || { ss_fail '请使用sudo运行星研管理脚本。';return 1; }
  [[ "$(uname -s)" == Linux ]] || { ss_fail '统一部署管理只支持Linux，未修改当前系统。';return 1; }
  export STAR_STUDY_MANAGED=1 STAR_STUDY_TTY_FD=3
  ss_menu
}
ss_menu() {
  local menu_choice
  SS_INTERRUPTED=0
  trap 'SS_INTERRUPTED=1;ss_message "已中断当前选择，返回菜单；没有自动卸载数据。"' INT
  trap 'ss_message "管理会话已结束，已有数据保留。";exit 143' TERM
  while true;do
    ss_message '';ss_message '══════════ 星研 StarStudy 管理 ══════════'
    ss_message '1. 安装 StarStudy';ss_message '2. 更新 StarStudy';ss_message '3. 卸载 StarStudy'
    ss_message '4. 查看运行状态';ss_message '5. 查看运行日志';ss_message '6. 重启服务'
    ss_message '7. 备份数据';ss_message '8. 恢复备份';ss_message '9. 检查系统环境和诊断问题';ss_message '0. 退出'
    SS_INTERRUPTED=0
    if ! ss_read menu_choice '请输入0—9：';then
      if ((SS_INTERRUPTED));then continue;fi
      ss_message '终端输入已结束，退出管理；没有清理数据。';break
    fi
    if [[ "$menu_choice" == 0 ]];then ss_message '已退出。后续管理：sudo starstudy';break;fi
    ss_dispatch "$menu_choice"
  done
}

if [[ "${BASH_SOURCE[0]:-$0}" == "$0" ]];then ss_main;fi
