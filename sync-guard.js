/* Shared protection for the task page and admin page. No offline writes. */
(function (global) {
    'use strict';
    const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
    const canonical = value => {
        if (value == null) return 'null';
        if (typeof value !== 'object') return JSON.stringify(value);
        return '{' + Object.keys(value).filter(key => value[key] != null).sort()
            .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    };
    const same = (a, b) => canonical(a) === canonical(b);
    // Server timestamps may differ between the transaction's estimated result
    // and the listener's confirmed snapshot. They are metadata, not user edits.
    const sameRecord = (a, b) => {
        const content = value => {
            if (value == null || typeof value !== 'object') return value;
            const { lastModified, ...record } = value;
            return record;
        };
        return same(content(a), content(b));
    };
    function diff(before, after, prefix = '', result = {}) {
        if (same(before, after)) return result;
        if (before && after && !Array.isArray(before) && !Array.isArray(after) &&
            typeof before === 'object' && typeof after === 'object') {
            for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
                diff(before[key], after[key], prefix ? prefix + '/' + key : key, result);
            }
        } else if (prefix) result[prefix] = clone(after);
        return result;
    }
    function apply(data, changes) {
        const next = clone(data) || {};
        for (const [path, value] of Object.entries(changes)) {
            const parts = path.split('/');
            let parent = next;
            for (const part of parts.slice(0, -1)) {
                if (!parent[part] || typeof parent[part] !== 'object') parent[part] = {};
                parent = parent[part];
            }
            if (value == null) delete parent[parts.at(-1)];
            else parent[parts.at(-1)] = clone(value);
        }
        return next;
    }
    function createRef(raw, options = {}) {
        const doc = options.document || global.document;
        const win = options.window || global;
        const clock = options.now || Date.now;
        const listeners = new Set();
        const pending = [];
        let baseline = null, snapshot = null, connected = false, ready = false;
        let epoch = 0, running = false, refreshing = null, verifiedAt = 0;
        let message = '正在同步最新資料，請稍候…';
        const overlay = doc?.createElement?.('div');
        let savingBadge = null, savingTimer = null;
        if (overlay) {
            overlay.dataset.syncGuard = 'true';
            overlay.setAttribute('role', 'status');
            overlay.setAttribute('aria-live', 'polite');
            overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:transparent;display:flex;align-items:flex-start;justify-content:center;padding:12px;text-align:center;font:14px sans-serif;touch-action:none;';
            const label = doc.createElement('span');
            label.style.cssText = 'padding:12px;border-radius:8px;background:#2d3748;color:white;box-shadow:0 2px 8px #0002;';
            overlay.appendChild(label);
            const retry = doc.createElement('button');
            retry.type = 'button'; retry.textContent = '重新同步';
            retry.style.cssText = 'margin-left:12px;padding:10px;border-radius:8px;border:1px solid #cbd5e0;';
            retry.onclick = () => refresh();
            overlay.appendChild(retry);
            doc.body.appendChild(overlay);
            savingBadge = doc.createElement('div');
            savingBadge.dataset.syncSaving = 'true';
            savingBadge.textContent = '☁️ 儲存中…';
            savingBadge.hidden = true;
            savingBadge.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:10001;padding:6px 10px;border-radius:16px;background:#2d3748;color:white;font:12px sans-serif;pointer-events:none;';
            doc.body.appendChild(savingBadge);
        }
        const hidden = () => doc?.visibilityState === 'hidden';
        function paint() {
            if (!overlay) return;
            const busy = running || pending.length > 0;
            overlay.hidden = ready && connected && !hidden();
            overlay.style.display = overlay.hidden ? 'none' : 'flex';
            overlay.firstChild.textContent = message;
            overlay.lastChild.hidden = busy || Boolean(refreshing);
            if (busy && overlay.hidden) {
                // Fast writes show no visual interruption; slow writes use a small badge.
                if (savingTimer === null && savingBadge.hidden) savingTimer = win.setTimeout(() => {
                    savingTimer = null;
                    if ((running || pending.length) && ready && connected && !hidden()) savingBadge.hidden = false;
                }, 300);
            } else {
                if (savingTimer !== null) win.clearTimeout(savingTimer);
                savingTimer = null;
                savingBadge.hidden = true;
            }
        }
        function notify(text) {
            if (options.onNotice) return options.onNotice(text);
            if (!doc) return;
            const toast = doc.createElement('div');
            toast.setAttribute('role', 'alert'); toast.textContent = text;
            toast.style.cssText = 'position:fixed;bottom:24px;left:12px;right:12px;z-index:10001;padding:14px;border-radius:10px;background:#2d3748;color:white;text-align:center;font:14px sans-serif;';
            doc.body.appendChild(toast);
            win.setTimeout(() => toast.remove(), 5000);
        }
        function accept(value) {
            snapshot = value;
            baseline = clone(value.val());
            // All consumers receive the complete snapshot on resume and conflict.
            for (const listener of listeners) listener(value);
        }
        async function refresh() {
            if (refreshing) return refreshing;
            ready = false;
            const expectedEpoch = ++epoch;
            message = connected ? '正在同步最新資料，請稍候…' : '尚未連上雲端，暫停編輯以保護資料。';
            paint();
            if (!connected || hidden()) return false;
            refreshing = (async () => {
                try {
                    const value = await raw.get();
                    if (epoch !== expectedEpoch || !connected || hidden()) return false;
                    ready = true;
                    verifiedAt = clock();
                    accept(value);
                    return true;
                } catch {
                    message = '同步失敗，請確認網路後按「重新同步」。';
                    return false;
                } finally { refreshing = null; paint(); }
            })();
            return refreshing;
        }
        async function flush() {
            if (running) return;
            running = true; paint();
            while (pending.length) {
                const request = pending.shift();
                let result = { committed: false };
                let error = null;
                if (request.epoch === -1) {
                    request.callback?.(new Error('先前操作遇到同步衝突，本次操作未儲存。'));
                    request.resolve(result);
                    continue;
                }
                try {
                    if (request.epoch !== epoch || !ready || !connected || hidden()) throw new Error('同步尚未完成');
                    const before = request.expected;
                    result = await raw.transaction(current => {
                        if (request.epoch !== epoch || !connected || !sameRecord(current, request.expected)) return;
                        return request.replace ? clone(request.value) : apply(current, request.value);
                    }, undefined, false);
                    if (!result.committed) throw new Error('其他裝置已更新資料，本次操作未儲存，已重新同步，請再操作一次。');
                    // Multiple writes from the same click build on our own commit.
                    // External writes still have to pass Firebase's atomic check.
                    for (const queued of pending) {
                        if (queued.epoch === request.epoch && sameRecord(queued.expected, before)) {
                            queued.expected = clone(result.snapshot.val());
                        }
                    }
                    verifiedAt = clock();
                } catch (failure) {
                    error = failure;
                    for (const queued of pending) queued.epoch = -1;
                    notify(failure.message || '儲存失敗，已重新同步。');
                    await refresh();
                }
                request.callback?.(error);
                request.resolve(result);
            }
            running = false; paint();
        }
        function write(value, replace, callback) {
            if (!ready || !connected || hidden() || clock() - verifiedAt > 30000) {
                const error = new Error('請先同步最新資料，再操作一次。');
                callback?.(error);
                refresh();
                return Promise.resolve({ committed: false });
            }
            if (!replace && !Object.keys(value).length) return Promise.resolve({ committed: true, snapshot });
            return new Promise(resolve => {
                pending.push({ value: clone(value), replace, callback, resolve, expected: clone(baseline), epoch });
                flush();
            });
        }
        function at(prefix = '') {
            return {
                set(value, callback) { return prefix ? write({ [prefix]: value }, false, callback) : write(value, true, callback); },
                update(value, callback) {
                    return write(Object.fromEntries(Object.entries(value).map(([path, val]) => [prefix ? prefix + '/' + path : path, val])), false, callback);
                },
                remove(callback) { return this.set(null, callback); },
                child(path) { return at(prefix ? prefix + '/' + path : path); },
                on(event, listener) {
                    if (prefix || event !== 'value') throw new Error('Unsupported listener');
                    listeners.add(listener);
                    if (snapshot) listener(snapshot);
                    return listener;
                },
                once(event, callback) { return refresh().then(() => { callback?.(snapshot); return snapshot; }); },
                refresh,
                isReady: () => ready && connected && !hidden(),
                off(event, listener) { listeners.delete(listener); }
            };
        }
        raw.on('value', value => { accept(value); }, () => {
            ready = false; message = '無法讀取雲端資料，請確認連線與權限。'; paint();
        });
        raw.root.child('.info/connected').on('value', value => {
            connected = value.val() === true;
            if (connected) refresh();
            else { ready = false; epoch++; message = '尚未連上雲端，暫停編輯以保護資料。'; paint(); }
        });
        doc?.addEventListener('visibilitychange', () => {
            if (hidden()) { ready = false; epoch++; paint(); }
            else refresh();
        });
        win.addEventListener?.('pageshow', () => refresh());
        win.addEventListener?.('online', () => refresh());
        win.addEventListener?.('offline', () => { ready = false; epoch++; message = '目前離線，暫停編輯以保護資料。'; paint(); });
        win.addEventListener?.('focus', () => {
            if (!ready || clock() - verifiedAt > 30000) refresh();
        });
        for (const type of ['pointerdown', 'touchstart', 'click', 'keydown', 'beforeinput', 'dragstart', 'drop']) {
            doc?.addEventListener(type, event => {
                if (event.target.closest?.('[data-sync-guard]')) return;
                if (!ready || !connected || hidden() || running || pending.length || clock() - verifiedAt > 30000) {
                    event.preventDefault(); event.stopImmediatePropagation();
                    if (!running && !pending.length) refresh();
                }
            }, { capture: true, passive: false });
        }
        paint();
        return at();
    }
    const api = { createRef, diff, same, apply };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else global.RealfarmSync = api;
})(typeof window === 'undefined' ? globalThis : window);
