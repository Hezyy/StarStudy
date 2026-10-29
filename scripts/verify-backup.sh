#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
[[ $# == 1 ]] || die '需要一个备份目录'
need_command python3
python3 scripts/deployment-validation.py backup "$1"
