import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
const script = path.resolve('scripts/prepare-release.mjs');
it('发布准备保留私有开发历史，发布树排除旧历史和截图，重复运行幂等且拒绝未提交改动', async () => {
  const base = path.resolve('backups');
  await mkdir(base, { recursive: true });
  const fixture = await mkdtemp(path.join(base, 'release-fixture-'));
  if (!fixture.startsWith(base + path.sep)) throw new Error('测试目录越界');
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: fixture,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  const commit = () =>
    git([
      '-c',
      'user.name=Release Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-am',
      'synthetic fixture',
    ]);
  const prepare = () =>
    execFileSync(process.execPath, [script], {
      cwd: fixture,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  try {
    await mkdir(path.join(fixture, 'src'), { recursive: true });
    await mkdir(path.join(fixture, 'docs/screenshots'), { recursive: true });
    await writeFile(path.join(fixture, '.gitignore'), 'backups/\n');
    await writeFile(
      path.join(fixture, 'package.json'),
      JSON.stringify({ name: 'synthetic-release-test', version: '0.0.0' }),
    );
    await writeFile(
      path.join(fixture, 'src/example.ts'),
      "export const example='private-original-fixture';\n",
    );
    await writeFile(path.join(fixture, 'docs/screenshots/private.png'), 'synthetic-screenshot');
    await writeFile(
      path.join(fixture, 'docs/UX_UPGRADE.md'),
      '[历史截图](screenshots/private.png)\n',
    );
    git(['init', '-b', 'private-dev']);
    git(['add', '.']);
    commit();
    const old = git(['rev-parse', 'HEAD']);
    await writeFile(
      path.join(fixture, 'src/example.ts'),
      "export const example='neutral-example';\n",
    );
    commit();
    const current = git(['rev-parse', 'HEAD']);
    prepare();
    const released = git(['rev-parse', 'codex/public-release']);
    expect(git(['branch', '--show-current'])).toBe('private-dev');
    expect(git(['rev-parse', 'HEAD'])).toBe(current);
    expect(git(['rev-list', '--count', 'codex/public-release'])).toBe('1');
    expect(git(['show', `${old}:src/example.ts`])).toContain('private-original-fixture');
    expect(git(['show', 'codex/public-release:src/example.ts'])).toContain('neutral-example');
    expect(() =>
      git(['cat-file', '-e', 'codex/public-release:docs/screenshots/private.png']),
    ).toThrow();
    expect(git(['show', 'codex/public-release:docs/UX_UPGRADE.md'])).toContain('不随公开源码分发');
    expect(await readFile(path.join(fixture, 'docs/screenshots/private.png'), 'utf8')).toBe(
      'synthetic-screenshot',
    );
    prepare();
    expect(git(['rev-parse', 'codex/public-release'])).toBe(released);
    await writeFile(path.join(fixture, 'src/example.ts'), 'uncommitted-user-change');
    expect(prepare).toThrow();
    expect(git(['rev-parse', 'codex/public-release'])).toBe(released);
    expect(await readFile(path.join(fixture, 'src/example.ts'), 'utf8')).toBe(
      'uncommitted-user-change',
    );
  } finally {
    if (fixture.startsWith(base + path.sep)) await rm(fixture, { recursive: true, force: true });
  }
}, 30000);
