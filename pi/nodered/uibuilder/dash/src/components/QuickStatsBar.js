// QuickStatsBar Component - Horizontal scrollable quick stats
export default {
    inject: ['deviceStore'],
    computed: {
        sensorFields() {
            return this.deviceStore?.sensorFields || [];
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
        <div class="overflow-x-auto pb-2 -mx-2 px-2">
            <div class="flex gap-2 min-w-max sm:grid sm:grid-cols-4 sm:min-w-0">
                <div v-for="f in sensorFields.slice(0, 4)" :key="'quick-' + f.key"
                     class="stat bg-base-100 shadow rounded-lg p-2 min-w-[120px] sm:min-w-0">
                    <div class="stat-title text-[10px] sm:text-xs truncate">{{ f.name }}</div>
                    <div class="stat-value text-base sm:text-lg font-bold">{{ formatValue(f, getValue(f.key)) }}</div>
                </div>
            </div>
        </div>
    `
};
