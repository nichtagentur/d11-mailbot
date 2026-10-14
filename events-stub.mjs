export function emit(type, data) { console.log('[event]', type, JSON.stringify(data || {}).slice(0, 300)); }
export function startDashboard() { console.log('[stub] no dashboard'); }
