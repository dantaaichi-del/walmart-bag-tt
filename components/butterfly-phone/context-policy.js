// Current story is authoritative. Only explicit user-authored plot changes create a new archive.
const plain = value => String(value || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').trim();
const hash = value => { let h = 2166136261; for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const isUser = m => m?.is_user === true || m?.role === 'user';
const messageText = m => String(m?.mes || m?.message || m?.content || '');
export const SOURCE_POLICY = `【当前剧情与资料来源优先级——适用于所有手机应用】
1. 当前剧情正文中最新明确、已经成立的世界观、时代、身份、关系与事件，优先于世界书、角色卡、Persona原设和旧手机缓存。只覆盖发生冲突的字段，未冲突的性格或背景可保留；不得把原本的总裁、夫妻等身份硬套进已经改成同学的新剧情。
2. 正文没有改动或没有明确说明的部分，才参考当前仍绑定且启用的世界书。关闭、解绑、禁用或本聊天选择不用的世界书及其缓存，不得作为补充来源。
3. 没有启用世界书时，以当前正文为依据；未知身份、关系或经历保持未知，不得从旧书、旧世界线或原卡职业中擅自补齐。原卡名字及不冲突的性格仅供识别人物，不等于原卡身份继续有效。
4. 一旦user明确开启新剧情，只读取该剧情起点之后的正文。旧剧情的微博、群聊、直播、财富和记忆属于旧存档，不能当作新剧情事实。
5. 回忆、假设、玩笑、梦境和角色自己的错误说法，不自动改写世界观。人物只能知道当前剧情中其合理可知的信息。
6. 这些规则同样约束通讯录身份、私聊、群聊、朋友圈、微博、一起刷和直播。古代场景不能被手机界面反向改成现代；若user继续使用手机，它仅作为当前故事的互动界面，不据此自动创造现代公司、平台、网络职业或新的人物关系。`;

export function isExplicitPlotChange(text) {
  const s = plain(text);
  if (!s || /^(?:如果|假如|假设|要是|比如说|举例|能不能|可不可以)/.test(s)) return false;
  return /(?:^|[\n。！!：:【\[（(])\s*(?:(?:现在|接下来|这次|本次|我们|我想|我要|咱们)[，,\s]*){0,3}(?:开启|开始|开个|开一段|切换到?|换成?|换个|另开|重开|改成?)[^。！!\n]{0,24}(?:新剧情|新世界线|新世界观|校园(?:剧情|世界观|AU)?|古代(?:剧情|世界观|AU)?|现代(?:剧情|世界观|AU)?|平行世界)/i.test(s)
    || /(?:^|[\n【\[])\s*(?:新剧情|新世界线|新世界观|本次(?:剧情|世界观|AU)|这次(?:剧情|世界观)|背景改为|世界观改为|切换世界观)\s*[：:】\]]/i.test(s)
    || /(?:这次|本次)(?:我们)?(?:改玩|玩|来玩|想玩)\s*(?:古代|校园|现代|高中|大学|架空|末世|西幻)(?:剧情|世界观|AU)?/i.test(s);
}

export function resolveStoryContext(chat) {
  const rows = Array.isArray(chat) ? chat : [];
  let start = 0, key = 'base', directive = '';
  for (let i = rows.length - 1; i >= 0; i--) {
    if (!isUser(rows[i]) || !isExplicitPlotChange(messageText(rows[i]))) continue;
    directive = plain(messageText(rows[i]));
    const stable = rows[i].id || rows[i].message_id || rows[i].send_date || rows[i].created_at || i;
    key = 'plot-' + hash(stable + '|' + directive); start = i; break;
  }
  const messages = rows.slice(start);
  const directives = messages.filter(m => isUser(m) && /设定|身份|世界观|背景|这次|本次|同学|同桌|班主任|穿越/.test(messageText(m))).slice(-6).map(m => plain(messageText(m)).slice(0, 1200));
  const recent = messages.slice(-12).map(m => `${isUser(m) ? 'user' : '正文'}：${plain(messageText(m)).slice(0, 1200)}`).join('\n');
  return { key, start, changed: key !== 'base', directive, messages, text: [directive ? `【本剧情起点指令】\n${directive.slice(0, 6000)}` : '', directives.length ? `【当前剧情中的设定说明；后文明确变更优先】\n${[...new Set(directives)].join('\n')}` : '', `【当前剧情近期正文】\n${recent}`].filter(Boolean).join('\n\n') };
}

export function storyContactNote(name, story, actors = {}) {
  const text = (story?.messages || []).map(m => {
    let s = plain(messageText(m));
    if (isUser(m)) {
      if (actors.charName) s = s.replace(/(?:character|你)(?=现在|目前|是|为|的身份)/gi, actors.charName);
      if (actors.userName) s = s.replace(/(?:user|我)(?=现在|目前|是|为|的身份)/gi, actors.userName);
    }
    return s;
  }).join('\n');
  const escaped = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return '';
  const rules = [new RegExp(`${escaped}\\s*(?:的(?:当前)?身份(?:是|为)?|(?:现在|目前|本次|在这个剧情里|在本剧情中)?(?:是|为))\\s*([^。！？!\\n，,；;]{1,50})`, 'g'), new RegExp(`(?:身份|职位|关系)[：:]\\s*${escaped}\\s*[-—:：]\\s*([^。！？!\\n，,；;]{1,50})`, 'g')];
  let last = '', pos = -1;
  for (const re of rules) for (const m of text.matchAll(re)) if (m.index >= pos) { pos = m.index; last = m[1]; }
  return last ? `当前正文：${last}` : '';
}

export function selectStoryline(store, ids, story) {
  let timelines = store[ids.timeline];
  if (!timelines || typeof timelines !== 'object') timelines = store[ids.timeline] = { version: 1, active: 'base', archives: {} };
  if (!timelines.archives || typeof timelines.archives !== 'object') timelines.archives = {};
  if (timelines.active === story.key) return false;
  const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
  const phone = store[ids.phone] || {}, shared = { profiles: clone(phone.profiles || {}), stickers: clone(phone.stickers || []), importedBooks: clone(phone.lore?.importedBooks || []), disabledBooks: clone(phone.lore?.disabledBooks || []), contextPolicy: clone(phone.contextPolicy || { useLore: true }) };
  const snapshot = {};
  for (const key of ids.values) if (store[key] !== undefined) snapshot[key] = clone(store[key]);
  if (snapshot[ids.phone]) { delete snapshot[ids.phone].profiles; delete snapshot[ids.phone].stickers; if (snapshot[ids.phone].lore) delete snapshot[ids.phone].lore.importedBooks; }
  timelines.archives[timelines.active || 'base'] = snapshot;
  const restored = timelines.archives[story.key];
  for (const key of ids.values) delete store[key];
  if (restored) for (const key of ids.values) if (restored[key] !== undefined) store[key] = clone(restored[key]);
  if (!store[ids.phone]) store[ids.phone] = { enabled: phone.enabled === true, mode: phone.mode || 'text', wechat: { contacts: [], threads: {}, moments: [], groups: [] }, weibo: { feed: [], hot: [], myPosts: [], lastRefresh: '' } };
  Object.assign(store[ids.phone], { profiles: shared.profiles, stickers: shared.stickers, contextPolicy: shared.contextPolicy });
  store[ids.phone].lore = { ...(store[ids.phone].lore || {}), importedBooks: shared.importedBooks, disabledBooks: shared.disabledBooks };
  timelines.active = story.key;
  return true;
}
