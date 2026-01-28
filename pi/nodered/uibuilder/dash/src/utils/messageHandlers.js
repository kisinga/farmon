// Message handlers for uibuilder messages
import {
    processFieldConfigs,
    createSystemFields,
    processControls,
    getControlCategory,
    createControlField,
    updateCurrentData
} from './fieldProcessors.js';

/**
 * Creates message handler functions that operate on a store context
 * @param {Object} store - The device store instance
 * @returns {Object} Handler functions keyed by topic
 */
export function createMessageHandlers(store) {
    return {
        handleDevicesMessage(msg) {
            store.devices = Array.isArray(msg.payload) ? msg.payload : [];
            // Auto-select first device if none selected
            if (store.devices.length > 0 && !store.selectedDevice) {
                const firstDevice = store.devices[0];
                if (firstDevice && firstDevice.eui) {
                    // Trigger device selection via callback
                    if (store.onDeviceSelect) {
                        store.onDeviceSelect(firstDevice.eui);
                    }
                }
            }
        },

        handleDeviceRegisteredMessage(msg) {
            const exists = store.devices.find(d => d.eui === msg.payload.eui);
            if (!exists) {
                store.devices.push(msg.payload);
            }
        },

        handleDeviceConfigMessage(msg, context) {
            const deviceSchema = msg.payload.schema || null;
            store.deviceSchema = deviceSchema;

            // Process field configs
            store.fieldConfigs = processFieldConfigs(
                msg.payload.fields || [],
                deviceSchema,
                (key, schema) => store.getCategoryFromSchema(key, schema)
            );

            // Add system fields (RSSI/SNR)
            const existingFieldKeys = new Set(store.fieldConfigs.map(f => f.key));
            const systemFields = createSystemFields(msg.payload.current, existingFieldKeys);
            if (systemFields.length > 0) {
                store.fieldConfigs = [...store.fieldConfigs, ...systemFields];
            }

            // Process controls
            const existingKeys = new Set(store.fieldConfigs.map(f => f.key));
            const { newControls, additionalFields } = processControls(
                msg.payload.controls || [],
                msg.payload.current?.data || {},
                deviceSchema,
                existingKeys,
                (val) => store.isControlValue(val),
                (key, schema) => store.getCategoryFromSchema(key, schema)
            );

            // Update reactive state atomically
            store.controls = { ...newControls };
            if (additionalFields.length > 0) {
                store.fieldConfigs = [...store.fieldConfigs, ...additionalFields];
            }
            store.syncControlsToFields();

            // Update metadata
            store.triggers = msg.payload.triggers || [];
            store.userRules = msg.payload.rules || [];
            store.deviceMeta = msg.payload.device || null;
            store.deviceSchema = msg.payload.schema || null;

            // Extract current telemetry data
            store.currentData = updateCurrentData(msg.payload.current);

            store.loading = false;

            // Auto-request history data for charts after config is loaded
            if (context && context.$nextTick) {
                context.$nextTick(() => {
                    if (context.requestHistory) {
                        context.requestHistory();
                    }
                });
            }
        },

        handleDeviceSchemaMessage(msg) {
            store.deviceSchema = msg.payload.schema || null;
        },

        handleEdgeRulesMessage(msg) {
            store.edgeRules = msg.payload.rules || [];
        },

        handleTelemetryMessage(msg, context) {
            if (msg.payload.eui !== store.selectedDevice) return;

            store.currentData = { ...store.currentData, ...msg.payload.data };

            let controlsUpdated = false;
            const newControls = { ...store.controls };
            const additionalFields = [];

            // Detect and sync controls from telemetry data
            Object.entries(msg.payload.data).forEach(([key, val]) => {
                if (store.isControlValue(val)) {
                    if (!newControls[key]) {
                        newControls[key] = {
                            control_key: key,
                            current_state: val,
                            mode: 'auto',
                            enum_values: ['off', 'on']
                        };
                        controlsUpdated = true;

                        if (!store.fieldConfigs.find(f => f.key === key)) {
                            const category = getControlCategory(key, store.deviceSchema, (k, s) => store.getCategoryFromSchema(k, s));
                            additionalFields.push(createControlField(key, category, ['off', 'on']));
                        }
                    } else if (newControls[key].current_state !== val) {
                        newControls[key] = { ...newControls[key], current_state: val };
                        controlsUpdated = true;
                    }
                }
            });

            // Update existing controls state from telemetry
            // Access stateFields from context if available (computed property)
            if (context && context.stateFields) {
                context.stateFields.forEach(f => {
                    if (msg.payload.data[f.key] !== undefined && newControls[f.key]) {
                        if (newControls[f.key].current_state !== msg.payload.data[f.key]) {
                            newControls[f.key] = { ...newControls[f.key], current_state: msg.payload.data[f.key] };
                            controlsUpdated = true;
                        }
                    }
                });
            }

            if (controlsUpdated) {
                store.controls = { ...newControls };
            }
            if (additionalFields.length > 0) {
                store.fieldConfigs = [...store.fieldConfigs, ...additionalFields];
            }
            if (controlsUpdated || additionalFields.length > 0) {
                store.syncControlsToFields();
            }
        },

        handleStateChangeMessage(msg) {
            if (msg.payload.eui !== store.selectedDevice) return;

            const oldState = store.controls[msg.payload.control]?.current_state;
            
            store.updateControl(msg.payload.control, {
                current_state: msg.payload.state,
                last_change_at: msg.payload.ts,
                last_change_by: msg.payload.reason
            });

            store.addStateChangeHistory({
                eui: msg.payload.eui,
                control: msg.payload.control,
                oldState: oldState,
                newState: msg.payload.state,
                source: msg.payload.reason || 'unknown',
                reason: msg.payload.reason || 'unknown',
                ts: msg.payload.ts || Date.now()
            });
        },

        handleHistoryMessage(msg) {
            store.historyData[msg.payload.field] = (msg.payload.data || []).map(d => ({
                ts: d.ts,
                value: typeof d.value === 'string' ? parseFloat(d.value) : d.value
            })).filter(d => !isNaN(d.value));
            store.historyData = { ...store.historyData };
        },

        handleCommandAckMessage(msg) {
            console.log('Command acknowledged:', msg.payload);
            store.addCommandHistory({
                eui: msg.payload.eui,
                type: 'system',
                command: msg.payload.command || 'unknown',
                status: msg.payload.status || 'ack',
                commandId: msg.payload.commandId,
                ts: Date.now()
            });
        },

        handleRulesMessage(msg) {
            if (msg.payload.eui === store.selectedDevice) {
                store.userRules = msg.payload.rules || [];
            }
        },

        handleRuleSavedMessage(msg, context) {
            if (msg.payload.eui !== store.selectedDevice || !msg.payload.rule) return;
            const idx = store.userRules.findIndex(r => r.id === msg.payload.rule.id);
            if (idx >= 0) {
                store.userRules[idx] = msg.payload.rule;
            } else {
                store.userRules.push(msg.payload.rule);
            }
            if (context && context.closeRuleEditor) {
                context.closeRuleEditor();
            }
        },

        handleRuleDeletedMessage(msg) {
            if (msg.payload.eui === store.selectedDevice) {
                store.userRules = store.userRules.filter(r => r.id !== msg.payload.ruleId);
            }
        },

        handleTriggerSavedMessage(msg) {
            if (msg.payload.eui !== store.selectedDevice || !msg.payload.trigger) return;
            const idx = store.triggers.findIndex(t => t.key === msg.payload.trigger.trigger_key);
            if (idx >= 0) {
                store.triggers[idx].enabled = msg.payload.trigger.enabled;
            }
        },

        handleControlUpdateMessage(msg) {
            if (msg.payload.eui === store.selectedDevice) {
                store.updateControl(msg.payload.control, {
                    current_state: msg.payload.state,
                    mode: msg.payload.mode
                });
            }
        },

        handleEdgeRuleSavedMessage(msg) {
            if (msg.payload.eui !== store.selectedDevice) return;
            const idx = store.edgeRules.findIndex(r => r.rule_id === msg.payload.rule.rule_id);
            if (idx >= 0) {
                store.edgeRules[idx] = msg.payload.rule;
            } else {
                store.edgeRules.push(msg.payload.rule);
            }
        },

        handleEdgeRuleDeletedMessage(msg) {
            if (msg.payload.eui === store.selectedDevice) {
                store.edgeRules = store.edgeRules.filter(r => r.rule_id !== msg.payload.ruleId);
            }
        }
    };
}
