#!/usr/bin/env python3
"""Internal standard-library validation. Never execute configuration or backup contents."""
import hashlib
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tarfile
from urllib.parse import urlsplit

def fail(message):
    raise ValueError(message)

def env_read(filename):
    path = Path(filename)
    if not path.is_file() or path.is_symlink(): fail('配置文件不存在或为符号链接')
    values = {}
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        line = line.strip()
        if not line or line.startswith('#'): continue
        key, sep, value = line.partition('=')
        if not sep or not re.fullmatch(r'[A-Z][A-Z0-9_]*', key): fail('配置含无法识别的行')
        if key in values: fail('配置含重复键')
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'": value = value[1:-1]
        if any(ord(char) < 32 for char in value): fail('配置含控制字符')
        values[key] = value
    return values

def marker(filename, root):
    path = Path(filename); values = env_read(filename); info = path.stat()
    if os.name == 'posix' and (info.st_uid != 0 or info.st_mode & 0o022): fail('安装标记必须为root所有且不可被其他用户写入')
    if values.get('APP') != 'StarStudy' or values.get('FORMAT_VERSION') != '1': fail('安装标记类型错误')
    identity = values.get('INSTALL_ID', '')
    if not re.fullmatch(r'[a-f0-9]{32}', identity): fail('安装身份无效')
    if values.get('COMPOSE_PROJECT_NAME') != 'starstudy_' + identity[:12]: fail('项目名与安装身份不符')
    declared = values.get('ROOT_PATH', '')
    if os.name == 'nt' and re.match(r'^/[a-zA-Z]/', declared): declared = declared[1] + ':' + declared[2:]
    if Path(declared).resolve() != Path(root).resolve(): fail('安装标记目录不符')

def domain(value):
    if len(value) > 253 or '.' not in value or not all(re.fullmatch(r'[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?', label) for label in value.split('.')):
        fail('域名格式无效，请勿填写协议、端口或路径')
    try: ipaddress.ip_address(value)
    except ValueError: return
    fail('证书安装需要域名，不能填写IP地址')

def config(filename):
    values = env_read(filename); url = urlsplit(values.get('PUBLIC_URL', '')); prefix = values.get('APP_BASE_PATH', '')
    if prefix and not re.fullmatch(r'/[a-f0-9]{32,128}', prefix): fail('随机访问路径格式无效')
    if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.query or url.fragment: fail('PUBLIC_URL无效')
    if url.path.rstrip('/') != prefix: fail('PUBLIC_URL与APP_BASE_PATH不一致')
    if url.scheme == 'http' and not (values.get('ALLOW_INSECURE_LOCAL') == '1' and url.hostname in ('localhost', '127.0.0.1', '::1')): fail('公网HTTP不能用于账户登录')
    if url.scheme == 'https':
        domain(url.hostname)
        port = int(values.get('HTTPS_PORT', '443'))
        if not 1 <= port <= 65535 or (url.port or 443) != port: fail('HTTPS端口与PUBLIC_URL不一致')
        if values.get('HTTP_PORT', '80') != '80': fail('HTTP-01必须使用公网80端口')
        if values.get('SITE_ADDRESS', url.hostname) != url.hostname or values.get('CADDY_DOMAIN', url.hostname) != url.hostname: fail('Caddy域名与PUBLIC_URL不一致')
    email = values.get('ACME_EMAIL', '')
    directive = values.get('ACME_EMAIL_DIRECTIVE', '')
    if email and not re.fullmatch(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}', email): fail('证书联系邮箱无效')
    if directive != ('email ' + email if email else ''): fail('ACME邮箱指令不一致，不能执行任意Caddy指令')
    if not values.get('POSTGRES_PASSWORD') or len(values.get('SESSION_SECRET', '')) < 32 or not values.get('SETUP_TOKEN'): fail('数据库或会话/初始化密钥未配置')
    return values

def dns_match(a, aaaa, public4, public6):
    def addresses(text):
        found = set()
        for value in text.split():
            try: found.add(ipaddress.ip_address(value))
            except ValueError: continue
        return found
    dns = addresses(a) | addresses(aaaa); public = addresses(public4) | addresses(public6)
    if not dns: fail('域名尚无有效A或AAAA记录，请先配置DNS')
    if not public: fail('无法确认本机公网IP，请检查出站网络或代理配置')
    if not dns.issubset(public): fail('DNS与本机公网IP不一致。请核对A/AAAA、等待生效，并暂时关闭CDN代理；证书申请已停止')

def safe_tar(filename):
    with tarfile.open(filename, 'r:*') as archive:
        total = 0
        for member in archive:
            name = member.name; path = PurePosixPath(name)
            if path.is_absolute() or '..' in path.parts or '\\' in name or any(ord(c) < 32 for c in name) or member.mode & 0o6000 or not (member.isfile() or member.isdir()): fail('证书归档含越界路径、链接、特殊权限或特殊文件')
            total += member.size
            if total > 2_000_000_000: fail('证书归档过大')

def verify_backup(directory):
    root = Path(directory).resolve()
    if not root.is_dir(): fail('备份目录不存在')
    files = {}
    for base, dirs, names in os.walk(root, followlinks=False):
        for name in dirs + names:
            path = Path(base) / name; info = path.lstat()
            if stat.S_ISLNK(info.st_mode) or not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)): fail('备份包含链接或特殊文件')
            if stat.S_ISREG(info.st_mode): files['./' + path.relative_to(root).as_posix()] = path
    sums = files.pop('./SHA256SUMS', None)
    if not sums: fail('缺少备份校验清单')
    expected = {}
    for line in sums.read_text(encoding='utf-8').splitlines():
        match = re.fullmatch(r'([a-fA-F0-9]{64}) [ *](\./[^\r\n]+)', line)
        if not match: fail('备份校验清单格式错误')
        digest, name = match.groups()
        if '..' in PurePosixPath(name).parts or '\\' in name or name in expected or name not in files: fail('校验清单含越界、重复或不存在的文件')
        expected[name] = digest.lower()
    if set(files) != set(expected): fail('备份存在未校验或遗漏的文件')
    for name, path in files.items():
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''): digest.update(block)
        if digest.hexdigest() != expected[name]: fail('备份校验失败，禁止恢复、更新或清理')
    mandatory = {'.env', 'compose.yaml', 'Caddyfile', 'database.dump', 'manifest.json', 'source-revision.txt'}
    if not all('./' + name in files for name in mandatory): fail('备份缺少必要文件')
    if files['./database.dump'].stat().st_size == 0: fail('数据库备份为空')
    manifest = json.loads(files['./manifest.json'].read_text(encoding='utf-8'))
    if manifest.get('app') != '星研' or manifest.get('formatVersion') not in (1, 2): fail('备份版本不兼容')
    if manifest['formatVersion'] == 2:
        if manifest.get('complete') is not True: fail('备份尚未完整结束')
        for name in ('caddy-data.tar', 'caddy-config.tar', '.starstudy-install'):
            if './' + name not in files: fail('完整备份缺少证书或安装身份')
        safe_tar(files['./caddy-data.tar']); safe_tar(files['./caddy-config.tar'])
        values = config(files['./.env'])
        identity = manifest.get('installationId', '')
        if not re.fullmatch(r'[a-f0-9]{32}', identity) or identity != values.get('INSTALL_ID'): fail('备份安装身份与配置不符')
        if manifest.get('composeProjectName') != values.get('COMPOSE_PROJECT_NAME') or values.get('COMPOSE_PROJECT_NAME') != 'starstudy_' + identity[:12]: fail('备份项目名不符')
        recorded = env_read(files['./.starstudy-install'])
        if recorded.get('APP') != 'StarStudy' or recorded.get('INSTALL_ID') != identity or recorded.get('COMPOSE_PROJECT_NAME') != values.get('COMPOSE_PROJECT_NAME'): fail('备份归属标记不符')
    print('备份校验通过（含所有已列文件）')

def redact(filename):
    values = env_read(filename)
    secrets = [value for key, value in values.items() if value and (any(part in key for part in ('PASSWORD', 'SECRET', 'TOKEN', 'API_KEY', 'PRIVATE_KEY')) or key in ('APP_BASE_PATH', 'PUBLIC_URL'))]
    secrets.sort(key=len, reverse=True)
    for line in sys.stdin:
        for secret in secrets: line = line.replace(secret, '[已隐藏]')
        line = re.sub(r'(?i)(Bearer\s+)[A-Za-z0-9._~+/-]+', r'\1[已隐藏]', line)
        line = re.sub(r'(?i)((?:api[_-]?key|password|token|secret)["\s:=]+)[^\s,"}]+', r'\1[已隐藏]', line)
        sys.stdout.write(line); sys.stdout.flush()

try:
    action = sys.argv[1]
    if action == 'env': print(env_read(sys.argv[2]).get(sys.argv[3], ''))
    elif action == 'marker': marker(sys.argv[2], sys.argv[3])
    elif action == 'domain': domain(sys.argv[2])
    elif action == 'config': config(sys.argv[2])
    elif action == 'url-domain': print(urlsplit(sys.argv[2]).hostname or '')
    elif action == 'dns': dns_match(*sys.argv[2:6])
    elif action == 'backup': verify_backup(sys.argv[2])
    elif action == 'redact': redact(sys.argv[2])
    elif action == 'tar': safe_tar(sys.argv[2])
    elif action == 'port':
        bindings = json.load(sys.stdin) or {}
        used = any(str(binding.get('HostPort')) == sys.argv[2] for group in bindings.values() for binding in (group or []))
        sys.exit(0 if used else 10)
    elif action == 'addresses':
        for interface in json.load(sys.stdin):
            for address in interface.get('addr_info', []):
                candidate = ipaddress.ip_address(address.get('local', ''))
                if candidate.is_global: print(candidate)
    elif action == 'compose-project':
        project = sys.argv[2]; model = json.load(sys.stdin)
        allowed = {'postgres_data', 'caddy_data', 'caddy_config'}
        if model.get('name') != project or set(model.get('volumes', {})) != allowed: fail('Compose项目或数据卷声明不符')
        if not set(model.get('services', {})).issubset({'database', 'migrate', 'app', 'caddy'}): fail('Compose包含未确认服务')
        for key, value in model['volumes'].items():
            if value.get('external') or value.get('name') != project + '_' + key: fail('Compose声明了外部或其他项目的数据卷')
        for key,value in model.get('networks',{}).items():
            if key != 'default' or value.get('external') or value.get('name') != project+'_default': fail('Compose网络无法确认归属')
    else: fail('未知内部校验操作')
except (ValueError, OSError, KeyError, IndexError, tarfile.TarError) as error:
    print('校验失败：' + str(error), file=sys.stderr); sys.exit(1)
