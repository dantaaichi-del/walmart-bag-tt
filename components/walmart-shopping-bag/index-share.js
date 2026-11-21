const WMB_MODULE = 'walmart_shopping_bag_dock';
const WMB_VERSION = '0.2.7-share.1';
const WMB_ASSETS = {
    bag: new URL('./assets/walmart-bag.png', import.meta.url).href,
    chocolate: new URL('./assets/chocolate.png', import.meta.url).href,
    cat: new URL('./assets/midnight-cat.png', import.meta.url).href,
    butterfly: new URL('./assets/butterfly.webp', import.meta.url).href,
};

const WMB_DEFAULTS = {
    size: 46,
    opacity: 0.97,
    floatAnimation: true,
    snap: false,
    hideOriginalLaunchers: true,
    position: { x: null, y: 245 },
    enabled: { chocolate: true, cat: true, butterfly: true },
    order: ['chocolate', 'cat', 'butterfly'],
};

const WMB_BUILTINS = {
    chocolate: {
        id: 'chocolate', label: '巧克力播放器', icon: WMB_ASSETS.chocolate,
        rootSelector: '#choco-player-root',
        bubbleSelector: '#choco-player-root .choco-bubble',
        panelSelector: '#choco-player-panel',
        closeSelector: '#choco-player-panel .choco-x',
        open: () => globalThis.ChocolateStoryPlayer?.open?.(),
        close: () => globalThis.ChocolateStoryPlayer?.close?.(),
        isOpen: () => !!globalThis.ChocolateStoryPlayer?.isOpen?.(),
        openStrategy: 'click',
    },
    cat: {
        id: 'cat', label: '午夜男高', icon: WMB_ASSETS.cat,
        rootSelector: '#mca-root',
        bubbleSelector: '#mca-cat',
        panelSelector: '#mca-dialog',
        closeSelector: '#mca-close',
        open: () => globalThis.MidnightCatArchive?.open?.('search'),
        close: () => globalThis.MidnightCatArchive?.close?.(),
        isOpen: () => !!globalThis.MidnightCatArchive?.isOpen?.(),
        openStrategy: 'api',
    },
    butterfly: {
        id: 'butterfly', label: '小蝴蝶手机', icon: WMB_ASSETS.butterfly,
        rootSelector: '#butterfly-phone-standalone-v1',
        bubbleSelector: '#butterfly-phone-standalone-v1 .bf-ball',
        panelSelector: '#butterfly-phone-standalone-v1-panel',
        closeSelector: '#butterfly-phone-standalone-v1-panel .ph-close',
        open: () => globalThis.ButterflyPhoneStandalone?.open?.(),
        close: () => globalThis.ButterflyPhoneStandalone?.close?.(),
        isOpen: () => !!globalThis.ButterflyPhoneStandalone?.isOpen?.(),
        openStrategy: 'api',
    },
};

let settings = null;
let initialized = false;
let menuOpen = false;
let longPressTimer = 0;
let longPressed = false;
let observer = null;
let refreshTimer = 0;
const registry = new Map(Object.entries(WMB_BUILTINS));

const ctx = () => globalThis.SillyTavern?.getContext?.();
const clamp = (v, min, max) => Math.min(Math.max(Number(v) || 0, min), max);

function getSettings() {
    const c = ctx();
    if (!c) return structuredClone(WMB_DEFAULTS);
    c.extensionSettings ||= {};
    if (!c.extensionSettings[WMB_MODULE]) c.extensionSettings[WMB_MODULE] = structuredClone(WMB_DEFAULTS);
    const s = c.extensionSettings[WMB_MODULE];
    for (const [key, value] of Object.entries(WMB_DEFAULTS)) {
        if (!Object.hasOwn(s, key)) s[key] = structuredClone(value);
    }
    if (!s.position) s.position = structuredClone(WMB_DEFAULTS.position);
    if (!s.enabled || typeof s.enabled !== 'object') s.enabled = structuredClone(WMB_DEFAULTS.enabled);
    if (!Array.isArray(s.order)) s.order = [...WMB_DEFAULTS.order];
    for (const [id, on] of Object.entries(WMB_DEFAULTS.enabled)) if (!Object.hasOwn(s.enabled, id)) s.enabled[id] = on;
    for (const id of WMB_DEFAULTS.order) if (!s.order.includes(id)) s.order.push(id);
    // v0.2.2: user requested true free placement. Existing installs used snap=true by default,
    // so migrate once to free movement; the setting remains available if the user wants edge snap later.
    if (s._wmbFreeMoveMigration !== 1) {
        s.snap = false;
        s._wmbFreeMoveMigration = 1;
        try { c.saveSettingsDebounced?.(); } catch (_) {}
    }
    return s;
}

function saveSettings() {
    try { ctx()?.saveSettingsDebounced?.(); } catch (e) { console.warn('[沃尔玛购物袋] 保存设置失败', e); }
}

function pluginExists(def) {
    if (typeof def.detect === 'function') {
        try { return !!def.detect(); } catch (_) { return false; }
    }
    return !!(def.rootSelector && document.querySelector(def.rootSelector));
}

function getDetectedPlugins() {
    const order = [...settings.order];
    for (const key of registry.keys()) if (!order.includes(key)) order.push(key);
    return order
        .map(key => registry.get(key))
        .filter(Boolean)
        .filter(def => settings.enabled?.[def.id] !== false)
        .filter(pluginExists);
}

function isPanelOpen(def) {
    if (typeof def.isOpen === 'function') {
        try { return !!def.isOpen(); } catch (_) { return false; }
    }
    const panel = def.panelSelector ? document.querySelector(def.panelSelector) : null;
    if (!panel) return false;
    if (panel.tagName === 'DIALOG') return !!panel.open;
    return panel.classList.contains('open') || panel.getAttribute('aria-hidden') === 'false';
}

function closePlugin(def) {
    if (!def || !isPanelOpen(def)) return;
    if (typeof def.close === 'function') {
        try { def.close(); return; } catch (e) { console.warn(`[沃尔玛购物袋] 关闭 ${def.label} 失败`, e); }
    }
    const close = def.closeSelector ? document.querySelector(def.closeSelector) : null;
    if (close) { try { close.click(); return; } catch (_) {} }
    const panel = def.panelSelector ? document.querySelector(def.panelSelector) : null;
    if (panel?.tagName === 'DIALOG' && panel.open) { try { panel.close(); } catch (_) {} }
    else panel?.classList?.remove('open');
}

function closeOtherPlugins(exceptId) {
    for (const def of registry.values()) if (def.id !== exceptId) closePlugin(def);
}

function dispatchPointerTap(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const x = Number.isFinite(r.left) ? r.left + Math.max(1, r.width / 2) : 1;
    const y = Number.isFinite(r.top) ? r.top + Math.max(1, r.height / 2) : 1;
    const base = {
        bubbles: true, cancelable: true, composed: true,
        pointerId: 9427, pointerType: 'touch', isPrimary: true,
        button: 0, clientX: x, clientY: y,
    };
    try {
        el.dispatchEvent(new PointerEvent('pointerdown', { ...base, buttons: 1 }));
        el.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }));
        return true;
    } catch (e) {
        console.warn('[沃尔玛购物袋] synthetic pointer 失败', e);
        return false;
    }
}

function dispatchKeyboardOpen(el) {
    if (!el) return false;
    try {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
        return true;
    } catch (_) { return false; }
}

function positionPanelNearBag(def) {
    const bag = document.getElementById('wmb-bag');
    const panel = def.panelSelector ? document.querySelector(def.panelSelector) : null;
    if (!bag || !panel || panel.tagName === 'DIALOG' || !isPanelOpen(def)) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!isPanelOpen(def)) return;
        const br = bag.getBoundingClientRect();
        const pr = panel.getBoundingClientRect();
        const margin = 8, gap = 9;
        const pw = pr.width || Math.min(420, innerWidth - 16);
        const ph = pr.height || Math.min(640, innerHeight - 16);
        let left = br.left + br.width / 2 < innerWidth / 2 ? br.right + gap : br.left - pw - gap;
        left = clamp(left, margin, Math.max(margin, innerWidth - pw - margin));
        let top = clamp(br.top, 56, Math.max(56, innerHeight - ph - margin));
        panel.style.setProperty('left', `${Math.round(left)}px`, 'important');
        panel.style.setProperty('top', `${Math.round(top)}px`, 'important');
    }));
}

async function openPlugin(id) {
    const def = registry.get(id);
    if (!def || !pluginExists(def)) {
        globalThis.toastr?.warning?.('这个插件现在没有加载到 ST 里。', '沃尔玛购物袋');
        refreshAll();
        return;
    }
    setMenuOpen(false);
    closeOtherPlugins(id);
    if (isPanelOpen(def)) return;

    if (typeof def.open === 'function') {
        try {
            const apiAvailable = (def.id === 'mochi' && globalThis.MochiPostgradEnglish?.open)
                || (def.id === 'fanqie' && globalThis.FanqieStudyTimer?.open)
                || (def.id === 'chocolate' && globalThis.ChocolateStoryPlayer?.open)
                || (def.id === 'cat' && globalThis.MidnightCatArchive?.open)
                || (def.id === 'butterfly' && globalThis.ButterflyPhoneStandalone?.open)
                || !['mochi','fanqie','chocolate','cat','butterfly'].includes(def.id);
            if (apiAvailable) {
                await def.open();
                positionPanelNearBag(def);
                return;
            }
        } catch (e) { console.warn(`[沃尔玛购物袋] ${def.label} 自定义打开失败`, e); }
    }

    const bubble = def.bubbleSelector ? document.querySelector(def.bubbleSelector) : null;
    if (!bubble) {
        globalThis.toastr?.warning?.(`${def.label} 的入口没有找到。`, '沃尔玛购物袋');
        return;
    }

    let fired = false;
    if (def.openStrategy === 'keyboard') fired = dispatchKeyboardOpen(bubble);
    else if (def.openStrategy === 'pointer') { try { bubble.click(); fired = true; } catch (_) { fired = false; } }
    else {
        try { bubble.click(); fired = true; } catch (_) { fired = dispatchPointerTap(bubble); }
    }

    if (!fired) globalThis.toastr?.warning?.(`${def.label} 没能打开。`, '沃尔玛购物袋');
    setTimeout(() => positionPanelNearBag(def), 80);
}

function shellHtml() {
    return `
      <div id="wmb-bag" role="button" tabindex="0" aria-label="沃尔玛购物袋" title="沃尔玛购物袋">
        <img src="${WMB_ASSETS.bag}" draggable="false" alt="">
      </div>
      <div id="wmb-orbit" aria-hidden="true"></div>
      <dialog id="wmb-settings-dialog">
        <form method="dialog" class="wmb-settings-card">
          <header class="wmb-settings-head">
            <div><b>沃尔玛购物袋</b><small>插件坞 · v${WMB_VERSION}</small></div>
            <button value="cancel" class="wmb-x" aria-label="关闭">×</button>
          </header>
          <section class="wmb-settings-section">
            <label>购物袋大小 <span id="wmb-size-value"></span><input id="wmb-size" type="range" min="32" max="76" step="1"></label>
            <label>透明度 <span id="wmb-opacity-value"></span><input id="wmb-opacity" type="range" min="0.40" max="1" step="0.01"></label>
            <label class="wmb-check"><input id="wmb-float" type="checkbox"> 上下呼吸悬浮</label>
            <label class="wmb-check"><input id="wmb-snap" type="checkbox"> 拖动后自动贴边（默认关闭，可自由停在屏幕中间）</label>
            <label class="wmb-check"><input id="wmb-hide-original" type="checkbox"> 收起原插件自己的悬浮图标</label>
          </section>
          <section class="wmb-settings-section">
            <div class="wmb-section-title">插件管理</div>
            <div id="wmb-plugin-list" class="wmb-plugin-list"></div>
          </section>
          <div class="wmb-note">平时只点购物袋；展开后直接点图标，不显示文字菜单。以后支持沃尔玛接口的新插件会自动加入这里，旧插件仍可独立升级和替换。</div>
          <button id="wmb-reset-position" class="wmb-wide" type="button">重置购物袋位置</button>
        </form>
      </dialog>`;
}

function updateManagedBubbleClasses() {
    document.querySelectorAll('.wmb-managed-launcher').forEach(el => el.classList.remove('wmb-managed-launcher'));
    if (!settings.hideOriginalLaunchers) {
        document.body.classList.remove('wmb-hide-originals');
        return;
    }
    document.body.classList.add('wmb-hide-originals');
    for (const def of registry.values()) {
        if (!pluginExists(def) || settings.enabled?.[def.id] === false) continue;
        if (def.bubbleSelector) document.querySelector(def.bubbleSelector)?.classList.add('wmb-managed-launcher');
    }
}

function orbitPositions(count, centerX, centerY, radius, itemSize) {
    if (!count) return [];
    const margin = itemSize / 2 + 7;
    const leftSpace = centerX;
    const rightSpace = innerWidth - centerX;
    const topSpace = centerY;
    const bottomSpace = innerHeight - centerY;

    let start, span;
    if (leftSpace < radius + itemSize) { start = -70; span = 140; }
    else if (rightSpace < radius + itemSize) { start = 110; span = 140; }
    else if (topSpace < radius + itemSize + 48) { start = 20; span = 140; }
    else if (bottomSpace < radius + itemSize) { start = 200; span = 140; }
    else { start = -90; span = 360; }

    const pts = [];
    for (let i = 0; i < count; i++) {
        let angle;
        if (span === 360) angle = -90 + (360 / count) * i;
        else angle = count === 1 ? start + span / 2 : start + (span / (count - 1)) * i;
        const rad = angle * Math.PI / 180;
        let x = centerX + Math.cos(rad) * radius;
        let y = centerY + Math.sin(rad) * radius;
        x = clamp(x, margin, innerWidth - margin);
        y = clamp(y, 56 + margin, innerHeight - margin);
        pts.push({ x, y });
    }
    return pts;
}

function renderOrbit() {
    const orbit = document.getElementById('wmb-orbit');
    const bag = document.getElementById('wmb-bag');
    if (!orbit || !bag) return;
    const plugins = getDetectedPlugins();
    const br = bag.getBoundingClientRect();
    const cx = br.left + br.width / 2;
    const cy = br.top + br.height / 2;
    const itemSize = 50;
    const radius = Math.max(plugins.length >= 5 ? 88 : 68, clamp(settings.size, 32, 76) + 30);
    const positions = orbitPositions(plugins.length, cx, cy, radius, itemSize);

    orbit.innerHTML = plugins.map((def, i) => `
      <button type="button" class="wmb-plugin" data-plugin="${def.id}" aria-label="${def.label}" title="${def.label}"
        style="--wmb-x:${positions[i]?.x ?? cx}px;--wmb-y:${positions[i]?.y ?? cy}px;--wmb-cx:${cx}px;--wmb-cy:${cy}px">
        <img src="${def.icon || ''}" draggable="false" alt="">
      </button>`).join('');

    orbit.querySelectorAll('.wmb-plugin').forEach(btn => btn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation(); openPlugin(btn.dataset.plugin);
    }));
}

function setMenuOpen(open) {
    menuOpen = !!open;
    const orbit = document.getElementById('wmb-orbit');
    const bag = document.getElementById('wmb-bag');
    if (!orbit || !bag) return;
    if (menuOpen) renderOrbit();
    orbit.classList.toggle('open', menuOpen);
    orbit.setAttribute('aria-hidden', menuOpen ? 'false' : 'true');
    bag.classList.toggle('open', menuOpen);
}

function applyBagSettings() {
    const bag = document.getElementById('wmb-bag');
    if (!bag) return;
    const size = clamp(settings.size, 32, 76) || 46;
    const hit = Math.max(54, size + 8);
    bag.style.width = `${hit}px`;
    bag.style.height = `${hit}px`;
    bag.style.setProperty('--wmb-size', `${size}px`);
    bag.style.opacity = String(clamp(settings.opacity, .4, 1) || .97);
    bag.classList.toggle('floaty', !!settings.floatAnimation);

    const fallbackX = Math.max(6, innerWidth - hit - 6);
    const x = Number.isFinite(Number(settings.position?.x)) ? Number(settings.position.x) : fallbackX;
    const y = Number.isFinite(Number(settings.position?.y)) ? Number(settings.position.y) : 245;
    bag.style.left = `${clamp(x, 3, Math.max(3, innerWidth - hit - 3))}px`;
    bag.style.top = `${clamp(y, 55, Math.max(55, innerHeight - hit - 10))}px`;
    if (menuOpen) renderOrbit();
}

function renderSettings() {
    const size = document.getElementById('wmb-size');
    const opacity = document.getElementById('wmb-opacity');
    if (!size || !opacity) return;
    size.value = String(settings.size);
    opacity.value = String(settings.opacity);
    document.getElementById('wmb-size-value').textContent = `${settings.size}px`;
    document.getElementById('wmb-opacity-value').textContent = `${Math.round(settings.opacity * 100)}%`;
    document.getElementById('wmb-float').checked = !!settings.floatAnimation;
    document.getElementById('wmb-snap').checked = !!settings.snap;
    document.getElementById('wmb-hide-original').checked = !!settings.hideOriginalLaunchers;

    const list = document.getElementById('wmb-plugin-list');
    if (!list) return;
    const order = [...settings.order];
    for (const key of registry.keys()) if (!order.includes(key)) order.push(key);
    list.innerHTML = order.map(id => {
        const def = registry.get(id);
        if (!def) return '';
        const detected = pluginExists(def);
        const checked = settings.enabled?.[id] !== false;
        return `<label class="wmb-plugin-row ${detected ? '' : 'missing'}">
          <img src="${def.icon || ''}" alt=""><span>${def.label}<small>${detected ? '已检测' : '未加载'}</small></span>
          <input type="checkbox" data-plugin-toggle="${id}" ${checked ? 'checked' : ''} ${detected ? '' : 'disabled'}>
        </label>`;
    }).join('');

    list.querySelectorAll('[data-plugin-toggle]').forEach(input => input.addEventListener('change', () => {
        settings.enabled[input.dataset.pluginToggle] = input.checked;
        saveSettings(); if (menuOpen) renderOrbit();
    }));
}

function openSettings() {
    setMenuOpen(false);
    renderSettings();
    const dlg = document.getElementById('wmb-settings-dialog');
    if (!dlg) return;
    try { if (!dlg.open) dlg.showModal(); } catch (_) { dlg.setAttribute('open', ''); }
}

function bindBag() {
    const bag = document.getElementById('wmb-bag');
    if (!bag) return;
    let active = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0, pid = null;
    const threshold = 17;

    bag.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        active = true; moved = false; longPressed = false; pid = e.pointerId;
        sx = e.clientX; sy = e.clientY;
        const r = bag.getBoundingClientRect(); ox = r.left; oy = r.top;
        clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => {
            if (active && !moved) { longPressed = true; openSettings(); }
        }, 680);
        bag.classList.add('pressed');
    }, { passive: true });

    document.addEventListener('pointermove', e => {
        if (!active || (pid != null && e.pointerId !== pid)) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (!moved && Math.hypot(dx, dy) < threshold) return;
        moved = true; clearTimeout(longPressTimer); setMenuOpen(false);
        const r = bag.getBoundingClientRect();
        bag.style.left = `${clamp(ox + dx, 3, Math.max(3, innerWidth - r.width - 3))}px`;
        bag.style.top = `${clamp(oy + dy, 55, Math.max(55, innerHeight - r.height - 10))}px`;
        if (e.cancelable) e.preventDefault();
    }, { passive: false });

    document.addEventListener('pointerup', e => {
        if (!active || (pid != null && e.pointerId !== pid)) return;
        active = false; clearTimeout(longPressTimer); bag.classList.remove('pressed');
        if (moved) {
            if (settings.snap) {
                const r = bag.getBoundingClientRect();
                const x = r.left + r.width / 2 < innerWidth / 2 ? 4 : innerWidth - r.width - 4;
                bag.style.left = `${x}px`;
            }
            const r = bag.getBoundingClientRect();
            settings.position = { x: Math.round(r.left), y: Math.round(r.top) };
            saveSettings();
        } else if (!longPressed) {
            bag.classList.add('tap-pop');
            setTimeout(() => bag.classList.remove('tap-pop'), 190);
            setMenuOpen(!menuOpen);
        }
        moved = false; pid = null;
    }, { passive: true });

    document.addEventListener('pointercancel', () => {
        if (!active) return;
        active = false; moved = false; pid = null; clearTimeout(longPressTimer); bag.classList.remove('pressed');
    }, { passive: true });

    bag.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMenuOpen(!menuOpen); }
    });
}

function bindSettings() {
    document.getElementById('wmb-size')?.addEventListener('input', e => {
        settings.size = Number(e.target.value); document.getElementById('wmb-size-value').textContent = `${settings.size}px`; applyBagSettings(); saveSettings();
    });
    document.getElementById('wmb-opacity')?.addEventListener('input', e => {
        settings.opacity = Number(e.target.value); document.getElementById('wmb-opacity-value').textContent = `${Math.round(settings.opacity * 100)}%`; applyBagSettings(); saveSettings();
    });
    document.getElementById('wmb-float')?.addEventListener('change', e => { settings.floatAnimation = e.target.checked; applyBagSettings(); saveSettings(); });
    document.getElementById('wmb-snap')?.addEventListener('change', e => { settings.snap = e.target.checked; saveSettings(); });
    document.getElementById('wmb-hide-original')?.addEventListener('change', e => { settings.hideOriginalLaunchers = e.target.checked; updateManagedBubbleClasses(); saveSettings(); });
    document.getElementById('wmb-reset-position')?.addEventListener('click', () => {
        settings.position = { x: null, y: 245 }; saveSettings(); applyBagSettings();
        globalThis.toastr?.success?.('购物袋位置已重置。', '沃尔玛购物袋');
    });
}

function refreshAll() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        updateManagedBubbleClasses();
        if (menuOpen) renderOrbit();
        const dlg = document.getElementById('wmb-settings-dialog');
        if (dlg?.open) renderSettings();
    }, 80);
}

function exposeApi() {
    const api = {
        version: WMB_VERSION,
        register(def) {
            if (!def?.id || !def?.label || !(def.icon || def.iconUrl)) throw new Error('register() 需要 id、label、icon');
            const normalized = { ...def, icon: def.icon || def.iconUrl };
            registry.set(normalized.id, normalized);
            if (!Object.hasOwn(settings.enabled, normalized.id)) settings.enabled[normalized.id] = true;
            if (!settings.order.includes(normalized.id)) settings.order.push(normalized.id);
            saveSettings(); refreshAll();
            return () => api.unregister(normalized.id);
        },
        unregister(id) { registry.delete(id); refreshAll(); },
        refresh: refreshAll,
        open: openPlugin,
        openSettings,
        list: () => [...registry.values()].map(def => ({ id: def.id, label: def.label, detected: pluginExists(def) })),
    };
    globalThis.WalmartShoppingBag = api;
    document.dispatchEvent(new CustomEvent('walmart-shopping-bag-ready', { detail: api }));
}

function bindGlobal() {
    window.addEventListener('resize', () => { applyBagSettings(); if (menuOpen) renderOrbit(); });
    document.addEventListener('pointerdown', e => {
        if (!menuOpen) return;
        if (!e.target.closest('#wmb-bag') && !e.target.closest('#wmb-orbit')) setMenuOpen(false);
    }, true);

    // Only react to changes made outside the shopping-bag UI. Re-rendering the
    // orbit/settings replaces children inside #wmb-root; observing those writes
    // used to schedule another render forever while either view was open.
    observer = new MutationObserver(records => {
        const root = document.getElementById('wmb-root');
        if (records.some(record => !root?.contains(record.target))) refreshAll();
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

async function init() {
    if (initialized || document.getElementById('wmb-root')) return;
    if (!globalThis.SillyTavern?.getContext) { setTimeout(init, 350); return; }
    initialized = true;
    settings = getSettings();
    const root = document.createElement('div');
    root.id = 'wmb-root';
    root.innerHTML = shellHtml();
    document.body.appendChild(root);
    bindBag(); bindSettings(); bindGlobal(); exposeApi();
    applyBagSettings();
    setTimeout(refreshAll, 350);
    setTimeout(refreshAll, 1200);
    console.info(`[沃尔玛购物袋] v${WMB_VERSION} 已加载`);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
