import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
/** Explicit allowlist. Never includes .git history, environment secrets, databases, uploads, or private Excel. */
export async function sourceArchive() {
  const zip = new JSZip(),
    folders = ['src', 'server', 'scripts', 'public', 'tests', '.github', 'docs', 'supabase'];
  const roots = [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'next-env.d.ts',
    'next.config.ts',
    'postcss.config.mjs',
    'vitest.config.mts',
    'playwright.config.ts',
    'playwright.platform.config.ts',
    'playwright.prefix.config.ts',
    'eslint.config.mjs',
    'drizzle.config.ts',
    'components.json',
    'README.md',
    'DEVELOPMENT_PROGRESS.md',
    'README_EN.md',
    'LICENSE',
    'CONTRIBUTING.md',
    'CODE_OF_CONDUCT.md',
    'SECURITY.md',
    'CHANGELOG.md',
    '.env.example',
    '.gitignore',
    '.gitattributes',
    '.dockerignore',
    '.prettierrc.json',
    'Dockerfile',
    'compose.yaml',
    'Caddyfile',
    'starstudy.sh',
  ];
  async function add(file) {
    if (file.startsWith('public/source/') || file.startsWith('docs/screenshots/') ||
        file.split('/').includes('__pycache__') || /\.py[co]$/.test(file)) return;
    const stat = await readdir(file, { withFileTypes: true }).catch(() => null);
    if (stat) {
      for (const entry of stat) await add(`${file}/${entry.name}`);
    } else {
      try {
        const bytes = await readFile(file);
        zip.file(
          file,
          file === 'docs/UX_UPGRADE.md'
            ? bytes
                .toString('utf8')
                .replace(
                  /\[([^\]]+)\]\(screenshots\/[^)]+\)/g,
                  '$1（历史验收截图不随公开源码分发）',
                )
            : bytes,
        );
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
  }
  for (const file of [...roots, ...folders]) await add(file);
  const version = JSON.parse(await readFile('package.json', 'utf8')).version;
  zip.file(
    'SOURCE_VERSION.txt',
    `星研 ${version}\nAGPL-3.0-only\n构建时源代码快照。不含密钥、私人数据或Git历史。运行步骤见README。\n`,
  );
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await mkdir('public/source', { recursive: true });
  await writeFile(path.join('public/source', 'star-study-source.zip'), buffer);
  console.log(
    `对应源码包已生成：${buffer.length} bytes SHA256 ${createHash('sha256').update(buffer).digest('hex')}`,
  );
}
