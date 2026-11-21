import {localAudio} from '../../local-audio.js';
// Small social games; all model calls require an explicit user action.
const arr=x=>Array.isArray(x)?x:[], text=(x,n=1000)=>String(x??'').trim().slice(0,n);
const key=x=>text(x,100).normalize('NFKC').replace(/^@/,'').toLocaleLowerCase();
const uniq=x=>[...new Set(x.filter(Boolean))];
export function normalizeVisibility(v){return{mode:['all','only','except','self'].includes(v?.mode)?v.mode:(v?.mode?'self':'all'),names:uniq(arr(v?.names).map(n=>text(n,80))).slice(0,300)};}
export function canViewMoment(post,name,userName){
  if(key(name)===key(userName)||key(name)===key(post?.author))return true;
  const v=normalizeVisibility(post?.visibility),included=v.names.some(n=>key(n)===key(name));
  return v.mode==='all'||v.mode==='only'&&included||v.mode==='except'&&!included;
}
export function eligibleViewers(post,contacts,userName){return uniq(arr(contacts).map(c=>c.name).filter(n=>n&&key(n)!==key(userName)&&canViewMoment(post,n,userName)));}
export function visibilityLabel(v){v=normalizeVisibility(v);return v.mode==='all'?'所有人可见':v.mode==='self'?'仅自己可见':`${v.mode==='only'?'仅这些人可见':'这些人不可见'}：${v.names.join('、')||'未选人'}`;}
export function audioSource(raw){
  const s=text(raw,2000);if(/^tt-audio:[a-z\d_-]+$/i.test(s))return s;if(/^\/api\/plugins\/eggtart-device-sync\/audio\/stream\/[a-z\d_-]+$/i.test(s))return s;
  try{const u=new URL(s);if(u.protocol==='https:'&&/\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i.test(u.pathname))return u.href;}catch(_){}return '';
}
export function anonymousPost(raw,id,now,known=[]){
  let s=text(raw?.text,1800);if(!s)return null;
  const cleanIdentity=value=>{let result=text(value,1800);for(const name of known){const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');result=result.replace(new RegExp(`(?:我是|我叫|本人是?|作者是?|投稿人是?)\\s*${escaped}`,'g'),'匿名投稿人');}return result;};
  // Do not retain a model-supplied author, identifier, avatar or real-to-pseudonym mapping.
  for(const name of known){const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');s=s.replace(new RegExp(`(?:我是|我叫|本人是?|作者是?|投稿人是?)\\s*${escaped}`,'g'),'匿名投稿人');}
  return{id,alias:'匿名纸片-'+id.slice(-5),text:s,topic:text(raw?.topic,40)||'随便说说',time:now,liked:false,comments:arr(raw?.comments).slice(0,6).map((c,i)=>({alias:'匿名回声-'+(i+1),text:cleanIdentity(c?.text).slice(0,600)})).filter(c=>c.text)};
}
export function normalizeSocialAdditions(x,d){
  for(const p of d.wechat.moments||[]){p.visibility=normalizeVisibility(p.visibility);if(p.visibility.mode!=='all'){p.likes=arr(p.likes).filter(n=>canViewMoment(p,n,p.author));p.comments=arr(p.comments).filter(c=>canViewMoment(p,c.author,p.author));}}
  d.music={tracks:arr(x?.music?.tracks).slice(-150).map(t=>({id:text(t.id,100),title:text(t.title,150),artist:text(t.artist,100),src:audioSource(t.src)})).filter(t=>t.id&&t.title),queue:arr(x?.music?.queue).slice(0,80).map(q=>({id:text(q.id,100),trackId:text(q.trackId,100),by:text(q.by,80),pinned:q.pinned===true,votes:uniq(arr(q.votes).map(n=>text(n,80))).slice(0,30)})),nowId:text(x?.music?.nowId,100),participants:uniq(arr(x?.music?.participants).map(n=>text(n,80))).slice(0,12),messages:arr(x?.music?.messages).slice(-50).map(m=>({author:text(m.author,80),text:text(m.text,800),time:text(m.time,80)}))};
  d.treehole={posts:arr(x?.treehole?.posts).slice(-40).map(p=>({id:text(p.id,100),alias:text(p.alias,80),text:text(p.text,1800),topic:text(p.topic,40),time:text(p.time,80),liked:p.liked===true,comments:arr(p.comments).slice(-8).map(c=>({alias:text(c.alias,80),text:text(c.text,600)}))})),topic:text(x?.treehole?.topic,120)};
  for(const g of d.wechat.groups)g.polls=arr(x?.wechat?.groups?.find(old=>old.id===g.id)?.polls).slice(-12).map(p=>({id:text(p.id,100),question:text(p.question,200),options:arr(p.options).slice(0,6).map(o=>text(o,100)),closed:p.closed===true,ballots:arr(p.ballots).slice(0,20).map(b=>({name:text(b.name,80),choice:Number(b.choice),reason:text(b.reason,250)})).filter(b=>Number.isInteger(b.choice)&&b.choice>=0&&b.choice<arr(p.options).length)}));
  return d;
}

export function createSocialExtras(E){
  const{content,doc,win,getState,saveState,esc,avatarHtml,makeId,scope,storySnapshot,askJson}=E;
  let disposed=false,page='',busy=new Set(),player=null,playingScope='',fileInputs=new Set(),localPlayUrl='',localPlaySource='',playToken=0;
  const valid=()=>{const s=scope();return()=>!disposed&&s===scope();};
  const fail=e=>{console.warn('[小蝴蝶互动]',e);win.alert?.(String(e.message||e));};
  const bind=(q,fn)=>content.querySelectorAll(q).forEach(el=>el.addEventListener('click',ev=>{ev.preventDefault();Promise.resolve().then(()=>fn(el)).catch(fail);}));
  const btn=(label,cls,extra='')=>`<button class="ph-secondary ${cls}" type="button" ${extra}>${label}</button>`;
  const hint=s=>`<div class="tiny bf-hint">${esc(s)}</div>`;
  function show(id,title,back=E.home){page=id;E.setView({app:'social',sub:id,target:''});E.expand(true);E.top(title,true,back);E.updateClock();}
  function visiblePage(id){return page===id&&E.view().app==='social';}
  function peerInfo(names){return E.memberInfo(names);}
  async function prepare(){const ok=valid();await E.scanLore(false);return ok;}
  function groupChoices(selected=[]){return getState().wechat.contacts.filter(c=>c.name!==E.userName()).map(c=>`<label class="bf-member"><input class="sx-peer" type="checkbox" value="${esc(c.name)}" ${selected.includes(c.name)?'checked':''}>${avatarHtml(c.name)}<span>${esc(c.name)}</span></label>`).join('');}
  function audienceFields(value){const v=normalizeVisibility(value);return `<div class="sx-audience"><label class="bf-field">谁可以看<select class="sx-audience-mode">${[['all','所有人'],['only','选中人物可见'],['except','选中人物不可见'],['self','仅自己']].map(([id,label])=>`<option value="${id}" ${v.mode===id?'selected':''}>${label}</option>`).join('')}</select></label><details><summary>选择人物（选中可见 / 不可见时生效）</summary>${groupChoices(v.names)}</details></div>`;}
  function readAudience(root=content){return normalizeVisibility({mode:root.querySelector('.sx-audience-mode')?.value||'all',names:[...root.querySelectorAll('.sx-peer:checked')].map(el=>el.value)});}
  function audienceEditor(id,back){const p=getState().wechat.moments.find(p=>p.id===id);if(!p||p.author!==E.userName())return;show('audience:'+id,'朋友圈可见范围',back);content.innerHTML=hint('更改后，范围外人物已有的点赞和评论也会从此帖移除。未被允许的内容不传给当前主角色的正文联动。')+audienceFields(p.visibility)+btn('保存可见范围','sx-save-audience');bind('.sx-save-audience',()=>{const st=getState(),post=st.wechat.moments.find(p=>p.id===id);if(!post)return;post.visibility=readAudience();post.likes=arr(post.likes).filter(n=>canViewMoment(post,n,E.userName()));post.comments=arr(post.comments).filter(c=>canViewMoment(post,c.author,E.userName()));E.invalidateMemory();saveState(st);return back();});}

  function musicPage(){
    show('music','共同歌单');const st=getState(),m=st.music,now=m.tracks.find(t=>t.id===m.nowId);
    content.innerHTML=`<div class="bf-section">${now?'正在选听：'+esc(now.title):'还没有选择当前歌曲'}</div>${hint('歌名可以先加入队列。实际播放需要本地上传的普通音频或HTTPS音频直链；QQ/网易云分享页不能直接播放。只在点“让大家抢下一首”时调用现有API。')}<div class="sx-audio-host"></div><div class="bf-actions">${btn('播放 / 继续','sx-play')}${btn('暂停','sx-pause')}${btn('下一首','sx-next')}${btn('一起听的人','sx-music-peers')}</div><div class="bf-actions">${btn('读取本机曲库','sx-music-library')}${btn('上传本地音频','sx-music-upload')}${btn('让大家抢下一首（API）','sx-music-react')}</div>${hint('一起听：'+(m.participants.join('、')||'尚未邀请'))}<div class="sx-track-form"><input class="sx-track-title" placeholder="歌名"><input class="sx-track-artist" placeholder="歌手（可选）"><input class="sx-track-url" placeholder="HTTPS音频直链（可留空）">${btn('由我点歌','sx-add-track')}</div><div class="bf-section">接下来听</div>${m.queue.map(q=>{const t=m.tracks.find(t=>t.id===q.trackId);return t?`<div class="sx-queue"><div><b>${esc(t.title)}</b><small>${esc(q.by)} 点歌 · ${q.votes.length}位想听 · ${t.src?'有音源':'未提供音源'}</small></div>${btn('插到下一首','sx-pin',`data-id="${esc(q.id)}"`)}${btn('移除','sx-remove-track',`data-id="${esc(q.id)}"`)}</div>`:'';}).join('')}<div class="sx-talk">${m.messages.map(r=>`<div class="bf-room-line">${avatarHtml(r.author)}<div><b>${esc(r.author)}</b><p>${esc(r.text)}</p></div></div>`).join('')}</div>`;
    if(player&&playingScope===scope())content.querySelector('.sx-audio-host').appendChild(player);
    bind('.sx-add-track',()=>{const title=text(content.querySelector('.sx-track-title').value,150),artist=text(content.querySelector('.sx-track-artist').value,100),url=text(content.querySelector('.sx-track-url').value,2000);if(!title)throw new Error('先填写歌名');if(url&&!audioSource(url))throw new Error('请选择HTTPS音频直链，或上传普通音频；分享页不可直接播放');const s=getState(),id=makeId('song');s.music.tracks.push({id,title,artist,src:audioSource(url)});s.music.queue.push({id:makeId('queue'),trackId:id,by:E.userName(),votes:[]});saveState(s);musicPage();});
    bind('.sx-pin',el=>{const s=getState(),q=s.music.queue.find(q=>q.id===el.dataset.id);if(q){for(const row of s.music.queue)row.pinned=row.id===q.id;s.music.queue=[q,...s.music.queue.filter(q=>q.id!==el.dataset.id)];saveState(s);musicPage();}});
    bind('.sx-remove-track',el=>{const s=getState();s.music.queue=s.music.queue.filter(q=>q.id!==el.dataset.id);saveState(s);musicPage();});
    bind('.sx-next',()=>nextSong(true));bind('.sx-play',playSong);bind('.sx-pause',()=>player?.pause());bind('.sx-music-peers',musicPeers);bind('.sx-music-react',musicReactions);bind('.sx-music-library',readLibrary);bind('.sx-music-upload',uploadAudio);
  }
  function musicPeers(){show('music-peers','邀请一起听',musicPage);content.innerHTML=hint('最多12位现有联系人，只有你能选择一起听的人。')+groupChoices(getState().music.participants)+btn('保存邀请','sx-save-peers');bind('.sx-save-peers',()=>{const names=[...content.querySelectorAll('.sx-peer:checked')].map(el=>el.value);if(names.length>12)throw new Error('最多邀请12人');const st=getState();st.music.participants=names;saveState(st);musicPage();});}
  function nextSong(play=false){const st=getState(),q=st.music.queue.shift();if(!q){win.alert?.('歌单队列已经空了');return;}player?.pause();st.music.nowId=q.trackId;saveState(st);if(visiblePage('music'))musicPage();if(play)return playSong();}
  async function playSong(){
    let st=getState();if(!st.music.nowId){if(!st.music.queue.length)throw new Error('请先点一首歌');nextSong(false);st=getState();}
    const token=++playToken,ok=valid();const song=st.music.tracks.find(t=>t.id===st.music.nowId);if(!song?.src)throw new Error('这首歌还没有音源，当前只有点歌记录。可上传音频或补充直链');if(!win.Audio)throw new Error('当前环境无法播放音频');
    if(!player){player=new win.Audio();player.controls=true;player.className='sx-audio';player.addEventListener('ended',()=>{if(playingScope===scope())nextSong(true)?.catch?.(fail);});}
    let url;
    if(song.src.startsWith('tt-audio:')){
      if(localPlaySource!==song.src||!localPlayUrl){
        const next=await localAudio.createUrl(song.src);if(token!==playToken||!ok()||getState().music.nowId!==song.id){URL.revokeObjectURL(next);return;}if(localPlayUrl)URL.revokeObjectURL(localPlayUrl);localPlayUrl=next;localPlaySource=song.src;
      }url=localPlayUrl;
    }else{url=new URL(song.src,win.location?.href||'https://localhost/').href;if(localPlayUrl)URL.revokeObjectURL(localPlayUrl);localPlayUrl='';localPlaySource='';}
    if(player.src!==url){player.src=url;player.load?.();}playingScope=scope();if(visiblePage('music'))content.querySelector('.sx-audio-host').appendChild(player);await player.play();
  }
  async function readLibrary(){const ok=valid(),rows=await localAudio.list();if(!ok())return;const st=getState();for(const row of rows){const src=localAudio.source(row.id),id='local-'+row.id,old=st.music.tracks.find(t=>t.id===id);if(old){old.title=text(row.title,150);old.src=src;}else st.music.tracks.push({id,title:text(row.title,150),artist:'',src});}saveState(st);libraryPage();}
  function libraryPage(){show('music-library','本机曲库',musicPage);content.innerHTML=hint('点击加入队列；模型可以从这些曲目中点歌。')+getState().music.tracks.map(t=>`<div class="sx-queue"><span>${esc(t.title)}</span>${btn('加入队列','sx-library-add',`data-id="${esc(t.id)}"`)}</div>`).join('');bind('.sx-library-add',el=>{const st=getState();st.music.queue.push({id:makeId('queue'),trackId:el.dataset.id,by:E.userName(),votes:[]});saveState(st);libraryPage();});}
  function uploadAudio(){const ok=valid(),el=doc.createElement('input');el.type='file';el.accept='audio/*,.mp3,.m4a,.aac,.ogg,.wav,.flac,.opus';el.hidden=true;doc.body.appendChild(el);fileInputs.add(el);el.oncancel=()=>{el.remove();fileInputs.delete(el);};el.onchange=async()=>{try{const f=el.files?.[0];if(!f)return;await localAudio.import(f);if(ok())await readLibrary();}catch(e){fail(e);}finally{el.remove();fileInputs.delete(el);}};el.click();}
  async function musicReactions(){
    const k='music:'+scope();if(busy.has(k))return;const ok=await prepare();if(!ok()||busy.has(k))return;const st=getState(),m=st.music;if(!m.participants.length)throw new Error('先邀请一起听的人');const snapshot=storySnapshot(),participants=[...m.participants],library=m.tracks.map(t=>({id:t.id,title:t.title,artist:t.artist}));busy.add(k);
    try{const obj=await askJson(`在共同歌单里，只有这些NPC可以说话、点歌或争下一首：${participants.join('、')}。不能替user点歌、切歌或发言，不能自动邀请别人。可以打趣、互相争歌或投想听的歌，每位NPC最多提议一首。已有曲目用trackId，新建议只写歌名，禁止编造音频链接。只返回JSON {"replies":[{"name":"允许的NPC","text":"发言"}],"requests":[{"name":"允许的NPC","trackId":"已有ID或空","title":"新歌名可选","artist":"歌手可选"}]}。人物：${JSON.stringify(peerInfo(participants))}`,`曲库：${JSON.stringify(library)}\n当前歌曲：${m.nowId}\n排队：${JSON.stringify(m.queue)}\n最近互动：${JSON.stringify(m.messages.slice(-8))}`);
      if(!ok()||snapshot!==storySnapshot())return;const s=getState();if(JSON.stringify(s.music.participants)!==JSON.stringify(participants))return;
      for(const r of arr(obj.replies).slice(0,12))if(participants.includes(r?.name)&&text(r.text))s.music.messages.push({author:r.name,text:text(r.text,800),time:E.storyTime()});
      const used=new Set();for(const r of arr(obj.requests)){if(!participants.includes(r?.name)||used.has(r.name))continue;used.add(r.name);let song=s.music.tracks.find(t=>t.id===r.trackId);if(!song&&text(r.title)){song={id:makeId('song'),title:text(r.title,150),artist:text(r.artist,100),src:''};s.music.tracks.push(song);}if(!song)continue;let q=s.music.queue.find(q=>q.trackId===song.id);if(q)q.votes=uniq([...q.votes,r.name]);else{s.music.queue.push({id:makeId('queue'),trackId:song.id,by:r.name,votes:[r.name]});}}
      // New recommendations may compete for next; never replace the currently playing song.
      s.music.queue.sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.votes.length-a.votes.length);saveState(s);
    }finally{busy.delete(k);if(ok()&&visiblePage('music'))musicPage();}
  }

  function treeholePage(){
    show('treehole','匿名树洞');const st=getState();content.innerHTML=`${hint('仅NPC匿名投稿、投厕、吐槽和闲聊。没有user投稿入口，没有真实作者映射、查作者或制裁按钮；树洞内容不进入正文联动和手机长期记忆。')}<input class="sx-hole-topic" placeholder="想看哪类投稿？留空随便聊" value="${esc(st.treehole.topic)}"><div class="bf-actions">${btn('刷新NPC投稿（API）','sx-hole-refresh')}</div>${st.treehole.posts.slice().reverse().map(p=>`<article class="wb-card"><div class="wb-author">${esc(p.alias)}</div><div class="tiny">${esc(p.topic)} · ${esc(p.time)}</div><div class="wb-text">${esc(p.text).replace(/\n/g,'<br>')}</div>${p.comments.map(c=>`<div class="wb-comment"><b>${esc(c.alias)}：</b>${esc(c.text)}</div>`).join('')}${btn(p.liked?'♥ 看得乐了':'♡ 看得乐了','sx-hole-like',`data-id="${esc(p.id)}"`)}</article>`).join('')}`;
    bind('.sx-hole-like',el=>{const s=getState(),p=s.treehole.posts.find(p=>p.id===el.dataset.id);if(p){p.liked=!p.liked;saveState(s);treeholePage();}});bind('.sx-hole-refresh',refreshTreehole);
  }
  async function refreshTreehole(){
    const k='treehole:'+scope();if(busy.has(k))return;const topic=text(content.querySelector('.sx-hole-topic')?.value,120),ok=await prepare();if(!ok()||busy.has(k))return;const snapshot=storySnapshot(),names=getState().wechat.contacts.map(c=>c.name).filter(n=>n!==E.userName());if(!names.length)throw new Error('当前没有可投稿的NPC，请先补充通讯录');busy.add(k);
    try{const obj=await askJson(`这是仅限虚构NPC投稿的匿名树洞/投厕。NPC可以畅所欲言：吐槽主角、character、user、同僚、关系、规则或生活，也能投稿快乐、秘密、困惑、阴阳怪气和不满。不需要吹捧主角，不要把负面观点洗成夸赞，也不要替发言人自我审查或安排受罚、被查身份、被威胁和权力报复。允许口语、粗话和人物自己的偏见；仍按当前剧情与人物可知信息写，不凭旧世界书强塞过时身份。所有作者和回帖者只能是现有NPC，绝不替user投稿。匿名可以提及被吐槽的人，但不能自报作者真名、职业编号或留下可直接对号入座的签名。不要输出任何真实作者字段、ID、头像、暗号映射或作者揭秘。只返回JSON {"posts":[{"topic":"话题","text":"投稿正文","comments":[{"text":"另一位匿名NPC回帖"}]}]}，3至5篇。此内容不会成为主线证据或触发制裁。`, `现有NPC名单：${names.join('、')}\n投稿方向：${topic||'自由发挥，话题多样'}\n避免复读旧帖：${JSON.stringify(getState().treehole.posts.slice(-5).map(p=>p.text.slice(0,160)))}`,{anonymous:true});
      if(!ok()||snapshot!==storySnapshot())return;const st=getState();st.treehole.topic=topic;const posts=arr(obj.posts).slice(0,5).map(p=>anonymousPost(p,makeId('hole'),E.storyTime(),[...names,E.userName()])).filter(Boolean);if(!posts.length)throw new Error('模型没有返回有效投稿，本次没有更新');st.treehole.posts=[...st.treehole.posts,...posts].slice(-40);saveState(st);
    }finally{busy.delete(k);if(ok()&&visiblePage('treehole'))treeholePage();}
  }

  function pollsPage(gid){const g=getState().wechat.groups.find(g=>g.id===gid);if(!g)return E.openGroup(gid);show('polls:'+gid,'群内小投票',()=>E.openGroup(gid));content.innerHTML=hint('由你发起，仅已有群成员参与；程序计票，模型不能替你投票。')+`<input class="sx-poll-question" placeholder="投什么？例如：晚饭吃哪家"><textarea class="sx-poll-options" placeholder="每行一个选项，2～6项"></textarea>`+btn('由我发起投票','sx-create-poll')+g.polls.map(p=>`<article class="wb-card"><b>${esc(p.question)}</b><div class="tiny">${p.closed?'已结束':'投票中'}</div>${p.options.map((o,i)=>`<div class="sx-poll-row"><span>${esc(o)} · ${p.ballots.filter(b=>b.choice===i).length}票</span>${!p.closed?btn('我投这项','sx-vote',`data-id="${esc(p.id)}" data-choice="${i}"`):''}</div>`).join('')}${p.ballots.map(b=>`<div class="tiny">${esc(b.name)}：${esc(p.options[b.choice])}${b.reason?' · '+esc(b.reason):''}</div>`).join('')}<div class="bf-actions">${!p.closed?btn('邀请成员投票（API）','sx-poll-ai',`data-id="${esc(p.id)}"`)+btn('结束投票','sx-poll-close',`data-id="${esc(p.id)}"`):''}</div></article>`).join('');
    bind('.sx-create-poll',()=>{const question=text(content.querySelector('.sx-poll-question').value,200),options=uniq(text(content.querySelector('.sx-poll-options').value,800).split('\n').map(x=>x.trim()));if(!question||options.length<2||options.length>6)throw new Error('填写问题和2～6个不同选项');const s=getState(),g=s.wechat.groups.find(g=>g.id===gid);g.polls.push({id:makeId('poll'),question,options,ballots:[],closed:false});saveState(s);pollsPage(gid);});
    bind('.sx-vote',el=>{const s=getState(),p=s.wechat.groups.find(g=>g.id===gid)?.polls.find(p=>p.id===el.dataset.id);if(!p||p.closed)return;p.ballots=p.ballots.filter(b=>b.name!==E.userName());p.ballots.push({name:E.userName(),choice:Number(el.dataset.choice),reason:''});saveState(s);pollsPage(gid);});
    bind('.sx-poll-close',el=>{const s=getState(),p=s.wechat.groups.find(g=>g.id===gid)?.polls.find(p=>p.id===el.dataset.id);if(p){p.closed=true;saveState(s);pollsPage(gid);}});bind('.sx-poll-ai',el=>pollVotes(gid,el.dataset.id));
  }
  async function pollVotes(gid,pid){const k='poll:'+scope()+':'+pid;if(busy.has(k))return;const ok=await prepare();if(!ok()||busy.has(k))return;const st=getState(),g=st.wechat.groups.find(g=>g.id===gid),p=g?.polls.find(p=>p.id===pid);if(!p||p.closed)return;const members=[...g.members],missing=members.filter(n=>!p.ballots.some(b=>b.name===n));if(!missing.length)return;const snap=storySnapshot();busy.add(k);
    try{const obj=await askJson(`仅为这些已有群成员投票：${missing.join('、')}。每人最多一票，choice为选项从0开始的编号。不得替user投票，不得新增选项、群聊或成员。符合当前剧情身份和人物意见。JSON {"votes":[{"name":"允许的群成员","choice":整数,"reason":"一句理由"}]}。人物：${JSON.stringify(peerInfo(missing))}`,`投票：${p.question}\n选项：${JSON.stringify(p.options)}`);if(!ok()||snap!==storySnapshot())return;const s=getState(),group=s.wechat.groups.find(g=>g.id===gid),poll=group?.polls.find(p=>p.id===pid);if(!poll||poll.closed||JSON.stringify(group.members)!==JSON.stringify(members))return;for(const b of arr(obj.votes)){if(missing.includes(b?.name)&&!poll.ballots.some(x=>x.name===b.name)&&Number.isInteger(b.choice)&&b.choice>=0&&b.choice<poll.options.length)poll.ballots.push({name:b.name,choice:b.choice,reason:text(b.reason,250)});}saveState(s);}finally{busy.delete(k);if(ok()&&visiblePage('polls:'+gid))pollsPage(gid);}}
  function canon(st){const main=E.charName();return{music:st.music.participants.includes(main)?st.music.messages.slice(-3).map(m=>({author:m.author,text:m.text.slice(0,140),time:m.time})):[],polls:st.wechat.groups.filter(g=>g.members.includes(main)).flatMap(g=>g.polls.slice(-1).map(p=>({group:g.name,question:p.question.slice(0,160),options:p.options.map(o=>o.slice(0,60)),ballots:p.ballots.map(b=>({name:b.name,choice:b.choice})),closed:p.closed}))).slice(-2)};}
  function reset(){playToken++;page='';player?.pause();playingScope='';if(localPlayUrl)URL.revokeObjectURL(localPlayUrl);localPlayUrl='';localPlaySource='';if(player)player.src='';}
  return{audienceFields,readAudience,audienceEditor,musicPage,treeholePage,pollsPage,canon,reset,refresh(){if(E.view().app!=='social')return;if(page==='music')musicPage();else if(page==='treehole')treeholePage();else if(page.startsWith('polls:'))pollsPage(page.slice(6));},cleanup(){disposed=true;reset();for(const el of fileInputs)el.remove();fileInputs.clear();if(player){player.src='';player=null;}}};
}
