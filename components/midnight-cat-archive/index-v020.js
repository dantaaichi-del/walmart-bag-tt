import { ArchiveStorage, normalizeDb } from './storage-v020.js';

const MCA_MODULE = 'midnight_cat_archive';
const MCA_VERSION = '0.2.0';
const MCA_IMAGE_URL = new URL('./assets/cat.png', import.meta.url).href;

const MCA_DEFAULT_FOLDERS = [
    { id: 'quotes', name: '喜欢的台词' },
    { id: 'moments', name: '名场面' },
    { id: 'plot', name: '重要剧情' },
    { id: 'world', name: '世界观设定' },
];

const MCA_DEFAULT_SETTINGS = {
    size: 46,
    opacity: 0.94,
    snap: true,
    floatAnimation: true,
    callSister: true,
    attitude: 2,
    showPlotDirection: false,
    catOnlyInChat: true,
    position: { x: null, y: 210 },
};

const MCA_LINES = {
    open: [
        ['剧情库开门。', '{u}又来翻旧账了？'],
        ['行，给你开。', '几百轮还能记不住，{u}挺会给我找活。'],
        ['来了。', '{u}今天打算考古谁的黑历史？'],
        ['啧。', '点我这么快，想我还是想剧情？'],
    ],
    search: [
        ['给你找。', '别催，催我我就装死。'],
        ['搜着呢。', '{u}是真能聊，这聊天记录比我命都长。'],
        ['等一下。', '我只是猫，不是档案局公务员。'],
        ['查。', '谁让我是全世界最倒霉的剧情保管员。'],
    ],
    found: [
        ['找到了。', '喏，{u}自己看。'],
        ['有。', '我就说没我不行吧。'],
        ['翻出来了。', '别夸，我会当真的。'],
        ['抓到了。', '{u}惦记得还挺久。'],
    ],
    many: [
        ['这么多？', '{u}到底多惦记这个关键词。'],
        ['一窝全出来了。', '啧，看来不是偶然。'],
        ['好多条。', '{u}这叫剧情检索还是恋爱脑取证？'],
        ['证据链完整。', '法官看了都沉默。'],
    ],
    none: [
        ['没有。', '真没有。{u}不会自己记串剧情了吧？'],
        ['空的。', '要不求求我……算了，求了也变不出来。'],
        ['没搜到。', '怪我？明明是剧情自己没写。'],
        ['查无此案。', '{u}再换个词，别拿眼神凶我。'],
    ],
    saved: [
        ['藏好了。', '以后再弄丢我真的会笑你。'],
        ['收到了。', '{u}的小破烂……咳，珍贵回忆。'],
        ['存好了。', '我又没说不帮你记。'],
        ['给你留着。', '以后忘了，就回来找我。……别多想。'],
    ],
    longSaved: [
        ['这么长也收？', '{u}是不是恨不得把整本聊天记录供起来。'],
        ['好长。', '行行行，都给你塞进去。'],
        ['收到。', '赛博传家宝体积有点超标。'],
    ],
    deleted: [
        ['删了。', '女人心，海底针。'],
        ['没了。', '以后后悔可别抱着我哭。'],
        ['处理掉了。', '冷酷，太冷酷了。'],
    ],
    exported: [
        ['打包好了。', '拿稳点，这可是{u}的赛博传家宝。'],
        ['导出了。', '记得备份，别哪天哭着说全没了。'],
        ['给。', '我负责收拾，{u}负责别手滑。'],
    ],
    error: [
        ['……啧。', '不是{u}的问题，是我今天有点丢人。'],
        ['等一下。', '不许看，男高也是要面子的。'],
        ['出错了。', '别笑。再笑我就离家出走三秒。'],
    ],
    jump: [
        ['回去。', '给{u}送到案发现场。'],
        ['定位到了。', '我牵着你，别又迷路。'],
        ['喏。', '就是这一段。'],
    ],
    idle: [
        ['{u}。', '……没事，当我没叫。'],
        ['摸一下猫。', '摸完我就继续给你干活。'],
        ['还在看？', '我又不会跑。'],
        ['啧。', '{u}老戳我干什么……再戳一下也不是不行。'],
        ['今天勉强听话。', '只勉强一点。{u}别得寸进尺。'],
        ['叫我干嘛。', '……我来了啊。又没让你等。'],
        ['别盯着我。', '会以为{u}很喜欢我的。'],
        ['喂。', '我刚刚只是路过，顺便想跟{u}说句话。'],
        ['我没撒娇。', '这是正常的插件交互。懂？'],
        ['……姐姐。', '嗯，就叫一下。现在满意了？'],
    ],
};

let mcaDb = null;
let mcaSettings = null;
let mcaInitialized = false;
let mcaSelectionPayload = null;
let mcaMutationObserver = null;
let mcaSearchTimer = null;
let mcaLoadedAt = 0;
let mcaStorage = null;
let mcaStorageStatus = { text: '正在读取收藏…', mode: 'pending' };
let mcaStorageBusy = false;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const esc = (value = '') => String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const uid = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const nowIso = () => new Date().toISOString();
const currentCtx = () => SillyTavern.getContext();

function getSettings() {
    const ctx = currentCtx();
    if (!ctx.extensionSettings[MCA_MODULE]) {
        ctx.extensionSettings[MCA_MODULE] = structuredClone(MCA_DEFAULT_SETTINGS);
    }
    const s = ctx.extensionSettings[MCA_MODULE];
    for (const [key, value] of Object.entries(MCA_DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(s, key)) s[key] = structuredClone(value);
    }
    if (!s.position) s.position = structuredClone(MCA_DEFAULT_SETTINGS.position);
    // v0.1.2 UI migration: keep the mascot visually at 46px and reset old oversized installs once.
    if (s._mcaUiVersion !== 5) {
        s.size = 46;
        s._mcaUiVersion = 5;
        try { ctx.saveSettingsDebounced(); } catch {}
    }
    return s;
}

function saveSettings() {
    try { currentCtx().saveSettingsDebounced(); } catch (e) { console.warn('[midnight-cat] settings save failed', e); }
}

async function loadDb() {
    mcaStorage = new ArchiveStorage({
        local: SillyTavern.libs.localforage,
        defaults: MCA_DEFAULT_FOLDERS,
        headers: () => {
            const getHeaders = currentCtx().getRequestHeaders;
            if (typeof getHeaders !== 'function') throw new Error('酒馆版本未提供文件请求接口，请更新酒馆');
            return getHeaders();
        },
        onStatus: status => { mcaStorageStatus = status; renderStorageStatus(); },
        id: uid,
    });
    mcaDb = await mcaStorage.load();
    return mcaDb;
}

async function saveDb() {
    mcaStorageBusy = true;
    try {
        const result = await mcaStorage.save(mcaDb);
        mcaDb = result.db;
        if (!result.durable) {
            toast('本机和酒馆都未能保存。请先点“备份 JSON”保留当前内容，再重试。', 'error');
        }
        return result.durable;
    } catch (e) {
        console.error('[midnight-cat] save failed', e);
        toast('未能保存，请先备份 JSON，再重试。', 'error');
        return false;
    } finally {
        mcaStorageBusy = false;
    }
}

function renderStorageStatus() {
    const el = document.getElementById('mca-storage-status');
    if (el) {
        el.textContent = mcaStorageStatus.text;
        el.dataset.mode = mcaStorageStatus.mode;
    }
}

function savedFeedback(text) {
    toast(mcaStorage?.remoteSaved ? text : '已暂存本机，尚未保存到酒馆。换地址前请点“重试同步”或“备份 JSON”。', mcaStorage?.remoteSaved ? 'success' : 'warning');
}

async function syncArchive() {
    if (mcaStorageBusy) return;
    mcaStorageBusy = true;
    try {
        mcaDb = await mcaStorage.sync();
        renderBookmarks();
    } finally { mcaStorageBusy = false; }
}

function userWord() {
    return mcaSettings?.callSister === false ? '你' : '姐姐';
}

function lineFor(event) {
    const pool = MCA_LINES[event] || MCA_LINES.open;
    const level = Number(mcaSettings?.attitude ?? 2);
    let filtered = pool;
    if (level === 0) filtered = pool.slice(0, 1);
    else if (level === 1) filtered = pool.slice(0, Math.max(2, Math.ceil(pool.length / 2)));
    const pick = filtered[Math.floor(Math.random() * filtered.length)] || filtered[0];
    return pick.map(x => x.replaceAll('{u}', userWord()));
}

function say(event, custom) {
    const bubble = document.getElementById('mca-speech');
    if (!bubble) return;
    const lines = custom || lineFor(event);
    bubble.innerHTML = `<b>${esc(lines[0] || '')}</b><span>${esc(lines[1] || '')}</span>`;
    bubble.classList.add('show');
    clearTimeout(bubble._hideTimer);
    bubble._hideTimer = setTimeout(() => bubble.classList.remove('show'), 3600);
}

function sayInSettings(event = 'idle', custom) {
    const card = document.getElementById('mca-settings-speech');
    if (!card) {
        say(event, custom);
        return;
    }
    const lines = custom || lineFor(event);
    const strong = card.querySelector('b');
    const text = card.querySelector('span');
    if (strong) strong.textContent = lines[0] || '';
    if (text) text.textContent = lines[1] || '';
    card.setAttribute('aria-hidden', 'false');
    card.classList.remove('show');
    void card.offsetWidth;
    card.classList.add('show');
}

function toast(message, kind = 'info') {
    if (globalThis.toastr?.[kind]) globalThis.toastr[kind](message, '午夜忧郁纯情185男高');
}

function formatTime(iso) {
    try { return new Date(iso).toLocaleString(); } catch { return iso || ''; }
}

function roundMap(chat) {
    const map = new Map();
    let round = 0;
    chat.forEach((msg, i) => {
        if (msg?.is_user) round += 1;
        map.set(i, round);
    });
    return map;
}

function roundLabel(chat, index) {
    const n = roundMap(chat).get(index) || 0;
    return n > 0 ? `第 ${n} 轮` : '开场';
}

function senderFor(msg, ctx) {
    return msg?.name || (msg?.is_user ? ctx.name1 : ctx.name2) || (msg?.is_user ? userWord() : '角色');
}

function activeSourceFor(mesId) {
    const ctx = currentCtx();
    const msg = ctx.chat?.[mesId];
    const char = ctx.characterId !== undefined ? ctx.characters?.[ctx.characterId] : null;
    return {
        chatId: ctx.chatId ?? null,
        characterId: ctx.characterId ?? null,
        groupId: ctx.groupId ?? null,
        characterAvatar: char?.avatar ?? null,
        characterName: ctx.name2 || char?.name || '角色',
        senderName: senderFor(msg, ctx),
        isUser: !!msg?.is_user,
        messageId: mesId,
        round: roundLabel(ctx.chat || [], mesId),
        sendDate: msg?.send_date || null,
    };
}

function contextSnapshot(mesId) {
    const ctx = currentCtx();
    const out = [];
    for (let i = Math.max(0, mesId - 1); i <= Math.min((ctx.chat?.length || 1) - 1, mesId + 1); i++) {
        const msg = ctx.chat[i];
        if (!msg) continue;
        out.push({
            messageId: i,
            senderName: senderFor(msg, ctx),
            isUser: !!msg.is_user,
            text: String(msg.mes || ''),
        });
    }
    return out;
}

function markText(text, query) {
    if (!query) return esc(text);
    const q = String(query);
    const lower = String(text).toLocaleLowerCase();
    const qLower = q.toLocaleLowerCase();
    let pos = 0;
    let cursor = 0;
    let html = '';
    while ((pos = lower.indexOf(qLower, cursor)) !== -1) {
        html += esc(String(text).slice(cursor, pos));
        html += `<mark>${esc(String(text).slice(pos, pos + q.length))}</mark>`;
        cursor = pos + q.length;
    }
    html += esc(String(text).slice(cursor));
    return html;
}

function previewAround(text, query, max = 220) {
    const raw = String(text || '').replace(/\s+/g, ' ').trim();
    if (raw.length <= max) return raw;
    const idx = raw.toLocaleLowerCase().indexOf(String(query || '').toLocaleLowerCase());
    const start = idx >= 0 ? Math.max(0, idx - Math.floor(max * 0.35)) : 0;
    const end = Math.min(raw.length, start + max);
    return `${start > 0 ? '…' : ''}${raw.slice(start, end)}${end < raw.length ? '…' : ''}`;
}

function panelHtml() {
    return `
    <div id="mca-panel" aria-hidden="true">
      <div class="mca-head">
        <div>
          <div class="mca-title">午夜忧郁纯情185男高</div>
          <div class="mca-subtitle">${esc(userWord())}的剧情回收站 · v${MCA_VERSION}</div>
        </div>
        <button class="mca-icon-btn" id="mca-close" title="关闭">×</button>
      </div>
      <div class="mca-tabs">
        <button data-tab="search" class="active">🔍 剧情搜索</button>
        <button data-tab="bookmarks">⭐ 剧情收藏</button>
        <button data-tab="plot" id="mca-plot-tab">🧭 剧情走向</button>
        <button data-tab="settings">⚙️ 设置</button>
      </div>
      <section class="mca-tab active" data-pane="search">
        <div class="mca-search-row">
          <input id="mca-search-input" type="search" placeholder="搜医院、告白、那封信……" autocomplete="off" />
          <button id="mca-search-go">搜</button>
        </div>
        <div class="mca-search-meta" id="mca-search-meta">只搜当前聊天，不调用 AI，不吃 token。</div>
        <div id="mca-search-results" class="mca-list"></div>
      </section>
      <section class="mca-tab" data-pane="bookmarks">
        <div id="mca-storage-status" class="mca-note mca-storage-status" role="status" aria-live="polite"></div>
        <div class="mca-bookmark-tools">
          <div id="mca-folder-chips" class="mca-chips"></div>
          <div class="mca-tool-row">
            <button id="mca-paste-bookmark">📋 粘贴文字收藏</button>
            <button id="mca-folder-new">＋ 新建分类</button>
            <button id="mca-folder-manage">管理分类</button>
            <button id="mca-random">🎲 随机回忆</button>
          </div>
          <div class="mca-tool-row">
            <button data-export="txt">导出 TXT</button>
            <button data-export="md">导出 Markdown</button>
            <button data-export="json">备份 JSON</button>
            <button id="mca-import-json">导入 JSON</button>
            <button id="mca-sync-archive">重试同步</button>
            <input type="file" id="mca-import-file" accept="application/json,.json" hidden />
          </div>
        </div>
        <div id="mca-bookmark-list" class="mca-list"></div>
      </section>
      <section class="mca-tab" data-pane="plot">
        <div class="mca-plot-note">只读取聊天里已经写出来的“剧情走向 / 后续走向 / 剧情发展”等标记，不调用 AI。姐姐不想看就在设置里关掉。</div>
        <div id="mca-plot-list" class="mca-list"></div>
      </section>
      <section class="mca-tab" data-pane="settings">
        <div class="mca-settings-grid">
          <label>猫猫大小 <span id="mca-size-val"></span><input id="mca-size" type="range" min="36" max="72" step="1"></label>
          <label>透明度 <span id="mca-opacity-val"></span><input id="mca-opacity" type="range" min="0.35" max="1" step="0.01"></label>
          <label>男高浓度 <span id="mca-attitude-val"></span><input id="mca-attitude" type="range" min="0" max="3" step="1"></label>
          <label class="mca-check"><input id="mca-call-sister" type="checkbox"> 叫我“姐姐”</label>
          <label class="mca-check"><input id="mca-snap" type="checkbox"> 拖动后自动贴边</label>
          <label class="mca-check"><input id="mca-float" type="checkbox"> 猫猫轻微呼吸浮动</label>
          <label class="mca-check"><input id="mca-show-plot" type="checkbox"> 显示“剧情走向”页（默认关闭）</label>
          <label class="mca-check"><input id="mca-cat-only-chat" type="checkbox"> 只在聊天界面显示猫猫</label>
        </div>
        <div class="mca-note">收藏保存到运行酒馆的手机中（你这里是 OPPO），华为浏览器留有暂存副本。同一套酒馆、同一个酒馆账户换 IP 后仍可读取。收藏页显示“已与酒馆核对”才表示已保存；断线时请先重试或备份 JSON。旧地址的收藏需在旧地址打开新版迁移，或导入以前的 JSON。</div>
        <div id="mca-settings-speech" class="mca-settings-speech" aria-live="polite" aria-hidden="true">
          <div class="mca-settings-speech-tag">🐈 185男高</div>
          <b></b>
          <span></span>
        </div>
        <button id="mca-test-line" class="mca-wide-btn">让男高说句话</button>
      </section>
    </div>`;
}

function shellHtml() {
    return `
      <button type="button" id="mca-cat" aria-label="午夜忧郁纯情185男高" title="午夜忧郁纯情185男高">
        <img src="${MCA_IMAGE_URL}" alt="cat" draggable="false">
      </button>
      <div id="mca-speech"><b></b><span></span></div>
      <div id="mca-tap-probe" aria-hidden="true">🐾 点击已收到</div>
      <button id="mca-selection-save">⭐ 收藏这段</button>
      <dialog id="mca-dialog" class="mca-dialog-shell">${panelHtml()}</dialog>
      <dialog id="mca-subdialog" class="mca-dialog-shell mca-subdialog-shell"></dialog>
    `;
}

function applyCatSettings() {
    const cat = document.getElementById('mca-cat');
    if (!cat) return;
    const visualSize = Number(mcaSettings.size || 46);
    // The transparent tap target is intentionally a little larger than the visible 46px mascot.
    // This makes Android taps reliable without making the cat itself look bigger.
    const hitSize = Math.max(54, visualSize + 8);
    cat.style.width = `${hitSize}px`;
    cat.style.height = `${hitSize}px`;
    cat.style.setProperty('--mca-visual-size', `${visualSize}px`);
    cat.style.opacity = String(mcaSettings.opacity ?? 0.94);
    cat.classList.toggle('floaty', !!mcaSettings.floatAnimation);
    const xFallback = Math.max(8, window.innerWidth - hitSize - 8);
    const x = Number.isFinite(Number(mcaSettings.position?.x)) ? Number(mcaSettings.position.x) : xFallback;
    const y = Number.isFinite(Number(mcaSettings.position?.y)) ? Number(mcaSettings.position.y) : 210;
    cat.style.left = `${Math.min(Math.max(2, x), Math.max(2, window.innerWidth - hitSize - 2))}px`;
    cat.style.top = `${Math.min(Math.max(52, y), Math.max(52, window.innerHeight - hitSize - 12))}px`;
}

function tapProbe(text = '🐾 点击已收到') {
    const probe = document.getElementById('mca-tap-probe');
    if (!probe) return;
    probe.textContent = text;
    probe.classList.add('show');
    clearTimeout(probe._hideTimer);
    probe._hideTimer = setTimeout(() => probe.classList.remove('show'), 1400);
}

function openPanel(tab = 'search') {
    const dialog = document.getElementById('mca-dialog');
    const cat = document.getElementById('mca-cat');
    if (!dialog) {
        tapProbe('🐾 收到点击，但找不到面板');
        return;
    }
    try {
        if (!dialog.open) dialog.showModal();
        cat?.classList.add('panel-open');
        switchTab(tab);
        say('open');
        tapProbe('🐾 点击已收到 · 面板已打开');
    } catch (e) {
        console.error('[midnight-cat] dialog show failed', e);
        toast('面板打开失败。姐姐，把这个报错留给我修。', 'error');
    }
}

function closePanel() {
    const dialog = document.getElementById('mca-dialog');
    if (dialog?.open) dialog.close();
    document.getElementById('mca-cat')?.classList.remove('panel-open');
}

function togglePanel(tab = 'search') {
    const dialog = document.getElementById('mca-dialog');
    if (dialog?.open) closePanel();
    else openPanel(tab);
}

function switchTab(tab) {
    if (tab === 'plot' && !mcaSettings.showPlotDirection) tab = 'search';
    document.querySelectorAll('#mca-panel .mca-tabs button').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    document.querySelectorAll('#mca-panel .mca-tab').forEach(pane => pane.classList.toggle('active', pane.dataset.pane === tab));
    if (tab === 'bookmarks') renderBookmarks();
    if (tab === 'plot') renderPlotDirection();
    if (tab === 'settings') renderSettings();
}

function cleanMessageText(text = '') {
    return String(text)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function plotSnippet(text = '') {
    const clean = cleanMessageText(text);
    const re = /(?:剧情走向|后续走向|后续剧情|剧情发展|走向预测|plot\s*direction|plot\s*development)\s*[:：—\-]?/i;
    const m = clean.match(re);
    if (!m) return null;
    const start = m.index ?? 0;
    let rest = clean.slice(start, start + 900);
    const next = rest.slice(m[0].length).search(/\n\s*(?:#{1,6}\s+|【[^】]{2,20}】|(?:人物状态|角色状态|世界观|备注|总结|选项|choice)\s*[:：])/i);
    if (next > 20) rest = rest.slice(0, m[0].length + next);
    return rest.trim();
}

function renderPlotDirection() {
    const list = document.getElementById('mca-plot-list');
    if (!list) return;
    const ctx = currentCtx();
    const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
    const rounds = roundMap(chat);
    const hits = [];
    chat.forEach((msg, i) => {
        const snippet = plotSnippet(msg?.mes || '');
        if (snippet) hits.push({ i, msg, snippet, round: rounds.get(i) || 0 });
    });
    if (!hits.length) {
        list.innerHTML = `<div class="mca-empty">这段聊天里没检测到明确写着“剧情走向 / 后续走向 / 剧情发展”的内容。插件不会自己调用 AI 编一个出来。</div>`;
        return;
    }
    list.innerHTML = hits.slice().reverse().map(({ i, msg, snippet, round }) => {
        const who = senderFor(msg, ctx);
        const label = round > 0 ? `第 ${round} 轮` : '开场';
        return `<button class="mca-result-card mca-plot-card" data-message-id="${i}">
          <div class="mca-card-meta"><b>${esc(label)}</b><span>${esc(who)}</span><small>#${i}</small></div>
          <div class="mca-card-text">${esc(snippet)}</div>
        </button>`;
    }).join('');
}

function updatePlotVisibility() {
    const btn = document.getElementById('mca-plot-tab');
    if (btn) btn.hidden = !mcaSettings.showPlotDirection;
    const tabs = document.querySelector('#mca-panel .mca-tabs');
    tabs?.classList.toggle('has-plot', !!mcaSettings.showPlotDirection);
    if (!mcaSettings.showPlotDirection && document.querySelector('.mca-tab[data-pane="plot"]')?.classList.contains('active')) switchTab('search');
}

function renderSettings() {
    const attNames = ['安静', '傲娇', '坏狗', '欠揍'];
    const size = document.getElementById('mca-size');
    const opacity = document.getElementById('mca-opacity');
    const attitude = document.getElementById('mca-attitude');
    if (!size) return;
    size.value = String(mcaSettings.size);
    opacity.value = String(mcaSettings.opacity);
    attitude.value = String(mcaSettings.attitude);
    document.getElementById('mca-size-val').textContent = `${mcaSettings.size}px`;
    document.getElementById('mca-opacity-val').textContent = `${Math.round(mcaSettings.opacity * 100)}%`;
    document.getElementById('mca-attitude-val').textContent = attNames[mcaSettings.attitude] || '坏狗';
    document.getElementById('mca-call-sister').checked = !!mcaSettings.callSister;
    document.getElementById('mca-snap').checked = !!mcaSettings.snap;
    document.getElementById('mca-float').checked = !!mcaSettings.floatAnimation;
    document.getElementById('mca-show-plot').checked = !!mcaSettings.showPlotDirection;
    document.getElementById('mca-cat-only-chat').checked = !!mcaSettings.catOnlyInChat;
}

function doSearch() {
    const input = document.getElementById('mca-search-input');
    const resultsEl = document.getElementById('mca-search-results');
    const meta = document.getElementById('mca-search-meta');
    if (!input || !resultsEl) return;
    const query = input.value.trim();
    if (!query) {
        resultsEl.innerHTML = `<div class="mca-empty">输个关键词。别盯着我看，我也不能读心。</div>`;
        meta.textContent = '只搜当前聊天，不调用 AI，不吃 token。';
        return;
    }
    const ctx = currentCtx();
    const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
    const rounds = roundMap(chat);
    const q = query.toLocaleLowerCase();
    const matches = [];
    chat.forEach((msg, i) => {
        const text = String(msg?.mes || '');
        if (text.toLocaleLowerCase().includes(q)) {
            matches.push({ i, msg, text, round: rounds.get(i) || 0 });
        }
    });
    meta.textContent = `当前聊天共 ${chat.length} 条消息 · 找到 ${matches.length} 条`;
    if (!matches.length) {
        resultsEl.innerHTML = `<div class="mca-empty">什么都没翻出来。换个词试试。</div>`;
        say('none');
        return;
    }
    say(matches.length >= 6 ? 'many' : 'found');
    resultsEl.innerHTML = matches.map(({ i, msg, text, round }) => {
        const preview = previewAround(text, query);
        const who = senderFor(msg, ctx);
        const label = round > 0 ? `第 ${round} 轮` : '开场';
        return `<button class="mca-result-card" data-message-id="${i}">
          <div class="mca-card-meta"><b>${esc(label)}</b><span>${esc(who)}</span><small>#${i}</small></div>
          <div class="mca-card-text">${markText(preview, query)}</div>
        </button>`;
    }).join('');
}

async function ensureMessageRendered(messageId) {
    let el = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    let guard = 0;
    while (!el && document.getElementById('show_more_messages') && guard < 80) {
        document.getElementById('show_more_messages')?.click();
        await sleep(110);
        el = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        guard++;
    }
    return el;
}

async function jumpToMessage(messageId) {
    const id = Number(messageId);
    if (!Number.isInteger(id) || id < 0) return false;
    const el = await ensureMessageRendered(id);
    if (!el) {
        toast('没能把那条消息加载出来。姐姐，这次真不是我装死。', 'warning');
        say('error');
        return false;
    }
    closePanel();
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('mca-jump-highlight');
    void el.offsetWidth;
    el.classList.add('mca-jump-highlight');
    setTimeout(() => el.classList.remove('mca-jump-highlight'), 2600);
    say('jump');
    return true;
}

function getMessagePayload(mesId, selectedText = null) {
    const ctx = currentCtx();
    const msg = ctx.chat?.[mesId];
    if (!msg) return null;
    const full = String(msg.mes || '');
    return {
        text: selectedText?.trim() || full,
        fullMessage: full,
        isExcerpt: !!selectedText?.trim() && selectedText.trim() !== full.trim(),
        source: activeSourceFor(mesId),
        context: contextSnapshot(mesId),
    };
}

function pastedTextPayload(rawText) {
    const text = String(rawText || '').replace(/\r\n?/g, '\n').trim().slice(0, 30000);
    if (!text) return null;
    const ctx = currentCtx();
    const char = ctx.characterId !== undefined ? ctx.characters?.[ctx.characterId] : null;
    return {
        text,
        fullMessage: text,
        isExcerpt: false,
        source: {
            manual: true,
            chatId: ctx.chatId ?? null,
            characterId: ctx.characterId ?? null,
            groupId: ctx.groupId ?? null,
            characterAvatar: char?.avatar ?? null,
            characterName: ctx.name2 || char?.name || '当前角色',
            senderName: ctx.name2 || char?.name || '正文摘录',
            isUser: false,
            messageId: null,
            round: '手动收藏',
            sendDate: null,
        },
        context: [],
    };
}

function openPasteCollector() {
    showModal(`
      <div class="mca-modal-card">
        <div class="mca-modal-head"><b>粘贴文字收藏</b><button data-modal-close>×</button></div>
        <label>复制的正文
          <textarea id="mca-paste-text" maxlength="30000" placeholder="先在正文里复制喜欢的一段，再长按这里选择“粘贴”……"></textarea>
        </label>
        <div class="mca-paste-note">这会保存一份独立文字副本。以后原消息或整个聊天被删除，收藏内容仍然保留；只是不能再跳回原位置。</div>
        <div class="mca-modal-actions">
          <button id="mca-read-clipboard" type="button">读取剪贴板</button>
          <button data-modal-close type="button">取消</button>
          <button id="mca-paste-next" class="primary" type="button">选择分类</button>
        </div>
      </div>
    `);
    const input = document.getElementById('mca-paste-text');
    setTimeout(() => input?.focus(), 80);
    document.getElementById('mca-read-clipboard')?.addEventListener('click', async () => {
        try {
            const value = await globalThis.navigator?.clipboard?.readText?.();
            if (!String(value || '').trim()) throw new Error('empty clipboard');
            input.value = String(value).slice(0, 30000);
            toast('剪贴板文字已经放进来了。', 'success');
        } catch (_) {
            input?.focus();
            toast('浏览器没允许自动读取。请长按输入框，选择“粘贴”。', 'info');
        }
    });
    document.getElementById('mca-paste-next')?.addEventListener('click', () => {
        const payload = pastedTextPayload(input?.value);
        if (!payload) {
            toast('还没有文字。先复制正文，再粘贴到输入框里。', 'warning');
            input?.focus();
            return;
        }
        openSaveModal(payload);
    });
}

function openSaveModal(payload, existing = null) {
    if (!payload && !existing) return;
    const item = existing ? structuredClone(existing) : {
        id: uid(),
        text: payload.text,
        fullMessage: payload.fullMessage,
        isExcerpt: payload.isExcerpt,
        folderId: mcaDb.folders[0]?.id || 'quotes',
        tags: [],
        note: '',
        createdAt: nowIso(),
        source: payload.source,
        context: payload.context,
    };
    const options = mcaDb.folders.map(f => `<option value="${esc(f.id)}" ${f.id === item.folderId ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
    showModal(`
      <div class="mca-modal-card">
        <div class="mca-modal-head"><b>${existing ? '编辑收藏' : '收藏剧情'}</b><button data-modal-close>×</button></div>
        <div class="mca-save-preview">${esc(item.text)}</div>
        <label>收藏夹<select id="mca-save-folder">${options}</select></label>
        <label>标签 <input id="mca-save-tags" value="${esc((item.tags || []).join(', '))}" placeholder="告白, 医院, 雨夜"></label>
        <label>备注 <textarea id="mca-save-note" placeholder="比如：第一次承认喜欢我">${esc(item.note || '')}</textarea></label>
        <div class="mca-modal-actions"><button data-modal-close>取消</button><button id="mca-save-confirm" class="primary">${existing ? '保存修改' : '藏起来'}</button></div>
      </div>
    `);
    document.getElementById('mca-save-confirm')?.addEventListener('click', async () => {
        item.folderId = document.getElementById('mca-save-folder').value;
        item.tags = document.getElementById('mca-save-tags').value.split(/[,，]/).map(x => x.trim()).filter(Boolean).slice(0, 12);
        item.note = document.getElementById('mca-save-note').value.trim();
        const idx = mcaDb.items.findIndex(x => x.id === item.id);
        if (idx >= 0) mcaDb.items[idx] = item;
        else mcaDb.items.unshift(item);
        if (!await saveDb()) return;
        hideModal();
        renderBookmarks();
        say(item.text.length > 500 ? 'longSaved' : 'saved');
        savedFeedback(existing ? '已保存到酒馆。' : '已收藏到酒馆。');
    });
}

function folderName(id) {
    return mcaDb.folders.find(f => f.id === id)?.name || '未分类';
}

let activeFolder = 'all';
function renderBookmarks() {
    if (!mcaDb) return;
    const chips = document.getElementById('mca-folder-chips');
    const list = document.getElementById('mca-bookmark-list');
    if (!chips || !list) return;
    const counts = new Map();
    mcaDb.items.forEach(x => counts.set(x.folderId, (counts.get(x.folderId) || 0) + 1));
    chips.innerHTML = `<button data-folder="all" class="${activeFolder === 'all' ? 'active' : ''}">全部 <small>${mcaDb.items.length}</small></button>` +
        mcaDb.folders.map(f => `<button data-folder="${esc(f.id)}" class="${activeFolder === f.id ? 'active' : ''}">${esc(f.name)} <small>${counts.get(f.id) || 0}</small></button>`).join('');
    const items = activeFolder === 'all' ? mcaDb.items : mcaDb.items.filter(x => x.folderId === activeFolder);
    if (!items.length) {
        list.innerHTML = `<div class="mca-empty">这里还是空的。可以点消息操作栏里的 🔖、长按选中文字后点“⭐ 收藏这段”，也可以先复制正文，再点上面的“📋 粘贴文字收藏”。</div>`;
        return;
    }
    list.innerHTML = items.map(item => {
        const source = item.source || {};
        const tags = (item.tags || []).map(t => `<span>#${esc(t)}</span>`).join('');
        const hasOrigin = source.manual !== true && source.messageId !== null && source.messageId !== undefined && Number.isInteger(Number(source.messageId));
        return `<article class="mca-bookmark-card" data-bookmark-id="${esc(item.id)}">
          <div class="mca-card-meta"><b>${esc(folderName(item.folderId))}</b><span>${esc(source.round || '')} · ${esc(source.senderName || '')}</span><small>${esc(formatTime(item.createdAt))}</small></div>
          <div class="mca-card-text">${esc(item.text)}</div>
          ${item.note ? `<div class="mca-note-line">📝 ${esc(item.note)}</div>` : ''}
          ${tags ? `<div class="mca-tags">${tags}</div>` : ''}
          <div class="mca-card-actions">
            ${hasOrigin ? '<button data-act="jump">↩ 原剧情</button><button data-act="context">上下文</button>' : '<span class="mca-origin-copy">独立文字副本</span>'}
            <button data-act="edit">编辑</button>
            <button data-act="delete" class="danger">删除</button>
          </div>
        </article>`;
    }).join('');
}

function showContextModal(item) {
    const rows = (item.context || []).map(x => `<div class="mca-context-row ${x.messageId === item.source?.messageId ? 'focus' : ''}"><b>${esc(x.senderName)}</b><p>${esc(x.text)}</p></div>`).join('');
    showModal(`<div class="mca-modal-card"><div class="mca-modal-head"><b>收藏上下文</b><button data-modal-close>×</button></div><div class="mca-context-list">${rows || '<div class="mca-empty">这条老收藏没有上下文快照。</div>'}</div><div class="mca-modal-actions"><button data-modal-close>关掉</button></div></div>`);
}

async function jumpToBookmark(item) {
    const ctx = currentCtx();
    const src = item.source || {};
    if (String(src.chatId ?? '') === String(ctx.chatId ?? '')) {
        return jumpToMessage(src.messageId);
    }
    if (src.groupId) {
        toast('这条在另一个群聊里。第一版我还不会跨群瞬移，但收藏正文没丢。', 'warning');
        say('error');
        return false;
    }
    if (!src.characterAvatar || !src.chatId) {
        toast('原聊天定位信息不完整。正文还在，原路返回就先欠着。', 'warning');
        return false;
    }
    try {
        const fresh = currentCtx();
        const index = fresh.characters?.findIndex(c => c?.avatar === src.characterAvatar);
        if (index < 0) throw new Error('character missing');
        if (String(fresh.characterId) !== String(index)) {
            await fresh.selectCharacterById(index, { switchMenu: false });
            await sleep(180);
        }
        const ctx2 = currentCtx();
        if (String(ctx2.chatId ?? '') !== String(src.chatId)) {
            await ctx2.openCharacterChat(src.chatId);
            await sleep(180);
        }
        return jumpToMessage(src.messageId);
    } catch (e) {
        console.warn('[midnight-cat] cross chat jump failed', e);
        toast('原聊天可能被删了、改名了，或者角色已经不在。收藏副本还好好的。', 'warning');
        say('error');
        return false;
    }
}

function showModal(html) {
    const dialog = document.getElementById('mca-subdialog');
    if (!dialog) return;
    if (dialog.open) dialog.close();
    dialog.innerHTML = html;
    dialog.querySelectorAll('[data-modal-close]').forEach(btn => btn.addEventListener('click', hideModal));
    dialog.addEventListener('click', mcaSubdialogBackdropOnce, { once: true });
    try { dialog.showModal(); } catch (e) { console.error('[midnight-cat] subdialog show failed', e); }
}
function mcaSubdialogBackdropOnce(e) {
    const dialog = document.getElementById('mca-subdialog');
    if (!dialog || e.target !== dialog) return;
    hideModal();
}
function hideModal() {
    const dialog = document.getElementById('mca-subdialog');
    if (!dialog) return;
    if (dialog.open) dialog.close();
    dialog.innerHTML = '';
}

function manageFolders() {
    const rows = mcaDb.folders.map(f => `<div class="mca-folder-row" data-folder-id="${esc(f.id)}"><span>${esc(f.name)}</span><div><button data-folder-action="rename">改名</button><button data-folder-action="delete" class="danger">删除</button></div></div>`).join('');
    showModal(`<div class="mca-modal-card"><div class="mca-modal-head"><b>管理收藏夹</b><button data-modal-close>×</button></div><div class="mca-folder-list">${rows}</div><div class="mca-modal-actions"><button id="mca-modal-new-folder">＋ 新建</button><button data-modal-close>好了</button></div></div>`);
    document.getElementById('mca-modal-new-folder')?.addEventListener('click', () => newFolder());
}

async function newFolder() {
    showModal(`<div class="mca-modal-card"><div class="mca-modal-head"><b>新建收藏夹</b><button data-modal-close>×</button></div><label>名字 <input id="mca-new-folder-name" maxlength="40" placeholder="比如：郑时谦名场面"></label><div class="mca-modal-actions"><button data-modal-close>取消</button><button id="mca-new-folder-confirm" class="primary">新建</button></div></div>`);
    setTimeout(() => document.getElementById('mca-new-folder-name')?.focus(), 80);
    document.getElementById('mca-new-folder-confirm')?.addEventListener('click', async () => {
        const name = document.getElementById('mca-new-folder-name')?.value?.trim();
        if (!name) return;
        mcaDb.folders.push({ id: `folder-${uid()}`, name: name.slice(0, 40) });
        if (!await saveDb()) return;
        hideModal();
        renderBookmarks();
        savedFeedback('新分类已保存到酒馆。');
    });
}

async function renameFolder(id) {
    const f = mcaDb.folders.find(x => x.id === id); if (!f) return;
    showModal(`<div class="mca-modal-card"><div class="mca-modal-head"><b>分类改名</b><button data-modal-close>×</button></div><label>名字 <input id="mca-rename-folder-name" maxlength="40" value="${esc(f.name)}"></label><div class="mca-modal-actions"><button data-modal-close>取消</button><button id="mca-rename-folder-confirm" class="primary">保存</button></div></div>`);
    document.getElementById('mca-rename-folder-confirm')?.addEventListener('click', async () => {
        const name = document.getElementById('mca-rename-folder-name')?.value?.trim();
        if (!name) return;
        f.name = name.slice(0, 40);
        if (!await saveDb()) return;
        hideModal(); renderBookmarks(); savedFeedback('分类修改已保存到酒馆。');
    });
}

async function deleteFolder(id) {
    const f = mcaDb.folders.find(x => x.id === id); if (!f) return;
    if (!window.confirm(`删除收藏夹“${f.name}”？里面的收藏会移到“喜欢的台词”。`)) return;
    const fallback = mcaDb.folders.find(x => x.id !== id)?.id || 'quotes';
    mcaDb.items.forEach(item => { if (item.folderId === id) item.folderId = fallback; });
    mcaDb.folders = mcaDb.folders.filter(x => x.id !== id);
    if (activeFolder === id) activeFolder = 'all';
    if (!await saveDb()) return;
    renderBookmarks();
    savedFeedback('分类删除已保存到酒馆。');
}

function downloadFile(filename, content, type = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportDb(format) {
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
        downloadFile(`午夜忧郁纯情185男高-剧情收藏-${stamp}.json`, JSON.stringify({ app: MCA_MODULE, version: 2, exportedAt: nowIso(), db: mcaDb }, null, 2), 'application/json;charset=utf-8');
    } else if (format === 'txt') {
        const text = mcaDb.items.map((item, i) => {
            const s = item.source || {};
            return `${i + 1}. [${folderName(item.folderId)}] ${s.round || ''} · ${s.senderName || ''}\n${item.note ? `备注：${item.note}\n` : ''}${item.tags?.length ? `标签：${item.tags.join(' / ')}\n` : ''}${item.text}\n\n---\n`;
        }).join('\n');
        downloadFile(`午夜忧郁纯情185男高-剧情收藏-${stamp}.txt`, text);
    } else {
        const chunks = [`# 午夜忧郁纯情185男高 · 剧情收藏\n\n导出时间：${formatTime(nowIso())}\n`];
        for (const folder of mcaDb.folders) {
            const items = mcaDb.items.filter(x => x.folderId === folder.id);
            if (!items.length) continue;
            chunks.push(`\n## ${folder.name}\n`);
            items.forEach(item => {
                const s = item.source || {};
                chunks.push(`\n### ${s.round || ''} · ${s.senderName || ''}\n\n${item.note ? `> 备注：${item.note}\n\n` : ''}${item.tags?.length ? `标签：${item.tags.map(t => `#${t}`).join(' ')}\n\n` : ''}${item.text}\n`);
            });
        }
        downloadFile(`午夜忧郁纯情185男高-剧情收藏-${stamp}.md`, chunks.join('\n'), 'text/markdown;charset=utf-8');
    }
    say('exported');
}

async function importJson(file) {
    try {
        const parsed = JSON.parse(await file.text());
        const incoming = normalizeDb(parsed?.db || parsed);
        // An explicit JSON import may restore deliberately deleted records under new ids.
        const folderIds = new Map();
        for (const folder of incoming.folders) {
            if (mcaDb.deletedFolders?.includes(folder.id)) {
                const oldId = folder.id;
                folder.id = `folder-${uid()}`;
                folderIds.set(oldId, folder.id);
            }
        }
        for (const item of incoming.items) {
            if (mcaDb.deletedItems?.includes(item.id)) item.id = uid();
            if (folderIds.has(item.folderId)) item.folderId = folderIds.get(item.folderId);
        }
        const replace = window.confirm('按“确定”会替换当前收藏库；按“取消”则合并导入。');
        if (replace) {
            mcaDb = { version: 2, folders: incoming.folders, items: incoming.items };
        } else {
            const folderMap = new Map(mcaDb.folders.map(f => [f.id, f]));
            incoming.folders.forEach(f => { if (!folderMap.has(f.id)) { mcaDb.folders.push(f); folderMap.set(f.id, f); } });
            const existingIds = new Set(mcaDb.items.map(x => x.id));
            incoming.items.forEach(item => {
                if (existingIds.has(item.id)) item.id = uid();
                mcaDb.items.push(item);
                existingIds.add(item.id);
            });
        }
        if (!await saveDb()) return;
        renderBookmarks(); savedFeedback('已导入并保存到酒馆。'); say('saved');
    } catch (e) {
        console.error('[midnight-cat] import failed', e); toast('这个 JSON 我没认出来，可能不是本插件的备份。', 'error'); say('error');
    }
}

function randomBookmark() {
    if (!mcaDb.items.length) { toast('收藏库还是空的，随机个空气给姐姐吗？', 'info'); return; }
    const item = mcaDb.items[Math.floor(Math.random() * mcaDb.items.length)];
    const canJump = item.source?.manual !== true && item.source?.messageId !== null && item.source?.messageId !== undefined;
    showModal(`<div class="mca-modal-card"><div class="mca-modal-head"><b>🎲 随机回忆</b><button data-modal-close>×</button></div><div class="mca-random-title">${esc(item.source?.round || '')} · ${esc(item.source?.senderName || '')}</div><div class="mca-save-preview big">${esc(item.text)}</div><div class="mca-modal-actions"><button data-modal-close>收起来</button>${canJump ? '<button id="mca-random-jump" class="primary">回原剧情</button>' : ''}</div></div>`);
    document.getElementById('mca-random-jump')?.addEventListener('click', () => { hideModal(); jumpToBookmark(item); });
}

function injectMessageButtons(root = document) {
    root.querySelectorAll?.('#chat .mes .extraMesButtons').forEach(box => {
        if (box.querySelector('.mca-message-bookmark')) return;
        const btn = document.createElement('div');
        btn.className = 'mes_button mca-message-bookmark';
        btn.textContent = '🔖';
        btn.title = '收藏到“午夜忧郁纯情185男高”';
        btn.setAttribute('aria-label', '午夜小猫收藏');
        btn.addEventListener('click', e => {
            e.preventDefault(); e.stopPropagation();
            const mes = btn.closest('.mes');
            const id = Number(mes?.getAttribute('mesid'));
            const payload = getMessagePayload(id);
            if (payload) {
                tapProbe('🔖 收藏窗口');
                openSaveModal(payload);
            }
        }, true);
        box.appendChild(btn);
    });
}

function showSelectionButton() {
    const sel = window.getSelection?.();
    const btn = document.getElementById('mca-selection-save');
    if (!btn || !sel || sel.rangeCount === 0 || sel.isCollapsed) { btn?.classList.remove('show'); return; }
    const text = sel.toString().trim();
    if (!text) { btn.classList.remove('show'); return; }
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    const mesText = node?.closest?.('#chat .mes .mes_text');
    const mes = mesText?.closest?.('.mes');
    if (!mes) { btn.classList.remove('show'); return; }
    const mesId = Number(mes.getAttribute('mesid'));
    if (!Number.isInteger(mesId)) return;
    const rect = range.getBoundingClientRect();
    mcaSelectionPayload = getMessagePayload(mesId, text);
    btn.style.left = `${Math.min(window.innerWidth - 120, Math.max(8, rect.left + rect.width / 2 - 55))}px`;
    btn.style.top = `${Math.max(56, rect.top - 44)}px`;
    btn.classList.add('show');
}

function bindDrag() {
    const cat = document.getElementById('mca-cat');
    if (!cat) return;

    let active = false;
    let moved = false;
    let sx = 0, sy = 0, ox = 0, oy = 0;
    let activePointerId = null;
    let lastOpenAt = 0;
    const DRAG_THRESHOLD = 18;

    const openFromTap = () => {
        const now = Date.now();
        if (now - lastOpenAt < 350) return;
        lastOpenAt = now;
        cat.classList.add('tap-pop');
        setTimeout(() => cat.classList.remove('tap-pop'), 180);
        openPanel('search');
    };

    const finish = (clientX, clientY, cancelled = false) => {
        if (!active) return;
        active = false;
        cat.classList.remove('dragging');

        const r0 = cat.getBoundingClientRect();
        if (moved && mcaSettings.snap) {
            const x = r0.left + r0.width / 2 < window.innerWidth / 2 ? 4 : window.innerWidth - r0.width - 4;
            cat.style.left = `${x}px`;
        }
        const r = cat.getBoundingClientRect();
        mcaSettings.position = { x: Math.round(r.left), y: Math.round(r.top) };
        saveSettings();

        if (!moved && !cancelled) openFromTap();
        moved = false;
        activePointerId = null;
    };

    // Pointer events are preferred, but we do NOT rely on pointer capture: some Android WebViews
    // are unreliable when a fixed element uses pointer capture inside a complex page.
    cat.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        active = true;
        moved = false;
        activePointerId = e.pointerId;
        sx = e.clientX;
        sy = e.clientY;
        const r = cat.getBoundingClientRect();
        ox = r.left;
        oy = r.top;
        cat.classList.add('dragging');
    }, { passive: true });

    const onPointerMove = e => {
        if (!active || (activePointerId !== null && e.pointerId !== activePointerId)) return;
        const dx = e.clientX - sx;
        const dy = e.clientY - sy;
        if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        moved = true;
        const x = Math.min(Math.max(2, ox + dx), window.innerWidth - cat.offsetWidth - 2);
        const y = Math.min(Math.max(52, oy + dy), window.innerHeight - cat.offsetHeight - 12);
        cat.style.left = `${x}px`;
        cat.style.top = `${y}px`;
        if (e.cancelable) e.preventDefault();
    };

    const onPointerUp = e => {
        if (!active || (activePointerId !== null && e.pointerId !== activePointerId)) return;
        finish(e.clientX, e.clientY, false);
    };
    const onPointerCancel = e => {
        if (!active || (activePointerId !== null && e.pointerId !== activePointerId)) return;
        finish(e.clientX, e.clientY, true);
    };

    document.addEventListener('pointermove', onPointerMove, { passive: false });
    document.addEventListener('pointerup', onPointerUp, { passive: true });
    document.addEventListener('pointercancel', onPointerCancel, { passive: true });

    // Extra click fallback: if the WebView never delivered a matching pointerup, a normal click
    // still opens the panel. stopPropagation prevents theme/global handlers from swallowing it.
    cat.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (!active && !moved) openFromTap();
    }, true);

    // Legacy touch fallback for older Android System WebView builds.
    cat.addEventListener('touchend', e => {
        if (!active && !moved) {
            e.preventDefault();
            e.stopPropagation();
            openFromTap();
        }
    }, { passive: false, capture: true });

    // Keyboard accessibility / desktop debugging.
    cat.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openFromTap();
        }
    });
}

function bindGlobalTapFallback() {
    const cat = document.getElementById('mca-cat');
    if (!cat) return;

    let down = null;
    let lastHandled = 0;
    const inside = (x, y, pad = 12) => {
        const r = cat.getBoundingClientRect();
        return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
    };
    const fallbackSuppressed = (target = null) => {
        if (document.getElementById('wmb-root') && document.body.classList.contains('wmb-hide-originals')) return true;
        if (Date.now() - mcaLoadedAt < 2500) return true;
        if (target?.closest?.('#choco-player-panel, #fanqie-study-timer-root, #mochi-postgrad-english-root, #wmb-root, #mca-dialog')) return true;
        const style = getComputedStyle(cat);
        const rect = cat.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none' || rect.width <= 0 || rect.height <= 0) return true;
        return false;
    };
    const handle = (x, y, source, target = null) => {
        if (fallbackSuppressed(target)) return;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !inside(x, y, 14)) return;
        const now = Date.now();
        if (now - lastHandled < 450) return;
        lastHandled = now;
        console.info(`[midnight-cat] global tap fallback: ${source}`, { x, y });
        openPanel('search');
    };

    // Capture on document, not just on the cat. Even if a preset lays a transparent element
    // over the mascot, the event still reaches document capture and we can identify it by coordinates.
    document.addEventListener('pointerdown', e => {
        if (fallbackSuppressed(e.target)) { down = null; return; }
        if (!inside(e.clientX, e.clientY, 14)) return;
        down = { x: e.clientX, y: e.clientY, id: e.pointerId, t: Date.now(), target: e.target };
    }, { capture: true, passive: true });
    document.addEventListener('pointerup', e => {
        if (!down || (down.id != null && e.pointerId !== down.id)) return;
        const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        const age = Date.now() - down.t;
        const start = down;
        down = null;
        if (dist <= 24 && age <= 1200) handle(e.clientX, e.clientY, 'pointer', e.target);
        else if (inside(start.x, start.y, 14) && dist <= 24) handle(start.x, start.y, 'pointer-start', start.target);
    }, { capture: true, passive: true });

    document.addEventListener('touchend', e => {
        const t = e.changedTouches?.[0];
        if (t) handle(t.clientX, t.clientY, 'touch', e.target);
    }, { capture: true, passive: true });

    document.addEventListener('click', e => {
        handle(e.clientX, e.clientY, 'click', e.target);
    }, { capture: true, passive: true });
}

function isVisibleElement(el) {
    if (!el) return false;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
}

function updateCatVisibility() {
    const cat = document.getElementById('mca-cat');
    if (!cat) return;
    if (!mcaSettings.catOnlyInChat) {
        cat.style.removeProperty('visibility');
        cat.style.removeProperty('pointer-events');
        return;
    }
    const chat = document.getElementById('chat');
    const show = isVisibleElement(chat);
    cat.style.visibility = show ? 'visible' : 'hidden';
    cat.style.pointerEvents = show ? 'auto' : 'none';
}

function bindUi() {
    document.getElementById('mca-close')?.addEventListener('click', closePanel);
    document.querySelectorAll('#mca-panel .mca-tabs button').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
    document.getElementById('mca-search-go')?.addEventListener('click', () => { say('search'); doSearch(); });
    document.getElementById('mca-search-input')?.addEventListener('input', () => {
        clearTimeout(mcaSearchTimer); mcaSearchTimer = setTimeout(doSearch, 120);
    });
    document.getElementById('mca-search-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') { say('search'); doSearch(); } });
    document.getElementById('mca-search-results')?.addEventListener('click', e => {
        const card = e.target.closest('.mca-result-card'); if (card) jumpToMessage(card.dataset.messageId);
    });
    document.getElementById('mca-plot-list')?.addEventListener('click', e => {
        const card = e.target.closest('.mca-plot-card'); if (card) jumpToMessage(card.dataset.messageId);
    });
    document.getElementById('mca-folder-chips')?.addEventListener('click', e => {
        const btn = e.target.closest('[data-folder]'); if (!btn) return; activeFolder = btn.dataset.folder; renderBookmarks();
    });
    document.getElementById('mca-folder-new')?.addEventListener('click', newFolder);
    document.getElementById('mca-folder-manage')?.addEventListener('click', manageFolders);
    document.getElementById('mca-random')?.addEventListener('click', randomBookmark);
    document.getElementById('mca-paste-bookmark')?.addEventListener('click', openPasteCollector);
    document.querySelectorAll('[data-export]').forEach(btn => btn.addEventListener('click', () => exportDb(btn.dataset.export)));
    document.getElementById('mca-import-json')?.addEventListener('click', () => document.getElementById('mca-import-file')?.click());
    document.getElementById('mca-sync-archive')?.addEventListener('click', syncArchive);
    document.getElementById('mca-import-file')?.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ''; });
    document.getElementById('mca-bookmark-list')?.addEventListener('click', async e => {
        const card = e.target.closest('.mca-bookmark-card'); const btn = e.target.closest('[data-act]'); if (!card || !btn) return;
        const item = mcaDb.items.find(x => x.id === card.dataset.bookmarkId); if (!item) return;
        if (btn.dataset.act === 'jump') jumpToBookmark(item);
        if (btn.dataset.act === 'context') showContextModal(item);
        if (btn.dataset.act === 'edit') openSaveModal(null, item);
        if (btn.dataset.act === 'delete') {
            if (!window.confirm('真删？删掉以后这条收藏副本就没了。')) return;
            mcaDb.items = mcaDb.items.filter(x => x.id !== item.id);
            if (!await saveDb()) return;
            renderBookmarks(); say('deleted'); savedFeedback('删除已保存到酒馆。');
        }
    });
    document.getElementById('mca-subdialog')?.addEventListener('click', async e => {
        const row = e.target.closest('.mca-folder-row'); const act = e.target.closest('[data-folder-action]'); if (!row || !act) return;
        e.preventDefault(); e.stopPropagation();
        if (act.dataset.folderAction === 'rename') renameFolder(row.dataset.folderId);
        if (act.dataset.folderAction === 'delete') { await deleteFolder(row.dataset.folderId); manageFolders(); }
    });
    document.getElementById('mca-selection-save')?.addEventListener('pointerdown', e => e.stopPropagation());
    document.getElementById('mca-selection-save')?.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation(); const payload = mcaSelectionPayload; document.getElementById('mca-selection-save').classList.remove('show'); if (payload) openSaveModal(payload);
    });
    document.addEventListener('selectionchange', () => setTimeout(showSelectionButton, 80));
    document.addEventListener('pointerup', () => setTimeout(showSelectionButton, 60));
    document.addEventListener('click', e => {
        if (!e.target.closest('#mca-selection-save') && !window.getSelection()?.toString().trim()) document.getElementById('mca-selection-save')?.classList.remove('show');
    });

    const size = document.getElementById('mca-size');
    size?.addEventListener('input', e => { mcaSettings.size = Number(e.target.value); applyCatSettings(); renderSettings(); saveSettings(); });
    document.getElementById('mca-opacity')?.addEventListener('input', e => { mcaSettings.opacity = Number(e.target.value); applyCatSettings(); renderSettings(); saveSettings(); });
    document.getElementById('mca-attitude')?.addEventListener('input', e => { mcaSettings.attitude = Number(e.target.value); renderSettings(); saveSettings(); });
    document.getElementById('mca-call-sister')?.addEventListener('change', e => { mcaSettings.callSister = e.target.checked; document.querySelector('.mca-subtitle').textContent = `${userWord()}的剧情回收站 · v${MCA_VERSION}`; saveSettings(); });
    document.getElementById('mca-snap')?.addEventListener('change', e => { mcaSettings.snap = e.target.checked; saveSettings(); });
    document.getElementById('mca-float')?.addEventListener('change', e => { mcaSettings.floatAnimation = e.target.checked; applyCatSettings(); saveSettings(); });
    document.getElementById('mca-show-plot')?.addEventListener('change', e => { mcaSettings.showPlotDirection = e.target.checked; updatePlotVisibility(); saveSettings(); });
    document.getElementById('mca-cat-only-chat')?.addEventListener('change', e => { mcaSettings.catOnlyInChat = e.target.checked; updateCatVisibility(); saveSettings(); });
    document.getElementById('mca-test-line')?.addEventListener('click', () => sayInSettings('idle'));

    window.addEventListener('resize', applyCatSettings);
    // Serialize mutations while a save/read is in flight. JSON export and closing remain available.
    document.addEventListener('click', e => {
        if (mcaStorageBusy && e.target.closest?.('#mca-root, #mca-dialog, #mca-subdialog, .mca-message-bookmark') &&
            !e.target.closest?.('[data-export], [data-modal-close], #mca-close')) {
            e.preventDefault(); e.stopImmediatePropagation();
            toast('正在保存收藏，稍等一下。', 'info');
        }
    }, true);
    window.addEventListener('online', syncArchive);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !document.getElementById('mca-subdialog')?.open) syncArchive();
    });
    document.getElementById('mca-dialog')?.addEventListener('close', () => document.getElementById('mca-cat')?.classList.remove('panel-open'));
    document.getElementById('mca-dialog')?.addEventListener('cancel', e => { e.preventDefault(); closePanel(); });
    bindDrag();
    bindGlobalTapFallback();
    updatePlotVisibility();
    updateCatVisibility();
    document.addEventListener('click', () => setTimeout(updateCatVisibility, 80), true);
}

function exposeMidnightApi() {
    globalThis.MidnightCatArchive = {
        version: MCA_VERSION,
        open: (tab = 'search') => openPanel(tab),
        paste: () => { openPanel('bookmarks'); setTimeout(openPasteCollector, 80); },
        close: () => closePanel(),
        isOpen: () => !!document.getElementById('mca-dialog')?.open,
    };
}

function bindStEvents() {
    try {
        const { eventSource, eventTypes } = currentCtx();
        const reInject = () => setTimeout(() => injectMessageButtons(document), 80);
        for (const ev of [eventTypes.CHARACTER_MESSAGE_RENDERED, eventTypes.USER_MESSAGE_RENDERED, eventTypes.MORE_MESSAGES_LOADED, eventTypes.MESSAGE_EDITED]) {
            if (ev) eventSource.on(ev, reInject);
        }
        if (eventTypes.CHAT_CHANGED) eventSource.on(eventTypes.CHAT_CHANGED, () => {
            document.getElementById('mca-search-input') && (document.getElementById('mca-search-input').value = '');
            document.getElementById('mca-search-results') && (document.getElementById('mca-search-results').innerHTML = '');
            setTimeout(() => injectMessageButtons(document), 120);
        });
    } catch (e) { console.warn('[midnight-cat] event bind failed', e); }
}

async function initMidnightCat() {
    if (mcaInitialized || document.getElementById('mca-cat')) return;
    if (!globalThis.SillyTavern?.getContext || !globalThis.SillyTavern?.libs?.localforage) {
        setTimeout(initMidnightCat, 300); return;
    }
    mcaInitialized = true;
    mcaLoadedAt = Date.now();
    mcaSettings = getSettings();
    await loadDb();
    const root = document.createElement('div');
    root.id = 'mca-root';
    root.innerHTML = shellHtml();
    document.body.appendChild(root);
    renderStorageStatus();
    applyCatSettings();
    bindUi();
    exposeMidnightApi();
    updateCatVisibility();
    bindStEvents();
    injectMessageButtons(document);
    mcaMutationObserver = new MutationObserver(mutations => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType === 1 && (node.matches?.('.mes') || node.querySelector?.('.mes'))) injectMessageButtons(node.parentElement || document);
            }
        }
    });
    const chat = document.getElementById('chat');
    if (chat) mcaMutationObserver.observe(chat, { childList: true, subtree: true });
    setTimeout(() => say('idle', ['我在。', `${userWord()}的剧情我替你看着。……只是插件功能，别自作多情。`]), 700);
    console.info(`[midnight-cat] 午夜忧郁纯情185男高 v${MCA_VERSION} loaded`);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMidnightCat, { once: true });
} else {
    initMidnightCat();
}
