// HistoryView Component - History tab content for commands and state changes only
import deviceStore from '../store/deviceStore.js';

const { computed, onMounted, watch } = Vue;

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

        // Watch time range (DeviceSelector updates store); request history when it changes
        watch(() => timeRange.value, (newRange) => {
            if (selectedDevice.value && newRange !== 'custom') {
                requestHistory();
            }
        });

        return {
            selectedDevice
        };
    },
    template: `
        <div class="space-y-3">
            <!-- Empty state when no device selected -->
            <dashboard-empty-state v-if="!selectedDevice" state="no-device-selected"></dashboard-empty-state>

            <template v-else>
                <!-- Command & State History (time range from DeviceSelector) -->
                <div class="card bg-base-100 shadow-xl">
                    <div class="card-body p-3">
                        <h2 class="card-title text-sm sm:text-base mb-3">Command & State History</h2>
                        <p class="text-xs opacity-60 mb-3">View all commands sent to the device and state changes that have occurred.</p>
                        
                        <command-history :device-eui="selectedDevice"></command-history>
                    </div>
                </div>
            </template>
        </div>
    `
};
