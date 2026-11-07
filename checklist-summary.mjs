// Shared by the main-page overview and the scheduled notification backend.
export function checklistDay(now = Date.now()) {
    return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function pendingChecklistGroups({ groups = {}, tasks = {}, checks = {} } = {}) {
    return Object.entries(groups || {})
        .sort(([a, left], [b, right]) => (Number(left?.order) || 0) - (Number(right?.order) || 0) || a.localeCompare(b))
        .flatMap(([id, group]) => {
            if (!group || typeof group !== 'object') return [];
            const target = Math.max(1, Math.min(99, Math.floor(Number(group.repeatCount) || 1)));
            const items = Object.entries(tasks || {}).filter(([, task]) => task && task.groupId === id && task.enabled !== false);
            const pending = items.filter(([key]) => {
                const record = checks?.[key];
                const count = typeof record?.count === 'number' ? Math.max(0, Math.floor(record.count)) : record?.done ? 1 : 0;
                return count < target;
            }).length;
            return pending ? [{ id, name: typeof group.name === 'string' && group.name.trim() ? group.name.trim() : '未命名分組', pending }] : [];
        });
}
