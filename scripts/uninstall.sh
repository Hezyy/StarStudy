#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
need_docker;need_env;lock_operation
[[ $# -le 1 && ( $# == 0 || "$1" == --purge ) ]] || die '请通过统一管理菜单选择卸载方式'
[[ ! -f .starstudy-install ]] || verify_project_ownership
if [[ "${1:-}" != --purge ]];then
 docker compose down
 printf '普通卸载完成：仅停止并移除本项目容器/网络。数据库、证书卷、.env、源码和备份均保留。\n配置目录：%s\n备份目录：%s\n恢复使用请选择统一菜单中的保留配置重试/启动。\n' "$STAR_ROOT" "$(backup_root)"
 exit 0
fi
need_marker;verify_project_ownership
docker compose config --format json | python3 scripts/deployment-validation.py compose-project "$COMPOSE_PROJECT_NAME"
printf '完全卸载将删除：\n- 项目%s的已核实容器及默认网络\n- %s_postgres_data（全部账户/学习记录/错题图片）\n- %s_caddy_data及%s_caddy_config（证书/ACME状态）\n- %s/.env、运行元数据及明确属于本项目的uploads目录\n源码、无凭据归属标记和最终外部备份会保留；这不是备份的安全擦除。\n' "$COMPOSE_PROJECT_NAME" "$COMPOSE_PROJECT_NAME" "$COMPOSE_PROJECT_NAME" "$COMPOSE_PROJECT_NAME" "$STAR_ROOT"
answer='';second=''
ask answer '必须输入 DELETE STARSTUDY DATA 才继续：'
[[ "$answer" == 'DELETE STARSTUDY DATA' ]] || die '已取消完全卸载'
ask second '再次确认永久删除以上数据？输入YES：'
[[ "$second" == YES ]] || die '已取消完全卸载'
backup_location=$(backup_root);mkdir -p -- "$backup_location";backup_location=$(cd -- "$backup_location" && pwd -P)
case "$backup_location" in "$STAR_ROOT"|"$STAR_ROOT/"*) die '永久清理的最终备份必须位于安装目录外，请先设置安全外部备份目录';; esac
docker compose stop app caddy || die '无法停止写入，未删除数据'
bash scripts/backup.sh
final_backup=$(python3 scripts/deployment-validation.py env .starstudy-backup-state DIRECTORY)
python3 scripts/deployment-validation.py backup "$final_backup" || die '最终备份未通过，禁止删除'
# Recheck labels immediately before removal; never use Docker prune or a project-wide guessed volume prefix.
verify_project_ownership
if ! docker compose down --volumes;then
 printf '完全卸载未完成，可能仍有卷或容器占用。未删除配置，请通过菜单诊断。最终备份：%s\n' "$final_backup" >&2;exit 1
fi
# A successful Compose exit alone does not prove every resource was removed.
# Enumerate with an explicit success check; inspect's nonzero status could mean
# either "not found" or an unreachable daemon and must never authorize deletion.
purge_incomplete() {
 printf '完全卸载未完成：%s。保留.env及文件配置，请通过菜单诊断。最终备份：%s\n' "$1" "$final_backup" >&2
 exit 1
}
docker info >/dev/null 2>&1 || purge_incomplete 'Docker守护进程不可达，无法确认删除结果'
remaining_containers=$(docker ps -a --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" --format '{{.ID}}') || purge_incomplete '无法枚举容器'
[[ -z "$remaining_containers" ]] || purge_incomplete '仍有星研项目容器残留'
remaining_volumes=$(docker volume ls --format '{{.Name}}') || purge_incomplete '无法枚举数据卷'
for purpose in postgres_data caddy_data caddy_config;do
 if grep -Fxq "${COMPOSE_PROJECT_NAME}_${purpose}" <<<"$remaining_volumes";then purge_incomplete "数据卷${COMPOSE_PROJECT_NAME}_${purpose}仍存在";fi
done
remaining_networks=$(docker network ls --format '{{.Name}}') || purge_incomplete '无法枚举网络'
if grep -Fxq "${COMPOSE_PROJECT_NAME}_default" <<<"$remaining_networks";then purge_incomplete '星研默认网络仍存在，可能被其他容器使用';fi
python3 - "$STAR_ROOT" <<'PY'
from pathlib import Path
import shutil,sys
root=Path(sys.argv[1]).resolve()
upload=root/'uploads'
if upload.exists() or upload.is_symlink():
    if upload.is_symlink() or upload.resolve().parent!=root:raise SystemExit('uploads归属无法确认，停止文件清理')
    shutil.rmtree(upload)
for name in ('.env','.starstudy-backup-state'):
    path=root/name
    if path.is_symlink():raise SystemExit('配置文件为符号链接，停止文件清理')
    path.unlink(missing_ok=True)
PY
printf '完全卸载的已列数据已删除。保留源码与无凭据归属标记：%s\n最终外部备份仍保留且包含用户数据/密钥：%s\n如需删除该备份，请另行核对后手动处理；本操作没有将其擦除。\n' "$STAR_ROOT" "$final_backup"
