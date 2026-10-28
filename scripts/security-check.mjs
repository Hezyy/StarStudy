import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
const paths = [
  ...new Set(
    execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean),
  ),
];
const failures = [];
for (const p of paths) {
  if (/(^|\/)(\.env(?:\..*)?|backups|imports|uploads|data)(\/|$)/.test(p) && p !== '.env.example')
    failures.push(`${p}: 私有文件不得进入版本控制`);
  if (!/\.(?:[cm]?[jt]sx?|json|ya?ml|md|sh|sql|example)$/.test(p)) continue;
  const text = await readFile(p, 'utf8');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))
    failures.push(`${p}: 包含私钥`);
  if (/\bsk-(?:proj-)?[a-zA-Z0-9_-]{28,}\b/.test(text)) failures.push(`${p}: 疑似真实API密钥`);
  if (/postgres(?:ql)?:\/\/[^\s:]+:[^\s@$\{]{16,}@/.test(text))
    failures.push(`${p}: 疑似含真实数据库密码`);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(
  `发布前检查通过：${paths.length}个候选文件，无私有目录或已知密钥格式。此扫描不能替代人工审查。`,
);
