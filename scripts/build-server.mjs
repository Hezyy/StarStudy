import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { sourceArchive } from './source-archive.mjs';
await mkdir('dist', { recursive: true });
await build({
  entryPoints: {
    platform: 'server/entry.ts',
    migrate: 'server/migrate.ts',
    'generate-templates': 'scripts/plan-templates.ts',
  },
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node24',
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  sourcemap: false,
});
await import('../dist/generate-templates.mjs');
await sourceArchive();
console.log('星研服务端构建完成');
