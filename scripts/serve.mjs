import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createApiHandler } from './api.mjs';
try {
  process.loadEnvFile?.('.env.local');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const api = createApiHandler();
let platform;
if (process.env.DATABASE_URL || process.env.STAR_STUDY_TEST_DATABASE) {
  const {postgresDatabase,embeddedDatabase,platformApi}=await import('../dist/platform.mjs');
  const database=process.env.DATABASE_URL ? await postgresDatabase(process.env.DATABASE_URL) : await embeddedDatabase(process.env.STAR_STUDY_TEST_DATABASE);
  platform=platformApi(database);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void database.close().finally(()=>process.exit(0));});
}
const root = path.resolve('out'),
  port = Number(process.env.PORT || 3000);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};
http
  .createServer(async (req, res) => {
    try {
      res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
      res.setHeader('X-Frame-Options','DENY');
      res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; worker-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if(platform && await platform(req,res,url))return;
      // In multi-user mode legacy unauthenticated AI/cloud routes must never bypass account checks.
      if(platform && url.pathname.startsWith('/api/') && url.pathname!=='/api/local-plan') {res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'请使用账户服务接口'}));return;}
      if (await api(req, res, url)) return;
      let p = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (p !== root && !p.startsWith(root + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        if ((await stat(p)).isDirectory()) p = path.join(p, 'index.html');
      } catch {}
      const content = await readFile(p);
      res.writeHead(200, {
        'Content-Type': types[path.extname(p)] || 'application/octet-stream',
        'Cache-Control': path.basename(p) === 'sw.js' ? 'no-store' : 'no-cache',
        'Service-Worker-Allowed': '/',
      });
      res.end(content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        await readFile(path.join(root, '404.html')).catch(() => Buffer.from('星研：页面未找到')),
      );
    }
  })
  .listen(port, process.env.HOST || '127.0.0.1', () =>
    console.log(`星研已启动: http://localhost:${port}`),
  );
