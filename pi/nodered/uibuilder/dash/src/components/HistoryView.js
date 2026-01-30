// HistoryView Component - History tab content for commands and state changes only
import deviceStore from '../store/deviceStore.js';

const { computed, onMounted, watch, nextTick } = Vue;

export default {
    props: {
        deviceEui: { type: String, required: true }
    },
    setup(props, { emit }) {
        const selectedDevice = computed(() => deviceStore.state.selectedDevice);
        const timeRange = computed(() => deviceStore.state.timeRange);
        const activeTab = computed(() => deviceStore.state.activeTab);

        const requestCommandHistory = () => {
            if (!selectedDevice.value) return;
            
            const payload = { eui: selectedDevice.value, range: timeRange.value };
            if (timeRange.value === 'custom') {
                if (deviceStore.state.customFrom && deviceStore.state.customTo) {
                    payload.from = deviceStore.state.customFrom;
                    payload.to = deviceStore.state.customTo;
                } else {
                    return; // Can't request without custom dates
                }
            }

            uibuilder.send({
                topic: 'getCommandHistory',
                payload
            });
        };

        const requestStateHistory = () => {
            if (!selectedDevice.value) return;
            
            const payload = { eui: selectedDevice.value, range: timeRange.value };
            if (timeRange.value === 'custom') {
                if (deviceStore.state.customFrom && deviceStore.state.customTo) {
                    payload.from = deviceStore.state.customFrom;
                    payload.to = deviceStore.state.customTo;
                } else {
                    return; // Can't request without custom dates
                }
            }

            uibuilder.send({
                topic: 'getStateHistory',
                payload
            });
        };

        const requestHistory = () => {
            requestCommandHistory();
            requestStateHistory();
        };

        const onTimeRangeChange = (value) => {
            emit('time-range-change', value);
            // Request history after time range changes
            if (value !== 'custom') {
                nextTick(() => {
                    requestHistory();
                });
            }
        };

        // Request history when component mounts or device changes
        onMounted(() => {
            if (selectedDevice.value) {
                requestHistory();
            }
        });

        watch(() => selectedDevice.value, () => {
            if (selectedDevice.value) {
                requestHistory();
            }
        });

        // Watch for when history tab becomes active
        watch(() => activeTab.value, (newTab) => {
            if (newTab === 'history' && selectedDevice.value) {
                requestHistory();
            }
        });

        return {
            selectedDevice,
            timeRange,
            onTimeRangeChange
        };
    },
    template: `
        <div class="space-y-3">
            <!-- Empty state when no device selected -->
            <dashboard-empty-state v-if="!selectedDevice" state="no-device-selected"></dashboard-empty-state>

            <template v-else>
                <!-- Time Range Selector -->
                <div class="card bg-base-100 shadow-xl">
                    <div class="card-body p-3">
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

                <!-- Command & State History -->
                <div class="card bg-base-100 shadow-xl">
                    <div class="card-body p-3">
                        <h2 class="card-title text-sm sm:text-base mb-3">Command & State History</h2>
                        <p class="text-xs opacity-60 mb-3">View all commands sent to the device and state changes that have occurred.</p>
                        
                        <command-history :device-eui="selectedDevice" />
                    </div>
                </div>
            </template>
        </div>
    `
};
