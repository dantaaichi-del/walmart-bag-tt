import {normalizeSocialAdditions,createSocialExtras} from "./social-extras.js";
import { resolveStoryContext, storyContactNote } from "./context-policy.js";
// v1.4 additions. Local lore/media reads never call the language model.
export const LIMITS = Object.freeze({ contacts: 300, stickers: 60, stickerBytes: 1400000, mediaTotal: 6500000, groups: 30, members: 12 });
const str = (x, n = 2000) => String(x ?? '').trim().slice(0, n);
export const personKey = x => str(x, 80).normalize('NFKC').replace(/^@/, '').replace(/\s+/g, ' ').toLocaleLowerCase();
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const list = x => Array.isArray(x) ? x : [];
const unique = x => [...new Set(x.filter(Boolean))];
export function imageSource(x) {
  const s = String(x || '');
  return /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/=]+$/i.test(s) && s.length <= LIMITS.stickerBytes ? s : '';
}
export function normalizeAdditions(x, d) {
  d.profiles = Object.create(null);
  for (const [k, v] of Object.entries(x?.profiles || {}).slice(0, LIMITS.contacts + 1)) {
    const avatar = imageSource(v?.avatar); if (avatar) d.profiles[personKey(k)] = { avatar };
  }
  d.stickers = list(x?.stickers).slice(0, LIMITS.stickers).map(s => ({ id: str(s?.id, 90), name: str(s?.name, 60), src: imageSource(s?.src) })).filter(s => s.id && s.src);
  d.contextPolicy = { useLore: x?.contextPolicy?.useLore !== false };
  d.lore = { disabledBooks: unique(list(x?.lore?.disabledBooks).map(n=>str(n,100))), ignored: unique(list(x?.lore?.ignored).map(personKey)).slice(0, 500), importedBooks: list(x?.lore?.importedBooks).map(b => ({ name: str(b?.name, 100), data: b?.data })).slice(0, 20) };
  d.wechat.groups = list(x?.wechat?.groups).filter(g => g?.createdBy === 'user' && g?.id).slice(0, LIMITS.groups).map(g => ({
    id: str(g.id, 100), name: str(g.name, 60), createdBy: 'user', members: unique(list(g.members).map(n => str(n, 80))).slice(0, LIMITS.members),
    messages: list(g.messages).slice(-120).map(m => ({ ...m, text: str(m.text, 3000), author: str(m.author, 80), stickerId: str(m.stickerId, 90) })), createdAt: str(g.createdAt, 80)
  }));
  const v = x?.video || {};
  d.video = { coins: Number.isSafeInteger(v.coins) && v.coins >= 0 ? v.coins : 1000, companions: unique(list(v.companions).map(n => str(n, 80))).slice(0, 6),
    feed: list(v.feed).slice(-20).map(p => ({ id: str(p.id, 100), author: str(p.author, 80), title: str(p.title, 120), text: str(p.text, 1800), time: str(p.time, 80), kind: p.kind === 'live' ? 'live' : 'clip', comments: list(p.comments).slice(-40) })),
    rooms: Object.fromEntries(Object.entries(v.rooms || {}).slice(-30).map(([id, r]) => [id, { ...r, board: list(r.board).map(b => ({ name: str(b.name, 80), coins: Math.min(1000000, Math.max(0, Math.floor(Number(b.coins) || 0))) })).slice(0, LIMITS.contacts), messages: list(r.messages).slice(-80), actions: list(r.actions).slice(-60) }])) };
  normalizeSocialAdditions(x,d);
  return d;
}

export function boundBooks(ctx, wi, power = {}) {
  const char = ctx?.characters?.[ctx?.characterId];
  const meta = ctx?.chatMetadata || {};
  const config = wi?.world_info || wi?.getWorldInfoSettings?.()?.world_info || {};
  const avatar = String(char?.avatar || '').replace(/\.[^.]+$/, '');
  const extras = list(config.charLore).filter(x => x.name === avatar).flatMap(x => list(x.extraBooks));
  return unique([meta.world_info, char?.data?.extensions?.world, power.persona_description_lorebook,
    ...list(wi?.selected_world_info || config.globalSelect), ...extras].filter(x => typeof x === 'string' && x.trim()));
}

function possibleName(raw) {
  const s = str(raw, 100).replace(/^(?:\[|【)?(?:角色|人物|NPC|CHARACTER|CHAR|人设|配角|主要人物)(?:\]|】)?\s*[:：|｜\-·]?\s*/i, '').replace(/\s*[（(](?:角色|NPC|人物|主角|配角)[）)]$/i, '').trim();
  if (!s || s.length > 36 || /[\n\r<>\[\]{}:：/\\|｜]/.test(s) || /^(?:__proto__|prototype|constructor|姓名|角色|人物|世界|设定|地点|城市|组织|规则|系统|关系|时间|历史|背景|总览|目录|介绍|示例|男|女|未知|无)$/i.test(s)) return '';
  return s;
}
export function lorePeople(books) {
  const out = new Map(), candidates = [];
  for (const book of books) {
    const entries = list(book.data?.entries).length ? book.data.entries : Object.values(book.data?.entries || {});
    for (const [i, e] of entries.entries()) {
      if (!e || e.disable === true || e.enabled === false) continue;
      const text = str(e.content, 60000), title = str(e.comment || e.name, 200), keys = list(e.key || e.keys).map(k => str(k, 80));
      if (/生成规则|格式要求|系统规则|输出要求|提示词|规则说明|教程|示例/.test(title)) continue;
      const explicit = [...text.matchAll(/(?:^|[\n\r,，;；{\s])(?:姓名|名字|全名|name)\s*["']?\s*[:：=]\s*["']?([^\n\r,，;；"'<>}]{1,36})/g)].map(m => possibleName(m[1])).filter(Boolean);
      const tagged = /(?:角色|人物|NPC|CHARACTER|人设|配角)/i.test(title) && !/(?:关系表|列表|规则|生成|格式|要求|指导)/.test(title);
      const personCues = /性别|年龄|性格|外貌|身高|人称|职业|gender|personality|appearance/i.test(text);
      const titleName = possibleName(title), firstKey = possibleName(keys[0]);
      const names = unique([...explicit, ...(tagged && titleName ? [titleName] : []), ...(!explicit.length && personCues && (firstKey || titleName) ? [firstKey || titleName] : [])]);
      if (!names.length) { if (title || keys.length) candidates.push({ book: book.name, uid: String(e.uid ?? e.id ?? i), title, text, keys }); continue; }
      for (const name of names) {
        const key = personKey(name), old = out.get(key);
        const ref = `${book.name}:${e.uid ?? e.id ?? i}`;
        if (old) { old.refs = unique([...old.refs, ref]); old.bio = (old.bio + '\n' + text).slice(0, 4000); }
        else out.set(key, { name, note: `世界书 · ${book.name}`, bio: text.slice(0, 4000), aliases: keys.filter(k => possibleName(k) && personKey(k) !== key).slice(0, 12), refs: [ref] });
      }
    }
  }
  return { people: [...out.values()].slice(0, LIMITS.contacts), candidates };
}

export function cropGeometry(iw, ih, ow, oh, zoom = 1, x = .5, y = .5) {
  const scale = Math.max(ow / iw, oh / ih) * Math.max(1, Math.min(4, Number(zoom) || 1));
  const sw = ow / scale, sh = oh / scale;
  return { sx: Math.max(0, iw - sw) * Math.min(1, Math.max(0, Number(x))), sy: Math.max(0, ih - sh) * Math.min(1, Math.max(0, Number(y))), sw, sh, ow, oh };
}
export function giftResult(coins, board, sender, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > coins) throw new Error('娱乐币不足或数量无效');
  const rows = list(board).map(x => ({ ...x })), row = rows.find(x => x.name === sender);
  if (row) row.coins += amount; else rows.push({ name: sender, coins: amount });
  return { coins: coins - amount, board: rows.sort((a, b) => b.coins - a.coins) };
}

export function createButterflyFeatures(E) {
  const { doc, win, content, getState, saveState, getCtx, esc, avatarHtml, storyTime, moment, askJson, makeId, scope, storySnapshot, cleanText } = E;
  let books = [], candidates = [], bookChoices = [], loreStamp = '', scanTask = null, disposed = false, currentPage = '', groupToken = 0;
  const mediaTasks = new Set(), aiTasks = new Set();
  const error = e => { console.warn('[蝴蝶 1.4]', e); win.alert?.(String(e?.message || e)); };
  const guard = () => { const s = scope(); return () => !disposed && s === scope(); };
  const bind = (q, fn) => content.querySelectorAll(q).forEach(el => el.addEventListener('click', e => { e.preventDefault(); Promise.resolve(fn(el, e)).catch(error); }));
  const button = (label, cls = '') => `<button class="ph-secondary ${cls}" type="button">${label}</button>`;
  const tip = t => `<div class="tiny bf-hint">${esc(t)}</div>`;
  function page(id, title, back) { currentPage = id; E.setView({ app: 'extra', sub: id, target: '' }); E.expand(true); E.top(title, true, back || E.home); E.updateClock(); }
  function memberInfo(names) { const st = getState(); return names.map(n => { const c = st.wechat.contacts.find(c => personKey(c.name) === personKey(n)); return { name: n, note: c?.note || '', bio: str(c?.bio, 1800), available: c?.available !== false, reason: c?.reason || '' }; }); }
  function avatar(name, isUser) {
    const st = getState(), key = personKey(name), direct = st.profiles?.[key]?.avatar;
    if (direct) return direct;
    const matches = st.wechat.contacts.filter(c => personKey(c.name) === key || list(c.aliases).some(n => personKey(n) === key));
    const contact = matches.find(c => personKey(c.name) === key) || (matches.length === 1 ? matches[0] : null);
    if (contact && st.profiles?.[personKey(contact.name)]?.avatar) return st.profiles[personKey(contact.name)].avatar;
    if (!isUser && personKey(name) === personKey(E.charName())) {
      const c = getCtx()?.characters?.[getCtx()?.characterId];
      if (c?.avatar && c.avatar !== 'none') return `/thumbnail?type=avatar&file=${encodeURIComponent(c.avatar)}`;
    }
    return '';
  }
  function currentStory() { return E.storyContext?.() || resolveStoryContext(getCtx()?.chat || []); }
  function loreEnabled() { return getState().contextPolicy.useLore !== false; }
  function contextText(task = '',includeStory=true) {
    const st = getState(), hits = st.wechat.contacts.filter(c => task.includes(c.name)), story = currentStory();
    const background = loreEnabled() ? candidates.filter(c => /世界|背景|时代|地点|城市|规则|设定/.test(c.title)).slice(0, 4).map(c => `${c.title}：${str(c.text, 700)}`).join('\n') : '';
    const baseline = loreEnabled() && books.length ? ['【仍启用的世界书补充；仅正文未改动的字段可采用】', background, ...hits.slice(0, 12).map(c => `${c.name}：${str(c.loreBio || c.bio || c.note, 1600)}`)].join('\n').slice(0, 10000) : '【本次没有可用世界书；不得从已关闭的书、原卡职业或旧缓存补身份】';
    return `${includeStory?story.text:""}\n${baseline}`;

  }
  async function loadBooks() {
    const ctx = getCtx(), char = ctx?.characters?.[ctx?.characterId], result = [];
    bookChoices=[];
    if(!loreEnabled())return [];
    let wi = {}, power = ctx?.powerUser || ctx?.power_user || {};
    try { wi = await import('/scripts/world-info.js'); } catch (_) { /* Only explicitly bound embedded data can serve as a compatibility fallback. */ }
    if (!Object.keys(power).length) { try { power = (await import('/scripts/power-user.js')).power_user || {}; } catch (_) {} }
    const bound=boundBooks(ctx,wi,power), disabled=new Set(getState().lore.disabledBooks);
    bookChoices=unique([...bound,...getState().lore.importedBooks.map(b=>b.name)]);
    for (const name of bound) {
      if(disabled.has(name))continue;
      try {
        let data;
        if (wi.loadWorldInfo) data = await wi.loadWorldInfo(name);
        else {
          const headers = ctx.getRequestHeaders?.() || (await import('/script.js')).getRequestHeaders();
          const r = await win.fetch('/api/worldinfo/get', { method: 'POST', headers, body: JSON.stringify({ name }), credentials: 'same-origin' });
          if (r.ok) data = await r.json();
        }
        if (data?.entries) result.push({ name, data });
      } catch (e) { console.warn('[蝴蝶] 世界书读取失败', name, e); }
    }
    const embeddedName=char?.data?.extensions?.world;
    if(embeddedName&&bound.includes(embeddedName)&&!disabled.has(embeddedName)&&!result.some(b=>b.name===embeddedName)&&char?.data?.character_book?.entries)result.push({name:embeddedName,data:char.data.character_book});
    for (const b of getState().lore.importedBooks) if (b?.data?.entries&&!disabled.has(b.name)) result.push(b);
    return result;
  }
  async function scanLore(force = false) {
    if (scanTask && !force) return scanTask;
    const valid = guard(), token = ++groupToken;
    scanTask = (async () => {
      const loaded = await loadBooks(); if (!valid() || token !== groupToken) return;
      books = loaded;
      const story=currentStory();
      const found = lorePeople(books); candidates = found.candidates;
      const body=lorePeople([{name:'当前正文',data:{entries:story.messages.map(m=>({content:String(m?.mes||m?.message||m?.content||'')}))}}]).people;
      const stamp = scope() + JSON.stringify({people:found.people,body,story:story.text,useLore:loreEnabled()}); if (stamp === loreStamp && !force) return;
      loreStamp = stamp;
      const st = getState(), ignored = new Set(st.lore.ignored), fresh=new Set(found.people.map(c=>personKey(c.name))), bodyText=story.messages.map(m=>String(m?.mes||m?.message||m?.content||'')).join('\n');
      const retained=st.wechat.contacts.filter(c=>{
        if(!c._loreDiscovered&&!c._bodyDiscovered)return true;
        const inStory=[c.name,...list(c.aliases)].some(n=>n&&bodyText.includes(n));
        const interacted=list(st.wechat.threads?.[c.name]).length>0||st.wechat.groups.some(g=>g.members.includes(c.name));
        return fresh.has(personKey(c.name))||inStory||interacted||c.name===E.charName();
      }).map(c=>{
        if(c._loreDiscovered&&!fresh.has(personKey(c.name)))return {...c,bio:'',loreBio:'',refs:[],note:storyContactNote(c.name,story,{charName:E.charName(),userName:E.userName()})||'当前正文 / 已发生互动'};
        return c;
      });
      const map = new Map(retained.map(c=>[personKey(c.name),c]));
      for (const p of found.people) {
        const key = personKey(p.name); if (ignored.has(key) || key === personKey(E.userName())) continue;
        const old = map.get(key) || {};
        const note=storyContactNote(p.name,story,{charName:E.charName(),userName:E.userName()})||(story.changed?'当前剧情身份优先 · 原世界书身份不自动沿用':p.note);
        map.set(key, { ...old, ...p, loreBio:p.bio, bio:story.changed?'':p.bio,note, available: old.available !== false, reason: old.reason || '', _loreDiscovered: true, _storyDiscovered: false, sourceStoryKeys: [], last: old.last || '', time: old.time || '' });
      }
      for(const p of body){const key=personKey(p.name);if(ignored.has(key)||key===personKey(E.userName()))continue;const old=map.get(key)||{};map.set(key,{...old,name:p.name,bio:p.bio,note:storyContactNote(p.name,story,{charName:E.charName(),userName:E.userName()})||'当前正文人物',_bodyDiscovered:true,_storyDiscovered:false,available:old.available!==false,last:old.last||'',time:old.time||'',sourceStoryKeys:[]});}
      for(const c of map.values()){if((!loreEnabled()||!books.length)&&!c._bodyDiscovered){c.bio='';c.loreBio='';c.note='当前正文身份未明确';}const note=storyContactNote(c.name,story,{charName:E.charName(),userName:E.userName()});if(note)c.note=note;else if(story.changed&&!c._bodyDiscovered&&!c._loreDiscovered)c.note='当前剧情身份以正文为准';}
      st.wechat.contacts = [...map.values()].slice(0, LIMITS.contacts); saveState(st);
    })().finally(() => { scanTask = null; });
    return scanTask;
  }
  async function peoplePage() {
    page('people', '世界书通讯录', () => E.wechat('contacts'));
    content.innerHTML = tip('正在读取当前角色、聊天、全局和人设绑定的世界书…');
    const peopleValid = guard(); await scanLore(true); if (!peopleValid()) return; if (currentPage !== 'people' || E.view().app !== 'extra') return;
    const st = getState();
    content.innerHTML = `<div class="bf-section">${esc(books.map(b => b.name).join(' / ') || '未读到绑定世界书，可导入世界书 JSON')}</div>
      ${tip('当前正文优先。未改动的部分才参考启用的世界书；关闭的书不再补身份。仅列入通讯录不代表已相识或知道秘密。')}<div class="bf-actions">${button(loreEnabled()?'关闭本聊天世界书参考':'开启世界书补充（正文仍优先）','bf-lore-toggle')}</div>${bookChoices.map(name=>`<label class="bf-member"><input class="bf-book-enabled" type="checkbox" value="${esc(name)}" ${st.lore.disabledBooks.includes(name)?'':'checked'}><span>${esc(name)}</span></label>`).join('')}
      <div class="bf-actions">${button('重新读取', 'bf-rescan')}${button('导入世界书 JSON', 'bf-book-import')}${button('AI补全人物（用现有API）', 'bf-lore-ai')}</div>
      <input type="file" class="bf-book-file" accept=".json,application/json" hidden>
      <div class="bf-actions"><input class="bf-new-name" placeholder="补一个人物姓名" maxlength="36">${button('加入', 'bf-add-person')}</div>
      ${st.wechat.contacts.map(c => `<div class="bf-person">${avatarHtml(c.name)}<div><b>${esc(c.name)}</b><small>${esc(c.note || '')}</small></div>${button('头像', 'bf-edit-avatar')}<button class="bf-remove-person" data-name="${esc(c.name)}" type="button">移出</button><span class="bf-name" hidden>${esc(c.name)}</span></div>`).join('')}
      ${candidates.length ? tip(`另有 ${candidates.length} 个条目未能确定是人物，可用AI补全或手动添加；不会把全部地点、规则都塞进好友列表。`) : ''}`;
    bind('.bf-rescan', peoplePage);
    bind('.bf-lore-toggle',()=>{const s=getState();s.contextPolicy.useLore=!s.contextPolicy.useLore;saveState(s);return peoplePage();});
    content.querySelectorAll('.bf-book-enabled').forEach(el=>el.addEventListener('change',()=>{const s=getState();s.lore.disabledBooks=el.checked?s.lore.disabledBooks.filter(n=>n!==el.value):unique([...s.lore.disabledBooks,el.value]);saveState(s);peoplePage().catch(error);}));
    bind('.bf-edit-avatar', el => chooseAvatar(el.parentElement.querySelector('.bf-name').textContent, peoplePage));
    bind('.bf-remove-person', el => { const s = getState(); if (el.dataset.name === E.charName()) throw new Error('当前主角色保留在通讯录中'); s.wechat.contacts = s.wechat.contacts.filter(c => c.name !== el.dataset.name); s.lore.ignored = unique([...s.lore.ignored, personKey(el.dataset.name)]); saveState(s); return peoplePage(); });
    bind('.bf-add-person', () => { const name = possibleName(content.querySelector('.bf-new-name').value); if (!name) throw new Error('请填写具体人物姓名'); addPerson(name); return peoplePage(); });
    bind('.bf-book-import', () => content.querySelector('.bf-book-file').click());
    content.querySelector('.bf-book-file').addEventListener('change', async e => {
      const valid = guard(); try { const f = e.target.files[0]; if (!f) return; if (f.size > 6000000) throw new Error('世界书 JSON 请控制在 6MB 内'); const data = JSON.parse(await f.text()); if (!data.entries || typeof data.entries !== 'object') throw new Error('未找到世界书 entries，不能把聊天备份当作世界书导入'); if (!valid()) return; const s = getState(); if(JSON.stringify([...s.lore.importedBooks.filter(b=>b.name!==f.name),{name:f.name,data}]).length>2500000)throw new Error('手动导入的世界书总量请控制在2.5MB以内；更大的书请在酒馆绑定后读取'); s.lore.importedBooks = [...s.lore.importedBooks.filter(b => b.name !== f.name), { name: f.name, data }].slice(-20); saveState(s); await peoplePage(); } catch (e) { error(e); }
    });
    bind('.bf-lore-ai', async el => {
      if (!loreEnabled()||!books.length) throw new Error('本聊天没有启用的世界书；可使用正文刷新联系人');
      const key = 'lore-ai:' + scope(); if (aiTasks.has(key)) return; aiTasks.add(key); el.disabled = true;
      const valid = guard(); let added = 0;
      try {
        const chunks = []; let chunk = '';
        for (const b of books) for (const entry of Object.values(b.data.entries || {})) {
          if (entry.disable === true || entry.enabled === false) continue;
          const text = `\n【${b.name} / ${entry.comment || entry.name || ''}】${str(entry.content, 14000)}`;
          if (chunk.length + text.length > 14000 && chunk) { chunks.push(chunk); chunk = ''; } chunk += text;
        }
        if (chunk) chunks.push(chunk);
        if (chunks.length > 1 && !win.confirm?.(`这本世界书需要分 ${chunks.length} 次调用当前酒馆API来找全人物，继续吗？`)) return;
        for (let i = 0; i < chunks.length; i++) {
          if (!valid()) return; el.textContent = `读取人物 ${i + 1}/${chunks.length}`;
          const obj = await askJson('从给定世界书中提取全部有名字的具体人物，包括尚未在正文登场的NPC。只提取实际存在的人，不把地点、组织、规则、普通称谓当人，不猜新人物；不要泄露秘密给其他人物。返回JSON {"people":[{"name":"正式姓名","aliases":[],"bio":"已明确的人设摘要"}]}。', chunks[i]);
          if (!valid()) return;
          for (const p of list(obj.people)) { const name = possibleName(p.name); if (name && chunks[i].includes(name)) { addPerson(name, str(p.bio, 2000), list(p.aliases).filter(a => chunks[i].includes(a)), true); added++; } }
        }
        win.alert?.(`人物读取完成，核对了 ${added} 项。头像仍由你决定。`);
      } finally { aiTasks.delete(key); if (valid()) await peoplePage(); }
    });
  }
  function addPerson(name, bio = '', aliases = [], fromLore = false) {
    const s = getState(); if (s.wechat.contacts.length >= LIMITS.contacts && !s.wechat.contacts.some(c => personKey(c.name) === personKey(name))) throw new Error('通讯录已达到300人上限');
    const old = s.wechat.contacts.find(c => personKey(c.name) === personKey(name));
    if (old) { if (bio) {old.bio = currentStory().changed&&fromLore?'':bio;if(fromLore)old.loreBio=bio;} if (aliases.length) old.aliases = unique([...list(old.aliases), ...aliases]); }
    else s.wechat.contacts.push({ name, bio:currentStory().changed&&fromLore?'':bio,loreBio:fromLore?bio:'', aliases, note: fromLore ? (currentStory().changed?'当前剧情身份以正文为准':'世界书人物') : '你手动加入的人物', last: '', time: '', available: true, _loreDiscovered: fromLore, sourceStoryKeys: [] });
    s.lore.ignored = s.lore.ignored.filter(n => n !== personKey(name)); saveState(s);
  }
  async function readImage(file, { animated = false, size = 360 } = {}) {
    if (!file || !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('请选择 PNG、JPG、GIF 或 WebP 图片');
    if (file.size > 12000000) throw new Error('图片过大，请选择12MB以内的图片');
    const raw = await new Promise((resolve, reject) => { const r = new win.FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('图片读取失败')); r.readAsDataURL(file); });
    const img = await new Promise((resolve, reject) => { const im = new win.Image(); im.onload = () => resolve(im); im.onerror = () => reject(new Error('图片无法解码')); im.src = raw; });
    if (animated && /image\/(gif|webp)/.test(file.type)) { if (!imageSource(raw)) throw new Error('动图请压缩到约1MB以内，以保留动画'); return { raw, img }; }
    const ratio = Math.min(1, size / img.width, size / img.height), cv = doc.createElement('canvas'); cv.width = Math.max(1, Math.round(img.width * ratio)); cv.height = Math.max(1, Math.round(img.height * ratio)); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return { raw: cv.toDataURL('image/png'), img };
  }
  function mediaBytes(st) { return st.stickers.reduce((n, s) => n + s.src.length, 0) + Object.values(st.profiles).reduce((n, p) => n + p.avatar.length, 0); }
  function checkMedia(st) { if (mediaBytes(st) > LIMITS.mediaTotal) throw new Error('本聊天头像与表情包合计已接近6.5MB，请先删除不用的图片'); }
  function pickFiles(accept, multiple, callback) {
    const valid = guard(), input = doc.createElement('input'); input.type = 'file'; input.accept = accept; input.multiple = multiple; input.hidden = true; doc.body.appendChild(input); mediaTasks.add(input);
    input.onchange = async () => { const files = [...input.files]; input.remove(); mediaTasks.delete(input); if (valid()) { try { await callback(files, valid); } catch (e) { error(e); } } }; input.oncancel = () => { input.remove(); mediaTasks.delete(input); }; input.click();
  }
  function chooseAvatar(name, back) {
    const valid = guard();
    pickFiles('image/png,image/jpeg,image/gif,image/webp', false, async files => {
      const file = files[0]; if (!file) return;
      const { img } = await readImage(file, { size: 1200 }); if (!valid()) return;
      cropImage(img, { width: 360, height: 360, title: `${name} 的头像`, cancel: back, save: async data => { if (!valid()) return; const s = getState(); s.profiles[personKey(name)] = { avatar: data }; checkMedia(s); saveState(s); await back(); } });
    });
  }
  function cropImage(img, opts) {
    page('crop', opts.title || '裁剪壁纸', opts.cancel);
    const valid = guard();
    content.innerHTML = `<div class="bf-crop-wrap"><canvas class="bf-crop-canvas" width="${opts.width}" height="${opts.height}"></canvas></div>${tip('拖动画面选取位置，再调节放大倍率。点保存后才会替换原图。')}<label class="bf-range">放大<input class="bf-zoom" type="range" min="1" max="4" step=".01" value="1"></label><label class="bf-range">左右<input class="bf-crop-x" type="range" min="0" max="1" step=".001" value=".5"></label><label class="bf-range">上下<input class="bf-crop-y" type="range" min="0" max="1" step=".001" value=".5"></label><div class="bf-actions">${button('取消', 'bf-crop-cancel')}${button('保存裁剪', 'bf-crop-save')}</div>`;
    const cv = content.querySelector('canvas'), z = content.querySelector('.bf-zoom'), x = content.querySelector('.bf-crop-x'), y = content.querySelector('.bf-crop-y');
    const draw = () => { const r = cropGeometry(img.width, img.height, cv.width, cv.height, +z.value, +x.value, +y.value); cv.getContext('2d').drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, r.ow, r.oh); };
    [z, x, y].forEach(el => el.addEventListener('input', draw));
    let drag = null;
    cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, px: +x.value, py: +y.value }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => { if (!drag) return; const r = cropGeometry(img.width, img.height, cv.width, cv.height, +z.value, +x.value, +y.value), rect = cv.getBoundingClientRect(); x.value = String(Math.min(1, Math.max(0, drag.px - (e.clientX - drag.x) / rect.width * r.sw / Math.max(1, img.width - r.sw)))); y.value = String(Math.min(1, Math.max(0, drag.py - (e.clientY - drag.y) / rect.height * r.sh / Math.max(1, img.height - r.sh)))); draw(); });
    const stop = () => { drag = null; }; cv.addEventListener('pointerup', stop); cv.addEventListener('pointercancel', stop);
    bind('.bf-crop-cancel', opts.cancel); bind('.bf-crop-save', async el => { if (!valid()) return; el.disabled = true; try { await opts.save(cv.toDataURL('image/jpeg', .88)); } finally { el.disabled = false; } }); draw();
  }
  async function wallpaperCrop(file, back) { const valid = guard(), { img } = await readImage(file, { size: 1800 }); if (!valid()) return; const rect = E.screen.getBoundingClientRect(), ratio = Math.max(.35, Math.min(1, rect.width / Math.max(1, rect.height))); cropImage(img, { width: 720, height: Math.round(720 / ratio), title: '裁剪手机壁纸', cancel: back, save: async data => { if (!valid()) return; await E.persistWallpaper(data); await back(); } }); }
  function stickerCatalog() { return getState().stickers.map(s => ({ id: s.id, meaning: s.name })); }
  function stickerBody(m) { const s = getState().stickers.find(s => s.id === m.stickerId); return s ? `<img class="bf-sticker-image" src="${esc(s.src)}" alt="${esc(s.name)}" title="${esc(s.name)}">` : '<span class="tiny">此表情包已从图库移除</span>'; }
  async function stickersPage(onPick = null, back = () => E.wechat('me')) {
    page('stickers', onPick ? '选一个表情包' : '我的表情包', back);
    const s = getState(); content.innerHTML = `${tip('导入真实图片或GIF动图，保留动画。表情含义可自行命名；模型按名称理解，不额外调用识图。表情包保存在当前聊天并参与双机同步。')}<div class="bf-actions">${button('导入图片 / GIF', 'bf-sticker-import')}${onPick ? button('返回聊天', 'bf-sticker-back') : ''}</div><div class="bf-sticker-grid">${s.stickers.map(st => `<div><button class="bf-sticker-pick" data-id="${esc(st.id)}" type="button"><img src="${esc(st.src)}" alt="${esc(st.name)}"><small>${esc(st.name)}</small></button><button class="bf-sticker-rename" data-id="${esc(st.id)}" type="button">改名</button><button class="bf-sticker-delete" data-id="${esc(st.id)}" type="button">移除</button></div>`).join('')}</div>${!s.stickers.length ? tip('还没有表情包，先导入几张。') : ''}`;
    bind('.bf-sticker-import', () => pickFiles('image/png,image/jpeg,image/gif,image/webp', true, async (files, valid) => {
      let imported = 0; const errors = [];
      for (const f of files) { try { const { raw } = await readImage(f, { animated: true, size: 320 }); if (!valid()) return; const st = getState(); if (st.stickers.length >= LIMITS.stickers) throw new Error('最多保存60个表情包'); if (st.stickers.some(s => s.src === raw)) continue; st.stickers.push({ id: makeId('sticker'), name: f.name.replace(/\.[^.]+$/, '').slice(0, 60), src: raw }); checkMedia(st); if (!saveState(st)) throw new Error('保存失败'); imported++; } catch (e) { errors.push(`${f.name}：${e.message}`); } }
      if (valid()) { if (errors.length) win.alert?.(`导入 ${imported} 张。\n${errors.join('\n')}`); await stickersPage(onPick, back); }
    }));
    bind('.bf-sticker-back', back);
    bind('.bf-sticker-pick', async el => { if (!onPick) return; const st = getState().stickers.find(s => s.id === el.dataset.id); if (st) { await back(); await onPick(st); } });
    bind('.bf-sticker-rename', el => { const st = getState(), row = st.stickers.find(s => s.id === el.dataset.id); const name = win.prompt?.('表情含义（例如：无语翻白眼、开心抱抱）', row.name); if (name?.trim()) { row.name = str(name, 60); saveState(st); } return stickersPage(onPick, back); });
    bind('.bf-sticker-delete', el => { const st = getState(); st.stickers = st.stickers.filter(s => s.id !== el.dataset.id); saveState(st); return stickersPage(onPick, back); });
  }
  function contactTools(name, back) { page('profile', name, back); content.innerHTML = `<div class="bf-profile-hero">${avatarHtml(name)}<b>${esc(name)}</b></div>${tip('头像在微信、朋友圈、微博、群聊和直播中共用。')}${button('选择并裁剪头像', 'bf-profile-pick')}${button('恢复默认头像', 'bf-profile-reset')}`; bind('.bf-profile-pick', () => chooseAvatar(name, () => contactTools(name, back))); bind('.bf-profile-reset', () => { const s = getState(); delete s.profiles[personKey(name)]; saveState(s); contactTools(name, back); }); }
  function groupList() {
    page('groups', '群聊', () => E.wechat('chats'));
    const s = getState(); content.innerHTML = `<div class="bf-actions">${button('＋ 由我发起群聊', 'bf-create-group')}</div>${tip('只有你能建群、拉人和解散。模型只负责群内已有成员的回复。')}${s.wechat.groups.map(g => `<button class="contact bf-open-group" data-id="${esc(g.id)}" type="button"><span class="bf-group-icon">群</span><div><div class="contact-name">${esc(g.name)} · ${g.members.length + 1}人</div><div class="contact-last">${esc(str(g.messages.at(-1)?.text || '你创建的群聊', 65))}</div></div></button>`).join('')}`;
    bind('.bf-create-group', () => groupEditor()); bind('.bf-open-group', el => openGroup(el.dataset.id));
  }
  async function groupEditor(id = '') {
    const valid = guard(); await scanLore(); if (!valid()) return;
    const s = getState(), g = s.wechat.groups.find(g => g.id === id); if (id && !g) return groupList();
    page('group-edit', g ? '群成员 · 由你管理' : '由我发起群聊', () => g ? openGroup(id) : groupList());
    content.innerHTML = `<label class="bf-field">群名<input class="bf-group-name" maxlength="60" value="${esc(g?.name || '')}" placeholder="给这个群起个名字"></label>${tip(`手动勾选2～${LIMITS.members}位通讯录人物，你自动加入。每轮合并一次模型请求，让每位成员回复或作出反应。`)}${s.wechat.contacts.filter(c => c.name !== E.userName()).map(c => `<label class="bf-member"><input type="checkbox" value="${esc(c.name)}" ${g?.members.includes(c.name) ? 'checked' : ''}>${avatarHtml(c.name)}<span>${esc(c.name)}</span></label>`).join('')}<div class="bf-actions">${button(g ? '保存成员' : '创建群聊', 'bf-group-save')}${g ? button('解散此群', 'bf-group-delete') : ''}</div>`;
    bind('.bf-group-save', () => {
      const names = [...content.querySelectorAll('.bf-member input:checked')].map(el => el.value); if (names.length < 2 || names.length > LIMITS.members) throw new Error(`请勾选2～${LIMITS.members}个人物`);
      const st = getState(), name = str(content.querySelector('.bf-group-name').value, 60) || names.slice(0, 3).join('、') + '的群';
      const old = st.wechat.groups.find(g => g.id === id);
      if (old) { old.name = name; old.members = names; } else { if (st.wechat.groups.length >= LIMITS.groups) throw new Error('群聊最多30个'); id = makeId('group'); st.wechat.groups.push({ id, name, members: names, createdBy: 'user', createdAt: storyTime(), messages: [] }); }
      saveState(st); openGroup(id);
    });
    bind('.bf-group-delete', () => { if (!win.confirm?.('解散此群并删除群内记录？')) return; const st = getState(); st.wechat.groups = st.wechat.groups.filter(g => g.id !== id); saveState(st); groupList(); });
  }
  function openGroup(id) {
    const g = getState().wechat.groups.find(g => g.id === id); if (!g) return groupList();
    page('group:' + id, `${g.name} (${g.members.length + 1})`, groupList);
    const pending = g.messages.some(m => m.from === 'user' && m.pending);
    content.innerHTML = `<div class="bf-actions">${button('管理群成员', 'bf-group-manage')}${button('投票', 'bf-group-polls')}${button('表情包', 'bf-group-stickers')}</div><div class="thread">${g.messages.map(m => `<div class="bubble-row ${m.from === 'user' ? 'me' : 'them'}"><div class="bubble-line">${avatarHtml(m.author, m.from === 'user', 'chat-avatar')}<div><div class="tiny">${esc(m.author)}</div><div class="bubble">${m.kind === 'sticker' ? stickerBody(m) : esc(m.text).replace(/\n/g, '<br>')}</div><div class="bubble-time">${esc(m.time)} ${m.from === 'user' ? `<button type="button" class="bubble-del bf-group-msg-delete" data-pair="${esc(m.pairId)}">删除</button>${m.failed ? `<button type="button" class="bubble-del bf-group-retry" data-pair="${esc(m.pairId)}">重试</button>` : ''}` : ''}</div>${m.error ? tip(m.error) : ''}</div></div></div>`).join('')}</div><div class="composer"><textarea class="bf-group-input" placeholder="${pending ? '等待群成员回应…' : '发一句话，群里的成员会各自回应'}" ${pending ? 'disabled' : ''}></textarea><button type="button" class="send bf-group-send" ${pending ? 'disabled' : ''}>发送</button></div>`;
    bind('.bf-group-polls',()=>socials.pollsPage(id));
    bind('.bf-group-manage', () => groupEditor(id)); bind('.bf-group-stickers', () => stickersPage(sticker => sendGroup(id, sticker), () => openGroup(id)));
    bind('.bf-group-send', () => sendGroup(id)); content.querySelector('.bf-group-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendGroup(id).catch(error); } });
    bind('.bf-group-msg-delete', el => { const s = getState(), row = s.wechat.groups.find(g => g.id === id); if (row) { row.messages = row.messages.filter(m => m.pairId !== el.dataset.pair); saveState(s); openGroup(id); } });
    bind('.bf-group-retry', el => sendGroup(id, null, el.dataset.pair)); content.scrollTop = content.scrollHeight;
  }
  async function sendGroup(id, sticker = null, retry = '') {
    const key = `group:${scope()}:${id}`; if (aiTasks.has(key)) return;
    const prepared=guard();await scanLore(false);if(!prepared()||aiTasks.has(key))return;
    let st = getState(), g = st.wechat.groups.find(g => g.id === id); if (!g) return;
    const old = retry ? g.messages.find(m => m.pairId === retry && m.from === 'user') : null;
    const text = old?.text || (sticker ? sticker.name : str(content.querySelector('.bf-group-input')?.value, 3000)); if (!text) return;
    if (!retry && g.messages.some(m => m.from === 'user' && m.pending)) return;
    const now = moment('发送群聊'); if (!now) return;
    const pair = old?.pairId || makeId('gp'), valid = guard(), snapshot = storySnapshot(), members = [...g.members];
    if (old) { old.pending = true; old.failed = false; old.error = ''; }
    else g.messages.push({ id: makeId('gm'), pairId: pair, author: E.userName(), from: 'user', text, kind: sticker ? 'sticker' : 'text', stickerId: sticker?.id || '', time: now, pending: true });
    saveState(st); openGroup(id); aiTasks.add(key);
    try {
      const obj = await askJson(`你在模拟由user亲自建立的微信群【${g.name}】。群成员仅限：${members.join('、')}和user【${E.userName()}】。严禁创建群、邀请他人、改变群成员或替user发言。对user最新消息，让每一位已有成员分别作出符合性格和知识范围的回应；无法通讯时写reason，不要强迫死亡/昏迷角色说话。人设中的秘密不是全群共享知识。不得假装发送图片、语音或视频。可以使用给定表情库里的stickerId。只返回JSON {"replies":[{"name":"群成员姓名","text":"回复或具体反应","stickerId":"已有ID或空","reason":"确实不能联系时说明"}]}。\n人设：${JSON.stringify(memberInfo(members))}\n表情库：${JSON.stringify(stickerCatalog())}`, `最近群聊：${JSON.stringify(g.messages.slice(-18).map(m => ({ author: m.author, text: m.text, kind: m.kind })))}\n本轮最新user消息：${text}`);
      if (!valid()) return;
      st = getState(); g = st.wechat.groups.find(g => g.id === id); const u = g?.messages.find(m => m.pairId === pair && m.from === 'user'); if (!g || !u) return;
      if (snapshot !== storySnapshot() || JSON.stringify(g.members) !== JSON.stringify(members)) throw new Error('剧情或群成员已变化，请按当前内容重试');
      const replies = list(obj.replies), allowed = new Set(st.stickers.map(s => s.id));
      g.messages = g.messages.filter(m => !(m.pairId === pair && m.from !== 'user'));
      for (const name of members) {
        const row = replies.find(r => personKey(r.name) === personKey(name));
        const sid = allowed.has(row?.stickerId) ? row.stickerId : '', text = cleanText(row?.text || '', 1600);
        if (text || sid) g.messages.push({ id: makeId('gm'), pairId: pair, author: name, from: 'npc', text, stickerId: sid, kind: sid && !text ? 'sticker' : 'text', time: now });
        else g.messages.push({ id: makeId('gm'), pairId: pair, author: name, from: 'status', text: row?.reason ? `本轮无法回应：${str(row.reason, 160)}` : '本轮模型没有返回此人的反应', kind: 'text', time: now });
        if (sid && text) g.messages.push({ id: makeId('gm'), pairId: pair, author: name, from: 'npc', text: st.stickers.find(s => s.id === sid)?.name || '', stickerId: sid, kind: 'sticker', time: now });
      }
      u.pending = false; u.failed = false; u.error = ''; saveState(st);
    } catch (e) {
      if (valid()) { st = getState(); g = st.wechat.groups.find(g => g.id === id); const u = g?.messages.find(m => m.pairId === pair && m.from === 'user'); if (u) { u.pending = false; u.failed = true; u.error = str(e.message, 180); saveState(st); } }
    } finally { aiTasks.delete(key); if (valid() && currentPage === 'group:' + id && E.view().app === 'extra') openGroup(id); }
  }
  function videoPage(tab = 'clip') {
    page('videos:' + tab, '一起刷', E.home);
    const st = getState(), rows = st.video.feed.filter(p => p.kind === tab);
    content.innerHTML = `<div class="seg"><button class="bf-video-tab ${tab === 'clip' ? 'active' : ''}" data-tab="clip">短视频</button><button class="bf-video-tab ${tab === 'live' ? 'active' : ''}" data-tab="live">直播</button></div>${tip('剧情内文字模拟，不接入真实抖音。仅你点击刷新或互动时请求当前酒馆API；娱乐币为独立游戏数值，不花真钱、不扣财富账本。')}<div class="bf-actions">${button('刷新内容（API）', 'bf-video-refresh')}${button('选择一起刷的人', 'bf-video-companions')}</div>${tip(`一起刷：${st.video.companions.join('、') || '暂未邀请'} · 娱乐币 ${st.video.coins}`)}${rows.map(p => `<div class="bf-video-card"><div class="author-line">${avatarHtml(p.author)}<b>${esc(p.author)}</b><span>${p.kind === 'live' ? '● 直播中' : '短视频'}</span></div><h3>${esc(p.title)}</h3><div class="bf-video-content">${esc(p.text).replace(/\n/g, '<br>')}</div><div class="bf-actions">${button(p.kind === 'live' ? '进入直播间' : '一起看 / 讨论', 'bf-video-open')}</div><span class="bf-item-id" hidden>${esc(p.id)}</span></div>`).join('')}${!rows.length ? tip('还没有内容，点击刷新，按当前世界观生成。') : ''}`;
    bind('.bf-video-tab', el => videoPage(el.dataset.tab)); bind('.bf-video-companions', () => companionEditor(tab)); bind('.bf-video-open', el => openRoom(el.closest('.bf-video-card').querySelector('.bf-item-id').textContent)); bind('.bf-video-refresh', el => refreshVideos(tab, el));
  }
  function companionEditor(tab) {
    page('companions', '邀请一起刷', () => videoPage(tab)); const st = getState();
    content.innerHTML = tip('最多选择6位已有联系人。只有你点保存才会加入本次一起刷。') + st.wechat.contacts.filter(c => c.name !== E.userName()).map(c => `<label class="bf-member"><input type="checkbox" value="${esc(c.name)}" ${st.video.companions.includes(c.name) ? 'checked' : ''}>${avatarHtml(c.name)}<span>${esc(c.name)}</span></label>`).join('') + button('保存邀请', 'bf-companion-save');
    bind('.bf-companion-save', () => { const names = [...content.querySelectorAll('input:checked')].map(e => e.value); if (names.length > 6) throw new Error('最多邀请6人'); const s = getState(); s.video.companions = names; saveState(s); videoPage(tab); });
  }
  async function refreshVideos(tab, el) {
    const key = 'video-feed:' + scope(); if (aiTasks.has(key)) return;
    const prepared=guard();await scanLore(false);if(!prepared()||aiTasks.has(key))return;
    const now = moment('刷新一起刷'); if (!now) return;
    const valid = guard(), snapshot = storySnapshot(), known = getState().wechat.contacts.map(c => c.name);
    if (!known.length) throw new Error('请先从当前正文或启用的世界书补充通讯录'); aiTasks.add(key); el.disabled = true; el.textContent = '生成中…';
    try {
      const obj = await askJson(`为当前世界观生成3条${tab === 'live' ? '虚拟直播间' : '短视频的文字内容'}。主播/发布者只能来自通讯录：${known.join('、')}。遵守角色身份、可知信息与通讯条件；不得编造不存在的真实视频链接、假媒体标签、打赏、充值或用户行为。文字直接描写这一条内容，不要声称正在播放真实视频。返回JSON {"items":[{"author":"现有姓名","title":"标题","text":"直播/短视频内容文字"}]}。`, `按当前正文刷新，允许的人物：${known.join('、')}`);
      if (!valid()) return; if (snapshot !== storySnapshot()) throw new Error('剧情已变化，请重新刷新');
      const st = getState(), rows = list(obj.items).filter(p => known.includes(p.author) && str(p.text)).slice(0, 3).map(p => ({ id: makeId('clip'), author: p.author, title: str(p.title, 120), text: cleanText(p.text, 1800), kind: tab, time: now, comments: [] }));
      if (!rows.length) throw new Error('模型没有返回有效的通讯录人物内容，本次未更新');
      const pinned = new Set(Object.entries(st.video.rooms).filter(([, r]) => list(r.actions).length).map(([id]) => id));
      st.video.feed = [...st.video.feed.filter(p => p.kind !== tab || pinned.has(p.id)), ...rows].slice(-20); saveState(st);
    } finally { aiTasks.delete(key); if (valid() && currentPage === 'videos:' + tab && E.view().app === 'extra') videoPage(tab); }
  }
  function getRoom(st, id) {
    if (!own(st.video.rooms, id)) st.video.rooms[id] = { board: [], messages: [], actions: [] };
    return st.video.rooms[id];
  }
  function openRoom(id) {
    const st = getState(), post = st.video.feed.find(p => p.id === id); if (!post) return videoPage();
    const r = getRoom(st, id); page('room:' + id, post.kind === 'live' ? post.author + ' 的直播' : '一起刷 · ' + post.author, () => videoPage(post.kind));
    const key = 'room:' + scope() + ':' + id, busy = aiTasks.has(key), board = [...r.board].sort((a, b) => b.coins - a.coins);
    content.innerHTML = `<div class="bf-video-card"><div class="author-line">${avatarHtml(post.author)}<b>${esc(post.author)}</b></div><h3>${esc(post.title)}</h3><p>${esc(post.text)}</p></div>${tip(`一起刷：${st.video.companions.join('、') || '仅你自己'} · 剩余娱乐币 ${st.video.coins}`)}${post.kind === 'live' ? `<div class="bf-ranking"><b>打赏榜 · 娱乐币</b>${board.length ? board.slice(0, 8).map((b, i) => `<div>${i + 1}. ${avatarHtml(b.name, b.name === E.userName())}<span>${esc(b.name)}</span><b>${b.coins}</b></div>`).join('') : tip('榜一虚位以待')}</div><div class="bf-actions">${[10, 50, 100].map(n => `<button class="ph-secondary bf-gift" data-coins="${n}" type="button" ${busy ? 'disabled' : ''}>送 ${n} 币</button>`).join('')}</div>` : ''}<div class="bf-room-messages">${r.messages.map(m => `<div class="bf-room-line">${avatarHtml(m.author, m.author === E.userName())}<div><b>${esc(m.author)}</b><p>${esc(m.text)}</p></div></div>`).join('')}</div>${busy ? tip('等待主播和一起刷的人回应…') : ''}<div class="composer"><textarea class="bf-room-input" placeholder="评论、夸主播，或向一起刷的人说句话" ${busy ? 'disabled' : ''}></textarea><button class="send bf-room-send" type="button" ${busy ? 'disabled' : ''}>发送</button></div><div class="bf-actions">${button('继续互动（API）', 'bf-room-continue')}${button('领取1000试玩币', 'bf-coins')}</div>${tip('榜单只在你互动时推进。NPC竞榜使用剧情娱乐币；它们不能替你送礼或扣你的币。试玩币可手动补充，不兑换财富或真钱。')}`;
    bind('.bf-gift', el => roomAction(id, 'gift', Number(el.dataset.coins)));
    bind('.bf-room-send', () => roomAction(id, 'comment'));
    bind('.bf-room-continue', () => roomAction(id, 'continue'));
    bind('.bf-coins', () => { if (aiTasks.has(key)) return; const s = getState(); s.video.coins = Math.min(1000000, s.video.coins + 1000); saveState(s); openRoom(id); });
    content.scrollTop = content.scrollHeight;
  }
  async function roomAction(id, kind, amount = 0) {
    const key = 'room:' + scope() + ':' + id; if (aiTasks.has(key)) return;
    const prepared=guard();await scanLore(false);if(!prepared()||aiTasks.has(key))return;
    let st = getState(), post = st.video.feed.find(p => p.id === id); if (!post) return;
    const r = getRoom(st, id), now = moment('直播 / 一起刷互动'); if (!now) return;
    let text = kind === 'comment' ? str(content.querySelector('.bf-room-input')?.value, 1000) : kind === 'gift' ? `送出了 ${amount} 娱乐币` : '继续一起观看'; if (!text) return;
    if (kind === 'gift') { const out = giftResult(st.video.coins, r.board, E.userName(), amount); st.video.coins = out.coins; r.board = out.board; }
    const action = { id: makeId('live-action'), kind, text, amount: kind === 'gift' ? amount : 0, time: now, author: E.userName(), pending: true };
    r.actions.push(action); if (kind !== 'continue') r.messages.push({ author: E.userName(), text, time: now, actionId: action.id }); saveState(st);
    const valid = guard(), snapshot = storySnapshot(), companions = [...st.video.companions], allowed = unique([post.author, ...companions]); aiTasks.add(key); openRoom(id);
    try {
      const obj = await askJson(`模拟当前${post.kind === 'live' ? '直播间' : '一起刷短视频'}里的互动。主播【${post.author}】、一起刷的人【${companions.join('、') || '无'}】可以讨论、打趣、吃醋或按各自性格竞榜；不能替user说话、行动、送礼、充值或扣款，也不能新建群聊。参与说话和竞榜者只能来自本次列出的姓名。NPC每次最多送200娱乐币，量力而行；短视频不能竞榜。榜单金额由程序计算，你只能建议本轮NPC新增的礼物，不能返回累计总额或更改user金额。返回JSON {"reactions":[{"author":"允许的人物姓名","text":"直接承接当前互动"}],"gifts":[{"author":"允许的同行NPC姓名","coins":整数}]}。\n人物资料：${JSON.stringify(memberInfo(allowed))}`, `内容：${post.title}\n${post.text}\n最近互动：${JSON.stringify(r.messages.slice(-12))}\n当前榜单：${JSON.stringify(r.board)}\nuser最新操作：${text}`);
      if (!valid()) return; st = getState(); const room = st.video.rooms[id]; const original = room?.actions.find(a => a.id === action.id); if (!room || !original) return;
      if (snapshot !== storySnapshot()) throw new Error('剧情变化，本轮NPC反应未保存。已送的礼物保留，可点继续互动。');
      for (const row of list(obj.reactions).slice(0, 10)) if (allowed.includes(row.author) && str(row.text)) room.messages.push({ author: row.author, text: cleanText(row.text, 1200), time: now, actionId: action.id });
      if (post.kind === 'live') {
        const donors = new Set();
        for (const gift of list(obj.gifts)) {
          const n = Number(gift.coins); if (!companions.includes(gift.author) || gift.author === E.userName() || gift.author === post.author || donors.has(gift.author) || !Number.isSafeInteger(n) || n < 1 || n > 200) continue;
          donors.add(gift.author); const row = room.board.find(b => b.name === gift.author); if (row) row.coins = Math.min(1000000, row.coins + n); else room.board.push({ name: gift.author, coins: n });
          room.messages.push({ author: gift.author, text: `送出 ${n} 娱乐币`, time: now, actionId: action.id });
        }
      }
      original.pending = false; saveState(st);
    } catch (e) {
      if (valid()) { st = getState(); const room = st.video.rooms[id], original = room?.actions.find(a => a.id === action.id); if (original) { original.pending = false; original.error = str(e.message, 180); room.messages.push({ author: '系统提示', text: `回应暂未完成：${str(e.message, 140)}。送礼只记一次，可点继续互动。`, time: now }); saveState(st); } }
    } finally { aiTasks.delete(key); if (valid() && currentPage === 'room:' + id && E.view().app === 'extra') openRoom(id); }
  }
  function canon(st) {
    const groups = st.wechat.groups.filter(g => g.members.includes(E.charName())&&g.messages.some(m => m.from === 'user')).slice(-2).map(g => ({ name: g.name, members: g.members, recent: g.messages.slice(-4).map(m => ({ author: m.author, text: str(m.text, 140), time: m.time, pending: m.pending === true })) }));
    const actions = Object.entries(st.video.rooms).flatMap(([id, r]) => list(r.actions).slice(-2).map(a => ({ room: st.video.feed.find(p => p.id === id)?.title || '', text: str(a.text, 140), time: a.time, amount: a.amount || 0 }))).slice(-3);
    return { groups, entertainment: actions };
  }
  function recoverPending() {
    const s = getState(); let changed = false;
    for (const g of s.wechat.groups) for (const m of g.messages) if (m.from === 'user' && m.pending) { m.pending = false; m.failed = true; m.error = '页面重开后回复中断，可重试或删除'; changed = true; }
    for (const r of Object.values(s.video.rooms)) for (const a of r.actions) if (a.pending) { a.pending = false; a.error = '上次回应中断，已记礼物不会重复扣币'; changed = true; }
    if (changed) saveState(s);
  }
  const socials=createSocialExtras({...E,scanLore,memberInfo,openGroup});
  return { socials,avatar, contextText, scanLore, hasLore:()=>loreEnabled()&&books.length>0, peoplePage, contactTools, chooseAvatar, wallpaperCrop, stickersPage, stickerBody, stickerCatalog, groupList, openGroup, videoPage, openRoom, canon, recoverPending,
    reset() { socials.reset();currentPage = ''; books = []; candidates = []; bookChoices=[]; loreStamp = ''; groupToken++; scanTask = null; },
    refresh() { if (E.view().app !== 'extra') return; if (currentPage.startsWith('group:')) openGroup(currentPage.slice(6)); else if (currentPage === 'groups') groupList(); else if (currentPage.startsWith('videos:')) videoPage(currentPage.slice(7)); else if (currentPage.startsWith('room:')) openRoom(currentPage.slice(5)); },
    cleanup() { socials.cleanup();disposed = true; groupToken++; for (const el of mediaTasks) el.remove(); mediaTasks.clear(); }
  };
}
