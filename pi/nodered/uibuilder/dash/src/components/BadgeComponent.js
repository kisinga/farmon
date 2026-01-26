// BadgeComponent - Simple value display
window.BadgeComponent = {
    props: {
        field: { type: Object, required: true },
        value: { default: null }
    },
    template: `
        <div class="stat bg-base-200 rounded-lg p-2">
            <div class="stat-title text-xs">{{ field.name }}</div>
            <div class="stat-value text-lg" :class="valueClass">{{ displayValue }}</div>
            <div v-if="field.unit" class="stat-desc">{{ field.unit }}</div>
        </div>
    `,
    computed: {
        displayValue() {
            if (this.value === null || this.value === undefined) return '--';
            if (typeof this.value === 'number') return this.value.toFixed(1);
            return this.value;
        },
        valueClass() {
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
