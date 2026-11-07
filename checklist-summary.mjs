// Shared by the main-page overview and the scheduled notification backend.
export function checklistDay(now = Date.now()) {
    return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function validChecklistDate(day) {
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    const time = Date.parse(`${day}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day;
}
export function isChecklistGroupDue(group, day = checklistDay()) {
    if (!validChecklistDate(day)) return false;
    const schedule = group?.schedule;
    if (!schedule || schedule.type === 'daily') return true;
    if (schedule.type === 'once') return validChecklistDate(schedule.date) && day >= schedule.date;
    if (schedule.startDate && (!validChecklistDate(schedule.startDate) || day < schedule.startDate)) return false;
    if (schedule.type === 'interval') {
        const every = Number(schedule.every);
        return validChecklistDate(schedule.startDate) && Number.isInteger(every) && every >= 1 && every <= 3650 &&
            Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${schedule.startDate}T00:00:00Z`)) / 86400000) % every === 0;
    }
    if (schedule.type === 'weekly') {
        const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
        return Object.values(schedule.weekdays || {}).some(value => Number(value) === weekday);
    }
    if (schedule.type === 'monthly') {
        const date = Number(schedule.dayOfMonth);
        return Number.isInteger(date) && date >= 1 && date <= 31 && Number(day.slice(8, 10)) === date;
    }
    return false;
}
export function checklistScheduleLabel(group) {
    const schedule = group?.schedule;
    if (!schedule || schedule.type === 'daily') return '每天';
    if (schedule.type === 'interval') return `每隔 ${schedule.every} 天 · ${schedule.startDate} 起`;
    if (schedule.type === 'weekly') {
        const days = [...new Set(Object.values(schedule.weekdays || {}).map(Number))].filter(day => Number.isInteger(day) && day >= 0 && day <= 6).sort();
        return `每週${days.map(day => '日一二三四五六'[day]).join('、')}${schedule.startDate ? ` · ${schedule.startDate} 起` : ''}`;
    }
    if (schedule.type === 'monthly') return `每月 ${schedule.dayOfMonth} 號${schedule.startDate ? ` · ${schedule.startDate} 起` : ''}`;
    if (schedule.type === 'once') return `一次性 · ${schedule.date} 起`;
    return '週期設定有誤';
}
export function checklistProgress(record, day, once = false) {
    if (!record) return 0;
    if (once && record.byDay && typeof record.byDay === 'object') {
        return Math.max(0, Object.entries(record.byDay).reduce((sum, [date, count]) =>
            sum + (date <= day && Number.isFinite(Number(count)) ? Math.trunc(Number(count)) : 0), 0));
    }
    return typeof record.count === 'number' && Number.isFinite(record.count) ? Math.max(0, Math.floor(record.count)) : record.done ? 1 : 0;
}
export function pendingChecklistGroups({ groups = {}, tasks = {}, checks = {}, once = {}, day = checklistDay() } = {}) {
    return Object.entries(groups || {})
        .sort(([a, left], [b, right]) => (Number(left?.order) || 0) - (Number(right?.order) || 0) || a.localeCompare(b))
        .flatMap(([id, group]) => {
            if (!group || typeof group !== 'object' || !isChecklistGroupDue(group, day)) return [];
            const target = Math.max(1, Math.min(99, Math.floor(Number(group.repeatCount) || 1)));
            const items = Object.entries(tasks || {}).filter(([, task]) => task && task.groupId === id && task.enabled !== false);
            const pending = items.filter(([key]) => {
                const isOnce = group.schedule?.type === 'once';
                const record = isOnce ? once?.[id]?.[key] : checks?.[key];
                const count = checklistProgress(record, day, isOnce);
                return count < target;
            }).length;
            return pending ? [{ id, name: typeof group.name === 'string' && group.name.trim() ? group.name.trim() : '未命名分組', pending }] : [];
        });
}
