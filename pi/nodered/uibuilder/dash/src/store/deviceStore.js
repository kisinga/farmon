// @ts-nocheck
'use strict'
// Device State Store - Vue 3 Composable Pattern
// Uses reactive() for state + computed() for derived values

const { reactive, computed, toRefs } = Vue;

// =============================================================================
// 1. BASE REACTIVE STATE (properties only, no getters)
// =============================================================================
const state = reactive({
    // Connection state
    connected: false,
    loading: false,
    activeTab: 'dashboard',

    // Devices
    devices: [],
    selectedDevice: null,

    // Selected device config (from backend)
    fieldConfigs: [],
    controls: {},
    triggers: [],
    userRules: [],

    // Telemetry data
    currentData: {},
    historyData: {},

    // Time range
    timeRange: '24h',
    customFrom: '',
    customTo: '',

    // Device metadata
    deviceMeta: null,

    // Device schema (for edge rules)
    deviceSchema: null,

    // Edge rules (device-side rules)
    edgeRules: [],

    // Command and state change history
    commandHistory: [],
    stateChangeHistory: [],

    // Rule editor state
    editingRule: {
        id: null,
        name: '',
        condition: { field: '', op: '<', val: 0 },
        action_control: '',
        action_state: '',
        priority: 100,
        cooldown_seconds: 300,
        enabled: true
    },

    // Edge rule editor state
    editingEdgeRule: {
        rule_id: null,
        field_idx: 0,
        operator: '<',
        threshold: 0,
        control_idx: 0,
        action_state: 0,
        priority: 128,
        cooldown_seconds: 300,
        enabled: true
    },

    // Modal visibility state
    showRuleEditor: false,
    showEdgeRuleEditor: false
});

// =============================================================================
// 2. COMPUTED REFS (replace all JS getters)
// =============================================================================

const selectedDeviceName = computed(() => {
    const device = state.devices.find(d => d.eui === state.selectedDevice);
    return device ? (device.name || device.eui) : 'Select Device';
});

const deviceOnline = computed(() => {
    const device = state.devices.find(d => d.eui === state.selectedDevice);
    if (!device || !device.lastSeen) return false;
    const threeMinutes = 3 * 60 * 1000;
    return (Date.now() - new Date(device.lastSeen).getTime()) < threeMinutes;
});

const gaugeFields = computed(() =>
    state.fieldConfigs
        .filter(f => f.is_visible && (f.viz_type === 'gauge' || f.viz_type === 'both') && f.category !== 'state')
        .sort((a, b) => a.sort_order - b.sort_order)
);

const chartFields = computed(() =>
    state.fieldConfigs
        .filter(f => f.is_visible && f.chartable !== false && (f.viz_type === 'chart' || f.viz_type === 'both') && f.category !== 'state')
        .sort((a, b) => a.sort_order - b.sort_order)
);

const badgeFields = computed(() =>
    state.fieldConfigs
        .filter(f => f.is_visible && f.viz_type === 'badge')
        .sort((a, b) => a.sort_order - b.sort_order)
);

const systemFields = computed(() =>
    state.fieldConfigs
        .filter(f => f.is_visible && f.category === 'sys')
        .sort((a, b) => a.sort_order - b.sort_order)
);

const diagnosticFields = computed(() =>
    state.fieldConfigs
        .filter(f => f.is_visible && f.category === 'diagnostic')
        .sort((a, b) => a.sort_order - b.sort_order)
);

const sensorFields = computed(() =>
    state.fieldConfigs
        .filter(f => f.is_visible && f.category === 'cont')
        .sort((a, b) => a.sort_order - b.sort_order)
);

const sensorBadgeFields = computed(() =>
    state.fieldConfigs
        .filter(f => f.is_visible && f.viz_type === 'badge' && f.category === 'cont')
        .sort((a, b) => a.sort_order - b.sort_order)
);

const systemBadgeFields = computed(() =>
    state.fieldConfigs
        .filter(f => f.is_visible && f.viz_type === 'badge' && (f.category === 'sys' || f.category === 'diagnostic'))
        .sort((a, b) => a.sort_order - b.sort_order)
);

const topBarFields = computed(() =>
    state.fieldConfigs
        .filter(f => f.show_in_top_bar === true)
        .sort((a, b) => a.sort_order - b.sort_order)
);

const numericFields = computed(() =>
    state.fieldConfigs
        .filter(f => f.type === 'num')
        .sort((a, b) => a.sort_order - b.sort_order)
);

const allFieldsForRules = computed(() =>
    state.fieldConfigs
        .filter(f => f.type === 'num' && f.category !== 'state')
        .map(f => ({
            ...f,
            categoryLabel: getFieldCategoryLabel(f)
        }))
        .sort((a, b) => {
            const categoryOrder = { 'cont': 0, 'diagnostic': 1, 'sys': 2 };
            const catA = categoryOrder[a.category] ?? 3;
            const catB = categoryOrder[b.category] ?? 3;
            if (catA !== catB) return catA - catB;
            return a.sort_order - b.sort_order;
        })
);

const schemaFields = computed(() => state.deviceSchema?.fields || []);

const schemaControls = computed(() => state.deviceSchema?.controls || []);

const isRuleValid = computed(() => {
    const r = state.editingRule;
    return r.name && r.name.trim() &&
           r.condition.field &&
           r.condition.op &&
           r.condition.val !== '' && r.condition.val !== null &&
           r.action_control &&
           r.action_state;
});

const isEdgeRuleValid = computed(() => {
    const r = state.editingEdgeRule;
    return r.field_idx !== null && r.field_idx !== undefined &&
           r.operator &&
           r.threshold !== null && r.threshold !== undefined &&
           r.control_idx !== null && r.control_idx !== undefined &&
           r.action_state !== null && r.action_state !== undefined;
});

const hasRawData = computed(() => Object.keys(state.currentData).length > 0);

const hasSchemaData = computed(() => state.fieldConfigs.length > 0);

const shouldShowRawData = computed(() => !hasSchemaData.value && hasRawData.value);

const dashboardState = computed(() => {
    if (state.loading) return 'loading';
    if (!state.selectedDevice) return 'no-device';
    if (!hasSchemaData.value && !hasRawData.value) return 'no-schema';
    if (shouldShowRawData.value) return 'raw-data';
    return 'schema-data';
});

// =============================================================================
// 3. HELPER FUNCTIONS (not reactive, just utilities)
// =============================================================================

function getSoftLabel(key) {
    return null;
}

function isControlValue(val) {
    if (typeof val !== 'string') return false;
    const controlStates = ['on', 'off', 'open', 'closed', 'true', 'false', 'active', 'inactive', 'running', 'stopped'];
    return controlStates.includes(val.toLowerCase());
}

function getGaugeStyleHint(key) {
    return null;
}

function getFieldCategoryLabel(field) {
    if (!field) return 'Unknown';
    const categoryMap = {
        'sys': 'System',
        'diagnostic': 'Diagnostic',
        'state': 'Control',
        'cont': 'Sensor'
    };
    return categoryMap[field.category] || 'Unknown';
}

function getFieldCategoryClass(field) {
    if (!field) return 'badge-ghost';
    const classMap = {
        'sys': 'badge-neutral',
        'diagnostic': 'badge-warning',
        'state': 'badge-success',
        'cont': 'badge-info'
    };
    return classMap[field.category] || 'badge-ghost';
}

function getCategoryFromSchema(key, schema) {
    if (!schema) return null;
    const allFields = [...(schema.fields || []), ...(schema.sys || [])];
    const field = allFields.find(f => (f.k || f.key) === key);
    if (!field) return null;
    return field.c || field.category || null;
}

function getStateClassFromSchema(key, schema) {
    if (!schema) return null;
    const allFields = [...(schema.fields || []), ...(schema.sys || [])];
    const field = allFields.find(f => (f.k || f.key) === key);
    if (!field) return null;
    return field.s || field.state_class || null;
}

// =============================================================================
// 4. METHODS (mutate state)
// =============================================================================

function syncControlsToFields() {
    const controlKeys = Object.keys(state.controls);
    const existingFieldKeys = new Set(state.fieldConfigs.map(f => f.key));
    const additionalFields = [];

    controlKeys.forEach(key => {
        if (!existingFieldKeys.has(key)) {
            let category = 'state';
            if (state.deviceSchema) {
                const deviceCategory = getCategoryFromSchema(key, state.deviceSchema);
                if (deviceCategory) {
                    category = deviceCategory;
                }
            }
            additionalFields.push({
                key,
                name: key,
                type: 'enum',
                category: category,
                viz_type: 'toggle',
                enum_values: state.controls[key]?.enum_values || ['off', 'on'],
                is_visible: true,
                sort_order: 100
            });
        }
    });

    if (additionalFields.length > 0) {
        state.fieldConfigs = [...state.fieldConfigs, ...additionalFields];
    }
}

function updateControl(controlKey, updates) {
    const existing = state.controls[controlKey];
    if (existing) {
        state.controls = {
            ...state.controls,
            [controlKey]: { ...existing, ...updates }
        };
    } else {
        state.controls = {
            ...state.controls,
            [controlKey]: {
                control_key: controlKey,
                current_state: updates.current_state || 'unknown',
                mode: updates.mode || 'auto',
                enum_values: updates.enum_values || ['off', 'on'],
                ...updates
            }
        };
    }
    syncControlsToFields();
}

function resetDeviceState() {
    state.currentData = {};
    state.historyData = {};
    state.fieldConfigs = [];
    state.controls = {};
    state.deviceSchema = null;
    state.edgeRules = [];
    state.triggers = [];
    state.userRules = [];
    state.deviceMeta = null;
}

function addCommandHistory(entry) {
    state.commandHistory.unshift({
        ...entry,
        ts: entry.ts || Date.now()
    });
    if (state.commandHistory.length > 1000) {
        state.commandHistory = state.commandHistory.slice(0, 1000);
    }
}

function addStateChangeHistory(entry) {
    state.stateChangeHistory.unshift({
        ...entry,
        ts: entry.ts || Date.now()
    });
    if (state.stateChangeHistory.length > 1000) {
        state.stateChangeHistory = state.stateChangeHistory.slice(0, 1000);
    }
}

function getCommandHistoryForDevice(eui) {
    if (!eui) return [];
    return state.commandHistory.filter(h => h.eui === eui);
}

function getStateChangeHistoryForDevice(eui) {
    if (!eui) return [];
    return state.stateChangeHistory.filter(h => h.eui === eui);
}

// =============================================================================
// 5. EXPORT STORE
// =============================================================================

// Computed refs collection (for easy access)
const computedRefs = {
    selectedDeviceName,
    deviceOnline,
    gaugeFields,
    chartFields,
    badgeFields,
    systemFields,
    diagnosticFields,
    sensorFields,
    sensorBadgeFields,
    systemBadgeFields,
    topBarFields,
    numericFields,
    allFieldsForRules,
    schemaFields,
    schemaControls,
    isRuleValid,
    isEdgeRuleValid,
    hasRawData,
    hasSchemaData,
    shouldShowRawData,
    dashboardState
};

// Methods collection
const methods = {
    getSoftLabel,
    isControlValue,
    getGaugeStyleHint,
    getFieldCategoryLabel,
    getFieldCategoryClass,
    getCategoryFromSchema,
    getStateClassFromSchema,
    syncControlsToFields,
    updateControl,
    resetDeviceState,
    addCommandHistory,
    addStateChangeHistory,
    getCommandHistoryForDevice,
    getStateChangeHistoryForDevice
};

// Main store export (refs for root component setup())
const deviceStore = {
    // State as refs (for template auto-unwrapping in root component)
    ...toRefs(state),

    // Computed refs
    ...computedRefs,

    // Methods
    ...methods,

    // Raw state access
    state
};

// Providable store for child components via inject
// This proxy auto-unwraps refs and computed refs so children get plain values
const providableStore = new Proxy({}, {
    get(_, prop) {
        // Check state first (reactive properties)
        if (prop in state) {
            return state[prop];
        }
        // Check computed refs (return unwrapped .value)
        if (prop in computedRefs) {
            return computedRefs[prop].value;
        }
        // Check methods
        if (prop in methods) {
            return methods[prop];
        }
        // Special case for raw state access
        if (prop === 'state') {
            return state;
        }
        return undefined;
    },
    set(_, prop, value) {
        if (prop in state) {
            state[prop] = value;
            return true;
        }
        return false;
    }
});

export default deviceStore;
export { providableStore };
