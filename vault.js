"use strict";
/* Bóveda local: todo se guarda en este teléfono (IndexedDB), cifrado con AES-GCM.
   Una clave de datos aleatoria (DEK) cifra todo; la contraseña (PBKDF2) solo envuelve esa clave. */
const Vault=(()=>{
  const DBN='consultorio',VER=1,ITER=600000;
  const enc=new TextEncoder(),dec=new TextDecoder();
  let idb=null,dek=null;
  const rnd=n=>crypto.getRandomValues(new Uint8Array(n));
  function open(){if(idb)return Promise.resolve(idb);return new Promise((res,rej)=>{const r=indexedDB.open(DBN,VER);r.onupgradeneeded=()=>{const d=r.result;for(const s of['meta','state','files','inbox'])if(!d.objectStoreNames.contains(s))d.createObjectStore(s)};r.onsuccess=()=>{idb=r.result;res(idb)};r.onerror=()=>rej(r.error)})}
  async function tx(store,mode,fn){const d=await open();return new Promise((res,rej)=>{const t=d.transaction(store,mode);const s=t.objectStore(store);let out;const r=fn(s);if(r&&'onsuccess'in r)r.onsuccess=()=>{out=r.result};t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error)})}
  const get=(s,k)=>tx(s,'readonly',st=>st.get(k));
  const put=(s,k,v)=>tx(s,'readwrite',st=>st.put(v,k));
  const del=(s,k)=>tx(s,'readwrite',st=>st.delete(k));
  const keys=s=>tx(s,'readonly',st=>st.getAllKeys());
  const clear=s=>tx(s,'readwrite',st=>st.clear());
  async function kek(pw,salt,iter){const base=await crypto.subtle.importKey('raw',enc.encode(pw),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:iter,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt','wrapKey','unwrapKey'])}
  async function seal(key,buf){const iv=rnd(12);const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,buf);return{iv,ct}}
  const open_=(key,o)=>crypto.subtle.decrypt({name:'AES-GCM',iv:o.iv},key,o.ct);

  async function isSetUp(){return !!(await get('meta','key'))}
  async function create(pw){
    dek=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
    await wrapWith(pw);
  }
  async function wrapWith(pw){const salt=rnd(16);const k=await kek(pw,salt,ITER);const iv=rnd(12);const w=await crypto.subtle.wrapKey('raw',dek,k,{name:'AES-GCM',iv});await put('meta','key',{salt,iter:ITER,iv,w})}
  async function unlock(pw){
    const m=await get('meta','key');if(!m)throw new Error('nokey');
    const k=await kek(pw,m.salt,m.iter);
    try{dek=await crypto.subtle.unwrapKey('raw',m.w,k,{name:'AES-GCM',iv:m.iv},{name:'AES-GCM',length:256},true,['encrypt','decrypt'])}catch(_){throw new Error('badpw')}
  }
  async function changePw(oldPw,newPw){const m=await get('meta','key');const k=await kek(oldPw,m.salt,m.iter);try{await crypto.subtle.unwrapKey('raw',m.w,k,{name:'AES-GCM',iv:m.iv},{name:'AES-GCM',length:256},true,['encrypt','decrypt'])}catch(_){throw new Error('badpw')}await wrapWith(newPw)}
  async function verify(pw){const m=await get('meta','key');try{const k=await kek(pw,m.salt,m.iter);await crypto.subtle.unwrapKey('raw',m.w,k,{name:'AES-GCM',iv:m.iv},{name:'AES-GCM',length:256},true,['encrypt','decrypt']);return true}catch(_){return false}}
  function lock(){dek=null}
  const unlocked=()=>!!dek;

  async function loadState(){const o=await get('state','main');if(!o)return null;return JSON.parse(dec.decode(await open_(dek,o)))}
  let saving=Promise.resolve();
  function saveState(obj){const job=async()=>{if(!dek)throw new Error('locked');await put('state','main',await seal(dek,enc.encode(JSON.stringify(obj))))};saving=saving.then(job,job);return saving}

  const newId=()=>Array.from(rnd(10),b=>b.toString(16).padStart(2,'0')).join('');
  async function putFile(blob,meta={}){const id=newId();await putFileAs(id,blob,meta);return{id,type:blob.type,size:blob.size}}
  async function putFileAs(id,blob,meta={}){const buf=await blob.arrayBuffer();const s=await seal(dek,buf);await put('files',id,{iv:s.iv,ct:s.ct,type:meta.type||blob.type||'application/octet-stream',size:buf.byteLength})}
  async function getFile(id){const o=await get('files',id);if(!o)return null;const b=await open_(dek,o);return new Blob([b],{type:o.type})}
  const delFile=id=>del('files',id);
  const fileIds=()=>keys('files');

  /* ---- respaldo: archivo de texto cifrado con la contraseña ---- */
  const MAGIC='CONSULTORIO-RESPALDO-CIFRADO v1';
  function b64(u8){let s='';const C=0x8000;for(let i=0;i<u8.length;i+=C)s+=String.fromCharCode.apply(null,u8.subarray(i,i+C));return btoa(s)}
  function unb64(str){const bin=atob(str);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u}
  async function exportBackup(state,pw,onProg){
    const ids=await fileIds();const files=[];const parts=[];let off=0;
    for(let i=0;i<ids.length;i++){const o=await get('files',ids[i]);const b=new Uint8Array(await open_(dek,o));files.push({id:ids[i],type:o.type,off,len:b.byteLength});parts.push(b);off+=b.byteLength;onProg&&onProg(i+1,ids.length)}
    const man=enc.encode(JSON.stringify({v:1,fecha:new Date().toISOString(),state,files}));
    const head=new Uint8Array(4);new DataView(head.buffer).setUint32(0,man.byteLength);
    const plain=new Blob([head,man,...parts]);const buf=await plain.arrayBuffer();
    const salt=rnd(16);const k=await kek(pw,salt,ITER);const s=await seal(k,buf);
    const ctB64=b64(new Uint8Array(s.ct));const lines=[];for(let i=0;i<ctB64.length;i+=76)lines.push(ctB64.slice(i,i+76));
    return new Blob([MAGIC+'\n'+JSON.stringify({salt:b64(salt),iv:b64(s.iv),iter:ITER})+'\n'+lines.join('\n')+'\n'],{type:'text/plain'});
  }
  async function readBackup(file,pw){
    const txt=await file.text();const nl1=txt.indexOf('\n'),nl2=txt.indexOf('\n',nl1+1);
    if(txt.slice(0,nl1).trim()!==MAGIC)throw new Error('notbackup');
    const p=JSON.parse(txt.slice(nl1+1,nl2));const ct=unb64(txt.slice(nl2+1).replace(/\s+/g,''));
    const k=await kek(pw,unb64(p.salt),p.iter);let buf;
    try{buf=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(p.iv)},k,ct)}catch(_){throw new Error('badpw')}
    const len=new DataView(buf,0,4).getUint32(0);const man=JSON.parse(dec.decode(new Uint8Array(buf,4,len)));
    const base=4+len;
    return{state:man.state,fecha:man.fecha,files:man.files.map(f=>({id:f.id,type:f.type,blob:new Blob([new Uint8Array(buf,base+f.off,f.len)],{type:f.type})}))};
  }
  async function wipeAll(){for(const s of['state','files'])await clear(s)}
  /* buzón de archivos compartidos desde otras apps (Grabadora, Docs) */
  async function inbox(){const ks=await keys('inbox');const out=[];for(const k of ks)out.push(Object.assign({key:k},await get('inbox',k)));return out}
  const inboxDel=k=>del('inbox',k);
  async function persist(){try{if(navigator.storage&&navigator.storage.persist)return await navigator.storage.persist()}catch(_){}return false}
  return{verify,isSetUp,create,unlock,changePw,lock,unlocked,loadState,saveState,putFile,putFileAs,getFile,delFile,fileIds,exportBackup,readBackup,wipeAll,inbox,inboxDel,newId,persist};
})();
