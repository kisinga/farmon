// BadgeComponent - Simple value display

function formatDuration(seconds) {
    if (seconds == null || isNaN(seconds)) return '--';
    const s = Math.floor(Number(seconds));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60) % 60;
    const h = Math.floor(s / 3600) % 24;
    const d = Math.floor(s / 86400);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0 || parts.length === 0) parts.push(`${m}m`);
    return parts.join(' ');
}

export default {
    props: {
        field: { type: Object, required: true },
        value: { default: null }
    },
    template: `
        <div class="stat bg-base-200 rounded-lg p-2">
            <div class="stat-title text-xs">{{ field.name }}</div>
            <div class="stat-value text-lg" :class="valueClass">{{ displayValue }}</div>
            <div v-if="field.unit && field.key !== 'tsr'" class="stat-desc">{{ field.unit }}</div>
        </div>
    `,
    computed: {
        displayValue() {
            if (this.field?.key === 'tsr') return formatDuration(this.value);
            if (this.value === null || this.value === undefined) return '--';
            if (typeof this.value === 'number') {
                if (Math.abs(this.value) >= 1000) {
                    return this.value.toLocaleString('en-US', { maximumFractionDigits: 1 });
                }
                return this.value.toFixed(1);
            }
            return this.value;
        },
        valueClass() {
            if (this.field?.key === 'tsr') return '';
            if (this.field.type !== 'num' || !this.field.thresholds) return '';
            const min = this.field.min ?? 0;
            const max = this.field.max ?? 100;
            const percent = (this.value - min) / (max - min);

            const thresholds = this.field.thresholds;
            for (const t of thresholds) {
                if (percent <= t.pct) {
                    if (t.color.includes('ef44')) return 'text-error';
                    if (t.color.includes('f59e')) return 'text-warning';
                    return 'text-success';
                }
            }
            return 'text-success';
        }
    }
};
