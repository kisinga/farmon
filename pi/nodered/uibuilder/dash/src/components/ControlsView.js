// ControlsView Component - Controls tab content
import { computeStateFields } from '../utils/fieldProcessors.js';

export default {
    inject: ['deviceStore'],
    computed: {
        selectedDevice() {
            return this.deviceStore?.selectedDevice || null;
        },
        stateFields() {
            const controls = this.deviceStore?.controls || {};
            const fieldConfigs = this.deviceStore?.fieldConfigs || [];
            return computeStateFields(controls, fieldConfigs);
        },
        controlsPageState() {
            if (this.deviceStore?.loading) return 'loading';
            if (this.stateFields.length === 0 && this.deviceStore?.fieldConfigs?.length > 0) return 'no-controls';
            if (this.stateFields.length === 0) return 'waiting';
            return 'ready';
        }
    },
    methods: {
        getValue(key) {
            return this.deviceStore?.currentData?.[key];
        },
        getControl(key) {
            return this.deviceStore?.controls?.[key] || {};
        }
    },
    template: `
        <div class="space-y-3">
            <system-commands
                :device-eui="selectedDevice"
                :current-interval="getValue('tx') || 60"
                @send-command="$emit('send-command', $event)"
            />

            <div v-if="controlsPageState === 'loading'" class="flex justify-center py-8">
                <span class="loading loading-lg loading-spinner text-primary"></span>
            </div>

            <div v-else-if="controlsPageState === 'no-controls'" class="alert">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-info shrink-0 w-6 h-6">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <span>This device has no controllable fields defined in registration.</span>
            </div>

            <div v-else-if="controlsPageState === 'waiting'" class="alert alert-info">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <span>Waiting for device configuration...</span>
            </div>

            <div v-else-if="controlsPageState === 'ready'" class="space-y-3 sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0">
                <control-card 
                    v-for="f in stateFields" 
                    :key="f.key"
                    :field="f"
                    :control="getControl(f.key)"
                    @set-control="$emit('set-control', $event)"
                    @clear-override="$emit('clear-override', $event)" />
            </div>
        </div>
    `
};
