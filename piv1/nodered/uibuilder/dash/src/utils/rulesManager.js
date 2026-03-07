// Rules and edge rules management utilities
import deviceStore from '../store/deviceStore.js';

export function createRuleManager(store, uibuilder) {
    return {
        toggleTrigger(triggerKey, enabled) {
            uibuilder.send({
                topic: 'saveTrigger',
                payload: {
                    eui: deviceStore.state.selectedDevice,
                    triggerKey,
                    enabled
                }
            });
        },

        toggleRule(rule, enabled) {
            uibuilder.send({
                topic: 'saveRule',
                payload: {
                    ...rule,
                    eui: deviceStore.state.selectedDevice,
                    enabled
                }
            });
        },

        openRuleEditor(rule = null, numericFields, stateFields, getEnumValues) {
            if (rule) {
                deviceStore.state.editingRule = {
                    id: rule.id,
                    name: rule.name,
                    condition: rule.condition || { field: '', op: '<', val: 0 },
                    action_control: rule.action_control,
                    action_state: rule.action_state,
                    priority: rule.priority || 100,
                    cooldown_seconds: rule.cooldown_seconds || 300,
                    enabled: rule.enabled ?? true
                };
            } else {
                const firstNumeric = numericFields[0];
                const firstState = stateFields[0];
                deviceStore.state.editingRule = {
                    id: null,
                    name: '',
                    condition: {
                        field: firstNumeric?.key || '',
                        op: '<',
                        val: 0
                    },
                    action_control: firstState?.key || '',
                    action_state: getEnumValues(firstState?.key)[0] || '',
                    priority: 100,
                    cooldown_seconds: 300,
                    enabled: true
                };
            }
            deviceStore.state.showRuleEditor = true;
        },

        closeRuleEditor() {
            deviceStore.state.showRuleEditor = false;
        },

        editRule(rule, numericFields, stateFields, getEnumValues) {
            this.openRuleEditor(rule, numericFields, stateFields, getEnumValues);
        },

        deleteRule(ruleId) {
            if (!confirm('Delete this rule?')) return;
            uibuilder.send({
                topic: 'deleteRule',
                payload: {
                    eui: deviceStore.state.selectedDevice,
                    ruleId
                }
            });
        },

        saveRule() {
            if (!deviceStore.isRuleValid.value) return;
            uibuilder.send({
                topic: 'saveRule',
                payload: {
                    ...deviceStore.state.editingRule,
                    eui: deviceStore.state.selectedDevice
                }
            });
        },

        openEdgeRuleEditor(rule = null) {
            if (!deviceStore.state.deviceSchema) {
                alert('Device schema not available. Cannot create edge rules.');
                return;
            }
            if (rule) {
                deviceStore.state.editingEdgeRule = {
                    rule_id: rule.rule_id,
                    field_idx: rule.field_idx,
                    operator: rule.operator,
                    threshold: rule.threshold,
                    control_idx: rule.control_idx,
                    action_state: rule.action_state,
                    priority: rule.priority ?? 128,
                    cooldown_seconds: rule.cooldown_seconds ?? 300,
                    enabled: rule.enabled ?? true
                };
            } else {
                deviceStore.state.editingEdgeRule = {
                    rule_id: null,
                    field_idx: 0,
                    operator: '<',
                    threshold: 0,
                    control_idx: 0,
                    action_state: 0,
                    priority: 128,
                    cooldown_seconds: 300,
                    enabled: true
                };
            }
            deviceStore.state.showEdgeRuleEditor = true;
        },

        closeEdgeRuleEditor() {
            deviceStore.state.showEdgeRuleEditor = false;
        },

        saveEdgeRule() {
            if (!deviceStore.isEdgeRuleValid.value) return;
            uibuilder.send({
                topic: 'saveEdgeRule',
                payload: {
                    eui: deviceStore.state.selectedDevice,
                    ...deviceStore.state.editingEdgeRule
                }
            });
            this.closeEdgeRuleEditor();
        },

        getControlStates(controlIdx) {
            const schema = deviceStore.state.deviceSchema;
            if (!schema?.controls || controlIdx >= schema.controls.length) {
                return ['off', 'on'];
            }
            return schema.controls[controlIdx]?.v || ['off', 'on'];
        },

        deleteEdgeRule(ruleId) {
            if (!confirm('Delete this edge rule?')) return;
            uibuilder.send({
                topic: 'deleteEdgeRule',
                payload: {
                    eui: deviceStore.state.selectedDevice,
                    ruleId
                }
            });
        },

        toggleEdgeRule(data) {
            uibuilder.send({
                topic: 'toggleEdgeRule',
                payload: {
                    eui: deviceStore.state.selectedDevice,
                    ruleId: data.ruleId,
                    enabled: data.enabled
                }
            });
        }
    };
}
