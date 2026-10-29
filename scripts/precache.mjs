import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { buildBasePath, prefixedPath } from './base-path.mjs';
const basePath = buildBasePath();
const at = (url) => prefixedPath(url, basePath);
// Rewrite only build output; never commit an installation's private path into public sources.
const manifest = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
manifest.id = at('/');
manifest.start_url = at('/');
manifest.scope = at('/');
manifest.icons = manifest.icons.map((icon) => ({ ...icon, src: at(icon.src) }));
await writeFile('out/manifest.webmanifest', JSON.stringify(manifest));
await writeFile(
  'out/.star-study-build.json',
  JSON.stringify({ app: '星研', version: 1, basePath }),
);
async function walk(dir) {
  const result = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) result.push(...(await walk(p)));
    else result.push(p);
  }
  return result;
}
const paths = (await walk('out')).filter(
  (p) => !p.endsWith('sw.js') && !p.endsWith('.map') && !p.endsWith('.star-study-build.json'),
);
const urls = paths.map((p) => at('/' + path.relative('out', p).split(path.sep).join('/')));
const hash = createHash('sha256');
for (const p of paths) hash.update(await readFile(p));
const version = hash.digest('hex').slice(0, 12);
const cachePrefix = `xingyan-${createHash('sha256').update(basePath).digest('hex').slice(0, 12)}-`;
const sw = `const BASE=${JSON.stringify(basePath)};
const PREFIX=${JSON.stringify(cachePrefix)};
const CACHE=PREFIX+${JSON.stringify(version)};
const ASSETS=${JSON.stringify(urls)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(url.origin!==self.location.origin||event.request.method!=='GET'||(BASE&&!url.pathname.startsWith(BASE+'/'))||url.pathname.startsWith(BASE+'/api/'))return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE);const normalized=url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname;const hit=await cache.match(event.request)||await cache.match(normalized);if(hit)return hit;try{return await fetch(event.request);}catch{if(event.request.mode==='navigate')return await cache.match(BASE+'/404.html')||Response.error();return Response.error();}})());
});`;
await writeFile('out/sw.js', sw);
console.log(`星研离线缓存 ${version}: ${urls.length} 个资源`);
