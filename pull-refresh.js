/* Pull to refresh the main page, including home-screen installations. */
(() => {
    const THRESHOLD = 110;
    const blockedTarget = 'button,a,input,textarea,select,summary,[contenteditable],.quest-chip,.queue-btn,.fish-btn,[draggable="true"]';
    let gesture = null;
    let refreshing = false;
    const indicator = document.createElement('div');
    indicator.id = 'pullRefreshStatus';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    indicator.hidden = true;
    indicator.style.cssText = 'position:fixed;top:max(12px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:10002;padding:10px 16px;border-radius:24px;background:#2d3748;color:#fff;box-shadow:0 3px 12px #0002;font:14px sans-serif;white-space:nowrap;pointer-events:none;';
    document.body.appendChild(indicator);
    document.documentElement.style.overscrollBehaviorY = 'contain';
    const atTop = () => (document.scrollingElement?.scrollTop || 0) <= 0 && window.scrollY <= 0;
    const modalOpen = () => Boolean(document.querySelector('[class*="modal-overlay"].show')) ||
        document.body.style.overflow === 'hidden';
    const reset = () => { gesture = null; if (!refreshing) indicator.hidden = true; };
    async function reload() {
        refreshing = true;
        indicator.hidden = false;
        indicator.textContent = '正在重新整理…';
        try {
            const perform = () => { window.location.reload(); return { committed: true }; };
            // Finish pending saves before navigating away from the page.
            if (typeof gameRef !== 'undefined' && gameRef.runWhenReady) {
                const result = await gameRef.runWhenReady(perform);
                if (!result?.committed) throw new Error('Not ready');
            } else perform();
        } catch {
            indicator.textContent = '暫時無法重新整理，請確認網路';
            refreshing = false;
            setTimeout(reset, 2500);
        }
    }
    document.addEventListener('touchstart', event => {
        reset();
        if (refreshing || event.touches.length !== 1 || !atTop() || modalOpen() ||
            event.target.closest(blockedTarget)) return;
        const touch = event.touches[0];
        gesture = { x: touch.clientX, y: touch.clientY, distance: 0, captured: false };
    }, { passive: true });
    document.addEventListener('touchmove', event => {
        if (!gesture) return;
        if (event.touches.length !== 1 || modalOpen() || !atTop()) { reset(); return; }
        const touch = event.touches[0];
        const dy = touch.clientY - gesture.y;
        const dx = Math.abs(touch.clientX - gesture.x);
        if (!gesture.captured && (dy < -8 || dx > Math.max(16, dy))) { reset(); return; }
        if (dy <= 12 && !gesture.captured) return;
        gesture.captured = true;
        gesture.distance = Math.max(0, dy);
        if (event.cancelable) event.preventDefault();
        indicator.hidden = false;
        indicator.textContent = gesture.distance >= THRESHOLD ? '↻ 放開以重新整理' : '↓ 下拉重新整理';
    }, { passive: false });
    document.addEventListener('touchend', () => {
        const shouldReload = gesture?.captured && gesture.distance >= THRESHOLD && atTop() && !modalOpen();
        reset();
        if (shouldReload && !refreshing) reload();
    }, { passive: true });
    document.addEventListener('touchcancel', reset, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
})();
