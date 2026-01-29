// DiagnosticsSection Component - Diagnostics section
import deviceStore from '../store/deviceStore.js';

const { computed } = Vue;

export default {
    setup() {
        const diagnosticFields = computed(() => deviceStore.diagnosticFields.value);
        const currentData = computed(() => deviceStore.state.currentData);

        const getValue = (key) => currentData.value[key];

        const formatValue = (field, value) => {
            if (value === null || value === undefined) return '--';
            if (typeof value === 'number') {
                const formatted = field.unit === '%' ? Math.round(value) : value.toFixed(1);
                return field.unit ? `${formatted}${field.unit}` : formatted;
            }
            return value;
        };

        return { diagnosticFields, currentData, getValue, formatValue };
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
