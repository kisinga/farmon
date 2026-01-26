// @ts-nocheck
'use strict'
// Device State Store - Centralized state management for device data
// Uses Vue's reactivity system to ensure proper reactivity across components

const { reactive } = Vue;

// Create reactive store
const deviceStore = reactive({
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

    // Helper methods
    getSoftLabel(key) {
        // No hard-coded labels - rely on database display_name
        // This is only used as fallback when name is missing
        return null;
    },

    isControlValue(val) {
        // Detect if a value looks like a control state (for dynamic detection)
        if (typeof val !== 'string') return false;
        const controlStates = ['on', 'off', 'open', 'closed', 'true', 'false', 'active', 'inactive', 'running', 'stopped'];
        return controlStates.includes(val.toLowerCase());
    },

    getGaugeStyleHint(key) {
        // No hard-coded gauge styles - rely on database gauge_style
        return null;
    },

    // Computed getters
    get selectedDeviceName() {
        const device = this.devices.find(d => d.eui === this.selectedDevice);
        return device ? (device.name || device.eui) : 'Select Device';
    },

    get deviceOnline() {
        const device = this.devices.find(d => d.eui === this.selectedDevice);
        if (!device || !device.lastSeen) return false;
        const threeMinutes = 3 * 60 * 1000;
        return (Date.now() - new Date(device.lastSeen).getTime()) < threeMinutes;
    },

    // Group fields by visualization type
    get gaugeFields() {
        return this.fieldConfigs
            .filter(f => f.is_visible && (f.viz_type === 'gauge' || f.viz_type === 'both') && f.category !== 'state')
            .sort((a, b) => a.sort_order - b.sort_order);
    },

    get chartFields() {
        return this.fieldConfigs
            .filter(f => f.is_visible && (f.viz_type === 'chart' || f.viz_type === 'both') && f.category !== 'state')
            .sort((a, b) => a.sort_order - b.sort_order);
    },

    // State fields - combines fieldConfigs with category 'state' + detected controls
    get stateFields() {
        // Get explicitly defined state fields from fieldConfigs (rely on database category)
        // Handle NULL is_visible (treat as visible, default true)
        const explicitStateFields = this.fieldConfigs
            .filter(f => (f.is_visible !== false) && f.category === 'state');

        // Get controls from the controls object that aren't already in fieldConfigs
        // These are dynamically detected controls that haven't been registered yet
        const controlKeys = Object.keys(this.controls);
        const controlsFromState = controlKeys
            .filter(key => !this.fieldConfigs.find(f => f.key === key))
            .map(key => ({
                key,
                name: key, // Use key as name until database provides display_name
                type: 'enum',
                category: 'state',
                viz_type: 'toggle',
                enum_values: this.controls[key]?.enum_values || ['off', 'on'],
                is_visible: true,
                sort_order: 100
            }));

        // Combine all, deduplicate by key
        const allControls = [...explicitStateFields, ...controlsFromState];
        const seen = new Set();
        return allControls
            .filter(f => {
                if (seen.has(f.key)) return false;
                seen.add(f.key);
                return true;
            })
            .sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100));
    },

    get badgeFields() {
        return this.fieldConfigs
            .filter(f => f.is_visible && f.viz_type === 'badge')
            .sort((a, b) => a.sort_order - b.sort_order);
    },

    // System fields - rely on database category
    get systemFields() {
        return this.fieldConfigs
            .filter(f => f.is_visible && f.category === 'sys')
            .sort((a, b) => a.sort_order - b.sort_order);
    },

    // Diagnostic fields - rely on database category
    get diagnosticFields() {
        return this.fieldConfigs
            .filter(f => f.is_visible && f.category === 'diagnostic')
            .sort((a, b) => a.sort_order - b.sort_order);
    },

    // Non-system continuous fields (sensors) - rely on database category
    get sensorFields() {
        return this.fieldConfigs
            .filter(f => f.is_visible && f.category === 'cont')
            .sort((a, b) => a.sort_order - b.sort_order);
    },

    // Badge-only fields within sensors
    get sensorBadgeFields() {
        return this.fieldConfigs
            .filter(f => f.is_visible && f.viz_type === 'badge' && f.category === 'cont')
            .sort((a, b) => a.sort_order - b.sort_order);
    },

    // Badge-only fields within system (includes diagnostic)
    get systemBadgeFields() {
        return this.fieldConfigs
            .filter(f => f.is_visible && f.viz_type === 'badge'
                && (f.category === 'sys' || f.category === 'diagnostic'))
            .sort((a, b) => a.sort_order - b.sort_order);
    },

    // Numeric fields for rule conditions
    get numericFields() {
        return this.fieldConfigs
            .filter(f => f.type === 'num')
            .sort((a, b) => a.sort_order - b.sort_order);
    },

    // All fields for rules (with category info) - includes all numeric fields regardless of category
    get allFieldsForRules() {
        return this.fieldConfigs
            .filter(f => f.type === 'num' && f.category !== 'state')
            .map(f => ({
                ...f,
                categoryLabel: this.getFieldCategoryLabel(f)
            }))
            .sort((a, b) => {
                // Sort by category first (sensors, diagnostic, system), then by sort_order
                // Rely on database category field
                const categoryOrder = { 'cont': 0, 'diagnostic': 1, 'sys': 2 };
                const catA = categoryOrder[a.category] ?? 3;
                const catB = categoryOrder[b.category] ?? 3;
                if (catA !== catB) return catA - catB;
                return a.sort_order - b.sort_order;
            });
    },

    // Schema fields for edge rules
    get schemaFields() {
        return this.deviceSchema?.fields || [];
    },

    // Schema controls for edge rules
    get schemaControls() {
        return this.deviceSchema?.controls || [];
    },

    // Validate rule form
    get isRuleValid() {
        const r = this.editingRule;
        return r.name && r.name.trim() &&
               r.condition.field &&
               r.condition.op &&
               r.condition.val !== '' && r.condition.val !== null &&
               r.action_control &&
               r.action_state;
    },

    // Check if we have raw telemetry data (for fallback display)
    get hasRawData() {
        return Object.keys(this.currentData).length > 0;
    },

    // Validate edge rule form
    get isEdgeRuleValid() {
        const r = this.editingEdgeRule;
        return r.field_idx !== null && r.field_idx !== undefined &&
               r.operator &&
               r.threshold !== null && r.threshold !== undefined &&
               r.control_idx !== null && r.control_idx !== undefined &&
               r.action_state !== null && r.action_state !== undefined;
    },

    // Helper methods for field categorization - rely on database category
    getFieldCategoryLabel(field) {
        if (!field) return 'Unknown';
        // Use database category field directly
        const categoryMap = {
            'sys': 'System',
            'diagnostic': 'Diagnostic',
            'state': 'Control',
            'cont': 'Sensor'
        };
        return categoryMap[field.category] || 'Unknown';
    },

    getFieldCategoryClass(field) {
        if (!field) return 'badge-ghost';
        // Use database category field directly
        const classMap = {
            'sys': 'badge-neutral',
            'diagnostic': 'badge-warning',
            'state': 'badge-success',
            'cont': 'badge-info'
        };
        return classMap[field.category] || 'badge-ghost';
    },

    // Synchronize controls and fieldConfigs - ensures controls always have corresponding field entries
    syncControlsToFields() {
        const controlKeys = Object.keys(this.controls);
        const existingFieldKeys = new Set(this.fieldConfigs.map(f => f.key));
        const additionalFields = [];

        controlKeys.forEach(key => {
            if (!existingFieldKeys.has(key)) {
                additionalFields.push({
                    key,
                    name: key, // Use key until database provides display_name
                    type: 'enum',
                    category: 'state',
                    viz_type: 'toggle',
                    enum_values: this.controls[key]?.enum_values || ['off', 'on'],
                    is_visible: true,
                    sort_order: 100
                });
            }
        });

        if (additionalFields.length > 0) {
            this.fieldConfigs = [...this.fieldConfigs, ...additionalFields];
        }
    },

    // Update control with reactivity
    updateControl(controlKey, updates) {
        const existing = this.controls[controlKey];
        if (existing) {
            this.controls = {
                ...this.controls,
                [controlKey]: { ...existing, ...updates }
            };
        } else {
            this.controls = {
                ...this.controls,
                [controlKey]: {
                    control_key: controlKey,
                    current_state: updates.current_state || 'unknown',
                    mode: updates.mode || 'auto',
                    enum_values: updates.enum_values || ['off', 'on'],
                    ...updates
                }
            };
        }
        // Ensure fieldConfigs stays in sync
        this.syncControlsToFields();
    },

    // Reset device state when selecting a new device
    resetDeviceState() {
        this.currentData = {};
        this.historyData = {};
        this.fieldConfigs = [];
        this.controls = {};
        this.deviceSchema = null;
        this.edgeRules = [];
        this.triggers = [];
        this.userRules = [];
        this.deviceMeta = null;
    }
});

// Export store
window.deviceStore = deviceStore;
