// DeviceSelector Component - Device dropdown and time range selector
export default {
    inject: ['deviceStore'],
    props: {
        showTimeRange: { type: Boolean, default: false }
    },
    computed: {
        devices() {
            return this.deviceStore?.devices || [];
        },
        selectedDevice() {
            return this.deviceStore?.selectedDevice || null;
        },
        timeRange() {
            return this.deviceStore?.timeRange || '24h';
        }
    },
    methods: {
        selectDevice(eui) {
            if (this.deviceStore) {
                this.$emit('select-device', eui);
            }
        },
        onTimeRangeChange(value) {
            if (this.deviceStore) {
                this.$emit('time-range-change', value);
            }
        }
    },
    template: `
        <div class="card bg-base-100 shadow-xl mb-3">
            <div class="card-body p-3">
                <div class="flex flex-col sm:flex-row sm:items-end gap-2 sm:gap-3">
                    <div class="flex-1 min-w-0">
                        <label class="label py-0.5">
                            <span class="label-text text-xs uppercase tracking-wide opacity-60">Device</span>
                        </label>
                        <select class="select select-bordered select-sm w-full"
                                :value="selectedDevice || ''"
                                @change="selectDevice($event.target.value)">
                            <option disabled value="">Select device...</option>
                            <option v-for="device in devices" :key="device.eui" :value="device.eui">
                                {{ device.name || device.eui }}
                            </option>
                        </select>
                    </div>
                    <div v-if="showTimeRange" class="flex-1 min-w-0">
                        <label class="label py-0.5">
                            <span class="label-text text-xs uppercase tracking-wide opacity-60">Time Range</span>
                        </label>
                        <select class="select select-bordered select-sm w-full"
                                :value="timeRange"
                                @change="onTimeRangeChange($event.target.value)">
                            <option value="1h">Last 1 Hour</option>
                            <option value="6h">Last 6 Hours</option>
                            <option value="24h">Last 24 Hours</option>
                            <option value="7d">Last 7 Days</option>
                            <option value="30d">Last 30 Days</option>
                            <option value="custom">Custom</option>
                        </select>
                    </div>
                </div>
            </div>
        </div>
    `
};
