#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
need_docker;need_env;lock_operation
[[ $# == 1 && -d "$1" ]] || die '请从统一管理菜单选择有效备份目录'
source_dir=$(cd -- "$1" && pwd -P)
python3 scripts/deployment-validation.py backup "$source_dir" || die '备份不完整或已损坏，尚未停止服务'
backup_version=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["appVersion"])' "$source_dir/manifest.json")
current_version=$(python3 -c 'import json;print(json.load(open("package.json"))["version"])')
[[ "$backup_version" == "$current_version" ]] || die '备份与当前应用版本不同，禁止直接覆盖；请先在隔离环境核对源码和迁移版本'
printf '恢复预览：备份应用版本%s，备份目录%s。当前域名、端口、路径与.env保持不变；将恢复数据库、图片及备份内的证书状态。\n' "$backup_version" "$source_dir"
docker compose exec -T database pg_restore --list < "$source_dir/database.dump" >/dev/null || die '数据库备份无法读取，尚未开始恢复'
[[ ! -f .starstudy-install ]] || verify_project_ownership
ask answer '恢复会替换此部署全部用户数据。确认备份来源，输入RESTORE：'
[[ "$answer" == RESTORE ]] || die '已取消恢复'
ask second '再次确认覆盖当前数据库？输入YES：'
[[ "$second" == YES ]] || die '已取消恢复'
docker compose stop app caddy || die '无法停止写入服务，未开始恢复'
phase=before-database;final_backup='尚未生成'
trap 'result=$?;if ((result!=0));then printf "恢复失败。阶段：%s，恢复前备份：%s。SQL仅在数据库恢复阶段采用单事务；若SQL已提交而证书/后续校验失败，数据库不会自动回滚。请经菜单诊断/重试，不会自动删除用户记录。\n" "$phase" "$final_backup" >&2;fi' EXIT
bash scripts/backup.sh
final_backup=$(python3 scripts/deployment-validation.py env .starstudy-backup-state DIRECTORY)
python3 scripts/deployment-validation.py backup "$final_backup" >/dev/null || die '恢复前备份未通过，未开始覆盖数据库'
phase=database-transaction
docker compose exec -T database pg_restore -U star_study -d star_study --clean --if-exists --no-owner --no-acl --single-transaction --exit-on-error < "$source_dir/database.dump"
phase=database-committed
if [[ -f "$source_dir/caddy-data.tar" ]];then
 # tar archives have already passed path/type validation. Keep unrelated files rather than recursively deleting a volume.
 docker compose run -T --rm --no-deps --entrypoint tar caddy -C /data -xf - < "$source_dir/caddy-data.tar"
 docker compose run -T --rm --no-deps --entrypoint tar caddy -C /config -xf - < "$source_dir/caddy-config.tar"
else
 printf '此旧版备份未包含证书，当前Caddy证书与续期卷保持原样。\n'
fi
if [[ -d "$source_dir/uploads" ]];then [[ ! -L uploads ]] || die '本机uploads为符号链接，停止自动复制';mkdir -p uploads;cp -a -- "$source_dir/uploads/." uploads/;fi
phase=services-starting
docker compose up -d
if ! health || ! local_https_health;then docker compose stop app caddy || true;die 'SQL已提交，但健康检查/HTTPS失败，写入服务已尝试停止；请通过菜单诊断，最终备份保留';fi
printf '恢复完成：数据库与健康检查通过。当前域名、端口、随机路径和.env未被覆盖；异机恢复请先核对对应版本与私有配置。\n'
