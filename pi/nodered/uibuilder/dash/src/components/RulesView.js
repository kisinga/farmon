// RulesView Component - Rules tab content
export default {
    inject: ['deviceStore'],
    computed: {
        selectedDevice() {
            return this.deviceStore?.selectedDevice || null;
        },
        deviceSchema() {
            return this.deviceStore?.deviceSchema || null;
        },
        edgeRules() {
            return this.deviceStore?.edgeRules || [];
        },
        triggers() {
            return this.deviceStore?.triggers || [];
        },
        userRules() {
            return this.deviceStore?.userRules || [];
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
