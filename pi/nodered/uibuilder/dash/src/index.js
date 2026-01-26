// @ts-nocheck
'use strict'
const { createApp, ref, computed, watch, onMounted, nextTick } = Vue;

// =============================================================================
// Main Application
// =============================================================================
createApp({
    // Register components from global window scope (loaded via script tags)
    components: {
        'v-chart': window.VChart,
        'gauge-component': window.GaugeComponent,
        'chart-component': window.ChartComponent,
        'control-card': window.ControlCard,
        'badge-component': window.BadgeComponent,
        'collapsible-section': window.CollapsibleSection,
        'edge-rules-panel': window.EdgeRulesPanel,
        'system-commands': window.SystemCommands
    },

    data() {
        return {
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
            }
        };
    },

    computed: {
        selectedDeviceName() {
            const device = this.devices.find(d => d.eui === this.selectedDevice);
            return device ? (device.name || device.eui) : 'Select Device';
        },

        deviceOnline() {
            const device = this.devices.find(d => d.eui === this.selectedDevice);
            if (!device || !device.lastSeen) return false;
            const threeMinutes = 3 * 60 * 1000;
            return (Date.now() - new Date(device.lastSeen).getTime()) < threeMinutes;
        },

        // Group fields by visualization type
        gaugeFields() {
            return this.fieldConfigs
                .filter(f => f.is_visible && (f.viz_type === 'gauge' || f.viz_type === 'both') && f.category !== 'state')
                .sort((a, b) => a.sort_order - b.sort_order);
        },

        chartFields() {
            return this.fieldConfigs
                .filter(f => f.is_visible && (f.viz_type === 'chart' || f.viz_type === 'both') && f.category !== 'state')
                .sort((a, b) => a.sort_order - b.sort_order);
        },

        stateFields() {
            return this.fieldConfigs
                .filter(f => f.is_visible && f.category === 'state')
                .sort((a, b) => a.sort_order - b.sort_order);
        },

        badgeFields() {
            return this.fieldConfigs
                .filter(f => f.is_visible && f.viz_type === 'badge')
                .sort((a, b) => a.sort_order - b.sort_order);
        },

        // System fields (battery, rssi, snr, and sys category)
        systemFields() {
            const systemKeys = ['bp', 'battery', 'rssi', 'snr'];
            return this.fieldConfigs
                .filter(f => f.is_visible && (systemKeys.includes(f.key) || f.category === 'sys'))
                .sort((a, b) => a.sort_order - b.sort_order);
        },

        // Non-system continuous fields (sensors)
        sensorFields() {
            const systemKeys = ['bp', 'battery', 'rssi', 'snr'];
            return this.fieldConfigs
                .filter(f => f.is_visible && f.category === 'cont' && !systemKeys.includes(f.key))
                .sort((a, b) => a.sort_order - b.sort_order);
        },

        // Badge-only fields within sensors
        sensorBadgeFields() {
            const systemKeys = ['bp', 'battery', 'rssi', 'snr'];
            return this.fieldConfigs
                .filter(f => f.is_visible && f.viz_type === 'badge' && f.category !== 'sys' && !systemKeys.includes(f.key))
                .sort((a, b) => a.sort_order - b.sort_order);
        },

        // Badge-only fields within system
        systemBadgeFields() {
            const systemKeys = ['bp', 'battery', 'rssi', 'snr'];
            return this.fieldConfigs
                .filter(f => f.is_visible && f.viz_type === 'badge' && (f.category === 'sys' || systemKeys.includes(f.key)))
                .sort((a, b) => a.sort_order - b.sort_order);
        },

        // Numeric fields for rule conditions
        numericFields() {
            return this.fieldConfigs
                .filter(f => f.type === 'num')
                .sort((a, b) => a.sort_order - b.sort_order);
        },

        // Validate rule form
        isRuleValid() {
            const r = this.editingRule;
            return r.name && r.name.trim() &&
                   r.condition.field &&
                   r.condition.op &&
                   r.condition.val !== '' && r.condition.val !== null &&
                   r.action_control &&
                   r.action_state;
        },

        // Check if we have raw telemetry data (for fallback display)
        hasRawData() {
            return Object.keys(this.currentData).length > 0;
        },

        // Schema fields for edge rules
        schemaFields() {
            return this.deviceSchema?.fields || [];
        },

        // Schema controls for edge rules
        schemaControls() {
            return this.deviceSchema?.controls || [];
        },

        // Validate edge rule form
        isEdgeRuleValid() {
            const r = this.editingEdgeRule;
            return r.field_idx !== null && r.field_idx !== undefined &&
                   r.operator &&
                   r.threshold !== null && r.threshold !== undefined &&
                   r.control_idx !== null && r.control_idx !== undefined &&
                   r.action_state !== null && r.action_state !== undefined;
        }
    },

    mounted() {
        this.initUIBuilder();
    },

    methods: {
        initUIBuilder() {
            uibuilder.start();
            uibuilder.onChange('msg', msg => this.handleMessage(msg));

            // Request initial device list
            this.$nextTick(() => {
                uibuilder.send({ topic: 'getDevices' });
            });
        },

        handleMessage(msg) {
            switch (msg.topic) {
                case 'devices':
                    this.devices = Array.isArray(msg.payload) ? msg.payload : [];
                    // Auto-select first device if none selected
                    if (this.devices.length > 0 && !this.selectedDevice) {
                        const firstDevice = this.devices[0];
                        if (firstDevice && firstDevice.eui) {
                            this.selectDevice(firstDevice.eui);
                        }
                    }
                    break;

                case 'deviceRegistered':
                    // New device registered - add to list if not exists
                    const exists = this.devices.find(d => d.eui === msg.payload.eui);
                    if (!exists) {
                        this.devices.push(msg.payload);
                    }
                    break;

                case 'deviceConfig':
                    // Merged fields + viz_config + controls
                    // Apply defaults for any missing viz properties
                    this.fieldConfigs = (msg.payload.fields || []).map(f => {
                        // Parse JSON strings
                        let thresholds = f.thresholds;
                        if (typeof thresholds === 'string') {
                            try { thresholds = JSON.parse(thresholds); } catch (e) { thresholds = null; }
                        }
                        let enumValues = f.enum_values;
                        if (typeof enumValues === 'string') {
                            try { enumValues = JSON.parse(enumValues); } catch (e) { enumValues = null; }
                        }

                        // Parse min/max as numbers (PostgreSQL returns strings)
                        const minVal = f.min !== null && f.min !== undefined ? parseFloat(f.min) : null;
                        const maxVal = f.max !== null && f.max !== undefined ? parseFloat(f.max) : null;

                        // Infer default viz_type if not set
                        let vizType = f.viz_type;
                        if (!vizType) {
                            if (f.category === 'state') {
                                vizType = 'toggle';
                            } else if (f.type === 'num' && f.category === 'cont') {
                                vizType = (minVal !== null && maxVal !== null && !isNaN(minVal) && !isNaN(maxVal)) ? 'both' : 'chart';
                            } else {
                                vizType = 'badge';
                            }
                        }

                        return {
                            ...f,
                            min: minVal,
                            max: maxVal,
                            viz_type: vizType,
                            gauge_style: f.gauge_style || 'radial',
                            chart_color: f.chart_color || '#3b82f6',
                            thresholds: thresholds || [
                                { pct: 0.2, color: '#ef4444' },
                                { pct: 0.5, color: '#f59e0b' },
                                { pct: 1.0, color: '#10b981' }
                            ],
                            enum_values: enumValues,
                            is_visible: f.is_visible !== false,
                            sort_order: f.sort_order ?? 100
                        };
                    });

                    // Add RSSI and SNR as system pseudo-fields
                    const current = msg.payload.current;
                    if (current && !this.fieldConfigs.find(f => f.key === 'rssi')) {
                        this.fieldConfigs.push({
                            key: 'rssi',
                            name: 'Signal Strength',
                            type: 'num',
                            unit: 'dBm',
                            category: 'sys',
                            min: -120,
                            max: -20,
                            viz_type: 'both',
                            gauge_style: 'radial',
                            chart_color: '#f59e0b',
                            thresholds: [
                                { pct: 0.3, color: '#ef4444' },
                                { pct: 0.6, color: '#f59e0b' },
                                { pct: 1.0, color: '#10b981' }
                            ],
                            is_visible: true,
                            sort_order: 80
                        });
                    }
                    if (current && !this.fieldConfigs.find(f => f.key === 'snr')) {
                        this.fieldConfigs.push({
                            key: 'snr',
                            name: 'SNR',
                            type: 'num',
                            unit: 'dB',
                            category: 'sys',
                            min: -20,
                            max: 15,
                            viz_type: 'both',
                            gauge_style: 'radial',
                            chart_color: '#8b5cf6',
                            thresholds: [
                                { pct: 0.3, color: '#ef4444' },
                                { pct: 0.6, color: '#f59e0b' },
                                { pct: 1.0, color: '#10b981' }
                            ],
                            is_visible: true,
                            sort_order: 90
                        });
                    }

                    // Map controls - backend returns 'key' and 'state', frontend expects 'control_key' and 'current_state'
                    this.controls = {};
                    (msg.payload.controls || []).forEach(c => {
                        const controlKey = c.control_key || c.key;
                        this.controls[controlKey] = {
                            control_key: controlKey,
                            current_state: c.current_state || c.state,
                            mode: c.mode || 'auto',
                            manual_until: c.manual_until,
                            last_change_at: c.last_change_at,
                            last_change_by: c.last_change_by
                        };
                    });

                    this.triggers = msg.payload.triggers || [];
                    this.userRules = msg.payload.rules || [];
                    this.deviceMeta = msg.payload.device || null;
                    this.deviceSchema = msg.payload.schema || null;

                    // Extract current telemetry data including RSSI/SNR from metadata
                    if (current) {
                        const dataValues = {};
                        // Parse all data values as numbers where applicable
                        Object.entries(current.data || {}).forEach(([key, val]) => {
                            dataValues[key] = typeof val === 'string' ? parseFloat(val) : val;
                            if (isNaN(dataValues[key])) dataValues[key] = val; // Keep original if not a number
                        });
                        this.currentData = {
                            ...dataValues,
                            rssi: parseFloat(current.rssi) || -120,
                            snr: parseFloat(current.snr) || -20
                        };
                    }

                    this.loading = false;

                    // Auto-request history data for charts after config is loaded
                    this.$nextTick(() => {
                        this.requestHistory();
                    });
                    break;

                case 'deviceSchema':
                    // Device schema for edge rules
                    this.deviceSchema = msg.payload.schema || null;
                    break;

                case 'edgeRules':
                    // Edge rules for device
                    this.edgeRules = msg.payload.rules || [];
                    break;

                case 'telemetry':
                    // Real-time telemetry update
                    if (msg.payload.eui === this.selectedDevice) {
                        this.currentData = { ...this.currentData, ...msg.payload.data };
                        // Update controls state from telemetry
                        this.stateFields.forEach(f => {
                            if (msg.payload.data[f.key] !== undefined && this.controls[f.key]) {
                                this.controls[f.key].current_state = msg.payload.data[f.key];
                            }
                        });
                    }
                    break;

                case 'stateChange':
                    // Control state changed
                    if (msg.payload.eui === this.selectedDevice) {
                        const ctrl = this.controls[msg.payload.control];
                        if (ctrl) {
                            ctrl.current_state = msg.payload.state;
                            ctrl.last_change_at = msg.payload.ts;
                            ctrl.last_change_by = msg.payload.reason;
                        }
                    }
                    break;

                case 'history':
                    // Historical data for charts - parse values as numbers
                    this.historyData[msg.payload.field] = (msg.payload.data || []).map(d => ({
                        ts: d.ts,
                        value: typeof d.value === 'string' ? parseFloat(d.value) : d.value
                    })).filter(d => !isNaN(d.value)); // Filter out invalid values
                    // Force reactivity
                    this.historyData = { ...this.historyData };
                    break;

                case 'commandAck':
                    // Command acknowledged - could show toast notification
                    console.log('Command acknowledged:', msg.payload);
                    break;

                case 'rules':
                    // User rules list
                    if (msg.payload.eui === this.selectedDevice) {
                        this.userRules = msg.payload.rules || [];
                    }
                    break;

                case 'ruleSaved':
                    // Rule created or updated
                    if (msg.payload.eui === this.selectedDevice && msg.payload.rule) {
                        const idx = this.userRules.findIndex(r => r.id === msg.payload.rule.id);
                        if (idx >= 0) {
                            this.userRules[idx] = msg.payload.rule;
                        } else {
                            this.userRules.push(msg.payload.rule);
                        }
                        this.closeRuleEditor();
                    }
                    break;

                case 'ruleDeleted':
                    // Rule deleted
                    if (msg.payload.eui === this.selectedDevice) {
                        this.userRules = this.userRules.filter(r => r.id !== msg.payload.ruleId);
                    }
                    break;

                case 'triggerSaved':
                    // Device trigger updated
                    if (msg.payload.eui === this.selectedDevice && msg.payload.trigger) {
                        const idx = this.triggers.findIndex(t => t.key === msg.payload.trigger.trigger_key);
                        if (idx >= 0) {
                            this.triggers[idx].enabled = msg.payload.trigger.enabled;
                        }
                    }
                    break;

                case 'controlUpdate':
                    // Control mode/state updated (e.g., from expired override)
                    if (msg.payload.eui === this.selectedDevice) {
                        const ctrl = this.controls[msg.payload.control];
                        if (ctrl) {
                            ctrl.current_state = msg.payload.state;
                            ctrl.mode = msg.payload.mode;
                        }
                    }
                    break;

                case 'edgeRuleSaved':
                    // Edge rule saved
                    if (msg.payload.eui === this.selectedDevice) {
                        const idx = this.edgeRules.findIndex(r => r.rule_id === msg.payload.rule.rule_id);
                        if (idx >= 0) {
                            this.edgeRules[idx] = msg.payload.rule;
                        } else {
                            this.edgeRules.push(msg.payload.rule);
                        }
                    }
                    break;

                case 'edgeRuleDeleted':
                    // Edge rule deleted
                    if (msg.payload.eui === this.selectedDevice) {
                        this.edgeRules = this.edgeRules.filter(r => r.rule_id !== msg.payload.ruleId);
                    }
                    break;
            }
        },

        selectDevice(eui) {
            this.selectedDevice = eui;
            this.loading = true;
            this.currentData = {};
            this.historyData = {};
            this.fieldConfigs = [];
            this.controls = {};
            this.deviceSchema = null;
            this.edgeRules = [];

            uibuilder.send({
                topic: 'selectDevice',
                payload: { eui, range: this.timeRange }
            });

            // Request edge rules (schema now comes with deviceConfig)
            uibuilder.send({
                topic: 'getEdgeRules',
                payload: { eui }
            });
        },

        selectDeviceAndClose(eui) {
            this.selectDevice(eui);
            const drawer = document.getElementById('main-drawer');
            if (drawer) drawer.checked = false;
        },

        onTimeRangeChange(newRange) {
            this.timeRange = newRange;
            if (!this.selectedDevice) return;
            if (this.timeRange === 'custom') return;
            this.requestHistory();
        },

        onCustomRangeChange(range) {
            this.customFrom = range.from;
            this.customTo = range.to;
            if (!this.selectedDevice || !this.customFrom || !this.customTo) return;
            this.requestHistory();
        },

        requestHistory() {
            if (!this.selectedDevice) return;

            const payload = { eui: this.selectedDevice, range: this.timeRange };
            if (this.timeRange === 'custom' && this.customFrom && this.customTo) {
                payload.from = this.customFrom;
                payload.to = this.customTo;
            }

            // Request history for chart fields AND system fields (unique keys)
            const fieldsToFetch = [...this.chartFields, ...this.systemFields];
            const uniqueKeys = [...new Set(fieldsToFetch.map(f => f.key))];

            uniqueKeys.forEach(key => {
                uibuilder.send({
                    topic: 'getHistory',
                    payload: { ...payload, field: key }
                });
            });
        },

        setControl(data) {
            uibuilder.send({
                topic: 'setControl',
                payload: {
                    eui: this.selectedDevice,
                    control: data.control,
                    state: data.state,
                    duration: data.duration
                }
            });
        },

        clearOverride(data) {
            uibuilder.send({
                topic: 'clearOverride',
                payload: {
                    eui: this.selectedDevice,
                    control: data.control
                }
            });
        },

        getValue(key) {
            return this.currentData[key];
        },

        getHistory(key) {
            return this.historyData[key] || [];
        },

        getControl(key) {
            return this.controls[key] || {};
        },

        // Format value with unit
        formatValue(field, value) {
            if (value === null || value === undefined) return '--';
            if (typeof value === 'number') {
                const formatted = field.unit === '%' ? Math.round(value) : value.toFixed(1);
                return field.unit ? `${formatted}${field.unit}` : formatted;
            }
            return value;
        },

        // Format raw value (no schema)
        formatRawValue(value) {
            if (value === null || value === undefined) return '--';
            if (typeof value === 'number') {
                return Number.isInteger(value) ? value : value.toFixed(2);
            }
            return String(value);
        },

        // Get badge class based on threshold
        getBadgeClass(field, value) {
            if (field.type !== 'num' || value === null || value === undefined) return 'badge-ghost';
            const min = field.min ?? 0;
            const max = field.max ?? 100;
            const percent = (value - min) / (max - min);

            const thresholds = field.thresholds || [
                { pct: 0.2, color: '#ef4444' },
                { pct: 0.5, color: '#f59e0b' },
                { pct: 1.0, color: '#10b981' }
            ];

            for (const t of thresholds) {
                if (percent <= t.pct) {
                    if (t.color.includes('ef44')) return 'badge-error';
                    if (t.color.includes('f59e')) return 'badge-warning';
                    return 'badge-success';
                }
            }
            return 'badge-success';
        },

        // Tab navigation
        setTab(tab) {
            this.activeTab = tab;
        },

        // =====================================================================
        // Rules Management
        // =====================================================================

        toggleTrigger(triggerKey, enabled) {
            uibuilder.send({
                topic: 'saveTrigger',
                payload: {
                    eui: this.selectedDevice,
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
                    eui: this.selectedDevice,
                    enabled
                }
            });
        },

        openRuleEditor(rule = null) {
            if (rule) {
                // Edit existing rule
                this.editingRule = {
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
                const firstNumeric = this.numericFields[0];
                const firstState = this.stateFields[0];
                this.editingRule = {
                    id: null,
                    name: '',
                    condition: {
                        field: firstNumeric?.key || '',
                        op: '<',
                        val: 0
                    },
                    action_control: firstState?.key || '',
                    action_state: this.getEnumValues(firstState?.key)[0] || '',
                    priority: 100,
                    cooldown_seconds: 300,
                    enabled: true
                };
            }
            document.getElementById('rule-editor-modal').showModal();
        },

        closeRuleEditor() {
            document.getElementById('rule-editor-modal').close();
        },

        editRule(rule) {
            this.openRuleEditor(rule);
        },

        deleteRule(ruleId) {
            if (!confirm('Delete this rule?')) return;
            uibuilder.send({
                topic: 'deleteRule',
                payload: {
                    eui: this.selectedDevice,
                    ruleId
                }
            });
        },

        saveRule() {
            if (!this.isRuleValid) return;
            uibuilder.send({
                topic: 'saveRule',
                payload: {
                    ...this.editingRule,
                    eui: this.selectedDevice
                }
            });
        },

        getEnumValues(controlKey) {
            const field = this.fieldConfigs.find(f => f.key === controlKey);
            if (field && field.enum_values) {
                return Array.isArray(field.enum_values) ? field.enum_values : JSON.parse(field.enum_values);
            }
            return ['off', 'on'];
        },

        formatTime(ts) {
            if (!ts) return '';
            return new Date(ts).toLocaleString('en-US', {
                month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        },

        // =====================================================================
        // Edge Rules Management
        // =====================================================================

        openEdgeRuleEditor(rule = null) {
            if (!this.deviceSchema) {
                alert('Device schema not available. Cannot create edge rules.');
                return;
            }
            if (rule) {
                // Edit existing rule
                this.editingEdgeRule = {
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
                this.editingEdgeRule = {
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
            document.getElementById('edge-rule-editor-modal').showModal();
        },

        closeEdgeRuleEditor() {
            document.getElementById('edge-rule-editor-modal').close();
        },

        saveEdgeRule() {
            if (!this.isEdgeRuleValid) return;
            uibuilder.send({
                topic: 'saveEdgeRule',
                payload: {
                    eui: this.selectedDevice,
                    ...this.editingEdgeRule
                }
            });
            this.closeEdgeRuleEditor();
        },

        getControlStates(controlIdx) {
            if (!this.deviceSchema?.controls || controlIdx >= this.deviceSchema.controls.length) {
                return ['off', 'on'];
            }
            return this.deviceSchema.controls[controlIdx]?.v || ['off', 'on'];
        },

        deleteEdgeRule(ruleId) {
            if (!confirm('Delete this edge rule?')) return;
            uibuilder.send({
                topic: 'deleteEdgeRule',
                payload: {
                    eui: this.selectedDevice,
                    ruleId
                }
            });
        },

        toggleEdgeRule(data) {
            uibuilder.send({
                topic: 'toggleEdgeRule',
                payload: {
                    eui: this.selectedDevice,
                    ruleId: data.ruleId,
                    enabled: data.enabled
                }
            });
        },

        // =====================================================================
        // System Commands
        // =====================================================================

        sendSystemCommand(data) {
            const cmdMap = {
                'clearErrors': { topic: 'sendCommand', fPort: 13 },
                'reset': { topic: 'sendCommand', fPort: 10 },
                'reboot': { topic: 'sendCommand', fPort: 12 },
                'forceReg': { topic: 'sendCommand', fPort: 14 },
                'setInterval': { topic: 'sendCommand', fPort: 11 },
                'requestStatus': { topic: 'sendCommand', fPort: 15 }
            };

            const cmdInfo = cmdMap[data.command];
            if (!cmdInfo) {
                console.warn('Unknown command:', data.command);
                return;
            }

            const payload = {
                eui: data.eui || this.selectedDevice,
                fPort: cmdInfo.fPort,
                command: data.command
            };

            // Add value for setInterval command
            if (data.command === 'setInterval' && data.value) {
                payload.value = data.value;
            }

            console.log('Sending system command:', payload);
            uibuilder.send({
                topic: cmdInfo.topic,
                payload
            });
        }
    }
}).mount('#app');
