// SensorsSection Component - Sensors collapsible section with gauges/charts
export default {
    inject: ['deviceStore'],
    computed: {
        sensorFields() {
            return this.deviceStore?.sensorFields || [];
        },
        sensorBadgeFields() {
            return this.deviceStore?.sensorBadgeFields || [];
        },
        currentData() {
            return this.deviceStore?.currentData || {};
        },
        historyData() {
            return this.deviceStore?.historyData || {};
        },
        tankGaugeFields() {
            return this.sensorFields.filter(f => 
                (f.viz_type === 'gauge' || f.viz_type === 'both') && f.gauge_style === 'tank'
            );
        },
        regularGaugeFields() {
            return this.sensorFields.filter(f => 
                (f.viz_type === 'gauge' || f.viz_type === 'both') && f.gauge_style !== 'tank'
            );
        },
        chartOnlyFields() {
            return this.sensorFields.filter(f => f.viz_type === 'chart');
        }
    },
    methods: {
        getValue(key) {
            return this.currentData[key];
        },
        getHistory(key) {
            return this.historyData[key] || [];
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

                        <!-- Chart for this field if viz_type is 'both' -->
                        <template v-if="f.viz_type === 'both'">
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

                        <!-- Chart for this field if viz_type is 'both' -->
                        <template v-if="f.viz_type === 'both'">
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
