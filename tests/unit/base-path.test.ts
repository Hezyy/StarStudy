import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import {
  normalizeBasePath,
  buildBasePath,
  stripBasePath,
  checkBuildBasePath,
} from '../../scripts/base-path.mjs';
const run = promisify(execFile);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('deployment path prefix', () => {
  it('单段校验、构建一致性和边界匹配，不把配置写进错误信息', () => {
    expect(normalizeBasePath('')).toBe('');
    expect(normalizeBasePath('/test-prefix')).toBe('/test-prefix');
    for (const invalid of ['/', 'secret', '/a/b', '/a/', '//evil.test', '/x?y', '/x%2fy'])
      expect(() => normalizeBasePath(invalid)).toThrow();
    expect(
      buildBasePath({ APP_BASE_PATH: '/test-prefix', NEXT_PUBLIC_BASE_PATH: '/test-prefix' }),
    ).toBe('/test-prefix');
    expect(() =>
      buildBasePath({ APP_BASE_PATH: '/private-test', NEXT_PUBLIC_BASE_PATH: '' }),
    ).toThrow('不一致');
    expect(stripBasePath('/test-prefix/plan/', '/test-prefix')).toBe('/plan/');
    expect(stripBasePath('/test-prefix-other/api/', '/test-prefix')).toBeNull();
    expect(stripBasePath('/api/platform/session', '/test-prefix')).toBeNull();
    expect(stripBasePath('/test-prefix', '/test-prefix')).toBe('/');
    expect(() =>
      checkBuildBasePath({ app: '星研', version: 1, basePath: '/private-test' }, ''),
    ).toThrow('不一致');
    try {
      checkBuildBasePath({ app: '星研', version: 1, basePath: '/private-test' }, '');
    } catch (error) {
      expect(String(error)).not.toContain('/private-test');
    }
  });
  it('原生URL与缓存元数据加作用域，root模式保留原键，Next链接不依赖此helper', async () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '');
    const root = await import('@/lib/app-path');
    expect(root.appUrl('/api/platform/status')).toBe('/api/platform/status');
    expect(root.appStorageKey('star-account')).toBe('star-account');
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/test-prefix');
    vi.resetModules();
    const prefixed = await import('@/lib/app-path');
    expect(prefixed.appUrl('/api/platform/status')).toBe('/test-prefix/api/platform/status');
    expect(prefixed.appUrl('/')).toBe('/test-prefix/');
    expect(prefixed.appStorageKey('star-account')).not.toBe('star-account');
    expect(() => prefixed.appUrl('//outside.test')).toThrow();
  });
  it('只重写构建输出的manifest、SW作用域、缓存和构建元数据，不写入源码或日志', async () => {
    const parent = path.resolve('test-results');
    await mkdir(parent, { recursive: true });
    const fixture = await mkdtemp(path.join(parent, 'prefix-unit-'));
    const relative = path.relative(parent, path.resolve(fixture));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error('unsafe fixture directory');
    try {
      await mkdir(path.join(fixture, 'public'), { recursive: true });
      await mkdir(path.join(fixture, 'out/icons'), { recursive: true });
      const original = JSON.stringify({
        id: '/',
        start_url: '/',
        scope: '/',
        icons: [{ src: '/icons/icon.png' }],
      });
      await writeFile(path.join(fixture, 'public/manifest.webmanifest'), original);
      await writeFile(path.join(fixture, 'out/index.html'), '<h1>synthetic</h1>');
      await writeFile(path.join(fixture, 'out/404.html'), '<h1>not found</h1>');
      await writeFile(path.join(fixture, 'out/icons/icon.png'), 'synthetic fixture');
      const result = await run(process.execPath, [path.resolve('scripts/precache.mjs')], {
        cwd: fixture,
        env: {
          ...process.env,
          APP_BASE_PATH: '/test-prefix',
          NEXT_PUBLIC_BASE_PATH: '/test-prefix',
        },
      });
      const manifest = JSON.parse(
        await readFile(path.join(fixture, 'out/manifest.webmanifest'), 'utf8'),
      );
      expect(manifest).toMatchObject({
        id: '/test-prefix/',
        start_url: '/test-prefix/',
        scope: '/test-prefix/',
      });
      expect(manifest.icons[0].src).toBe('/test-prefix/icons/icon.png');
      expect(await readFile(path.join(fixture, 'public/manifest.webmanifest'), 'utf8')).toBe(
        original,
      );
      expect(
        JSON.parse(await readFile(path.join(fixture, 'out/.star-study-build.json'), 'utf8'))
          .basePath,
      ).toBe('/test-prefix');
      const worker = await readFile(path.join(fixture, 'out/sw.js'), 'utf8');
      expect(worker).toContain('"/test-prefix/index.html"');
      expect(worker).toContain("url.pathname.startsWith(BASE+'/api/')");
      expect(worker).toContain('k.startsWith(PREFIX)');
      expect(worker).not.toContain('/.star-study-build.json');
      expect(result.stdout).not.toContain('/test-prefix');
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
