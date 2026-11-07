import { checklistDay, pendingChecklistGroups } from './checklist-summary.mjs?v=1';

const state = { groups: {}, tasks: {}, checks: {} };
const loaded = { groups: false, tasks: false, checks: false };
const failed = new Set();
let day = '';
let dayRef, dayHandler;
function render() {
    const box = document.getElementById('pendingOverviewBox');
    if (!box) return;
    box.querySelector('[data-checklist-overview]')?.remove();
    const wrapper = document.createElement('span');
    wrapper.dataset.checklistOverview = 'true';
    wrapper.style.display = 'contents';
    const ready = Object.values(loaded).every(Boolean) && failed.size === 0;
    const groups = ready ? pendingChecklistGroups(state) : [];
    const empty = box.querySelector('[data-rcoin-empty]');
    if (empty) empty.hidden = !ready || groups.length > 0;
    if (!ready) {
        const message = document.createElement('span');
        message.textContent = failed.size ? '📋 Checklist 暫時無法同步' : '📋 Checklist 同步中…';
        message.style.cssText = 'font-size:12px;color:#718096;';
        wrapper.appendChild(message);
    }
    for (const group of groups) {
        const link = document.createElement('a');
        link.className = 'checklist-pending-group';
        link.href = `checklist.html#checklist-group-${encodeURIComponent(group.id)}`;
        link.textContent = `📋 ${group.name}`;
        link.title = '今日 Checklist 未完成分組，點擊開啟清單';
        link.style.cssText = 'display:inline-flex;align-items:center;min-height:32px;padding:4px 10px;border:1px solid #bee3f8;border-radius:8px;background:#ebf8ff;color:#2b6cb0;font-size:13px;font-weight:600;text-decoration:none;overflow-wrap:anywhere;';
        wrapper.appendChild(link);
    }
    box.appendChild(wrapper);
}
document.addEventListener('realfarm-pending-rendered', render);
render();
try {
    const app = firebase.initializeApp({
        apiKey: 'AIzaSyDnEljOXFhS8G7_iI56H_O1IEWofm8HY90',
        authDomain: 'realfarm-checklist.firebaseapp.com',
        databaseURL: 'https://realfarm-checklist-default-rtdb.asia-southeast1.firebasedatabase.app',
        projectId: 'realfarm-checklist',
        appId: '1:307880963686:web:7e2cb68ad9d0a8fab847a7'
    }, 'checklist-overview');
    const root = app.database().ref('daily_checklist');
    const error = field => () => { failed.add(field); render(); };
    for (const field of ['groups', 'tasks']) {
        root.child(field).on('value', snapshot => {
            state[field] = snapshot.val() || {};
            loaded[field] = true;
            failed.delete(field);
            render();
        }, error(field));
    }
    function bindDay() {
        const next = checklistDay();
        if (next === day) return;
        if (dayRef) dayRef.off('value', dayHandler);
        day = next;
        state.checks = {};
        loaded.checks = false;
        render();
        dayRef = root.child(`daily/${day}`);
        const boundDay = day;
        dayHandler = snapshot => {
            if (day !== boundDay) return;
            state.checks = snapshot.val() || {};
            loaded.checks = true;
            failed.delete('checks');
            render();
        };
        dayRef.on('value', dayHandler, error('checks'));
    }
    bindDay();
    setInterval(bindDay, 30000);
    window.addEventListener('focus', bindDay);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) bindDay(); });
} catch {
    failed.add('setup');
    render();
}
