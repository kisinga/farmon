// Formatting utility functions

export function formatValue(field, value) {
    if (value === null || value === undefined) return '--';
    if (typeof value === 'number') {
        const formatted = field.unit === '%' ? Math.round(value) : value.toFixed(1);
        return field.unit ? `${formatted}${field.unit}` : formatted;
    }
    return value;
}

export function formatRawValue(value) {
    if (value === null || value === undefined) return '--';
    if (typeof value === 'number') {
        return Number.isInteger(value) ? value : value.toFixed(2);
    }
    return String(value);
}

export function getBadgeClass(field, value) {
    if (field.type !== 'num' || value === null || value === undefined) return 'badge-ghost';
    const min = field.min ?? 0;
    const max = field.max ?? 100;
    const percent = (value - min) / (max - min);

    const thresholds = field.thresholds || [
        { pct: 0.2, color: '#ef4444' },
        { pct: 0.5, color: '#f59e0b' },
        { pct: 1.0, color: '#10b981' }
    ];

    for (const t of thresholds) {
        if (percent <= t.pct) {
            if (t.color.includes('ef44')) return 'badge-error';
            if (t.color.includes('f59e')) return 'badge-warning';
            return 'badge-success';
        }
    }
    return 'badge-success';
}

export function formatTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString('en-US', {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}
