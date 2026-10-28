#!/usr/bin/env bash
# Isolated control-flow smoke tests. This does NOT exercise Docker or PostgreSQL.
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
mkdir -p "$STAR_ROOT/backups"
fixture=$(mktemp -d "$STAR_ROOT/backups/deploy-check.XXXXXX")
fixture=$(cd -- "$fixture" && pwd -P)
case "$fixture" in "$STAR_ROOT"/backups/deploy-check.*) ;; *) die '测试路径校验失败';; esac
cleanup() { case "$fixture" in "$STAR_ROOT"/backups/deploy-check.*) rm -rf -- "$fixture";; esac; }
trap cleanup EXIT
mkdir -p "$fixture/scripts" "$fixture/mockbin"
cp scripts/{common,backup,restore,uninstall,update}.sh "$fixture/scripts/"
cp compose.yaml Caddyfile package.json "$fixture/"
printf 'POSTGRES_PASSWORD=synthetic-test-only\nPUBLIC_URL=http://127.0.0.1:8080\n' > "$fixture/.env"
cat > "$fixture/mockbin/docker" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STAR_MOCK_CALLS"
case "$*" in
  *pg_dump*)
    [[ "${STAR_MOCK_FAIL_DUMP:-0}" != 1 ]] || exit 43
    [[ "${STAR_MOCK_EMPTY_DUMP:-0}" != 1 ]] || exit 0
    printf 'synthetic-dump-for-control-flow-only\n';;
  *--single-transaction*) cat >/dev/null; [[ "${STAR_MOCK_FAIL_RESTORE:-0}" != 1 ]] || exit 42;;
  *pg_restore*) cat >/dev/null;;
  'compose run --rm migrate') [[ "${STAR_MOCK_FAIL_MIGRATE:-0}" != 1 ]] || exit 44;;
esac
exit 0
MOCK
chmod +x "$fixture/mockbin/docker"
cat > "$fixture/mockbin/git" <<'MOCK'
#!/usr/bin/env bash
printf 'git %s\n' "$*" >> "$STAR_MOCK_CALLS"
case "$*" in
 'rev-parse HEAD'|'rev-parse --verify refs/tags/v0.4.0') printf '0000000000000000000000000000000000000000\n';;
 'rev-parse --is-inside-work-tree') printf 'true\n';;
 'remote get-url origin') [[ "${STAR_MOCK_NO_ORIGIN:-0}" != 1 ]] || exit 1;printf 'https://example.invalid/synthetic-test.git\n';;
 'status --porcelain --untracked-files=no'|'fetch --tags origin'|'switch --detach v0.4.0') ;;
 *) exit 1;;
esac
MOCK
chmod +x "$fixture/mockbin/git"
export STAR_MOCK_CALLS="$fixture/docker-calls.log"
export PATH="$fixture/mockbin:$PATH"
export STAR_BACKUP_DIR="$fixture/backups/server"
cd -- "$fixture"
bash scripts/backup.sh >/dev/null
saved=$(find "$STAR_BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d | head -1)
[[ -n "$saved" && -f "$saved/database.dump" && -f "$saved/SHA256SUMS" ]] || die '备份未生成预期文件'
(cd -- "$saved" && sha256sum -c SHA256SUMS >/dev/null)
printf 'CANCEL\n' | bash scripts/restore.sh "$saved" >/dev/null 2>&1 && die '取消恢复未被拒绝'
! grep -q -- '--single-transaction' "$STAR_MOCK_CALLS" || die '取消前触发恢复'
printf 'RESTORE\nYES\n' | bash scripts/restore.sh "$saved" >/dev/null
grep -q -- '--single-transaction --exit-on-error' "$STAR_MOCK_CALLS" || die '恢复缺少单事务/失败退出'
: > "$STAR_MOCK_CALLS"
if printf 'RESTORE\nYES\n' | STAR_MOCK_FAIL_RESTORE=1 bash scripts/restore.sh "$saved" >/dev/null 2>&1;then die '数据库恢复失败未返回失败';fi
grep -q '^compose stop app caddy$' "$STAR_MOCK_CALLS" || die '恢复前未停止写入'
restore_stop_line=$(grep -n '^compose stop app caddy$' "$STAR_MOCK_CALLS" | head -1 | cut -d: -f1)
restore_backup_line=$(grep -n pg_dump "$STAR_MOCK_CALLS" | head -1 | cut -d: -f1)
restore_write_line=$(grep -n -- '--single-transaction' "$STAR_MOCK_CALLS" | head -1 | cut -d: -f1)
((restore_stop_line<restore_backup_line && restore_backup_line<restore_write_line)) || die '恢复前未创建停止新写入后的最终备份'
! grep -q '^compose up -d$' "$STAR_MOCK_CALLS" || die '恢复失败后自动启动了应用'
original_sums=$(cat "$saved/SHA256SUMS")
grep -v 'database.dump$' "$saved/SHA256SUMS" > "$saved/checksums.tmp"
mv "$saved/checksums.tmp" "$saved/SHA256SUMS"
if printf 'RESTORE\nYES\n' | bash scripts/restore.sh "$saved" >/dev/null 2>&1;then die '缺失数据库校验项仍被接受';fi
printf '%s\n' "$original_sums" > "$saved/SHA256SUMS"
printf '%064d  ./../outside\n' 0 >> "$saved/SHA256SUMS"
if printf 'RESTORE\nYES\n' | bash scripts/restore.sh "$saved" >/dev/null 2>&1;then die '越界校验路径仍被接受';fi
printf '%s\n' "$original_sums" > "$saved/SHA256SUMS"
printf 'not-in-manifest\n' > "$saved/unlisted.txt"
if printf 'RESTORE\nYES\n' | bash scripts/restore.sh "$saved" >/dev/null 2>&1;then die '未校验附加文件仍被接受';fi
rm -- "$saved/unlisted.txt"
printf 'tampered\n' >> "$saved/database.dump"
calls_before=$(wc -l < "$STAR_MOCK_CALLS")
printf 'RESTORE\nYES\n' | bash scripts/restore.sh "$saved" >/dev/null 2>&1 && die '损坏备份未被拒绝'
calls_after=$(wc -l < "$STAR_MOCK_CALLS")
((calls_after-calls_before<=2)) || die '损坏校验后仍执行了恢复'
env_before=$(sha256sum .env)
if STAR_MOCK_FAIL_DUMP=1 bash scripts/backup.sh >/dev/null 2>&1;then die '转储失败被伪装为备份成功';fi
[[ "$env_before" == "$(sha256sum .env)" ]] || die '失败备份改写了成功时间'
if STAR_MOCK_EMPTY_DUMP=1 bash scripts/backup.sh >/dev/null 2>&1;then die '空数据库转储被接受';fi
if STAR_BACKUP_DIR="$fixture/public/server" bash scripts/backup.sh >/dev/null 2>&1;then die 'Web目录备份未被拒绝';fi
if STAR_BACKUP_DIR="$fixture/unignored-archive" bash scripts/backup.sh >/dev/null 2>&1;then die '备份进入未忽略的仓库路径';fi
: > "$STAR_MOCK_CALLS"
if STAR_MOCK_NO_ORIGIN=1 bash scripts/update.sh v0.4.0 >/dev/null 2>&1;then die '无可信远程仍执行更新';fi
! grep -q 'pg_dump\|fetch --tags' "$STAR_MOCK_CALLS" || die '来源检查失败后仍创建更新副作用'
: > "$STAR_MOCK_CALLS"
if STAR_MOCK_FAIL_MIGRATE=1 bash scripts/update.sh v0.4.0 >/dev/null 2>&1;then die '迁移失败被伪装为更新成功';fi
grep -q '^compose stop app caddy$' "$STAR_MOCK_CALLS" || die '迁移前未停止旧应用写入'
grep -q '^compose run --rm migrate$' "$STAR_MOCK_CALLS" || die '未执行迁移控制流程'
stopped_line=$(grep -n '^compose stop app caddy$' "$STAR_MOCK_CALLS" | head -1 | cut -d: -f1)
final_backup_line=$(grep -n pg_dump "$STAR_MOCK_CALLS" | tail -1 | cut -d: -f1)
migration_line=$(grep -n '^compose run --rm migrate$' "$STAR_MOCK_CALLS" | head -1 | cut -d: -f1)
((stopped_line<final_backup_line && final_backup_line<migration_line)) || die '未在停写之后、迁移之前创建最终快照'
! grep -q '^compose up -d$' "$STAR_MOCK_CALLS" || die '迁移失败后自动启动了应用'
! grep -q -- '--volumes' "$STAR_MOCK_CALLS" || die '更新失败删除了卷'
: > "$STAR_MOCK_CALLS"
bash scripts/uninstall.sh >/dev/null
grep -q '^compose down$' "$STAR_MOCK_CALLS" || die '默认卸载未停止服务'
! grep -q -- '--volumes' "$STAR_MOCK_CALLS" || die '默认卸载删除了卷'
printf 'CANCEL\n' | bash scripts/uninstall.sh --purge >/dev/null 2>&1 && die '取消清理未被拒绝'
! grep -q -- '--volumes' "$STAR_MOCK_CALLS" || die '未确认清理删除了卷'
printf '部署脚本隔离控制流程检查通过（mock Docker，不代表真实部署/数据库恢复）\n'
