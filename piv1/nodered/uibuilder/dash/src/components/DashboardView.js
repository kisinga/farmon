// DashboardView Component - Main dashboard orchestrator
import deviceStore from '../store/deviceStore.js';

const { computed } = Vue;

export default {
    setup() {
        const loading = computed(() => deviceStore.state.loading);
        const selectedDevice = computed(() => deviceStore.state.selectedDevice);
        const fieldConfigs = computed(() => deviceStore.state.fieldConfigs);
        const currentData = computed(() => deviceStore.state.currentData);

        const dashboardState = computed(() => {
            if (loading.value) return 'loading';
            if (!selectedDevice.value) return 'no-device';
            if (fieldConfigs.value.length === 0 && Object.keys(currentData.value).length === 0) return 'no-schema';
            if (fieldConfigs.value.length === 0 && Object.keys(currentData.value).length > 0) return 'raw-data';
            return 'schema-data';
        });

        return { loading, selectedDevice, fieldConfigs, currentData, dashboardState };
    },
    methods: {
        handleNavigateToControls() {
            this.$emit('navigate-to-controls');
        }
    },
    template: `
        <div class="space-y-3">
            <dashboard-empty-state v-if="!selectedDevice" state="no-device-selected"></dashboard-empty-state>
            <dashboard-empty-state v-else-if="loading" state="loading"></dashboard-empty-state>

            <template v-else>
                <device-info-bar></device-info-bar>

                <raw-data-fallback v-if="dashboardState === 'raw-data'"></raw-data-fallback>
                <dashboard-empty-state v-else-if="dashboardState === 'no-schema'" state="waiting-for-data"></dashboard-empty-state>

                <template v-else-if="dashboardState === 'schema-data'">
                    <quick-stats-bar></quick-stats-bar>
                    <sensors-section></sensors-section>
                    <diagnostics-section></diagnostics-section>
                    <system-section></system-section>
                    <controls-preview @navigate-to-controls="handleNavigateToControls"></controls-preview>
                </template>
            </template>
        </div>
    `
};
