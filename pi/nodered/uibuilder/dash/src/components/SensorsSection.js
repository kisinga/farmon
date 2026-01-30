// SensorsSection Component - Sensors collapsible section with gauges/charts
import deviceStore from '../store/deviceStore.js';

const { computed } = Vue;

export default {
    setup() {
        // Create computed refs that properly track deviceStore
        const sensorFields = computed(() => deviceStore.sensorFields.value);
        const sensorBadgeFields = computed(() => deviceStore.sensorBadgeFields.value);
        const currentData = computed(() => deviceStore.state.currentData);
        const historyData = computed(() => deviceStore.state.historyData);

        const tankGaugeFields = computed(() =>
            sensorFields.value.filter(f =>
                (f.viz_type === 'gauge' || f.viz_type === 'both') && f.gauge_style === 'tank'
            )
        );

        const regularGaugeFields = computed(() =>
            sensorFields.value.filter(f =>
                (f.viz_type === 'gauge' || f.viz_type === 'both') && f.gauge_style !== 'tank'
            )
        );

        const chartOnlyFields = computed(() =>
            sensorFields.value.filter(f => f.viz_type === 'chart')
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
            sensorFields,
            sensorBadgeFields,
            currentData,
            historyData,
            tankGaugeFields,
            regularGaugeFields,
            chartOnlyFields,
            getValue,
            getHistory,
            formatValue
        };
    },
    template: `
        <collapsible-section
            v-if="sensorFields.length > 0"
            title="Sensors"
            :default-open="true"
            :badge-count="sensorFields.length">

            <div class="space-y-3 pt-2">
                <!-- Tank-style gauges get featured display -->
                <div v-for="f in tankGaugeFields" :key="'tank-' + f.key"
                     class="card bg-base-200">
                    <div class="card-body p-3">
                        <div class="flex items-center justify-between mb-1">
                            <h2 class="card-title text-sm sm:text-base">{{ f.name }}</h2>
                            <div class="badge badge-info">{{ formatValue(f, getValue(f.key)) }}</div>
                        </div>
                        <gauge-component :field="f" :value="getValue(f.key)" class="gauge-hero gauge-tank" />

                        <!-- Chart for this field if viz_type is 'both' and history exists -->
                        <template v-if="f.viz_type === 'both' && getHistory(f.key).length > 0">
                            <div class="divider my-1 opacity-20"></div>
                            <div class="text-xs opacity-60 mb-1">History</div>
                            <chart-component :field="f" :data="getHistory(f.key)" />
                        </template>
                    </div>
                </div>

                <!-- Regular sensor gauges -->
                <div v-for="f in regularGaugeFields" :key="'gauge-' + f.key"
                     class="card bg-base-200">
                    <div class="card-body p-3">
                        <div class="flex items-center justify-between mb-1">
                            <h2 class="card-title text-sm sm:text-base">{{ f.name }}</h2>
                            <div class="badge badge-info">{{ formatValue(f, getValue(f.key)) }}</div>
                        </div>
                        <gauge-component :field="f" :value="getValue(f.key)" class="gauge-hero" />

                        <!-- Chart for this field if viz_type is 'both' and history exists -->
                        <template v-if="f.viz_type === 'both' && getHistory(f.key).length > 0">
                            <div class="divider my-1 opacity-20"></div>
                            <div class="text-xs opacity-60 mb-1">History</div>
                            <chart-component :field="f" :data="getHistory(f.key)" />
                        </template>
                    </div>
                </div>

                <!-- Chart-only fields -->
                <div v-for="f in chartOnlyFields" :key="'chart-' + f.key"
                     class="card bg-base-200">
                    <div class="card-body p-3">
                        <div class="flex items-center justify-between mb-1">
                            <h2 class="card-title text-sm sm:text-base">{{ f.name }}</h2>
                            <div class="badge badge-ghost">{{ formatValue(f, getValue(f.key)) }}</div>
                        </div>
                        <chart-component :field="f" :data="getHistory(f.key)" />
                    </div>
                </div>

                <!-- Badge-only fields within sensors -->
                <div v-if="sensorBadgeFields.length > 0" class="stats stats-vertical sm:stats-horizontal shadow w-full">
                    <badge-component v-for="f in sensorBadgeFields" :key="'badge-' + f.key"
                                     :field="f" :value="getValue(f.key)" />
                </div>
            </div>
        </collapsible-section>
    `
};
