const CACHE='carnet-v3';
const CORE=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-maskable.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const req=e.request;if(req.method!=='GET')return;
  const url=new URL(req.url);
  const fonts=url.host==='fonts.googleapis.com'||url.host==='fonts.gstatic.com';
  if(url.origin!==location.origin&&!fonts)return;
  e.respondWith(caches.open(CACHE).then(async c=>{
    const hit=await c.match(req,{ignoreSearch:!fonts});
    const net=fetch(req).then(r=>{if(r&&(r.ok||r.type==='opaque'))c.put(req,r.clone());return r;}).catch(()=>null);
    if(hit){if(!fonts)e.waitUntil(net);return hit;}
    const r=await net;if(r)return r;
    if(req.mode==='navigate')return (await c.match('./index.html'))||Response.error();
    return Response.error();
  }));
});
