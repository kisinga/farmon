// Rules and edge rules management utilities

export function createRuleManager(store, uibuilder) {
    return {
        toggleTrigger(triggerKey, enabled) {
            uibuilder.send({
                topic: 'saveTrigger',
                payload: {
                    eui: store.selectedDevice,
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
                    eui: store.selectedDevice,
                    enabled
                }
            });
        },

        openRuleEditor(rule = null, numericFields, stateFields, getEnumValues) {
            if (rule) {
                // Edit existing rule
                store.editingRule = {
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
                // New rule - set defaults
                const firstNumeric = numericFields[0];
                const firstState = stateFields[0];
                store.editingRule = {
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
            store.showRuleEditor = true;
        },

        closeRuleEditor() {
            store.showRuleEditor = false;
        },

        editRule(rule, numericFields, stateFields, getEnumValues) {
            this.openRuleEditor(rule, numericFields, stateFields, getEnumValues);
        },

        deleteRule(ruleId) {
            if (!confirm('Delete this rule?')) return;
            uibuilder.send({
                topic: 'deleteRule',
                payload: {
                    eui: store.selectedDevice,
                    ruleId
                }
            });
        },

        saveRule() {
            if (!store.isRuleValid) return;
            uibuilder.send({
                topic: 'saveRule',
                payload: {
                    ...store.editingRule,
                    eui: store.selectedDevice
                }
            });
        },

        openEdgeRuleEditor(rule = null) {
            if (!store.deviceSchema) {
                alert('Device schema not available. Cannot create edge rules.');
                return;
            }
            if (rule) {
                // Edit existing rule
                store.editingEdgeRule = {
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
                // New rule
                store.editingEdgeRule = {
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
            store.showEdgeRuleEditor = true;
        },

        closeEdgeRuleEditor() {
            store.showEdgeRuleEditor = false;
        },

        saveEdgeRule() {
            if (!store.isEdgeRuleValid.value) return;
            uibuilder.send({
                topic: 'saveEdgeRule',
                payload: {
                    eui: store.selectedDevice,
                    ...store.editingEdgeRule
                }
            });
            this.closeEdgeRuleEditor();
        },

        getControlStates(controlIdx) {
            if (!store.deviceSchema?.controls || controlIdx >= store.deviceSchema.controls.length) {
                return ['off', 'on'];
            }
            return store.deviceSchema.controls[controlIdx]?.v || ['off', 'on'];
        },

        deleteEdgeRule(ruleId) {
            if (!confirm('Delete this edge rule?')) return;
            uibuilder.send({
                topic: 'deleteEdgeRule',
                payload: {
                    eui: store.selectedDevice,
                    ruleId
                }
            });
        },

        toggleEdgeRule(data) {
            uibuilder.send({
                topic: 'toggleEdgeRule',
                payload: {
                    eui: store.selectedDevice,
                    ruleId: data.ruleId,
                    enabled: data.enabled
                }
            });
        }
    };
}
