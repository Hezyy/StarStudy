#!/usr/bin/env bash
# Isolated tests for the manager. Never runs apt, Docker, public deployment, or real uninstall.
set -Eeuo pipefail
MANAGER_REPO=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
mkdir -p "$MANAGER_REPO/backups"
fixture=$(mktemp -d "$MANAGER_REPO/backups/manager-check.XXXXXXXX")
fixture=$(cd -- "$fixture" && pwd -P)
case "$fixture" in "$MANAGER_REPO"/backups/manager-check.*) ;;*) printf '测试目录校验失败\n' >&2;exit 1;;esac
test_cleanup() { case "$fixture" in "$MANAGER_REPO"/backups/manager-check.*) rm -rf -- "$fixture";;esac; }
trap test_cleanup EXIT
# Sourcing the script loads functions without running the root/Linux entrypoint.
# shellcheck source=../starstudy.sh
source "$MANAGER_REPO/starstudy.sh"
exec 3>"$fixture/terminal-output.log"
assert() { "$@" || { printf '管理脚本断言失败：%s\n' "$*" >&2;exit 1; }; }

printf 'SAFE=$(touch should-not-exist)\nDUPLICATE=one\nDUPLICATE=two\n' > "$fixture/fields"
assert test "$(ss_field "$fixture/fields" SAFE)" = '$(touch should-not-exist)'
assert test ! -e should-not-exist
if ss_field "$fixture/fields" DUPLICATE >/dev/null;then printf '重复配置键未被拒绝\n' >&2;exit 1;fi

(
  ss_execute() { printf '%s\n' "$*" >> "$fixture/dispatched"; }
  for choice in 1 2 3 4 5 6 7 8 9;do ss_dispatch "$choice";done
  assert test "$(wc -l < "$fixture/dispatched")" = 9
  ss_dispatch 'invalid'
  assert test "$(wc -l < "$fixture/dispatched")" = 9
  assert grep -qx 'ss_operation doctor.sh --status' "$fixture/dispatched"
  assert grep -qx 'ss_logs' "$fixture/dispatched"
  assert grep -qx 'ss_operation doctor.sh --restart' "$fixture/dispatched"
)
(
  fails_midway() { false;printf 'must-not-run' > "$fixture/continued-after-error"; }
  ss_execute fails_midway
  assert test ! -e "$fixture/continued-after-error"
  assert grep -q '现已回到管理菜单' "$fixture/terminal-output.log"
)
(
  command() { if [[ "$1" == -v && "$2" == jq ]];then return 1;fi;builtin command "$@"; }
  apt-get() { printf '%s\n' "$*" >> "$fixture/apt-calls";return 47; }
  if ss_prepare_tools;then printf 'APT失败仍被当作准备成功\n' >&2;exit 1;fi
  assert test "$(cat "$fixture/apt-calls")" = update
)
(
  ss_check_docker_target() { return 1; }
  docker() { printf 'unsafe-docker-call' > "$fixture/docker-after-invalid-context"; }
  if ss_prepare_docker;then printf '未知Docker目标未拒绝\n' >&2;exit 1;fi
  assert test ! -e "$fixture/docker-after-invalid-context"
)
(
  ss_temporary() { return 1; }
  ss_api() { printf 'unsafe-api-call' > "$fixture/api-after-temp-failure"; }
  if ss_commit main selected_commit;then printf '临时目录失败未拒绝\n' >&2;exit 1;fi
  assert test ! -e "$fixture/api-after-temp-failure"
)
(
  ss_temporary() { SS_TEMPORARY="$fixture"; }
  ss_api() { return 1; }
  ss_download() { printf 'unsafe-download' > "$fixture/download-after-api-failure"; }
  if ss_compose_plugin;then printf 'Compose API失败未拒绝\n' >&2;exit 1;fi
  assert test ! -e "$fixture/download-after-api-failure"
)

mkdir -p "$fixture/downloads" "$fixture/bin"
printf '#!/usr/bin/env bash\n# StarStudy managed entrypoint. Repository: Hezyy/StarStudy\nprintf "synthetic-manager-test-only\\n"\n' > "$fixture/candidate.sh"
(
  ss_temporary() { SS_TEMPORARY="$fixture/downloads"; }
  ss_api() { printf '%s\n' "$1" > "$fixture/api-url";[[ "${SS_TEST_API_FAILURE:-0}" != 1 ]] || return 1;printf '{}\n' > "$2"; }
  ss_download() { printf '%s\n' "$1" > "$fixture/raw-url";[[ "${SS_TEST_DOWNLOAD_FAILURE:-0}" != 1 ]] || return 1;cp -- "$fixture/candidate.sh" "$2"; }
  jq() {
    case "$*" in
      *'.size'*) wc -c < "$fixture/candidate.sh";;
      *'.sha'*) if [[ "${SS_TEST_BAD_HASH:-0}" == 1 ]];then printf '%040d\n' 0;else git hash-object --no-filters -- "$fixture/candidate.sh";fi;;
      *) return 1;;
    esac
  }
  commit_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  verified_path=''
  ss_verified_manager "$commit_id" verified_path
  assert test -s "$verified_path"
  assert grep -Fq "contents/starstudy.sh?ref=$commit_id" "$fixture/api-url"
  assert grep -Fq "/$commit_id/starstudy.sh" "$fixture/raw-url"
  cp -- "$fixture/candidate.sh" "$fixture/bin/starstudy"
  initial_command_hash=$(git hash-object --no-filters -- "$fixture/bin/starstudy")
  SS_TEST_BAD_HASH=1
  if ss_verified_manager "$commit_id" verified_path;then printf '损坏blob校验未拒绝\n' >&2;exit 1;fi
  unset SS_TEST_BAD_HASH
  SS_TEST_API_FAILURE=1
  if ss_verified_manager "$commit_id" verified_path;then printf 'API失败仍接受旧元数据\n' >&2;exit 1;fi
  unset SS_TEST_API_FAILURE
  SS_TEST_DOWNLOAD_FAILURE=1
  if ss_verified_manager "$commit_id" verified_path;then printf '下载失败仍接受旧文件\n' >&2;exit 1;fi
  unset SS_TEST_DOWNLOAD_FAILURE
  printf 'if then\n' >> "$fixture/candidate.sh"
  if ss_verified_manager "$commit_id" verified_path 2>/dev/null;then printf '语法错误脚本被接受\n' >&2;exit 1;fi
  assert test "$(git hash-object --no-filters -- "$fixture/bin/starstudy")" = "$initial_command_hash"
)
(
  # Exercise unknown-name protection without needing root or touching /usr/local/bin.
  SS_COMMAND_PATH="$fixture/bin/starstudy"
  SS_CONFIG_ROOT="$fixture/unknown-config"
  SS_INSTALL_ROOT="$fixture/owned-project"
  ss_owned() { [[ -e "$1" && ! -L "$1" ]]; }
  printf '#!/usr/bin/env bash\n# StarStudy managed entrypoint. Repository: Hezyy/StarStudy\nprintf "synthetic-manager-test-only\\n"\n' > "$fixture/candidate.sh"
  SS_MANAGER_BLOB=$(git hash-object --no-filters -- "$fixture/candidate.sh")
  if ss_install_manager aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$fixture/candidate.sh";then printf '未知同名命令被覆盖\n' >&2;exit 1;fi
  assert test ! -e "$SS_CONFIG_ROOT"
)
(
  # Atomic self-update failure injection. Ownership and flock are deliberately mocked;
  # actual root ownership and cross-process locks are checked by Linux integration.
  SS_COMMAND_PATH="$fixture/atomic-bin/starstudy"
  SS_CONFIG_ROOT="$fixture/atomic-config"
  SS_INSTALL_ROOT="$fixture/atomic-project"
  mkdir -p "$fixture/atomic-bin"
  ss_owned() { [[ -e "$1" && ! -L "$1" ]]; }
  flock() { printf 'lock\n' >> "$fixture/atomic-order"; }
  install() {
    printf 'install\n' >> "$fixture/atomic-order"
    cp -- "${@: -2:1}" "${@: -1}" && chmod 755 -- "${@: -1}"
  }
  mv() {
    if [[ "${SS_TEST_METADATA_FAILURE:-0}" == 1 && "${*: -1}" == "$SS_CONFIG_ROOT/manager.conf" ]];then return 48;fi
    command mv "$@"
  }
  SS_MANAGER_BLOB=$(git hash-object --no-filters -- "$fixture/candidate.sh")
  ss_install_manager aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$fixture/candidate.sh"
  assert test "$(head -1 "$fixture/atomic-order")" = lock
  assert test "$(ss_field "$SS_CONFIG_ROOT/manager.conf" MANAGER_BLOB_SHA)" = "$SS_MANAGER_BLOB"
  previous_hash=$(git hash-object --no-filters -- "$SS_COMMAND_PATH")
  previous_metadata=$(git hash-object --no-filters -- "$SS_CONFIG_ROOT/manager.conf")
  cp -- "$fixture/candidate.sh" "$fixture/new-candidate.sh"
  printf '# changed synthetic manager\n' >> "$fixture/new-candidate.sh"
  SS_MANAGER_BLOB=$(git hash-object --no-filters -- "$fixture/new-candidate.sh")
  SS_TEST_METADATA_FAILURE=1
  if ss_install_manager bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb "$fixture/new-candidate.sh";then printf '元数据替换失败仍宣称更新成功\n' >&2;exit 1;fi
  assert test "$(git hash-object --no-filters -- "$SS_COMMAND_PATH")" = "$previous_hash"
  assert test "$(git hash-object --no-filters -- "$SS_CONFIG_ROOT/manager.conf")" = "$previous_metadata"
  unset SS_TEST_METADATA_FAILURE
  ss_install_manager bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb "$fixture/new-candidate.sh"
  assert test "$(git hash-object --no-filters -- "$SS_COMMAND_PATH")" = "$SS_MANAGER_BLOB"
  printf '# local modification\n' >> "$SS_COMMAND_PATH"
  modified_hash=$(git hash-object --no-filters -- "$SS_COMMAND_PATH")
  if ss_install_manager bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb "$fixture/new-candidate.sh";then printf '本机脚本未确认修改仍被覆盖\n' >&2;exit 1;fi
  assert test "$(git hash-object --no-filters -- "$SS_COMMAND_PATH")" = "$modified_hash"
)
(
  ss_require_install() { return 0; }
  ss_latest_release() { SS_RELEASE_TAG=''; }
  ss_read() { printf -v "$1" '%s' 1; }
  ss_operation() { printf 'must-not-update' > "$fixture/unreleased-update"; }
  ss_update
  assert test ! -e "$fixture/unreleased-update"
  assert grep -q '没有可用的正式稳定版' "$fixture/terminal-output.log"
)
(
  ss_supported_system() { return 0; }
  SS_INSTALL_ROOT="$fixture/unknown-project"
  mkdir -p "$SS_INSTALL_ROOT"
  printf 'private-existing-data' > "$SS_INSTALL_ROOT/.env"
  ss_prepare_tools() { printf 'must-not-install-tools' > "$fixture/apt-called"; }
  if ss_install;then printf '未知安装目录未被拒绝\n' >&2;exit 1;fi
  assert test ! -e "$fixture/apt-called"
  assert test "$(cat "$SS_INSTALL_ROOT/.env")" = private-existing-data
)

if [[ "$(uname -s)" == Linux ]] && command -v python3 >/dev/null && python3 -c 'import os,sys;sys.exit(0 if os.name=="posix" else 1)' 2>/dev/null;then
  python3 - "$MANAGER_REPO/starstudy.sh" <<'PY'
import os,pty,subprocess,select,time,sys,fcntl,termios
entry=sys.argv[1]
master,slave=pty.openpty()
code='source "$1"; exec 3<>/dev/tty; ss_read answer "PIPE_TTY_PROMPT: "; printf "PIPE_TTY_RESULT=%s\\n" "$answer" >&3'
payload='printf "%s\\n" '+__import__('shlex').quote(code)+' | bash -s -- '+__import__('shlex').quote(entry)
def controlling_tty():
    os.setsid()
    fcntl.ioctl(0,termios.TIOCSCTTY,0)
process=subprocess.Popen(['bash','-c',payload],stdin=slave,stdout=slave,stderr=slave,preexec_fn=controlling_tty)
os.close(slave)
captured=b'';sent=False;deadline=time.monotonic()+10
while time.monotonic()<deadline:
    ready,_,_=select.select([master],[],[],.1)
    if ready:
        try: chunk=os.read(master,8192)
        except OSError: break
        if not chunk: break
        captured+=chunk
        if b'PIPE_TTY_PROMPT:' in captured and not sent:
            os.write(master,b'9\n');sent=True
    if process.poll() is not None: break
if process.poll() is None:process.kill()
status=process.wait();os.close(master)
assert status==0 and b'PIPE_TTY_RESULT=9' in captured,(status,captured)
print('真实POSIX PTY下的管道/终端分离检查通过')
PY
else
  printf '跳过真实POSIX PTY检查：当前环境无可用POSIX Python/PTY；需Linux验收。\n'
fi
if command -v setsid >/dev/null;then
  if setsid bash "$MANAGER_REPO/starstudy.sh" </dev/null >"$fixture/no-tty.log" 2>&1;then printf '无终端未拒绝\n' >&2;exit 1;fi
  assert grep -q '真实交互终端' "$fixture/no-tty.log"
else printf '跳过无TTY进程检查：当前环境缺少setsid；需Linux验收。\n';fi
printf '管理脚本隔离检查通过（未安装APT/Docker、未访问真实部署、未删除用户数据）。\n'
