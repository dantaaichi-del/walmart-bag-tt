// Shared local music for the two players. Uses TauriTavern 2.4's native
// extension store; no Node server, temporary playback URL, or audio data goes
// into chat metadata.
const NS='walmart-bag-tt-audio-v1';
const MAX_BYTES=100*1024*1024;
const safeId=id=>{id=String(id||'');if(!/^[a-zA-Z0-9_-]{1,120}$/.test(id))throw new Error('音乐编号无效');return id;};
let tail=Promise.resolve();
const serial=fn=>{const next=tail.then(fn);tail=next.catch(()=>{});return next;};
async function store(){
  const host=globalThis.__TAURITAVERN__;
  await (host?.ready??globalThis.__TAURITAVERN_MAIN_READY__);
  const api=host?.api?.extension?.store;
  if(!api?.tryGetJson||!api?.setJson||!api?.getBlob||!api?.setBlob||!api?.listKeys||!api?.deleteJson||!api?.deleteBlob)throw new Error('本机曲库需要 TauriTavern 2.4 的扩展存储接口');
  return api;
}
const opts=(id,table='tracks')=>({namespace:NS,table,key:safeId(id)});
const metadata=t=>({id:safeId(t.id),title:String(t.title||'未命名').slice(0,300),tags:String(t.tags||'').slice(0,500),mode:t.mode==='ancient'?'ancient':'modern',originalName:String(t.originalName||'').slice(0,300),type:String(t.type||'audio/mpeg'),size:Number(t.size||t.blob?.size)||0,addedAt:Number(t.addedAt)||Date.now(),storage:'local'});
function changed(){globalThis.dispatchEvent?.(new CustomEvent('walmart-local-audio-changed'));}
export function isAudio(file){return !!file&& !/\.(mgg\d*|qmc\w*|ncm)(?:\.|$)/i.test(file.name||'')&&!/^video\//i.test(file.type||'')&&!/\.(mp4|webm|mkv|mov|avi)$/i.test(file.name||'')&&(/^audio\//i.test(file.type||'')||/\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i.test(file.name||''));}
async function writeUnlocked(track){
  const api=await store(),row=metadata(track),entry=opts(row.id),prior=await api.tryGetJson(entry);
  if(track.blob){
    if(!isAudio({name:row.originalName,type:row.type}))throw new Error('请选择普通音频文件，本版不转换视频或加密音乐');
    if(track.blob.size>MAX_BYTES)throw new Error('单首音乐请控制在100MB内');
    if(!track.blob.size)throw new Error('音频文件是空的');
    await api.setBlob({...opts(row.id,'audio'),data:track.blob});
  }else if(!prior.found)throw new Error('未找到歌曲音频，请重新导入');
  try{await api.setJson({...entry,value:row});}
  catch(e){if(!prior.found&&track.blob)await api.deleteBlob(opts(row.id,'audio')).catch(()=>{});throw e;}
  changed();return row;
}
export const localAudio={
  async list(){await tail;const api=await store(),keys=await api.listKeys({namespace:NS,table:'tracks'});const rows=[];for(const key of keys){const r=await api.tryGetJson(opts(key));if(r.found)rows.push(metadata(r.value));}return rows.sort((a,b)=>a.addedAt-b.addedAt);},
  put(track){return serial(()=>writeUnlocked(track));},
  import(file,mode='modern'){
    if(!isAudio(file))return Promise.reject(new Error('请选择普通 MP3、M4A 等音频，本版不支持视频提取或加密文件'));
    const id=globalThis.crypto?.randomUUID?.()||`${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return this.put({id,mode,title:String(file.name||'音乐').replace(/\.[^.]+$/,''),originalName:file.name,type:file.type||'audio/mpeg',size:file.size,addedAt:Date.now(),blob:file});
  },
  async blob(id){await tail;const api=await store(),meta=await api.tryGetJson(opts(id));if(!meta.found)throw new Error('歌曲已移除，请重新读取本机曲库');const raw=await api.getBlob(opts(id,'audio'));return new Blob([raw],{type:meta.value.type||'audio/mpeg'});},
  delete(id){return serial(async()=>{const api=await store();await api.deleteJson(opts(id));await api.deleteBlob(opts(id,'audio')).catch(e=>console.warn('[本机曲库] 音频清理待重试',e));changed();});},
  source(id){return 'tt-audio:'+safeId(id);},
  async createUrl(source){if(!String(source).startsWith('tt-audio:'))return source;return URL.createObjectURL(await this.blob(source.slice(9)));},
};
