/* Service worker: guarda la app para que funcione sin internet y recibe archivos compartidos. */
const CACHE='froid-v3';
const FILES=['./','./index.html','./vault.js','./manifest.webmanifest','./dmsans.woff2','./icon-192.png','./icon-512.png','./icon-maskable.png','./fraunces.woff2','./img/logo-vertical.svg','./img/logo-horizontal.svg','./img/froid-atento.svg','./img/froid-tranquilo.svg','./img/froid-feliz.svg','./img/froid-complice.svg','./img/froid-pensativo.svg','./img/froid-sorprendido.svg'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
function inboxPut(items){return new Promise((res,rej)=>{const r=indexedDB.open('consultorio',1);r.onupgradeneeded=()=>{const d=r.result;for(const s of['meta','state','files','inbox'])if(!d.objectStoreNames.contains(s))d.createObjectStore(s)};r.onsuccess=()=>{const t=r.result.transaction('inbox','readwrite');const s=t.objectStore('inbox');for(const it of items)s.put(it,Date.now()+'-'+Math.random().toString(36).slice(2));t.oncomplete=()=>res();t.onerror=()=>rej(t.error)};r.onerror=()=>rej(r.error)})}
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method==='POST'&&u.pathname.endsWith('/compartir')){
    e.respondWith((async()=>{
      try{const fd=await e.request.formData();const items=[];
        for(const f of fd.getAll('archivos'))if(f&&f.size)items.push({name:f.name||'archivo',type:f.type||'',data:await f.arrayBuffer(),recibido:new Date().toISOString()});
        const txt=[fd.get('title'),fd.get('text')].filter(Boolean).join('\n');
        if(!items.length&&txt)items.push({name:'texto compartido.txt',type:'text/plain',data:new TextEncoder().encode(txt).buffer,recibido:new Date().toISOString()});
        await inboxPut(items);
      }catch(_){}
      return Response.redirect(new URL('./?compartido=1',self.registration.scope).href,303);
    })());
    return;
  }
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request).then(res=>{if(res.ok){const c=res.clone();caches.open(CACHE).then(x=>x.put(e.request,c))}return res}).catch(()=>caches.match('./index.html'))));
});
