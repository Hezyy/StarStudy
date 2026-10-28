#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
need_docker; need_env
[[ $# == 1 ]] || die '用法：bash scripts/restore.sh /备份目录'
[[ -d "$1" ]] || die '备份目录不存在'
source_dir=$(cd -- "$1" && pwd -P)
[[ -f "$source_dir/SHA256SUMS" && -f "$source_dir/database.dump" ]] || die '不是完整备份'
[[ ! -L "$source_dir/SHA256SUMS" && -s "$source_dir/database.dump" ]] || die '备份清单或数据库转储无效'
# Never follow symlinks or checksum paths out of the chosen backup directory.
[[ -z "$(find "$source_dir" -type l -print -quit)" ]] || die '备份含符号链接，恢复已拒绝'
checked_paths=()
was_checked() { local candidate;for candidate in "${checked_paths[@]}";do [[ "$candidate" != "$1" ]] || return 0;done;return 1; }
while IFS= read -r checksum_line; do
 checksum_hash=${checksum_line:0:64}
 checksum_separator=${checksum_line:64:2}
 checksum_path=${checksum_line:66}
 [[ "$checksum_hash" =~ ^[[:xdigit:]]{64}$ && ( "$checksum_separator" == '  ' || "$checksum_separator" == ' *' ) && "$checksum_path" == ./* && "$checksum_path" != *'/../'* && "$checksum_path" != *$'\r'* ]] || die '备份校验清单路径无效'
 [[ -f "$source_dir/$checksum_path" ]] && ! was_checked "$checksum_path" || die '备份清单含重复或非普通文件'
 checked_paths+=("$checksum_path")
done < "$source_dir/SHA256SUMS"
for mandatory in database.dump .env compose.yaml Caddyfile manifest.json source-revision.txt; do
 was_checked "./$mandatory" || die "备份校验清单缺少必要文件：$mandatory"
done
while IFS= read -r -d '' contained_file; do
 relative_file="./${contained_file#"$source_dir/"}"
 [[ "$relative_file" == ./SHA256SUMS ]] || was_checked "$relative_file" || die '备份包含未列入校验清单的文件'
done < <(find "$source_dir" -type f -print0)
(cd -- "$source_dir" && sha256sum -c SHA256SUMS) || die '备份完整性校验失败'
docker compose exec -T database pg_restore --list < "$source_dir/database.dump" >/dev/null
read -r -p '恢复将替换服务器全部用户数据。请确认备份来源，输入RESTORE：' answer
[[ "$answer" == RESTORE ]] || die '已取消'
read -r -p '再次确认覆盖当前数据库？输入YES：' second
[[ "$second" == YES ]] || die '已取消'
docker compose stop app caddy || die '无法完整停止写入服务，尚未开始恢复数据库，请先诊断服务状态'
trap 'printf "恢复未完成，应用保持停止，数据库事务已回滚或保留；请按文档从恢复前备份重试。\n" >&2' ERR
bash scripts/backup.sh
docker compose exec -T database pg_restore -U star_study -d star_study --clean --if-exists --no-owner --no-acl --single-transaction --exit-on-error < "$source_dir/database.dump"
# The current release stores all images in PostgreSQL. Optional legacy uploads are copied, never deleted.
if [[ -d "$source_dir/uploads" ]]; then [[ ! -L uploads ]] || die '本机uploads为符号链接，请手动核对';mkdir -p uploads;cp -a -- "$source_dir/uploads/." uploads/;fi
docker compose up -d
health || die '数据库已恢复但应用健康检查未通过，请运行doctor.sh'
printf '恢复完成。配置不自动覆盖：异机恢复请按部署文档核对域名、密钥和版本。\n'
