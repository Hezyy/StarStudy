#!/usr/bin/env bash
# Destructive lifecycle tests are confined to generated fixtures on disposable GitHub runners.
# This uses Caddy's private test CA. It does not test public DNS, ACME or real-server installation.
set -Eeuo pipefail
umask 077
[[ ${GITHUB_ACTIONS:-} == true && ${STAR_STUDY_CI_INTEGRATION:-} == 1 && $EUID == 0 && $(uname -s) == Linux ]] || {
 printf 'Refusing deployment lifecycle tests outside an explicitly enabled disposable Linux CI runner.\n' >&2;exit 1;
}
source_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
for tool in git docker python3 curl openssl script ss;do command -v "$tool" >/dev/null || { printf 'Missing CI dependency: %s\n' "$tool" >&2;exit 1; };done
docker info >/dev/null
docker compose version
identity=$(openssl rand -hex 16)
[[ $identity =~ ^[a-f0-9]{32}$ ]] || exit 1
project="starstudy_${identity:0:12}"
fixture=$(mktemp -d /opt/starstudy-ci.XXXXXXXX)
archive=$(mktemp -d /var/tmp/starstudy-ci-backups.XXXXXXXX)
case $fixture in /opt/starstudy-ci.*) ;; *) exit 1;; esac
case $archive in /var/tmp/starstudy-ci-backups.*) ;; *) exit 1;; esac
sentinel_name="starstudy-ci-unrelated-$identity"
sentinel_volume="starstudy_ci_unrelated_$identity"
cleanup() {
 local code=$?
 trap - EXIT
 # Use only this generated project and its saved configuration. Never run prune or remove guessed resources.
 if [[ -f $fixture/.starstudy-install && -f $archive/cleanup.env && -f $fixture/compose.yaml ]];then
  if python3 "$fixture/scripts/deployment-validation.py" marker "$fixture/.starstudy-install" "$fixture" >/dev/null;then
   (cd -- "$fixture" && docker compose --env-file "$archive/cleanup.env" --project-name "$project" down --volumes) >/dev/null 2>&1 || true
  fi
 fi
 if [[ $(docker inspect --format '{{ index .Config.Labels "io.starstudy.ci" }}' "$sentinel_name" 2>/dev/null || true) == "$identity" ]];then
  docker rm -f "$sentinel_name" >/dev/null || true
 fi
 if [[ $(docker volume inspect --format '{{ index .Labels "io.starstudy.ci" }}' "$sentinel_volume" 2>/dev/null || true) == "$identity" ]];then
  docker volume rm "$sentinel_volume" >/dev/null || true
 fi
 if ((code));then printf 'Linux deployment CI failed. No public certificate or production deployment has been claimed.\n' >&2;fi
 # Fixtures are intentionally not uploaded: they contain test credentials, database dumps and test private keys.
 exit "$code"
}
trap cleanup EXIT
git -c safe.directory="$source_root" -C "$source_root" archive HEAD | tar -xf - -C "$fixture"
cd -- "$fixture"
git init --quiet
git remote add origin https://github.com/Hezyy/StarStudy.git
printf 'APP=StarStudy\nFORMAT_VERSION=1\nINSTALL_ID=%s\nCOMPOSE_PROJECT_NAME=%s\nROOT_PATH=%s\n' "$identity" "$project" "$fixture" > .starstudy-install
chmod 600 .starstudy-install
# Exercise the production CSPRNG/port-ownership code against the real runner.
source scripts/common.sh
source scripts/deployment-config.sh
port=$(choose_https_port '')
((port>=20000 && port<=60000))
prefix="/$(openssl rand -hex 16)"
domain=starstudy.example.test
cat > .env <<ENV
INSTALL_ID=$identity
COMPOSE_PROJECT_NAME=$project
POSTGRES_PASSWORD=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 48)
SETUP_TOKEN=$(openssl rand -hex 32)
PUBLIC_URL=https://$domain:$port$prefix
SITE_ADDRESS=$domain
CADDY_DOMAIN=$domain
APP_BASE_PATH=$prefix
ACME_EMAIL=
ACME_EMAIL_DIRECTIVE=
BIND_ADDRESS=127.0.0.1
HTTP_PORT=80
HTTPS_PORT=$port
ALLOW_INSECURE_LOCAL=0
INITIAL_REGISTRATION=invite
ENV
chmod 600 .env
cp .env "$archive/cleanup.env"
export STAR_BACKUP_DIR="$archive/data" STAR_STUDY_MANAGED=1
python3 scripts/deployment-validation.py config .env
docker compose config --quiet
docker compose config --format json | python3 scripts/deployment-validation.py compose-project "$project"
printf 'Compose configuration and ownership metadata: passed.\n'

# Validate the actual production file without issuing any certificate. Email and prefix are independently optional.
docker pull caddy:2-alpine >/dev/null
for validation_prefix in '' "$prefix";do
 for email in '' 'email ci-notifications@example.test';do
  docker run --rm --entrypoint caddy \
   -e "CADDY_DOMAIN=$domain" -e "HTTPS_PORT=$port" -e "APP_BASE_PATH=$validation_prefix" -e "ACME_EMAIL_DIRECTIVE=$email" \
   --mount "type=bind,source=$fixture/Caddyfile,target=/etc/caddy/Caddyfile,readonly" \
   caddy:2-alpine validate --config /etc/caddy/Caddyfile >"$archive/caddy-validation.log" 2>&1 || {
    printf 'Production Caddy configuration validation failed.\n' >&2;exit 1;
   }
 done
done
printf 'Production Caddy config: 4 combinations passed (no ACME request).\n'

# The copied fixture alone uses an internal CA, avoiding external DNS/ACME and system trust changes.
python3 - <<'PY'
from pathlib import Path
path = Path('Caddyfile')
text = path.read_text()
issuer = '  tls {\n    issuer acme {\n      disable_tlsalpn_challenge\n    }\n  }'
assert text.count(issuer) == 1, 'Production TLS fixture contract changed'
text = text.replace(issuer, '  tls internal').replace('{\n', '{\n  skip_install_trust\n', 1)
path.write_text(text)
PY
docker compose up -d --build >"$archive/build.log" 2>&1 || {
 printf 'Docker build/start failed; showing a redacted tail.\n' >&2
 tail -n 60 "$archive/build.log" | python3 scripts/deployment-validation.py redact .env >&2
 exit 1
}
for ((attempt=0;attempt<30;attempt++));do
 if docker compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt > "$archive/test-ca.crt" 2>/dev/null && [[ -s $archive/test-ca.crt ]];then break;fi
 sleep 1
done
[[ -s $archive/test-ca.crt ]] || { printf 'Internal test CA was not created.\n' >&2;exit 1; }
openssl x509 -in "$archive/test-ca.crt" -noout -checkend 60 >/dev/null
export SSL_CERT_FILE="$archive/test-ca.crt" CURL_CA_BUNDLE="$archive/test-ca.crt"
export STAR_STUDY_CI_ROOT="$fixture" STAR_STUDY_CI_STATE="$archive"
http() {
 curl --noproxy '*' --silent --show-error --max-time 15 --connect-timeout 5 \
  --resolve "$domain:$port:127.0.0.1" --cacert "$archive/test-ca.crt" "$@"
}
wait_health() {
 local attempt
 for ((attempt=0;attempt<40;attempt++));do
  if http --fail "https://$domain:$port$prefix/api/platform/health" >"$archive/health.json" 2>/dev/null;then return 0;fi
  sleep 2
 done
 printf 'Prefixed HTTPS health failed.\n' >&2;return 1
}
wait_health
[[ $(http --output /dev/null --write-out '%{http_code}' "https://$domain:$port/") == 404 ]]
http --fail "https://$domain:$port$prefix/" > "$archive/index.html"
http --fail "https://$domain:$port$prefix/manifest.webmanifest" > "$archive/manifest.json"
http --fail "https://$domain:$port$prefix/icons/star.svg" > /dev/null
curl --noproxy '*' --silent --show-error --max-time 10 --resolve "$domain:80:127.0.0.1" \
 --dump-header "$archive/redirect.headers" --output /dev/null "http://$domain$prefix/"
python3 - "$archive" "$domain" "$port" "$prefix" <<'PY'
import json,sys
from pathlib import Path
root,domain,port,prefix = sys.argv[1:]
root=Path(root)
headers=root.joinpath('redirect.headers').read_text().lower()
assert f'location: https://{domain}:{port}{prefix}/' in headers
manifest=json.loads(root.joinpath('manifest.json').read_text())
assert all(manifest[k] == prefix+'/' for k in ('id','scope','start_url'))
assert all(icon['src'].startswith(prefix+'/') for icon in manifest['icons'])
html=root.joinpath('index.html').read_text()
assert prefix+'/_next/' in html
PY
printf 'Real high-port private-CA HTTPS, redirect, prefix pages, icons, manifest and API: passed.\n'
python3 scripts/test-compose-api.py seed
env_digest=$(sha256sum .env)
docker compose exec -T caddy sh -c 'printf cert-state-for-lifecycle-test > /data/starstudy-ci-sentinel'
bash scripts/backup.sh
saved=$(python3 scripts/deployment-validation.py env .starstudy-backup-state DIRECTORY)
python3 scripts/deployment-validation.py backup "$saved"
[[ -s $saved/caddy-data.tar && -s $saved/caddy-config.tar ]]
python3 scripts/test-compose-api.py mutate
docker compose exec -T caddy rm /data/starstudy-ci-sentinel
printf 'RESTORE\nYES\n' | script --quiet --return --command 'bash scripts/restore.sh "'"$saved"'"' /dev/null > "$archive/restore.log" 2>&1 || {
 tail -n 40 "$archive/restore.log" | python3 scripts/deployment-validation.py redact .env >&2;exit 1;
}
[[ $env_digest == "$(sha256sum .env)" ]]
python3 scripts/test-compose-api.py verify
[[ $(docker compose exec -T caddy cat /data/starstudy-ci-sentinel) == cert-state-for-lifecycle-test ]]
printf 'Real PostgreSQL/learning-session/image and Caddy-state backup/restore: passed.\n'

docker volume create --label "io.starstudy.ci=$identity" "$sentinel_volume" >/dev/null
docker run -d --name "$sentinel_name" --label "io.starstudy.ci=$identity" \
 --mount "type=volume,source=$sentinel_volume,target=/sentinel" --entrypoint sleep postgres:17-bookworm 1800 >/dev/null
bash scripts/uninstall.sh
[[ -f .env && $env_digest == "$(sha256sum .env)" ]]
for purpose in postgres_data caddy_data caddy_config;do docker volume inspect "${project}_${purpose}" >/dev/null;done
docker compose up -d >"$archive/restart.log" 2>&1
wait_health
python3 scripts/test-compose-api.py verify
printf 'Normal uninstall/restart preserved configuration and real data: passed.\n'
printf 'DELETE STARSTUDY DATA\nYES\n' | script --quiet --return --command 'bash scripts/uninstall.sh --purge' /dev/null > "$archive/purge.log" 2>&1 || {
 tail -n 40 "$archive/purge.log" | python3 scripts/deployment-validation.py redact "$archive/cleanup.env" >&2;exit 1;
}
[[ ! -e .env ]]
for purpose in postgres_data caddy_data caddy_config;do
 if docker volume inspect "${project}_${purpose}" >/dev/null 2>&1;then printf 'Owned volume remains after purge.\n' >&2;exit 1;fi
done
[[ -z $(docker ps -aq --filter "label=com.docker.compose.project=$project") ]]
[[ $(docker inspect --format '{{.State.Running}}' "$sentinel_name") == true ]]
docker volume inspect "$sentinel_volume" >/dev/null
find "$archive/data" -name manifest.json -type f | grep -q .
printf 'Full uninstall removed only owned resources; unrelated container/volume and final external backup survived.\n'
printf 'Linux Docker lifecycle completed. Public DNS/HTTP-01/ACME and production release upgrades were not exercised.\n'
