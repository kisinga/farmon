// DeviceSelector Component - Device and time range selection
window.DeviceSelector = {
    props: {
        devices: { type: Array, default: () => [] },
        selectedDevice: { type: String, default: null },
        timeRange: { type: String, default: '24h' },
        customFrom: { type: String, default: '' },
        customTo: { type: String, default: '' }
    },
    emits: ['select-device', 'time-range-change', 'custom-range-change'],
    template: `
        <div class="card bg-base-100 shadow-xl">
            <div class="card-body p-3">
                <div class="flex flex-col sm:flex-row sm:items-end gap-2 sm:gap-3">
                    <!-- Device Selector -->
                    <div class="flex-1 min-w-0">
                        <label class="label py-0.5">
                            <span class="label-text text-xs uppercase tracking-wide opacity-60">Device</span>
                        </label>
                        <select class="select select-bordered select-sm w-full"
                                :value="selectedDevice"
                                @change="$emit('select-device', $event.target.value)">
                            <option disabled :value="null">Select device...</option>
                            <option v-for="device in devices" :key="device.eui" :value="device.eui">
                                {{ device.name || device.eui }}
                            </option>
                        </select>
                    </div>

                    <!-- Time Range -->
                    <div class="flex-1 min-w-0">
                        <label class="label py-0.5">
                            <span class="label-text text-xs uppercase tracking-wide opacity-60">Time Range</span>
                        </label>
                        <select class="select select-bordered select-sm w-full"
                                :value="timeRange"
                                @change="$emit('time-range-change', $event.target.value)">
                            <option value="1h">Last 1 Hour</option>
                            <option value="6h">Last 6 Hours</option>
                            <option value="24h">Last 24 Hours</option>
                            <option value="7d">Last 7 Days</option>
                            <option value="30d">Last 30 Days</option>
                            <option value="custom">Custom</option>
                        </select>
                    </div>

                    <!-- Custom Date Range -->
                    <template v-if="timeRange === 'custom'">
                        <div class="flex-1 min-w-0">
                            <label class="label py-0.5">
                                <span class="label-text text-xs uppercase tracking-wide opacity-60">From</span>
                            </label>
                            <input type="datetime-local" class="input input-bordered input-sm w-full"
                                   :value="customFrom"
                                   @change="$emit('custom-range-change', { from: $event.target.value, to: customTo })">
                        </div>
                        <div class="flex-1 min-w-0">
                            <label class="label py-0.5">
                                <span class="label-text text-xs uppercase tracking-wide opacity-60">To</span>
                            </label>
                            <input type="datetime-local" class="input input-bordered input-sm w-full"
                                   :value="customTo"
                                   @change="$emit('custom-range-change', { from: customFrom, to: $event.target.value })">
                        </div>
                    </template>
                </div>
            </div>
        </div>
    `
};
