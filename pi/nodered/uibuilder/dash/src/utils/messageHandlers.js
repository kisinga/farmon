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
 * Normalizes EUI string for comparison (lowercase, alphanumeric only)
 */
function normalizeEui(eui) {
    return (eui && String(eui).toLowerCase().replace(/[^a-f0-9]/g, '')) || '';
}

/**
 * Checks if message is for the currently selected device
 */
function isForSelectedDevice(eui) {
    return eui && normalizeEui(eui) === normalizeEui(deviceStore.state.selectedDevice);
}

/**
 * Updates device's lastSeen timestamp for online status tracking
 */
function updateDeviceLastSeen(eui, timestamp) {
    if (!eui) return;
    
    const idx = deviceStore.state.devices.findIndex(d => normalizeEui(d.eui) === normalizeEui(eui));
    if (idx >= 0) {
        const device = deviceStore.state.devices[idx];
        const oldLastSeen = device.lastSeen;
        const newLastSeen = timestamp || new Date().toISOString();
        console.log('[updateDeviceLastSeen]', {
            eui,
            idx,
            oldLastSeen,
            newLastSeen,
            elapsed: oldLastSeen ? Date.now() - new Date(oldLastSeen).getTime() : null
        });
        // Create new device object (same pattern as currentData updates)
        const updatedDevice = { ...device, lastSeen: newLastSeen };
        // Replace entire array with new device object
        deviceStore.state.devices = [
            ...deviceStore.state.devices.slice(0, idx),
            updatedDevice,
            ...deviceStore.state.devices.slice(idx + 1)
        ];
    } else {
        console.log('[updateDeviceLastSeen] Device not found:', eui, 'devices:', deviceStore.state.devices.map(d => d.eui));
    }
}

/**
 * Updates current telemetry data with payload data, RSSI, and SNR
 */
function updateCurrentTelemetryData(payload) {
    const data = payload.data || {};
    const next = { ...deviceStore.state.currentData, ...data };
    
    if (payload.rssi != null) next.rssi = payload.rssi;
    if (payload.snr != null) next.snr = payload.snr;
    
    deviceStore.state.currentData = next;
}

/**
 * Updates or inserts an item in an array based on a find condition
 * @param {Array} array - The array to update
 * @param {Function} findFn - Function to find existing item
 * @param {*} newItem - Item to insert or update with
 * @returns {Array} New array with updated item
 */
function updateOrInsert(array, findFn, newItem) {
    const idx = array.findIndex(findFn);
    if (idx >= 0) {
        const updated = [...array];
        updated[idx] = newItem;
        return updated;
    }
    return [...array, newItem];
}

/**
 * Processes device configuration: fields, system fields, and controls
 */
function processDeviceConfig(payload) {
    const deviceSchema = payload.schema || null;
    
    // Process field configs
    const fieldConfigs = processFieldConfigs(
        payload.fields || [],
        deviceSchema,
        (key, schema) => deviceStore.getCategoryFromSchema(key, schema),
        (key, schema) => deviceStore.getStateClassFromSchema(key, schema)
    );

    // Add system fields (RSSI/SNR)
    const existingFieldKeys = new Set(fieldConfigs.map(f => f.key));
    const systemFields = createSystemFields(payload.current, existingFieldKeys);
    const allFieldConfigs = systemFields.length > 0 
        ? [...fieldConfigs, ...systemFields]
        : fieldConfigs;

    // Process controls
    const existingKeys = new Set(allFieldConfigs.map(f => f.key));
    const { newControls, additionalFields } = processControls(
        payload.controls || [],
        payload.current?.data || {},
        deviceSchema,
        existingKeys,
        (val) => deviceStore.isControlValue(val),
        (key, schema) => deviceStore.getCategoryFromSchema(key, schema)
    );

    const finalFieldConfigs = additionalFields.length > 0
        ? [...allFieldConfigs, ...additionalFields]
        : allFieldConfigs;

    return {
        deviceSchema,
        fieldConfigs: finalFieldConfigs,
        controls: newControls
    };
}

/**
 * Processes controls from telemetry data and stateFields
 * Returns updated controls and any additional fields that need to be added
 */
function processTelemetryControls(telemetryData, stateFields, existingControls, fieldConfigs, deviceSchema, isControlValue, getCategoryFromSchema) {
    const newControls = { ...existingControls };
    const additionalFields = [];
    let controlsUpdated = false;
    const existingFieldKeys = new Set(fieldConfigs.map(f => f.key));

    // Detect new controls from telemetry data
    Object.entries(telemetryData).forEach(([key, val]) => {
        if (!isControlValue(val)) return;

        const isNewControl = !newControls[key];
        const stateChanged = !isNewControl && newControls[key].current_state !== val;

        if (isNewControl) {
            newControls[key] = {
                control_key: key,
                current_state: val,
                mode: 'auto',
                enum_values: ['off', 'on']
            };
            controlsUpdated = true;

            // Add field config if missing
            if (!existingFieldKeys.has(key)) {
                const category = getControlCategory(key, deviceSchema, getCategoryFromSchema);
                additionalFields.push(createControlField(key, category, ['off', 'on']));
            }
        } else if (stateChanged) {
            newControls[key] = { ...newControls[key], current_state: val };
            controlsUpdated = true;
        }
    });

    // Update existing controls from stateFields
    if (stateFields) {
        stateFields.forEach(field => {
            const value = telemetryData[field.key];
            const control = newControls[field.key];
            
            if (value !== undefined && control && control.current_state !== value) {
                newControls[field.key] = { ...control, current_state: value };
                controlsUpdated = true;
            }
        });
    }

    return { 
        controlsUpdated, 
        additionalFields,
        newControls 
    };
}

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
            const firstDevice = deviceStore.state.devices[0];
            if (firstDevice?.eui && !deviceStore.state.selectedDevice && store.onDeviceSelect) {
                store.onDeviceSelect(firstDevice.eui);
            }
        },

        handleDeviceRegisteredMessage(msg) {
            const exists = deviceStore.state.devices.some(d => d.eui === msg.payload.eui);
            if (!exists) {
                deviceStore.state.devices.push(msg.payload);
            }
        },

        handleDeviceConfigMessage(msg, context) {
            const payload = msg.payload;
            
            console.log('[DeviceConfig] Received:', {
                fields: (payload.fields || []).length,
                controls: (payload.controls || []).length,
                schema: !!payload.schema,
                current: !!payload.current
            });

            // Process configuration (fields, system fields, controls)
            const { deviceSchema, fieldConfigs, controls } = processDeviceConfig(payload);

            // Update reactive state atomically
            deviceStore.state.deviceSchema = deviceSchema;
            deviceStore.state.fieldConfigs = fieldConfigs;
            deviceStore.state.controls = { ...controls };
            deviceStore.syncControlsToFields();

            // Update metadata
            deviceStore.state.triggers = payload.triggers || [];
            deviceStore.state.userRules = payload.rules || [];
            deviceStore.state.deviceMeta = payload.device || null;
            deviceStore.state.currentData = updateCurrentData(payload.current);
            deviceStore.state.loading = false;

            // Auto-request history data for charts after config is loaded
            context?.$nextTick?.(() => {
                context.requestHistory?.();
            });
        },

        handleDeviceSchemaMessage(msg) {
            deviceStore.state.deviceSchema = msg.payload.schema || null;
        },

        handleEdgeRulesMessage(msg) {
            deviceStore.state.edgeRules = msg.payload.rules || [];
        },

        handleTelemetryMessage(msg, context) {
            const payload = msg.payload || {};
            const eui = payload.eui;
            
            console.log('[handleTelemetryMessage]', { eui, ts: payload.ts, hasData: !!payload.data });
            
            // Update device's lastSeen for all devices (for online status)
            updateDeviceLastSeen(eui, payload.ts);
            // Client-side "received at" so online status is correct even with wrong system time
            deviceStore.setLastSeenReceivedAt(eui);

            // Early return if not for selected device
            if (!isForSelectedDevice(eui)) {
                return;
            }

            // Update current telemetry data
            updateCurrentTelemetryData(payload);

            // Process and sync controls from telemetry
            const { controlsUpdated, additionalFields, newControls } = processTelemetryControls(
                payload.data || {},
                context?.stateFields,
                deviceStore.state.controls,
                deviceStore.state.fieldConfigs,
                deviceStore.state.deviceSchema,
                deviceStore.isControlValue.bind(deviceStore),
                deviceStore.getCategoryFromSchema.bind(deviceStore)
            );

            // Apply updates atomically
            if (controlsUpdated || additionalFields.length > 0) {
                if (controlsUpdated) {
                    deviceStore.state.controls = { ...newControls };
                }
                if (additionalFields.length > 0) {
                    deviceStore.state.fieldConfigs = [...deviceStore.state.fieldConfigs, ...additionalFields];
                }
                deviceStore.syncControlsToFields();
            }
        },

        handleStateChangeMessage(msg) {
            if (!isForSelectedDevice(msg.payload.eui)) return;

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

        handleCommandHistoryMessage(msg) {
            const payload = msg.payload || {};
            const eui = payload.eui;
            const commands = payload.commands || [];
            console.log('[CommandHistory]', eui, ':', commands.length, 'commands');

            // Replace command history for this device (filter out old entries for this device, then add new ones)
            deviceStore.state.commandHistory = [
                ...deviceStore.state.commandHistory.filter(h => h.eui !== eui),
                ...commands.map(cmd => ({
                    eui: eui,
                    type: cmd.type || (cmd.command_key?.startsWith('set_') ? 'control' : 'system'),
                    command: cmd.command_key || cmd.command,
                    control: cmd.command_key?.replace('set_', '') || cmd.control,
                    state: cmd.payload ? (typeof cmd.payload === 'string' ? JSON.parse(cmd.payload)?.state : cmd.payload?.state) : cmd.state,
                    value: cmd.payload ? (typeof cmd.payload === 'string' ? JSON.parse(cmd.payload)?.value : cmd.payload?.value) : cmd.value,
                    source: cmd.initiated_by || cmd.source || 'unknown',
                    status: cmd.status || 'pending',
                    commandId: cmd.id,
                    ts: cmd.created_at ? new Date(cmd.created_at).getTime() : (cmd.sent_at ? new Date(cmd.sent_at).getTime() : Date.now())
                }))
            ].sort((a, b) => (b.ts || 0) - (a.ts || 0));
        },

        handleStateHistoryMessage(msg) {
            const payload = msg.payload || {};
            const eui = payload.eui;
            const stateChanges = payload.stateChanges || [];
            console.log('[StateHistory]', eui, ':', stateChanges.length, 'state changes');

            // Replace state change history for this device
            deviceStore.state.stateChangeHistory = [
                ...deviceStore.state.stateChangeHistory.filter(h => h.eui !== eui),
                ...stateChanges.map(change => ({
                    eui: eui,
                    control: change.control_key || change.control,
                    oldState: change.old_state,
                    newState: change.new_state,
                    source: change.reason || change.source || 'unknown',
                    reason: change.reason || 'unknown',
                    ts: change.ts ? new Date(change.ts).getTime() : (change.device_ts ? new Date(change.device_ts).getTime() : Date.now())
                }))
            ].sort((a, b) => (b.ts || 0) - (a.ts || 0));
        },

        handleHistoryMessage(msg) {
            const data = msg.payload.data || [];
            const field = msg.payload.field;
            const dataLen = data.length;
            
            console.log('[History]', field, ':', dataLen, 'points',
                dataLen > 0 ? '| sample:' : '', dataLen > 0 ? data[0] : '');

            const processedData = data
                .map(d => ({
                    ts: d.ts,
                    value: typeof d.value === 'string' ? parseFloat(d.value) : d.value
                }))
                .filter(d => !isNaN(d.value));

            deviceStore.state.historyData = {
                ...deviceStore.state.historyData,
                [field]: processedData
            };
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
            if (isForSelectedDevice(msg.payload.eui)) {
                deviceStore.state.userRules = msg.payload.rules || [];
            }
        },

        handleRuleSavedMessage(msg, context) {
            if (!isForSelectedDevice(msg.payload.eui) || !msg.payload.rule) return;
            
            deviceStore.state.userRules = updateOrInsert(
                deviceStore.state.userRules,
                r => r.id === msg.payload.rule.id,
                msg.payload.rule
            );
            
            context?.closeRuleEditor?.();
        },

        handleRuleDeletedMessage(msg) {
            if (!isForSelectedDevice(msg.payload.eui)) return;
            
            deviceStore.state.userRules = deviceStore.state.userRules.filter(
                r => r.id !== msg.payload.ruleId
            );
        },

        handleTriggerSavedMessage(msg) {
            if (!isForSelectedDevice(msg.payload.eui) || !msg.payload.trigger) return;
            
            const idx = deviceStore.state.triggers.findIndex(
                t => t.key === msg.payload.trigger.trigger_key
            );
            if (idx >= 0) {
                deviceStore.state.triggers[idx].enabled = msg.payload.trigger.enabled;
            }
        },

        handleControlUpdateMessage(msg) {
            if (!isForSelectedDevice(msg.payload.eui)) return;
            
            deviceStore.updateControl(msg.payload.control, {
                current_state: msg.payload.state,
                mode: msg.payload.mode
            });
        },

        handleEdgeRuleSavedMessage(msg) {
            if (!isForSelectedDevice(msg.payload.eui) || !msg.payload.rule) return;
            
            deviceStore.state.edgeRules = updateOrInsert(
                deviceStore.state.edgeRules,
                r => r.rule_id === msg.payload.rule.rule_id,
                msg.payload.rule
            );
        },

        handleEdgeRuleDeletedMessage(msg) {
            if (!isForSelectedDevice(msg.payload.eui)) return;
            
            deviceStore.state.edgeRules = deviceStore.state.edgeRules.filter(
                r => r.rule_id !== msg.payload.ruleId
            );
        },

        handleGatewayStatusMessage(msg) {
            const payload = msg.payload || {};
            const state = (payload.state || '').toUpperCase();
            const gatewayId = payload.gatewayId || payload.gateway_id || 'unknown';
            const wasOnline = deviceStore.state.gatewayOnline;
            const isOnline = state === 'ONLINE';
            
            deviceStore.state.gatewayOnline = isOnline;

            if (state === 'OFFLINE') {
                console.warn('[Gateway] Offline:', gatewayId);
            } else if (isOnline && !wasOnline) {
                console.log('[Gateway] Back online:', gatewayId);
            }
        }
    };
}
