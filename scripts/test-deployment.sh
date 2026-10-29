#!/usr/bin/env bash
# Isolated contract/control-flow checks. Docker, DNS, certificates and PG are mocks.
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
mkdir -p "$STAR_ROOT/backups"
fixture=$(mktemp -d "$STAR_ROOT/backups/deploy-check.XXXXXX")
fixture=$(cd -- "$fixture" && pwd -P)
case "$fixture" in "$STAR_ROOT"/backups/deploy-check.*) ;; *) die '测试路径校验失败';; esac
cleanup() { case "$fixture" in "$STAR_ROOT"/backups/deploy-check.*) rm -rf -- "$fixture" "$fixture-external";; esac; }
trap cleanup EXIT
mkdir -p "$fixture/scripts" "$fixture/mockbin" "$fixture/project" "$fixture/archives"
cp scripts/{common,backup,restore,uninstall,update,doctor,deployment-config,verify-backup}.sh "$fixture/scripts/"
cp scripts/deployment-validation.py "$fixture/scripts/"
cp compose.yaml Caddyfile package.json "$fixture/"
identity=0123456789abcdef0123456789abcdef
project=starstudy_${identity:0:12}
cat > "$fixture/.env" <<ENV
INSTALL_ID=$identity
COMPOSE_PROJECT_NAME=$project
POSTGRES_PASSWORD=synthetic-test-password-only
SESSION_SECRET=synthetic-test-session-secret-only-32-characters
SETUP_TOKEN=synthetic-test-setup-only
PUBLIC_URL=https://study.example.com:34567/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
SITE_ADDRESS=study.example.com
APP_BASE_PATH=/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
ACME_EMAIL=
ACME_EMAIL_DIRECTIVE=
HTTPS_PORT=34567
HTTP_PORT=80
ENV
printf 'APP=StarStudy\nFORMAT_VERSION=1\nINSTALL_ID=%s\nCOMPOSE_PROJECT_NAME=%s\nROOT_PATH=%s\n' "$identity" "$project" "$fixture" > "$fixture/.starstudy-install"
cat > "$fixture/mockbin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$STAR_MOCK_CALLS"
case "$*" in
 'info'|'compose version'|'compose version --short') printf '2.40.0\n';;
 'version --format '*) printf '28.0.0\n';;
 'ps --format '*) ;;
 'ps -a --filter volume='*) [[ "${STAR_MOCK_FOREIGN_CONSUMER:-0}" != 1 ]] || printf 'deadcafe\n';;
 'ps -a --filter label='*) [[ "${STAR_MOCK_ENUM_FAIL:-0}" != 1 ]] || exit 1;;
 'volume ls '*) printf '%s\n' "${COMPOSE_PROJECT_NAME}_postgres_data" "${COMPOSE_PROJECT_NAME}_caddy_data" "${COMPOSE_PROJECT_NAME}_caddy_config";;
 'volume inspect --format '*|'network inspect --format '*)
  if [[ "$*" == *io.starstudy.installation* ]];then [[ "${STAR_MOCK_FOREIGN_VOLUME:-0}" == 1 ]] && printf 'foreign\n' || printf '0123456789abcdef0123456789abcdef\n'
  elif [[ "$*" == *com.docker.compose.project* ]];then printf '%s\n' "$COMPOSE_PROJECT_NAME"
  elif [[ "$*" == *com.docker.compose.volume* ]];then v=${@: -1};printf '%s\n' "${v#${COMPOSE_PROJECT_NAME}_}"
  elif [[ "$*" == *com.docker.compose.network* ]];then printf 'default\n';fi;;
 'volume inspect '*|'network inspect '*) ;;
 'inspect --format '*) printf 'foreign\n';;
 'compose config --format json')
  printf '{"name":"%s","services":{"database":{},"app":{},"caddy":{},"migrate":{}},"volumes":{' "$COMPOSE_PROJECT_NAME"
  sep='';for v in postgres_data caddy_data caddy_config;do printf '%s"%s":{"name":"%s_%s"}' "$sep" "$v" "$COMPOSE_PROJECT_NAME" "$v";sep=,;done
  printf '},"networks":{"default":{"name":"%s_default"}}}\n' "$COMPOSE_PROJECT_NAME";;
 *pg_dump*)
  [[ "${STAR_MOCK_FAIL_DUMP:-0}" != 1 ]] || exit 43
  [[ "${STAR_MOCK_EMPTY_DUMP:-0}" != 1 ]] || exit 0
  printf 'synthetic-control-flow-dump-only\n';;
 *--single-transaction*) cat >/dev/null; [[ "${STAR_MOCK_FAIL_RESTORE:-0}" != 1 ]] || exit 42;;
 *pg_restore*) cat >/dev/null;;
 'compose run -T --rm migrate') [[ "${STAR_MOCK_FAIL_MIGRATE:-0}" != 1 ]] || exit 44;;
 *'--entrypoint tar caddy '*'-cf - .'*) cat "$STAR_MOCK_TAR";;
 *'--entrypoint tar caddy '*'-xf -'*) cat >/dev/null;[[ "${STAR_MOCK_FAIL_CERT:-0}" != 1 ]] || exit 45;;
 'compose logs '*) printf 'password=synthetic-test-password-only path=/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n';;
 'compose up -d'|'compose stop app caddy'|'compose down'|'compose down --volumes'|'compose restart app caddy'|'compose build') ;;
 'compose exec -T app '*|'compose exec -T database pg_isready '*) ;;
 *) printf 'UNEXPECTED MOCK DOCKER: %s\n' "$*" >&2;exit 90;;
esac
MOCK
cat > "$fixture/mockbin/git" <<'MOCK'
#!/usr/bin/env bash
set -eu
printf 'git %s\n' "$*" >> "$STAR_MOCK_CALLS"
case "$*" in
 'rev-parse HEAD') printf '0000000000000000000000000000000000000000\n';;
 'rev-parse --verify refs/tags/v0.4.0^{commit}') printf '1111111111111111111111111111111111111111\n';;
 'rev-parse --is-inside-work-tree') printf 'true\n';;
 'remote get-url origin') [[ "${STAR_MOCK_NO_ORIGIN:-0}" != 1 ]] || exit 1;printf 'https://github.com/Hezyy/StarStudy.git\n';;
 'status --porcelain --untracked-files=normal') [[ "${STAR_MOCK_DIRTY:-0}" != 1 ]] || printf ' M user-file\n';;
 'cat-file -e '*) [[ "${STAR_MOCK_LEGACY_RELEASE:-0}" != 1 ]] || exit 1;;
 'show 1111111111111111111111111111111111111111:package.json') printf '{"version":"0.4.0"}\n';;
 'fetch --no-tags origin refs/tags/v0.4.0:refs/tags/v0.4.0'|'switch --detach v0.4.0') ;;
 *) printf 'UNEXPECTED MOCK GIT: %s\n' "$*" >&2;exit 1;;
esac
MOCK
cat > "$fixture/mockbin/curl" <<'MOCK'
#!/usr/bin/env bash
if [[ "$*" == *api.github.com* ]];then
 [[ "${STAR_MOCK_NO_RELEASE:-0}" != 1 ]] || exit 22
 printf '{"tag_name":"v0.4.0","draft":false,"prerelease":false,"published_at":"2026-10-28T00:00:00Z"}\n'
else [[ "${STAR_MOCK_FAIL_HTTPS:-0}" != 1 ]] || exit 60;fi
MOCK
printf '#!/usr/bin/env bash\nexit 0\n' > "$fixture/mockbin/flock"
chmod +x "$fixture/mockbin/"*
export STAR_MOCK_CALLS="$fixture/docker-calls.log" STAR_MOCK_TAR="$fixture/archives/cert.tar"
export PATH="$fixture/mockbin:$PATH" PYTHONDONTWRITEBYTECODE=1
export STAR_BACKUP_DIR="$fixture-external"
# Deliberately pass a separate FD, never make production ask() consume piped stdin.
export STAR_STUDY_TTY_FD=3
cd -- "$fixture"
python3 - "$STAR_MOCK_TAR" <<'PY'
import io,sys,tarfile
with tarfile.open(sys.argv[1],'w') as t:
 m=tarfile.TarInfo('caddy/mock-certificate.txt');b=b'synthetic cert fixture only';m.size=len(b);m.mode=0o600;t.addfile(m,io.BytesIO(b))
PY
checks=0
pass() { checks=$((checks+1));printf 'ok %s - %s\n' "$checks" "$1"; }
reject() { if ("$@") >"$fixture/rejected.log" 2>&1;then die "预期失败但成功：$*";fi; }
bash scripts/backup.sh > "$fixture/backup.log"
saved=$(find "$STAR_BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name 'backup-*' | head -1)
[[ -f "$saved/caddy-data.tar" && -f "$saved/caddy-config.tar" && -f "$saved/.env" ]] || die '备份缺失证书/配置'
bash scripts/verify-backup.sh "$saved" >/dev/null
pass '完整数据库/图片所在JSONB/配置/证书备份及校验'
reject bash scripts/restore.sh "$saved" 3<<<'CANCEL'
! grep -q -- '--single-transaction' "$STAR_MOCK_CALLS" || die '取消前恢复'
pass '恢复取消无写入'
bash scripts/restore.sh "$saved" 3<<<$'RESTORE\nYES' > "$fixture/restore.log"
grep -q -- '--single-transaction --exit-on-error' "$STAR_MOCK_CALLS" || die '缺少事务'
grep -q -- '-C /data -xf -' "$STAR_MOCK_CALLS" || die '未恢复证书'
pass '确认恢复包含SQL事务及证书'
: > "$STAR_MOCK_CALLS"
reject env STAR_MOCK_FAIL_RESTORE=1 bash scripts/restore.sh "$saved" 3<<<$'RESTORE\nYES'
! grep -q '^compose up -d$' "$STAR_MOCK_CALLS" || die 'SQL失败仍启动'
grep -q 'database-transaction' "$fixture/rejected.log" || die 'SQL失败阶段未说明'
stop_line=$(grep -n '^compose stop app caddy$' "$STAR_MOCK_CALLS" | head -1 | cut -d: -f1)
dump_line=$(grep -n pg_dump "$STAR_MOCK_CALLS" | head -1 | cut -d: -f1)
write_line=$(grep -n -- '--single-transaction' "$STAR_MOCK_CALLS" | head -1 | cut -d: -f1)
((stop_line<dump_line && dump_line<write_line)) || die '恢复未停写后最终备份'
pass 'SQL失败不启动且停写后最终备份顺序正确'
reject env STAR_MOCK_FAIL_CERT=1 bash scripts/restore.sh "$saved" 3<<<$'RESTORE\nYES'
grep -q 'database-committed' "$fixture/rejected.log" || die '证书失败未说明SQL已提交'
pass '证书失败如实报告SQL已提交与备份位置'
original_sums=$(cat "$saved/SHA256SUMS")
grep -v 'database.dump$' "$saved/SHA256SUMS" > "$saved/checksums.tmp";mv "$saved/checksums.tmp" "$saved/SHA256SUMS"
reject bash scripts/verify-backup.sh "$saved"
printf '%s\n' "$original_sums" > "$saved/SHA256SUMS"
printf '%064d  ./../outside\n' 0 >> "$saved/SHA256SUMS"
reject bash scripts/verify-backup.sh "$saved"
printf '%s\n' "$original_sums" > "$saved/SHA256SUMS"
printf 'unlisted\n' > "$saved/unlisted.txt";reject bash scripts/verify-backup.sh "$saved";rm "$saved/unlisted.txt"
printf 'tampered\n' >> "$saved/database.dump";reject bash scripts/restore.sh "$saved" 3<<<$'RESTORE\nYES'
pass '缺失/越界/附加/篡改备份均拒绝'
env_before=$(sha256sum .env)
reject env STAR_MOCK_FAIL_DUMP=1 bash scripts/backup.sh
reject env STAR_MOCK_EMPTY_DUMP=1 bash scripts/backup.sh
[[ "$env_before" == "$(sha256sum .env)" ]] || die '备份改写env'
reject env STAR_BACKUP_DIR="$fixture/public/archive" bash scripts/backup.sh
reject env STAR_BACKUP_DIR="$fixture/unignored" bash scripts/backup.sh
pass '失败/空转储与Web/未忽略目录保护'
: > "$STAR_MOCK_CALLS"
reject env STAR_MOCK_NO_ORIGIN=1 bash scripts/update.sh
reject env STAR_MOCK_DIRTY=1 bash scripts/update.sh
reject env STAR_MOCK_NO_RELEASE=1 bash scripts/update.sh
reject env STAR_MOCK_LEGACY_RELEASE=1 bash scripts/update.sh
! grep -q pg_dump "$STAR_MOCK_CALLS" || die '来源/稳定版检查前仍备份'
pass '未知origin/本地改动/无稳定版/旧版缺少管理协议不更新'
: > "$STAR_MOCK_CALLS"
reject env STAR_MOCK_FAIL_MIGRATE=1 bash scripts/update.sh v0.4.0
! grep -q '^compose up -d$' "$STAR_MOCK_CALLS" || die '迁移失败仍启动'
stop_line=$(grep -n '^compose stop app caddy$' "$STAR_MOCK_CALLS" | head -1 | cut -d: -f1)
dump_line=$(grep -n pg_dump "$STAR_MOCK_CALLS" | tail -1 | cut -d: -f1)
write_line=$(grep -n '^compose run -T --rm migrate$' "$STAR_MOCK_CALLS" | head -1 | cut -d: -f1)
((stop_line<dump_line && dump_line<write_line)) || die '迁移前最终备份顺序错误'
! grep -q -- '--volumes' "$STAR_MOCK_CALLS" || die '更新失败删除数据'
pass '迁移失败保持停止/保留最终备份且不删除卷'
bash scripts/update.sh v0.4.0 > "$fixture/update.log"
[[ "$env_before" == "$(sha256sum .env)" ]] || die '更新改变端口/路径/密钥'
pass '更新保持.env/域名/端口/路径'
: > "$STAR_MOCK_CALLS"
reject env STAR_MOCK_FOREIGN_VOLUME=1 bash scripts/uninstall.sh
reject env STAR_MOCK_FOREIGN_CONSUMER=1 bash scripts/uninstall.sh
reject env STAR_MOCK_ENUM_FAIL=1 bash scripts/uninstall.sh
! grep -q '^compose down' "$STAR_MOCK_CALLS" || die '归属失败仍删除'
pass '共享/外来卷/枚举错误安全停止'
bash scripts/uninstall.sh > "$fixture/uninstall.log"
grep -q '^compose down$' "$STAR_MOCK_CALLS" || die '普通卸载未停止'
! grep -q -- '--volumes' "$STAR_MOCK_CALLS" || die '普通卸载删除卷'
pass '普通卸载保留持久化数据'
reject bash scripts/uninstall.sh --purge 3<<<'CANCEL'
reject bash scripts/uninstall.sh --purge 3<<<$'DELETE STARSTUDY DATA\nCANCEL'
! grep -q -- '--volumes' "$STAR_MOCK_CALLS" || die '未双确认删除卷'
pass '完全卸载两次确认保护'
bash scripts/doctor.sh --logs > "$fixture/logs.out"
! grep -q 'synthetic-test-password-only\|/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' "$fixture/logs.out" || die '日志泄露密钥/路径'
pass '日志脱敏'
# DNS, parsing, random-port constraints exercise actual pure helpers with controlled I/O.
python3 scripts/deployment-validation.py dns '203.0.113.8' '' '203.0.113.8' ''
reject python3 scripts/deployment-validation.py dns '203.0.113.9' '' '203.0.113.8' ''
reject python3 scripts/deployment-validation.py dns '203.0.113.8' '2001:db8::2' '203.0.113.8' '2001:db8::1'
pass 'DNS错误/错误AAAA停止'
source scripts/deployment-config.sh
port_free() { [[ "$1" != 34567 ]]; }
[[ "$(choose_https_port 34568)" == 34568 ]] || die '手动端口错误'
reject choose_https_port 34567
reject choose_https_port 80
reject choose_https_port 65536
random_port=$(choose_https_port '')
((random_port>=20000 && random_port<=60000)) || die '随机端口越界'
pass '端口范围/冲突/手动替代'
reject env STAR_MOCK_FAIL_HTTPS=1 bash scripts/restore.sh "$(find "$STAR_BACKUP_DIR" -mindepth 1 -maxdepth 1 -name 'backup-*' | tail -1)" 3<<<$'RESTORE\nYES'
pass 'HTTPS证书失败不报告恢复成功'
bash scripts/uninstall.sh --purge 3<<<$'DELETE STARSTUDY DATA\nYES' > "$fixture/purge.log"
grep -q '^compose down --volumes$' "$STAR_MOCK_CALLS" || die '双确认后未删除自有卷'
[[ ! -e .env && -f .starstudy-install && -d "$STAR_BACKUP_DIR" ]] || die '永久删除范围错误'
pass '双确认后仅已列资源删除且保留外部最终备份'
printf '部署隔离检查：%s组通过；Docker/PG/DNS/证书为mock，不代表真实部署。\n' "$checks"
