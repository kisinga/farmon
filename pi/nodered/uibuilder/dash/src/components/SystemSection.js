// SystemSection Component - System fields display
import deviceStore from '../store/deviceStore.js';

const { computed } = Vue;

export default {
    setup() {
        const systemFields = computed(() => deviceStore.systemFields.value);
        const systemBadgeFields = computed(() => deviceStore.systemBadgeFields.value);
        const currentData = computed(() => deviceStore.state.currentData);
        const historyData = computed(() => deviceStore.state.historyData);

        const systemGaugeFields = computed(() =>
            systemFields.value.filter(f => f.viz_type !== 'badge')
        );
        const systemChartFields = computed(() =>
            systemFields.value.filter(f => f.viz_type === 'both')
        );

        const getValue = (key) => currentData.value[key];
        const getHistory = (key) => historyData.value[key] || [];

        const formatValue = (field, value) => {
            if (value === null || value === undefined) return '--';
            if (typeof value === 'number') {
                const formatted = field.unit === '%' ? Math.round(value) : value.toFixed(1);
                return field.unit ? `${formatted}${field.unit}` : formatted;
            }
            return value;
        };

        return {
            systemFields,
            systemBadgeFields,
            currentData,
            historyData,
            systemGaugeFields,
            systemChartFields,
            getValue,
            getHistory,
            formatValue
        };
    },
    template: `
        <collapsible-section
            v-if="systemFields.length > 0"
            title="System"
            :default-open="false"
            :badge-count="systemFields.length">

            <div class="space-y-3 pt-2">
                <!-- System gauges in a compact grid -->
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <div v-for="f in systemGaugeFields" :key="f.key" class="bg-base-200 rounded-lg p-1.5 min-w-0">
                        <div class="text-[10px] sm:text-xs text-center opacity-60">{{ f.name }}</div>
                        <gauge-component :field="f" :value="getValue(f.key)" />
                    </div>
                </div>

                <!-- System charts -->
                <div v-for="f in systemChartFields" :key="'sys-chart-' + f.key"
                     class="card bg-base-200">
                    <div class="card-body p-3">
                        <div class="flex items-center justify-between mb-1">
                            <h2 class="card-title text-sm">{{ f.name }} History</h2>
                            <div class="badge badge-ghost text-xs">{{ formatValue(f, getValue(f.key)) }}</div>
                        </div>
                        <chart-component :field="f" :data="getHistory(f.key)" />
                    </div>
                </div>

                <!-- System badges -->
                <div v-if="systemBadgeFields.length > 0" class="stats stats-vertical sm:stats-horizontal shadow w-full bg-base-200">
                    <badge-component v-for="f in systemBadgeFields" :key="'sys-badge-' + f.key"
                                     :field="f" :value="getValue(f.key)" />
                </div>
            </div>
        </collapsible-section>
    `
};
