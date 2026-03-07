// RulesView Component - Rules tab content
import deviceStore from '../store/deviceStore.js';

export default {
    computed: {
        selectedDevice() {
            return deviceStore.state.selectedDevice;
        },
        deviceSchema() {
            return deviceStore.state.deviceSchema;
        },
        edgeRules() {
            return deviceStore.state.edgeRules;
        },
        triggers() {
            return deviceStore.state.triggers;
        },
        userRules() {
            return deviceStore.state.userRules;
        }
    },
    template: `
        <div class="space-y-3">
            <edge-rules-panel
                :device-eui="selectedDevice"
                :schema="deviceSchema"
                :edge-rules="edgeRules"
                @add-rule="$emit('add-edge-rule', $event)"
                @edit-rule="$emit('edit-edge-rule', $event)"
                @delete-rule="$emit('delete-edge-rule', $event)"
                @toggle-rule="$emit('toggle-edge-rule', $event)"
            />

            <device-triggers
                :triggers="triggers"
                @toggle-trigger="$emit('toggle-trigger', $event)"
            />

            <user-rules
                :rules="userRules"
                @add-rule="$emit('add-rule')"
                @edit-rule="$emit('edit-rule', $event)"
                @delete-rule="$emit('delete-rule', $event)"
                @toggle-rule="$emit('toggle-rule', $event)"
            />
        </div>
    `
};
