// The ST host owns the canonical archive; browser storage is only a retry cache.
export const SERVER_FILE = 'midnight-cat-archive-v2.json';
const LEGACY_KEYS = ['midnight-cat-archive:v1', 'midnight-cat-archive:backup:v1'];
const clone = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const validRow = row => row && typeof row.id === 'string' && row.id.length > 0;

export function normalizeDb(value) {
    if (!value || !Array.isArray(value.items) || !Array.isArray(value.folders)) throw new Error('收藏文件格式不正确');
    if (!value.items.every(x => validRow(x) && typeof x.text === 'string') ||
        !value.folders.every(x => validRow(x) && typeof x.name === 'string') ||
        ['items', 'folders'].some(key => new Set(value[key].map(x => x.id)).size !== value[key].length)) {
        throw new Error('收藏文件包含无效或重复的记录');
    }
    const db = clone(value);
    db.version = 2;
    db.deletedItems = Array.isArray(db.deletedItems) ? db.deletedItems.filter(x => typeof x === 'string') : [];
    db.deletedFolders = Array.isArray(db.deletedFolders) ? db.deletedFolders.filter(x => typeof x === 'string') : [];
    return db;
}

export function diffDb(before, after) {
    const ops = [];
    for (const key of ['folders', 'items']) {
        const oldRows = new Map(before[key].map(row => [row.id, row]));
        const newRows = new Map(after[key].map(row => [row.id, row]));
        for (const [id, row] of newRows) {
            if (!same(row, oldRows.get(id))) ops.push({ key, id, value: clone(row), before: clone(oldRows.get(id)) });
        }
        for (const [id, row] of oldRows) {
            if (!newRows.has(id)) ops.push({ key, id, value: null, before: clone(row) });
        }
    }
    return ops;
}

export function applyOps(input, ops) {
    const db = normalizeDb(input);
    for (const op of ops) {
        const rows = db[op.key];
        const deleted = db[op.key === 'items' ? 'deletedItems' : 'deletedFolders'];
        const i = rows.findIndex(row => row.id === op.id);
        if (op.migration && (i >= 0 || deleted.includes(op.id))) continue;
        if (op.value === null) {
            // A stale device must not delete a record that was edited elsewhere.
            if (i >= 0 && !same(rows[i], op.before)) continue;
            if (i >= 0) rows.splice(i, 1);
            if (!deleted.includes(op.id)) deleted.push(op.id);
        } else {
            if (deleted.includes(op.id)) continue;
            // Preserve both versions for a simultaneous edit of a bookmark.
            if (i >= 0 && !same(rows[i], op.before) && !same(rows[i], op.value)) {
                if (op.key === 'items') {
                    const conflictId = op.conflictId || `${op.id}-conflict`;
                    if (!rows.some(row => row.id === conflictId)) {
                        rows.unshift({ ...clone(op.value), id: conflictId, note: `${op.value.note || ''}\n[另一设备同时修改，已保留此副本]`.trim() });
                    }
                }
                continue;
            }
            if (i >= 0) rows[i] = clone(op.value);
            else if (op.migration) rows.push(clone(op.value));
            else rows.unshift(clone(op.value));
        }
    }
    // A folder deleted on another device must not strand bookmarks.
    const fallback = db.folders[0]?.id || 'quotes';
    for (const item of db.items) {
        if (!db.folders.some(folder => folder.id === item.folderId)) item.folderId = fallback;
    }
    return db;
}

export class ArchiveStorage {
    constructor({ local, headers, defaults, scope = 'default', fetcher = globalThis.fetch.bind(globalThis), onStatus = () => {}, id = () => `${Date.now()}-${Math.random().toString(36).slice(2)}` }) {
        this.local = local;
        this.headers = headers;
        this.defaults = defaults;
        this.fetcher = fetcher;
        this.onStatus = onStatus;
        this.id = id;
        this.cacheKey = `midnight-cat-archive:host-v2:${scope}`;
        this.pending = [];
        this.db = this.empty();
        this.queue = Promise.resolve();
        this.remoteSaved = false;
        this.cacheSaved = false;
        this.localProblem = false;
    }

    empty() { return normalizeDb({ folders: this.defaults, items: [] }); }

    serial(task) {
        const job = this.queue.then(task);
        this.queue = job.catch(() => {});
        return job;
    }

    status(text, mode = 'pending') {
        this.statusText = text;
        this.onStatus({ text, mode });
    }

    async request(url, options = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            return await this.fetcher(url, { ...options, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
                headers: this.headers(), signal: controller.signal });
        } finally { clearTimeout(timer); }
    }

    async readRemote() {
        const result = await this.request(`/user/files/${SERVER_FILE}?mca=${Date.now()}`);
        if (result.status === 404) {
            // Distinguish a missing archive from an unsupported/broken file route.
            const path = `user/files/${SERVER_FILE}`;
            const check = await this.request('/api/files/verify', { method: 'POST', body: JSON.stringify({ urls: [path] }) });
            if (!check.ok || (await check.json())[path] !== false) throw new Error('无法确认酒馆收藏文件，请重试');
            return null;
        }
        if (!result.ok) throw new Error(`酒馆读取失败（${result.status}）`);
        const packet = await result.json();
        if (packet.app !== 'midnight_cat_archive' || packet.version !== 2) throw new Error('酒馆收藏文件无法识别，已停止覆盖');
        return normalizeDb(packet.db);
    }

    async upload(db) {
        const packet = { app: 'midnight_cat_archive', version: 2, updatedAt: new Date().toISOString(), db };
        const bytes = new TextEncoder().encode(JSON.stringify(packet));
        let binary = '';
        for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        const result = await this.request('/api/files/upload', { method: 'POST', body: JSON.stringify({ name: SERVER_FILE, data: btoa(binary) }) });
        if (!result.ok) throw new Error(`酒馆保存失败（${result.status}）`);
        const response = await result.json();
        if (typeof response.path !== 'string' || response.path.replace(/^\//, '') !== `user/files/${SERVER_FILE}`) throw new Error('酒馆返回了意外的保存路径');
        const verified = await this.readRemote();
        if (!verified || !same(verified, db)) throw new Error('酒馆保存后的核对未通过，请重试');
    }

    async cache() {
        const packet = { version: 2, db: clone(this.db), pending: clone(this.pending) };
        const results = await Promise.allSettled([
            this.local.setItem(this.cacheKey, packet),
            this.local.setItem(`${this.cacheKey}:backup`, clone(packet)),
        ]);
        this.cacheSaved = results.some(result => result.status === 'fulfilled');
        return this.cacheSaved;
    }

    load() {
        return this.serial(async () => {
            let cached = false;
            for (const key of [this.cacheKey, `${this.cacheKey}:backup`]) {
                try {
                    const value = await this.local.getItem(key);
                    if (!value) continue;
                    const db = normalizeDb(value.db);
                    if (!Array.isArray(value.pending) || !value.pending.every(op =>
                        ['items', 'folders'].includes(op.key) && typeof op.id === 'string' &&
                        (op.value === null || (validRow(op.value) && op.value.id === op.id)))) throw new Error('本机待同步记录格式不正确');
                    this.db = db;
                    this.pending = value.pending;
                    cached = true;
                    break;
                } catch (error) { this.localProblem = true; console.warn('[midnight-cat] cache read failed', error); }
            }
            if (!cached) {
                for (const key of LEGACY_KEYS) {
                    try {
                        const value = await this.local.getItem(key);
                        if (!value) continue;
                        this.db = normalizeDb(value);
                        this.pending = ['folders', 'items'].flatMap(key => this.db[key].map(value => ({ key, id: value.id, value: clone(value), migration: true })));
                        break;
                    } catch (error) { this.localProblem = true; console.warn('[midnight-cat] legacy read failed', error); }
                }
            }
            await this.syncNow();
            return clone(this.db);
        });
    }

    save(nextDb) {
        const snapshot = normalizeDb(nextDb);
        return this.serial(async () => {
            const ops = diffDb(this.db, snapshot).map(op => ({ ...op, conflictId: `${op.id}-conflict-${this.id()}` }));
            this.pending.push(...ops);
            this.db = snapshot;
            await this.cache(); // Durable retry queue is written before the network request.
            await this.syncNow();
            return { db: clone(this.db), durable: this.remoteSaved || this.cacheSaved, remoteSaved: this.remoteSaved };
        });
    }

    sync() { return this.serial(async () => { await this.syncNow(); return clone(this.db); }); }

    async syncNow() {
        this.remoteSaved = false;
        this.status('正在核对酒馆收藏…');
        try {
            const remote = await this.readRemote();
            const merged = applyOps(remote || this.empty(), this.pending);
            if (this.pending.length > 0) {
                await this.upload(merged);
            } else if (!remote && (!same(this.db, this.empty()) || this.localProblem)) {
                // Never silently clear a nonempty cache when the host file disappears.
                throw new Error('酒馆收藏文件缺失；已保留本机副本，请备份 JSON 后检查');
            }
            this.db = merged;
            this.pending = [];
            this.remoteSaved = true;
            await this.cache();
            this.status(`已保存到 TT 并核对 · ${this.db.items.length} 条收藏 · 本机存档${this.cacheSaved ? '' : '（本机缓存不可用，请另存 JSON）'}`, this.cacheSaved ? 'saved' : 'warning');
        } catch (error) {
            await this.cache();
            const prefix = this.cacheSaved ? '仅暂存本机，换地址前请重试或备份 JSON。' : '尚未可靠保存，请立即备份 JSON。';
            this.status(`${prefix} ${error.message || '连接失败'}`, 'warning');
            console.warn('[midnight-cat] host sync failed', error);
        }
    }
}
