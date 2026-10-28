import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
async function walk(dir) {
  const result = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) result.push(...(await walk(p)));
    else result.push(p);
  }
  return result;
}
const paths = (await walk('out')).filter((p) => !p.endsWith('sw.js') && !p.endsWith('.map'));
const urls = paths.map((p) => '/' + path.relative('out', p).split(path.sep).join('/'));
const hash = createHash('sha256');
for (const p of paths) hash.update(await readFile(p));
const version = hash.digest('hex').slice(0, 12);
const sw = `const CACHE='xingyan-${version}';
const ASSETS=${JSON.stringify(urls)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('xingyan-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(url.origin!==self.location.origin||event.request.method!=='GET'||url.pathname.startsWith('/api/'))return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE);const normalized=url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname;const hit=await cache.match(event.request)||await cache.match(normalized);if(hit)return hit;try{return await fetch(event.request);}catch{if(event.request.mode==='navigate')return await cache.match('/404.html')||Response.error();return Response.error();}})());
});`;
await writeFile('out/sw.js', sw);
console.log(`星研离线缓存 ${version}: ${urls.length} 个资源`);
