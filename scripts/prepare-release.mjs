import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = process.cwd(),
  ref = 'refs/heads/codex/public-release';
const git = (args, options = {}) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', ...options }).trim();
if (git(['status', '--porcelain']))
  throw new Error('请先审查并提交当前改动。发布准备不会覆盖未提交文件。');
execFileSync(process.execPath, [fileURLToPath(new URL('./security-check.mjs', import.meta.url))], {
  cwd: root,
  stdio: 'inherit',
});
const head = git(['rev-parse', 'HEAD']);
let previous = '';
try {
  previous = git(['rev-parse', '--verify', ref]);
} catch {}
if (previous) {
  let related = false;
  try {
    git(['merge-base', head, previous]);
    related = true;
  } catch {}
  if (related) throw new Error('发布分支与开发历史已有共同提交，需人工审查；不会覆盖该分支。');
}
const backups = path.resolve(root, 'backups');
await mkdir(backups, { recursive: true });
const temporary = await mkdtemp(path.join(backups, 'release-index-'));
if (!temporary.startsWith(backups + path.sep)) throw new Error('临时目录越界，已停止');
const env = { ...process.env, GIT_INDEX_FILE: path.join(temporary, 'index') };
try {
  git(['read-tree', `${head}^{tree}`], { env });
  const files = git(['ls-tree', '-r', '--name-only', head]).split(/\r?\n/).filter(Boolean);
  // Historical QA screenshots are private development evidence, not application assets.
  const excluded = files.filter((p) => p.startsWith('docs/screenshots/'));
  if (excluded.length) git(['update-index', '--force-remove', '--', ...excluded], { env });
  const ux = 'docs/UX_UPGRADE.md';
  if (files.includes(ux)) {
    const original = await readFile(path.join(root, ux), 'utf8');
    const sanitized = original.replace(
      /\[([^\]]+)\]\(screenshots\/[^)]+\)/g,
      '$1（历史验收截图不随公开源码分发）',
    );
    const blob = git(['hash-object', '-w', '--stdin'], { input: sanitized });
    git(['update-index', '--add', '--cacheinfo', `100644,${blob},${ux}`], { env });
  }
  const tree = git(['write-tree'], { env });
  if (previous && git(['rev-parse', `${previous}^{tree}`]) === tree) {
    console.log('发布分支已包含相同源码，无需新增提交。');
  } else {
    const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
    const args = [
      '-c',
      `user.name=${process.env.STAR_STUDY_RELEASE_AUTHOR_NAME || 'Star Study contributors'}`,
      '-c',
      `user.email=${process.env.STAR_STUDY_RELEASE_AUTHOR_EMAIL || 'noreply@star-study.invalid'}`,
      'commit-tree',
      tree,
      ...(previous ? ['-p', previous] : []),
      '-m',
      `release: audited Star Study ${version} source snapshot`,
    ];
    const commit = git(args);
    git(['update-ref', ref, commit, previous || '0'.repeat(40)]);
    console.log(`本地发布分支已准备：codex/public-release ${commit.slice(0, 7)}`);
  }
  console.log(
    '原开发分支、工作区和私有历史保持原状；没有创建远程仓库或推送。请按docs/GITHUB_RELEASE.md由本人决定首次发布。',
  );
} finally {
  // Only remove our verified, uniquely created temporary index directory.
  if (temporary.startsWith(backups + path.sep))
    await rm(temporary, { recursive: true, force: true });
}
