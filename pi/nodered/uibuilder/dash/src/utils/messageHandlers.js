// Message handlers for uibuilder messages
import {
    processFieldConfigs,
    createSystemFields,
    processControls,
    getControlCategory,
    createControlField,
    updateCurrentData
} from './fieldProcessors.js';
import deviceStore from '../store/deviceStore.js';

/**
 * Creates message handler functions that operate on a store context
 * @param {Object} store - The device store instance
 * @returns {Object} Handler functions keyed by topic
 */
export function createMessageHandlers(store) {
    return {
        handleDevicesMessage(msg) {
            deviceStore.state.devices = Array.isArray(msg.payload) ? msg.payload : [];

            // Auto-select first device if none selected
            if (deviceStore.state.devices.length > 0 && !deviceStore.state.selectedDevice) {
                const firstDevice = deviceStore.state.devices[0];
                if (firstDevice && firstDevice.eui && store.onDeviceSelect) {
                    store.onDeviceSelect(firstDevice.eui);
                }
            }
        },

        handleDeviceRegisteredMessage(msg) {
            const exists = deviceStore.state.devices.find(d => d.eui === msg.payload.eui);
            if (!exists) {
                deviceStore.state.devices.push(msg.payload);
            }
        },

        handleDeviceConfigMessage(msg, context) {
            console.log('[DeviceConfig] Received:', {
                fields: (msg.payload.fields || []).length,
                controls: (msg.payload.controls || []).length,
                schema: !!msg.payload.schema,
                current: !!msg.payload.current
            });

            const deviceSchema = msg.payload.schema || null;
            deviceStore.state.deviceSchema = deviceSchema;

            // Process field configs
            deviceStore.state.fieldConfigs = processFieldConfigs(
                msg.payload.fields || [],
                deviceSchema,
                (key, schema) => deviceStore.getCategoryFromSchema(key, schema),
                (key, schema) => deviceStore.getStateClassFromSchema(key, schema)
            );

            // Add system fields (RSSI/SNR)
            const existingFieldKeys = new Set(deviceStore.state.fieldConfigs.map(f => f.key));
            const systemFields = createSystemFields(msg.payload.current, existingFieldKeys);
            if (systemFields.length > 0) {
                deviceStore.state.fieldConfigs = [...deviceStore.state.fieldConfigs, ...systemFields];
            }

            // Process controls
            const existingKeys = new Set(deviceStore.state.fieldConfigs.map(f => f.key));
            const { newControls, additionalFields } = processControls(
                msg.payload.controls || [],
                msg.payload.current?.data || {},
                deviceSchema,
                existingKeys,
                (val) => deviceStore.isControlValue(val),
                (key, schema) => deviceStore.getCategoryFromSchema(key, schema)
            );

            // Update reactive state atomically
            deviceStore.state.controls = { ...newControls };
            if (additionalFields.length > 0) {
                deviceStore.state.fieldConfigs = [...deviceStore.state.fieldConfigs, ...additionalFields];
            }
            deviceStore.syncControlsToFields();

            // Update metadata
            deviceStore.state.triggers = msg.payload.triggers || [];
            deviceStore.state.userRules = msg.payload.rules || [];
            deviceStore.state.deviceMeta = msg.payload.device || null;
            deviceStore.state.deviceSchema = msg.payload.schema || null;

            // Extract current telemetry data
            deviceStore.state.currentData = updateCurrentData(msg.payload.current);

            deviceStore.state.loading = false;

            // Auto-request history data for charts after config is loaded
            if (context && context.$nextTick && context.requestHistory) {
                context.$nextTick(() => {
                    context.requestHistory();
                });
            }
        },

        handleDeviceSchemaMessage(msg) {
            deviceStore.state.deviceSchema = msg.payload.schema || null;
        },

        handleEdgeRulesMessage(msg) {
            deviceStore.state.edgeRules = msg.payload.rules || [];
        },

        handleTelemetryMessage(msg, context) {
            if (msg.payload.eui !== deviceStore.state.selectedDevice) return;

            deviceStore.state.currentData = { ...deviceStore.state.currentData, ...msg.payload.data };

            let controlsUpdated = false;
            const newControls = { ...deviceStore.state.controls };
            const additionalFields = [];

            // Detect and sync controls from telemetry data
            Object.entries(msg.payload.data).forEach(([key, val]) => {
                if (deviceStore.isControlValue(val)) {
                    if (!newControls[key]) {
                        newControls[key] = {
                            control_key: key,
                            current_state: val,
                            mode: 'auto',
                            enum_values: ['off', 'on']
                        };
                        controlsUpdated = true;

                        if (!deviceStore.state.fieldConfigs.find(f => f.key === key)) {
                            const category = getControlCategory(key, deviceStore.state.deviceSchema, (k, s) => deviceStore.getCategoryFromSchema(k, s));
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
                deviceStore.state.controls = { ...newControls };
            }
            if (additionalFields.length > 0) {
                deviceStore.state.fieldConfigs = [...deviceStore.state.fieldConfigs, ...additionalFields];
            }
            if (controlsUpdated || additionalFields.length > 0) {
                deviceStore.syncControlsToFields();
            }
        },

        handleStateChangeMessage(msg) {
            if (msg.payload.eui !== deviceStore.state.selectedDevice) return;

            const oldState = deviceStore.state.controls[msg.payload.control]?.current_state;

            deviceStore.updateControl(msg.payload.control, {
                current_state: msg.payload.state,
                last_change_at: msg.payload.ts,
                last_change_by: msg.payload.reason
            });

            deviceStore.addStateChangeHistory({
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
            const dataLen = (msg.payload.data || []).length;
            console.log('[History]', msg.payload.field, ':', dataLen, 'points',
                dataLen > 0 ? '| sample:' : '', dataLen > 0 ? msg.payload.data[0] : '');

            deviceStore.state.historyData[msg.payload.field] = (msg.payload.data || []).map(d => ({
                ts: d.ts,
                value: typeof d.value === 'string' ? parseFloat(d.value) : d.value
            })).filter(d => !isNaN(d.value));
            deviceStore.state.historyData = { ...deviceStore.state.historyData };
        },

        handleCommandAckMessage(msg) {
            deviceStore.addCommandHistory({
                eui: msg.payload.eui,
                type: 'system',
                command: msg.payload.command || 'unknown',
                status: msg.payload.status || 'ack',
                commandId: msg.payload.commandId,
                ts: Date.now()
            });
        },

        handleRulesMessage(msg) {
            if (msg.payload.eui === deviceStore.state.selectedDevice) {
                deviceStore.state.userRules = msg.payload.rules || [];
            }
        },

        handleRuleSavedMessage(msg, context) {
            if (msg.payload.eui !== deviceStore.state.selectedDevice || !msg.payload.rule) return;
            const idx = deviceStore.state.userRules.findIndex(r => r.id === msg.payload.rule.id);
            if (idx >= 0) {
                deviceStore.state.userRules[idx] = msg.payload.rule;
            } else {
                deviceStore.state.userRules.push(msg.payload.rule);
            }
            if (context && context.closeRuleEditor) {
                context.closeRuleEditor();
            }
        },

        handleRuleDeletedMessage(msg) {
            if (msg.payload.eui === deviceStore.state.selectedDevice) {
                deviceStore.state.userRules = deviceStore.state.userRules.filter(r => r.id !== msg.payload.ruleId);
            }
        },

        handleTriggerSavedMessage(msg) {
            if (msg.payload.eui !== deviceStore.state.selectedDevice || !msg.payload.trigger) return;
            const idx = deviceStore.state.triggers.findIndex(t => t.key === msg.payload.trigger.trigger_key);
            if (idx >= 0) {
                deviceStore.state.triggers[idx].enabled = msg.payload.trigger.enabled;
            }
        },

        handleControlUpdateMessage(msg) {
            if (msg.payload.eui === deviceStore.state.selectedDevice) {
                deviceStore.updateControl(msg.payload.control, {
                    current_state: msg.payload.state,
                    mode: msg.payload.mode
                });
            }
        },

        handleEdgeRuleSavedMessage(msg) {
            if (msg.payload.eui !== deviceStore.state.selectedDevice) return;
            const idx = deviceStore.state.edgeRules.findIndex(r => r.rule_id === msg.payload.rule.rule_id);
            if (idx >= 0) {
                deviceStore.state.edgeRules[idx] = msg.payload.rule;
            } else {
                deviceStore.state.edgeRules.push(msg.payload.rule);
            }
        },

        handleEdgeRuleDeletedMessage(msg) {
            if (msg.payload.eui === deviceStore.state.selectedDevice) {
                deviceStore.state.edgeRules = deviceStore.state.edgeRules.filter(r => r.rule_id !== msg.payload.ruleId);
            }
        }
    };
}
