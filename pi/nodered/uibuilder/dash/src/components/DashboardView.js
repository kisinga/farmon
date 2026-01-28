// DashboardView Component - Main dashboard orchestrator
export default {
    inject: ['deviceStore'],
    computed: {
        dashboardState() {
            return this.deviceStore?.dashboardState || 'no-device';
        },
        selectedDevice() {
            return this.deviceStore?.selectedDevice || null;
        },
        loading() {
            return this.deviceStore?.loading || false;
        },
        devices() {
            return this.deviceStore?.devices || [];
        }
    },
    methods: {
        handleSelectDevice(eui) {
            this.$emit('select-device', eui);
        },
        handleTimeRangeChange(range) {
            this.$emit('time-range-change', range);
        },
        handleNavigateToControls() {
            this.$emit('navigate-to-controls');
        }
    },
    template: `
        <div class="space-y-3">
            <!-- No Device Selected -->
            <dashboard-empty-state v-if="!selectedDevice" state="no-device-selected" />

            <!-- Loading State -->
            <dashboard-empty-state v-else-if="loading" state="loading" />

            <!-- Device Content -->
            <template v-else>
                <device-info-bar />

                <!-- Raw Data Fallback - when no schema but we have telemetry -->
                <raw-data-fallback v-if="dashboardState === 'raw-data'" />

                <!-- Waiting for data -->
                <dashboard-empty-state v-else-if="dashboardState === 'no-schema'" state="waiting-for-data" />

                <!-- Full Dashboard with Schema -->
                <template v-else-if="dashboardState === 'schema-data'">
                    <quick-stats-bar />
                    <sensors-section />
                    <diagnostics-section />
                    <system-section />
                    <controls-preview @navigate-to-controls="handleNavigateToControls" />
                </template>
            </template>
        </div>
    `
};
