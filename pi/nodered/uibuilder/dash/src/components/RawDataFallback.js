// RawDataFallback Component - Raw telemetry display when schema unavailable
export default {
    inject: ['deviceStore'],
    computed: {
        currentData() {
            return this.deviceStore?.currentData || {};
        }
    },
    methods: {
        formatRawValue(value) {
            if (value === null || value === undefined) return '--';
            if (typeof value === 'number') {
                return Number.isInteger(value) ? value : value.toFixed(2);
            }
            return String(value);
        }
    },
    template: `
        <div class="card bg-base-100 shadow-xl">
            <div class="card-body p-3">
                <div class="flex items-center justify-between mb-2">
                    <h2 class="card-title text-sm sm:text-base">Live Telemetry</h2>
                    <span class="badge badge-warning badge-sm">No Schema</span>
                </div>
                <p class="text-xs opacity-60 mb-3">Receiving data. Device schema not yet registered.</p>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <div v-for="(value, key) in currentData" :key="key" class="stat bg-base-200 rounded-lg p-2">
                        <div class="stat-title text-xs truncate">{{ key }}</div>
                        <div class="stat-value text-base font-mono">{{ formatRawValue(value) }}</div>
                    </div>
                </div>
            </div>
        </div>
    `
};
