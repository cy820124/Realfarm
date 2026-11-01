/* global firebase */
(async () => {
    const config = window.REALFARM_PUSH || {};
    const toggle = document.getElementById('pushToggle');
    const test = document.getElementById('pushTest');
    const status = document.getElementById('pushStatus');
    const key = 'realfarm-push-enabled';
    let enabled = false;
    let messaging;
    let registration;
    let api;
    const report = text => { status.textContent = text; };
    const render = () => {
        toggle.textContent = enabled ? '🔕 關閉背景通知' : '🔔 開啟背景通知';
        test.hidden = !enabled;
    };
    const explain = error => {
        console.error('Push setup failed:', error.code || error.name);
        report(error.message || '通知設定未完成，請檢查網路與設定後重試。');
    };
    try {
        const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (ios && !navigator.standalone && !matchMedia('(display-mode: standalone)').matches) {
            report('請先用分享選單「加入主畫面」，再從主畫面開啟以啟用通知。');
            return;
        }
        if (!window.isSecureContext || !('Notification' in window) ||
            !('serviceWorker' in navigator) || !await firebase.messaging.isSupported()) {
            report('此環境不支援背景通知，請使用支援推播的瀏覽器並以 HTTPS 開啟。');
            return;
        }
        if (!config.backendReady || !config.vapidKey || !config.workerUrl) {
            report('背景通知尚待網站管理者完成雲端設定。');
            return;
        }
        api = async (action, data = {}) => {
            if (!firebase.auth().currentUser) await firebase.auth().signInAnonymously();
            const idToken = await firebase.auth().currentUser.getIdToken();
            const response = await fetch(config.workerUrl, {
                method: 'POST', headers: {
                    Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json'
                }, body: JSON.stringify({ ...data, action })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || '通知服務連線失敗');
            return result;
        };
        messaging = firebase.messaging();
        const connect = async () => {
            if (!firebase.auth().currentUser) await firebase.auth().signInAnonymously();
            if (!registration) {
                registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
                if (!registration.active) {
                    await new Promise((resolve, reject) => {
                        const worker = registration.installing || registration.waiting;
                        if (!worker) return reject(new Error('Worker unavailable'));
                        const timer = setTimeout(() => reject(new Error('Worker timeout')), 20000);
                        const check = () => {
                            if (worker.state === 'activated') { clearTimeout(timer); resolve(); }
                            if (worker.state === 'redundant') { clearTimeout(timer); reject(new Error('Worker failed')); }
                        };
                        worker.addEventListener('statechange', check);
                        check();
                    });
                }
            }
            const token = await messaging.getToken({ vapidKey: config.vapidKey, serviceWorkerRegistration: registration });
            if (!token) throw new Error('No push token');
            await api('register', { token });
            enabled = true;
            localStorage.setItem(key, 'true');
            render();
            report('背景通知已開啟，關閉網頁後仍可接收。提醒可能因網路或省電設定而延遲。');
        };
        toggle.onclick = async () => {
            toggle.disabled = true;
            try {
                if (enabled) {
                    await api('unregister');
                    enabled = false;
                    localStorage.removeItem(key);
                    render();
                    report('已關閉此裝置的背景通知。');
                    // Backend removal already stops delivery, even if token deletion fails.
                    await messaging.deleteToken().catch(() => {});
                } else {
                    const permission = await Notification.requestPermission();
                    if (permission !== 'granted') {
                        report('尚未允許通知。若已封鎖，請到瀏覽器的網站設定中允許通知。');
                        return;
                    }
                    await connect();
                }
            } catch (error) { explain(error); }
            finally { toggle.disabled = false; }
        };
        test.onclick = async () => {
            test.disabled = true;
            try {
                await api('test');
                report('已送出測試通知，請查看系統通知。也可關閉網頁，等待下一次計時提醒測試背景接收。');
            } catch (error) { explain(error); }
            finally { test.disabled = false; }
        };
        messaging.onMessage(payload => {
            const n = payload.notification || {};
            registration.showNotification(n.title || 'Realfarm 提醒', {
                body: n.body || '', tag: payload.data?.eventId,
                data: { url: new URL('./', location.href).href }
            }).catch(explain);
        });
        let syncTimer;
        let lastTimes = '';
        let syncing = false;
        let syncAgain = false;
        const sync = async () => {
            if (!enabled) return;
            if (syncing) { syncAgain = true; return; }
            syncing = true;
            try { await api('sync'); }
            catch (error) { report('提醒時間尚未同步，請檢查網路並重新開啟網頁。'); }
            finally {
                syncing = false;
                if (syncAgain) { syncAgain = false; sync(); }
            }
        };
        // Only time changes schedule work; there is no periodic cloud polling.
        window.addEventListener('realfarm-reminder-times', event => {
            const times = JSON.stringify(event.detail);
            if (times === lastTimes) return;
            lastTimes = times;
            if (!enabled) return;
            clearTimeout(syncTimer);
            syncTimer = setTimeout(sync, 250);
        });
        if (localStorage.getItem(key) === 'true' && Notification.permission === 'granted') {
            await connect();
        } else report('開啟後，即使關閉網頁也能接收釣魚與彩虹提醒。');
        toggle.disabled = false;
    } catch (error) { explain(error); toggle.disabled = false; }
})();
