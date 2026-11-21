import {localAudio} from '../../local-audio.js';
(() => {
  const CHOCO_ICON=new URL('./assets/chocolate.png',import.meta.url).href;
  const MODULE='chocolate_story_player_v1', ROOT_ID='choco-player-root', PANEL_ID='choco-player-panel';
  const POS_KEY='chocolate_story_player_pos_v1';
  let playIntent=0,tracks=[],localTracks=[], currentTrack=null, currentUrl=null, choosing=false, mode='modern', playbackMode='sequential', panelOpen=false;
  let editingTrackId='', editSaving=false, shareNoticeAccepted=false;
  const SHARE_NOTICE='免费分享，请勿倒卖、请勿去署名二次发布';
  const ctx=()=>SillyTavern.getContext();
  const toast=(msg,type='info')=>{try{if(window.toastr?.[type])window.toastr[type](msg);else console.log('[巧克力播放器]',msg)}catch(_){}};
  function settings(){const c=ctx();if(!c.extensionSettings[MODULE]){c.extensionSettings[MODULE]={mode:'modern',playbackMode:'sequential'};c.saveSettingsDebounced()}if(!['modern','ancient'].includes(c.extensionSettings[MODULE].mode))c.extensionSettings[MODULE].mode='modern';if(!['sequential','repeat-one','shuffle'].includes(c.extensionSettings[MODULE].playbackMode))c.extensionSettings[MODULE].playbackMode='sequential';return c.extensionSettings[MODULE]}
  function setMode(next){if(!['modern','ancient'].includes(next)||mode===next)return;mode=next;settings().mode=mode;ctx().saveSettingsDebounced();stopAudio(true);currentTrack=null;render();toast(`已切换到${mode==='modern'?'现代':'古风'}曲库；不会自动播放。`)}
  function setPlaybackMode(next){if(!['sequential','repeat-one','shuffle'].includes(next))return;playbackMode=next;settings().playbackMode=next;ctx().saveSettingsDebounced();render();const names={sequential:'顺序播放','repeat-one':'单曲循环',shuffle:'随机播放'};toast(`播放模式：${names[next]}`,'info')}
  function cyclePlaybackMode(){const list=['sequential','repeat-one','shuffle'];const i=list.indexOf(playbackMode);setPlaybackMode(list[(i+1)%list.length])}
  async function openDB(){await localAudio.list();}
  const dbGetAll=()=>localAudio.list();
  const dbPut=t=>localAudio.put(t);
  const dbDelete=id=>localAudio.delete(id);
  const esc=(s='')=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const cleanTitle=(n='')=>String(n).replace(/\.(mp3|m4a|aac|ogg|wav|flac|opus|webm|mp4|mkv|mov|m4v|3gp|avi|mpeg|mpg|ts)$/ig,'').replace(/[_-]+/g,' ').trim();
  const fmt=sec=>{if(!Number.isFinite(sec)||sec<0)sec=0;const m=Math.floor(sec/60),s=Math.floor(sec%60);return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`};
  let audio=null;
  function ensureAudio(){
    let a=document.getElementById('choco-audio-engine');
    if(!a){a=document.createElement('audio');a.id='choco-audio-engine';a.preload='metadata';a.setAttribute('playsinline','');a.setAttribute('webkit-playsinline','');a.style.position='fixed';a.style.width='1px';a.style.height='1px';a.style.opacity='0.001';a.style.pointerEvents='none';a.style.left='-10px';a.style.bottom='0';document.body.appendChild(a)}
    audio=a;return a;
  }
  ensureAudio();
  audio.addEventListener('play',()=>{document.getElementById(ROOT_ID)?.classList.add('playing');render()});
  audio.addEventListener('pause',()=>{document.getElementById(ROOT_ID)?.classList.remove('playing');render()});
  audio.addEventListener('ended',()=>handleEnded());audio.addEventListener('timeupdate',updateProgress);audio.addEventListener('loadedmetadata',updateProgress);
  audio.addEventListener('error',()=>{toast('这首音频无法播放，可以删除后重新导入。','error');document.getElementById(ROOT_ID)?.classList.remove('playing')});
  function revokeUrl(){if(currentUrl){try{URL.revokeObjectURL(currentUrl)}catch(_){}currentUrl=null}}
  function stopAudio(reset=false){playIntent++;try{audio.pause()}catch(_){}if(reset){try{audio.currentTime=0}catch(_){}revokeUrl();audio.removeAttribute('src');audio.load()}document.getElementById(ROOT_ID)?.classList.remove('playing');render()}
  function modeTracks(){return tracks.filter(t=>t.mode===mode)}
  function sequentialNext(list){
    if(!list.length)return null;
    const idx=currentTrack?list.findIndex(t=>t.id===currentTrack.id):-1;
    return list[(idx>=0?idx+1:0)%list.length]||list[0];
  }
  function shuffleNext(list){
    if(!list.length)return null;
    if(list.length===1)return list[0];
    const pool=currentTrack?list.filter(t=>t.id!==currentTrack.id):list;
    return pool[Math.floor(Math.random()*pool.length)]||list[0];
  }


  function rebuildTracks(){tracks=[...localTracks];}
  async function refreshShared(silent=false){try{localTracks=await dbGetAll();rebuildTracks();render();if(!silent)toast('本机曲库已刷新。','success');}catch(e){toast(e.message,'error');}}
  async function loadAndPlay(track){
    if(!track)return;
    try{
    stopAudio(true);
    const intent=playIntent;const blob=await localAudio.blob(track.id);if(intent!==playIntent)return;currentTrack=track;currentUrl=URL.createObjectURL(blob);audio.src=currentUrl;
    audio.load();render();
    try{await audio.play();setStatus('')}catch(e){console.warn('[巧克力播放器] play failed',e);setStatus(`播放失败：${e?.name||'Error'} ${e?.message||''}`);toast('播放没有启动，请再点一次播放或检查文件格式。','warning')}
    }catch(error){toast('歌曲读取失败：'+error.message,'error');}
  }
  async function startPlayback(){
    const list=modeTracks();
    if(!list.length){toast(`请先添加${mode==='modern'?'现代':'古风'}音乐。`,'warning');return}
    if(currentTrack&&currentTrack.mode===mode&&audio.src){
      try{await audio.play();return}catch(e){console.warn('[巧克力播放器] resume failed',e)}
    }
    await loadAndPlay(list[0]);
  }
  async function nextTrack(){
    if(choosing)return;
    const list=modeTracks();
    if(!list.length){toast(`当前${mode==='modern'?'现代':'古风'}曲库没有音乐。`,'warning');return}
    choosing=true;
    setStatus('正在切换下一首…');
    try{
      const next=playbackMode==='shuffle'?shuffleNext(list):sequentialNext(list);
      if(next){setStatus(`下一首：${next.title}`);await loadAndPlay(next)}
    }finally{choosing=false;setStatus('')}
  }
  async function handleEnded(){
    const list=modeTracks();
    if(!list.length)return;
    if(playbackMode==='repeat-one'&&currentTrack){
      try{audio.currentTime=0;await audio.play()}catch(_){await loadAndPlay(currentTrack)}
      return;
    }
    const next=playbackMode==='shuffle'?shuffleNext(list):sequentialNext(list);
    if(next)await loadAndPlay(next);
  }
  async function playExactTrack(id){const t=tracks.find(x=>x.id===id&&x.mode===mode);if(!t)return;setStatus(`手动播放：${t.title}`);try{await loadAndPlay(t)}finally{setStatus('')}}
  function updateProgress(){const p=document.querySelector('#choco-player-panel .choco-progress'),a=document.querySelector('#choco-player-panel .choco-time .now'),b=document.querySelector('#choco-player-panel .choco-time .dur');if(p){p.max=Number.isFinite(audio.duration)&&audio.duration>0?audio.duration:1;p.value=Number.isFinite(audio.currentTime)?audio.currentTime:0}if(a)a.textContent=fmt(audio.currentTime);if(b)b.textContent=fmt(audio.duration)}
  function setStatus(s){const e=document.querySelector('#choco-player-panel .choco-status');if(e)e.textContent=s||''}
  async function importFiles(targetMode,files){
    let count=0;const list=Array.from(files||[]);if(!list.length)return;
    for(const file of list){try{setStatus(`正在保存到本机… ${count+1}/${list.length}`);await localAudio.import(file,targetMode);count++;}catch(e){toast(`《${file.name}》导入失败：${e.message}`,'error');}}
    await refreshShared(true);setStatus('');toast(`已保存 ${count} 首到本机曲库。`);
  }
  function openTrackEditor(id){
    const t=tracks.find(x=>x.id===id),panel=document.getElementById(PANEL_ID),dialog=panel?.querySelector('.choco-edit-dialog');
    if(!t||!dialog)return;
    editingTrackId=t.id;
    dialog.querySelector('.choco-edit-title').value=t.title||'';
    dialog.querySelector('.choco-edit-tags').value=t.tags||'';
    dialog.classList.add('open');
    dialog.setAttribute('aria-hidden','false');
    setTimeout(()=>dialog.querySelector('.choco-edit-title')?.focus(),60);
  }
  function closeTrackEditor(force=false){
    if(editSaving&&!force)return;
    const dialog=document.querySelector(`#${PANEL_ID} .choco-edit-dialog`);
    if(dialog){dialog.classList.remove('open');dialog.setAttribute('aria-hidden','true')}
    editingTrackId='';
  }
  async function saveTrackEditor(){
    if(editSaving||!editingTrackId)return;
    const panel=document.getElementById(PANEL_ID),dialog=panel?.querySelector('.choco-edit-dialog');
    const t=tracks.find(x=>x.id===editingTrackId);
    if(!dialog||!t){closeTrackEditor(true);toast('没有找到要编辑的歌曲，请刷新曲库后重试。','warning');return}
    const title=String(dialog.querySelector('.choco-edit-title')?.value||'').trim();
    const tags=String(dialog.querySelector('.choco-edit-tags')?.value||'').trim();
    if(!title){toast('歌曲名不能为空。','warning');dialog.querySelector('.choco-edit-title')?.focus();return}
    const saveButton=dialog.querySelector('.choco-edit-save'),trackId=t.id;
    editSaving=true;
    if(saveButton){saveButton.disabled=true;saveButton.textContent='保存中…'}
    setStatus('正在保存歌名和标签…');
    let saved=false;
    try{
      const savedTrack=await dbPut({...t,title,tags});Object.assign(t,savedTrack)
      if(currentTrack?.id===trackId)Object.assign(currentTrack,t);
      saved=true;
      toast('歌名和标签已保存到本机。','success');
    }catch(e){
      console.error('[巧克力播放器] 编辑歌曲失败',e);
      toast(`保存失败：${e?.message||'未知错误'}`,'error');
      setStatus(`保存失败：${e?.message||'未知错误'}`);
    }finally{
      editSaving=false;
      if(saveButton){saveButton.disabled=false;saveButton.textContent='保存'}
      if(saved){closeTrackEditor();rebuildTracks();render();setStatus('')}
    }
  }
  async function removeTrack(id){const t=tracks.find(x=>x.id===id);if(!t||!confirm(`删除《${t.title}》？`))return;if(currentTrack?.id===id){stopAudio(true);currentTrack=null}await dbDelete(id);localTracks=localTracks.filter(x=>x.id!==id);rebuildTracks();render()}
  function render(){
    const panel=document.getElementById(PANEL_ID);if(!panel)return;
    panel.querySelectorAll('.choco-tab').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
    const song=panel.querySelector('.choco-song');if(song)song.textContent=currentTrack?.title||`尚未播放 · ${mode==='modern'?'现代':'古风'}曲库`;
    const play=panel.querySelector('.choco-play');if(play)play.textContent=audio.paused?'▶ 播放':'❚❚ 暂停';
    const playModeBtn=panel.querySelector('.choco-play-mode');if(playModeBtn){const labels={sequential:'↻ 顺序播放','repeat-one':'🔂 单曲循环',shuffle:'🔀 随机播放'};playModeBtn.textContent=labels[playbackMode]||labels.sequential;playModeBtn.title='点击切换播放模式';playModeBtn.setAttribute('aria-label',`播放模式：${labels[playbackMode]||labels.sequential}`)}
    const storage=panel.querySelector('.choco-storage');if(storage){storage.textContent='本机曲库 · TT 专用版';storage.classList.remove('offline')}
    const localCount=panel.querySelector('.choco-local-count');if(localCount)localCount.textContent=`本机已保存：${localTracks.length} 首 · 可在小蝴蝶共同歌单中读取`;
    const lib=panel.querySelector('.choco-library');
    if(lib){const list=tracks.filter(t=>t.mode===mode);lib.innerHTML=list.length?list.map(t=>`<div class="choco-track ${currentTrack?.id===t.id?'current':''}" data-track="${esc(t.id)}"><div class="choco-track-main"><div class="choco-track-name" title="${esc(t.title)}">${esc(t.title)}</div><div class="choco-track-tags">${esc(t.tags||'点击 ▶ 可直接播放')}</div></div><div class="choco-track-actions"><button class="choco-mini play-one" data-play="${esc(t.id)}" type="button">▶</button><button class="choco-mini" data-edit="${esc(t.id)}" type="button">编</button><button class="choco-mini" data-del="${esc(t.id)}" type="button">删</button></div></div>`).join(''):`<div class="choco-empty">这个分类还没有音乐。点击上面的添加按钮，选择手机里的普通音频。</div>`;lib.querySelectorAll('[data-play]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();playExactTrack(b.dataset.play)}));lib.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openTrackEditor(b.dataset.edit)}));lib.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();removeTrack(b.dataset.del)}));lib.querySelectorAll('.choco-track-main').forEach(el=>el.addEventListener('click',()=>{const id=el.closest('.choco-track')?.dataset.track;if(id)playExactTrack(id)}))}
    const count=panel.querySelector('.choco-count');if(count)count.textContent=`${tracks.filter(t=>t.mode===mode).length} 首`;updateProgress();
  }
  function positionPanel(){const root=document.getElementById(ROOT_ID),panel=document.getElementById(PANEL_ID);if(!root||!panel||!panel.classList.contains('open'))return;const rr=root.getBoundingClientRect(),pr=panel.getBoundingClientRect(),gap=8,margin=8;let left=rr.right+gap,origin='top left';if(left+pr.width>innerWidth-margin){left=rr.left-pr.width-gap;origin='top right'}if(left<margin){left=Math.max(margin,Math.min(innerWidth-pr.width-margin,rr.left+(rr.width-pr.width)/2));origin='top center'}let top=rr.top;if(top+pr.height>innerHeight-margin)top=innerHeight-pr.height-margin;top=Math.max(margin,top);panel.style.left=`${Math.round(left)}px`;panel.style.top=`${Math.round(top)}px`;panel.style.transformOrigin=origin}
  function openPanel(){
    if(!shareNoticeAccepted){
      window.alert(SHARE_NOTICE);
      shareNoticeAccepted=true;
    }
    document.getElementById(PANEL_ID)?.classList.add('open');panelOpen=true;render();requestAnimationFrame(positionPanel)
  }
  function closePanel(){closeTrackEditor(true);document.getElementById(PANEL_ID)?.classList.remove('open');panelOpen=false}
  function makeUI(){
    if(document.getElementById(ROOT_ID))return;
    const root=document.createElement('div');root.id=ROOT_ID;root.innerHTML=`<button class="choco-bubble" type="button" aria-label="巧克力播放器"><img draggable="false" src="${CHOCO_ICON}"><span class="choco-note n1">♪</span><span class="choco-note n2">♫</span></button>`;document.body.appendChild(root);
    const panel=document.createElement('section');panel.id=PANEL_ID;panel.innerHTML=`<div class="choco-head"><img draggable="false" src="${CHOCO_ICON}"><div class="choco-title"><b>巧克力播放器</b><small>本机音乐 · TT 适配版</small></div><button class="choco-x" type="button">×</button></div><div class="choco-body"><div class="choco-storage"></div><div class="choco-tabs"><button class="choco-tab" data-mode="modern" type="button">现代</button><button class="choco-tab" data-mode="ancient" type="button">古风</button></div><div class="choco-now"><div class="choco-song">尚未播放</div><input class="choco-progress" type="range" min="0" max="1" value="0" step="0.1"><div class="choco-time"><span class="now">00:00</span><span class="dur">00:00</span></div></div><div class="choco-controls"><button class="choco-btn choco-play" type="button">▶ 播放</button><button class="choco-btn choco-next" type="button">下一首</button><button class="choco-btn choco-play-mode" type="button" aria-label="播放模式：顺序播放">↻ 顺序播放</button></div><div class="choco-section-label"><span>添加本机音频</span><span class="choco-count">0 首</span></div><div class="choco-adds"><button class="choco-btn add-modern" type="button">＋现代音频</button><button class="choco-btn add-ancient" type="button">＋古风音频</button></div><div class="choco-help">可多选手机里的普通MP3、M4A等音频，保存在本机。小蝴蝶的共同歌单也能读取；不支持视频提取和QQ加密文件。</div><div class="choco-local-count"></div><button class="choco-btn choco-refresh" type="button">↻ 刷新本机曲库</button><div class="choco-section-label"><span>当前曲库</span></div><div class="choco-library"></div><div class="choco-status"></div><input class="pick-modern" type="file" accept="audio/*,.mp3,.m4a,.aac,.ogg,.wav,.flac,.opus" multiple hidden><input class="pick-ancient" type="file" accept="audio/*,.mp3,.m4a,.aac,.ogg,.wav,.flac,.opus" multiple hidden></div><div class="choco-edit-dialog" role="dialog" aria-modal="true" aria-hidden="true" aria-label="编辑歌曲信息"><div class="choco-edit-card"><div class="choco-edit-heading">编辑歌曲信息</div><label>歌曲名<input class="choco-edit-title" type="text" maxlength="300" autocomplete="off"></label><label>标签<input class="choco-edit-tags" type="text" maxlength="500" placeholder="例如：雨夜、古风、轻快、纯音乐" autocomplete="off"></label><div class="choco-edit-actions"><button class="choco-btn choco-edit-cancel" type="button">取消</button><button class="choco-btn choco-edit-save" type="button">保存</button></div></div></div>`;document.body.appendChild(panel);
    let saved=null;try{saved=JSON.parse(localStorage.getItem(POS_KEY)||'null')}catch(_){}const x=Number(saved?.x),y=Number(saved?.y);root.style.left=`${Number.isFinite(x)?Math.max(4,Math.min(innerWidth-46,x)):14}px`;root.style.top=`${Number.isFinite(y)?Math.max(4,Math.min(innerHeight-46,y)):Math.max(70,innerHeight*.28)}px`;
    const bubble=root.querySelector('.choco-bubble');let down=false,drag=false,sx=0,sy=0,sl=0,st=0;
    bubble.addEventListener('pointerdown',e=>{if(e.button!=null&&e.button!==0)return;down=true;drag=false;sx=e.clientX;sy=e.clientY;const r=root.getBoundingClientRect();sl=r.left;st=r.top;try{bubble.setPointerCapture(e.pointerId)}catch(_){}e.preventDefault()});
    bubble.addEventListener('pointermove',e=>{if(!down)return;const dx=e.clientX-sx,dy=e.clientY-sy;if(!drag&&Math.hypot(dx,dy)>6)drag=true;if(!drag)return;const nx=Math.max(4,Math.min(innerWidth-46,sl+dx)),ny=Math.max(4,Math.min(innerHeight-46,st+dy));root.style.left=`${nx}px`;root.style.top=`${ny}px`;if(panelOpen)positionPanel();e.preventDefault()});
    bubble.addEventListener('pointerup',e=>{if(!down)return;down=false;try{bubble.releasePointerCapture(e.pointerId)}catch(_){}if(drag){drag=false;const r=root.getBoundingClientRect();localStorage.setItem(POS_KEY,JSON.stringify({x:r.left,y:r.top}))}else{panelOpen?closePanel():openPanel()}e.preventDefault()});bubble.addEventListener('pointercancel',()=>{down=false;drag=false});
    panel.querySelector('.choco-x').addEventListener('click',closePanel);panel.querySelectorAll('.choco-tab').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));panel.querySelector('.choco-play').addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();if(!audio.paused){audio.pause();setStatus('已暂停');return}setStatus('正在播放…');await startPlayback()});panel.querySelector('.choco-next').addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();await nextTrack()});panel.querySelector('.choco-play-mode').addEventListener('click',e=>{e.preventDefault();e.stopPropagation();cyclePlaybackMode()});panel.querySelector('.choco-refresh').addEventListener('click',()=>refreshShared(false));
    const editDialog=panel.querySelector('.choco-edit-dialog');
    editDialog.querySelector('.choco-edit-cancel').addEventListener('click',()=>closeTrackEditor());
    editDialog.querySelector('.choco-edit-save').addEventListener('click',()=>saveTrackEditor());
    editDialog.addEventListener('click',e=>{if(e.target===editDialog)closeTrackEditor()});
    editDialog.querySelectorAll('input').forEach(input=>input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();saveTrackEditor()}else if(e.key==='Escape'){e.preventDefault();closeTrackEditor()}}));
    const prog=panel.querySelector('.choco-progress');prog.addEventListener('input',()=>{if(Number.isFinite(audio.duration))audio.currentTime=Number(prog.value)||0});
    const pm=panel.querySelector('.pick-modern'),pa=panel.querySelector('.pick-ancient');panel.querySelector('.add-modern').addEventListener('click',()=>pm.click());panel.querySelector('.add-ancient').addEventListener('click',()=>pa.click());pm.addEventListener('change',async()=>{await importFiles('modern',pm.files);pm.value=''});pa.addEventListener('change',async()=>{await importFiles('ancient',pa.files);pa.value=''});
    const head=panel.querySelector('.choco-head');let hd=false,hdrag=false,hsx=0,hsy=0,pl=0,pt=0,rl=0,rt=0;head.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;hd=true;hdrag=false;hsx=e.clientX;hsy=e.clientY;const pr=panel.getBoundingClientRect(),rr=root.getBoundingClientRect();pl=pr.left;pt=pr.top;rl=rr.left;rt=rr.top;try{head.setPointerCapture(e.pointerId)}catch(_){}e.preventDefault()});head.addEventListener('pointermove',e=>{if(!hd)return;const dx=e.clientX-hsx,dy=e.clientY-hsy;if(!hdrag&&Math.hypot(dx,dy)>5)hdrag=true;if(!hdrag)return;const pw=panel.getBoundingClientRect().width,ph=panel.getBoundingClientRect().height,nl=Math.max(6,Math.min(innerWidth-pw-6,pl+dx)),nt=Math.max(6,Math.min(innerHeight-ph-6,pt+dy)),adx=nl-pl,ady=nt-pt;panel.style.left=`${nl}px`;panel.style.top=`${nt}px`;root.style.left=`${Math.max(4,Math.min(innerWidth-46,rl+adx))}px`;root.style.top=`${Math.max(4,Math.min(innerHeight-46,rt+ady))}px`;e.preventDefault()});head.addEventListener('pointerup',e=>{hd=false;try{head.releasePointerCapture(e.pointerId)}catch(_){}if(hdrag){const r=root.getBoundingClientRect();localStorage.setItem(POS_KEY,JSON.stringify({x:r.left,y:r.top}))}hdrag=false;e.preventDefault()});
    window.addEventListener('resize',()=>{const r=root.getBoundingClientRect();root.style.left=`${Math.max(4,Math.min(innerWidth-46,r.left))}px`;root.style.top=`${Math.max(4,Math.min(innerHeight-46,r.top))}px`;if(panelOpen)positionPanel()});render();
  }

  function exposeApi(){globalThis.ChocolateStoryPlayer={version:'1.6.1-tt.1',open:openPanel,close:closePanel,isOpen:()=>!!document.getElementById(PANEL_ID)?.classList.contains('open'),refresh:()=>refreshShared(false)};}
  let started=false;
  async function init(){if(started)return;started=true;try{ensureAudio();const s=settings();mode=s.mode;playbackMode=s.playbackMode;await openDB();localTracks=await dbGetAll();rebuildTracks();makeUI();exposeApi();render();window.addEventListener('walmart-local-audio-changed',()=>refreshShared(true));}catch(e){started=false;console.error('[巧克力播放器 TT]',e);toast('本机播放器未能加载：'+e.message,'error');}}
  setTimeout(init,0);
})();
