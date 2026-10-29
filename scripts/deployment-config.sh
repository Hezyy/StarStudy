#!/usr/bin/env bash
# Internal helpers sourced by install/diagnostics. No user configuration is executed.
port_free() {
 local port=$1 listeners identifiers identifier bindings result
 listeners=$(ss -ltnH) || die '无法检查本机监听端口'
 if awk '{print $4}' <<<"$listeners" | grep -E ":${port}$" >/dev/null;then return 1;fi
 identifiers=$(docker ps --format '{{.ID}}') || die '无法检查Docker已发布端口'
 while IFS= read -r identifier;do
  [[ -z "$identifier" ]] && continue
  [[ "$identifier" =~ ^[a-f0-9]+$ ]] || die 'Docker容器标识无效'
  bindings=$(docker inspect --format '{{json .HostConfig.PortBindings}}' "$identifier") || die '无法读取Docker端口绑定'
  if python3 scripts/deployment-validation.py port "$port" <<<"$bindings";then return 1;else result=$?;[[ "$result" == 10 ]] || die 'Docker端口信息无法验证';fi
 done <<<"$identifiers"
 return 0
}
choose_https_port() {
 local requested=$1 random_value number candidate attempt max_unbiased
 if [[ -n "$requested" ]];then
  [[ "$requested" =~ ^[0-9]{1,5}$ ]] || die '端口须为1—65535的整数'
  candidate=$((10#$requested))
  ((candidate>=1 && candidate<=65535 && candidate!=80)) || die 'HTTPS端口无效或与HTTP-01的80端口冲突'
  port_free "$candidate" || die '所选端口已被进程或其他Docker服务使用，不会停止其他服务'
  printf '%s' "$candidate";return
 fi
 max_unbiased=$((4294967296 / 40001 * 40001))
 for ((attempt=0;attempt<50;attempt++));do
  random_value=$(openssl rand -hex 4) || die '安全随机数生成失败'
  [[ "$random_value" =~ ^[a-f0-9]{8}$ ]] || die '安全随机数格式错误'
  number=$((16#$random_value));((number<max_unbiased)) || continue
  candidate=$((20000+number%40001))
  if port_free "$candidate";then printf '%s' "$candidate";return;fi
 done
 die '50次尝试未找到可用随机端口，请重新选择安装并手动填写端口'
}
dns_check() {
 local domain=$1 resolved4 resolved6 public4 public6 local_addresses
 resolved4=$(dig +short +time=3 +tries=1 A "$domain") || die 'A记录查询失败，请检查DNS网络'
 resolved6=$(dig +short +time=3 +tries=1 AAAA "$domain") || die 'AAAA记录查询失败，请检查DNS网络'
 public4=$(curl -4 --noproxy '*' -fsS --connect-timeout 3 --max-time 6 https://api4.ipify.org 2>/dev/null || true)
 public6=$(curl -6 --noproxy '*' -fsS --connect-timeout 3 --max-time 6 https://api6.ipify.org 2>/dev/null || true)
 local_addresses=$(ip -j address show scope global | python3 scripts/deployment-validation.py addresses) || die '无法识别本机公网接口'
 python3 scripts/deployment-validation.py dns "$resolved4" "$resolved6" "$public4 $local_addresses" "$public6" || die 'DNS未通过，尚未开始申请证书；请修正解析后重试'
 printf 'A/AAAA记录与可确认的本机公网地址一致。\n'
}
certificate_expiry() {
 local domain port certificate
 domain=$(python3 scripts/deployment-validation.py url-domain "$(env_value PUBLIC_URL)")
 port=$(env_value HTTPS_PORT);port=${port:-443}
 certificate=$(timeout 12 openssl s_client -connect "127.0.0.1:$port" -servername "$domain" </dev/null 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null) || return 1
 printf '%s\n' "$certificate"
}
