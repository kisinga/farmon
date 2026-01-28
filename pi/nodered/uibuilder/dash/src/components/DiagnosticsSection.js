// DiagnosticsSection Component - Diagnostics section
export default {
    inject: ['deviceStore'],
    computed: {
        diagnosticFields() {
            return this.deviceStore?.diagnosticFields || [];
        },
        currentData() {
            return this.deviceStore?.currentData || {};
        }
    },
    methods: {
        getValue(key) {
            return this.currentData[key];
        },
        formatValue(field, value) {
            if (value === null || value === undefined) return '--';
            if (typeof value === 'number') {
                const formatted = field.unit === '%' ? Math.round(value) : value.toFixed(1);
                return field.unit ? `${formatted}${field.unit}` : formatted;
            }
            return value;
        }
    },
    template: `
        <collapsible-section
            v-if="diagnosticFields.length > 0"
            title="Diagnostics"
            :default-open="false"
            :badge-count="diagnosticFields.length">

            <div class="pt-2">
                <div class="stats stats-vertical sm:stats-horizontal shadow w-full bg-base-200">
                    <div v-for="f in diagnosticFields" :key="'diag-' + f.key" class="stat px-3 py-2">
                        <div class="stat-title text-xs">{{ f.name }}</div>
                        <div class="stat-value text-lg" 
                             :class="f.key.toLowerCase().includes('error') && getValue(f.key) > 0 ? 'text-error' : ''">
                            {{ formatValue(f, getValue(f.key)) }}
                        </div>
                    </div>
                </div>
            </div>
        </collapsible-section>
    `
};
