// @ts-nocheck
'use strict'
import { computeStateFields } from './utils/fieldProcessors.js';
import { createMessageHandlers } from './utils/messageHandlers.js';
import { 
    formatValue as formatValueUtil, 
    formatRawValue as formatRawValueUtil, 
    getBadgeClass as getBadgeClassUtil, 
    formatTime as formatTimeUtil 
} from './utils/formatters.js';
import { createRuleManager } from './utils/rulesManager.js';
import { createSystemCommandManager } from './utils/systemCommands.js';

// Import all components
import VChart from './components/VChart.js';
import GaugeComponent from './components/GaugeComponent.js';
import ChartComponent from './components/ChartComponent.js';
import ControlCard from './components/ControlCard.js';
import BadgeComponent from './components/BadgeComponent.js';
import CollapsibleSection from './components/CollapsibleSection.js';
import EdgeRulesPanel from './components/EdgeRulesPanel.js';
import SystemCommands from './components/SystemCommands.js';
import CommandHistory from './components/CommandHistory.js';
import DeviceSelector from './components/DeviceSelector.js';
import DeviceInfoBar from './components/DeviceInfoBar.js';
import DashboardEmptyState from './components/DashboardEmptyState.js';
import RawDataFallback from './components/RawDataFallback.js';
import QuickStatsBar from './components/QuickStatsBar.js';
import SensorsSection from './components/SensorsSection.js';
import DiagnosticsSection from './components/DiagnosticsSection.js';
import SystemSection from './components/SystemSection.js';
import ControlsPreview from './components/ControlsPreview.js';
import DashboardView from './components/DashboardView.js';
import ControlsView from './components/ControlsView.js';
import RulesView from './components/RulesView.js';
import HistoryView from './components/HistoryView.js';
import Navbar from './components/Navbar.js';
import TabNavigation from './components/TabNavigation.js';
import RuleEditorModal from './components/RuleEditorModal.js';
import EdgeRuleEditorModal from './components/EdgeRuleEditorModal.js';
import DeviceTriggers from './components/DeviceTriggers.js';
import UserRules from './components/UserRules.js';
import Sidebar from './components/Sidebar.js';

const { createApp, ref, watch, onMounted, nextTick, toRefs, computed: vueComputed } = Vue;

// =============================================================================
// Main Application
// =============================================================================
createApp({
    // Register all components
    components: {
        'v-chart': VChart,
        'gauge-component': GaugeComponent,
        'chart-component': ChartComponent,
        'control-card': ControlCard,
        'badge-component': BadgeComponent,
        'collapsible-section': CollapsibleSection,
        'edge-rules-panel': EdgeRulesPanel,
        'system-commands': SystemCommands,
        'command-history': CommandHistory,
        'device-selector': DeviceSelector,
        'device-info-bar': DeviceInfoBar,
        'dashboard-empty-state': DashboardEmptyState,
        'raw-data-fallback': RawDataFallback,
        'quick-stats-bar': QuickStatsBar,
        'sensors-section': SensorsSection,
        'diagnostics-section': DiagnosticsSection,
        'system-section': SystemSection,
        'controls-preview': ControlsPreview,
        'dashboard-view': DashboardView,
        'controls-view': ControlsView,
        'rules-view': RulesView,
        'history-view': HistoryView,
        'navbar': Navbar,
        'tab-navigation': TabNavigation,
        'rule-editor-modal': RuleEditorModal,
        'edge-rule-editor-modal': EdgeRuleEditorModal,
        'device-triggers': DeviceTriggers,
        'user-rules': UserRules,
        'sidebar': Sidebar
    },

    data() {
        // Return store directly - Vue will make it reactive
        // All store properties and methods become accessible via 'this'
        return window.deviceStore;
    },

    // Provide store for child components (Vue 3 best practice)
    provide() {
        return {
            deviceStore: window.deviceStore
        };
    },

    computed: {
        // State fields - combines controls object with fieldConfigs
        stateFields() {
            return computeStateFields(this.controls, this.fieldConfigs);
        },

        // UI state for controls page
        controlsPageState() {
            if (this.loading) return 'loading';
            if (this.stateFields.length === 0 && this.fieldConfigs.length > 0) return 'no-controls';
            if (this.stateFields.length === 0) return 'waiting';
            return 'ready';
        },

        showControlsPage() {
            return this.activeTab === 'controls';
        }
    },

    mounted() {
        // Initialize message handlers with store context
        this.messageHandlers = createMessageHandlers(this);
        this.rulesManager = createRuleManager(this, uibuilder);
        this.systemCommandManager = createSystemCommandManager(this, uibuilder);
        
        this.initUIBuilder();
        this.initRouting();
    },

    methods: {
        // Note: Helper methods (getSoftLabel, getGaugeStyleHint, isControlValue, getFieldCategoryLabel, getFieldCategoryClass)
        // are provided by the store and accessible via 'this' since store is returned as data.
        // These methods no longer contain hard-coded values - they rely on database fields.

        initUIBuilder() {
            uibuilder.start();
            uibuilder.onChange('msg', msg => this.handleMessage(msg));

            // Request initial device list
            this.$nextTick(() => {
                uibuilder.send({ topic: 'getDevices' });
            });
        },

        initRouting() {
            // Hash-based routing
            const updateRoute = () => {
                const hash = window.location.hash.slice(1) || 'dashboard';
                const validRoutes = ['dashboard', 'controls', 'rules', 'history'];
                if (validRoutes.includes(hash)) {
                    this.activeTab = hash;
                } else {
                    this.activeTab = 'dashboard';
                    window.location.hash = 'dashboard';
                }
            };

            // Initial route
            updateRoute();

            // Listen for hash changes
            window.addEventListener('hashchange', updateRoute);
        },

        navigateTo(route) {
            window.location.hash = route;
            this.activeTab = route;
        },

        handleMessage(msg) {
            const handlerMap = {
                'devices': this.messageHandlers.handleDevicesMessage,
                'deviceRegistered': this.messageHandlers.handleDeviceRegisteredMessage,
                'deviceConfig': this.messageHandlers.handleDeviceConfigMessage,
                'deviceSchema': this.messageHandlers.handleDeviceSchemaMessage,
                'edgeRules': this.messageHandlers.handleEdgeRulesMessage,
                'telemetry': this.messageHandlers.handleTelemetryMessage,
                'stateChange': this.messageHandlers.handleStateChangeMessage,
                'history': this.messageHandlers.handleHistoryMessage,
                'commandAck': this.messageHandlers.handleCommandAckMessage,
                'rules': this.messageHandlers.handleRulesMessage,
                'ruleSaved': this.messageHandlers.handleRuleSavedMessage,
                'ruleDeleted': this.messageHandlers.handleRuleDeletedMessage,
                'triggerSaved': this.messageHandlers.handleTriggerSavedMessage,
                'controlUpdate': this.messageHandlers.handleControlUpdateMessage,
                'edgeRuleSaved': this.messageHandlers.handleEdgeRuleSavedMessage,
                'edgeRuleDeleted': this.messageHandlers.handleEdgeRuleDeletedMessage
            };

            const handler = handlerMap[msg.topic];
            if (handler) {
                handler(msg, this);
            }
        },

        selectDevice(eui) {
            this.selectedDevice = eui;
            this.loading = true;
            // Use store's reset method for consistency
            this.resetDeviceState();

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

        // Expose selectDevice for message handlers
        onDeviceSelect(eui) {
            this.selectDevice(eui);
        },

        selectDeviceAndClose(eui) {
            this.selectDevice(eui);
            this.closeDrawer();
        },

        closeDrawer() {
            // Drawer is controlled by checkbox input, keep this simple
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
            // Track command before sending
            this.addCommandHistory({
                eui: this.selectedDevice,
                type: 'control',
                control: data.control,
                state: data.state,
                duration: data.duration,
                source: 'user',
                status: 'pending',
                ts: Date.now()
            });

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

        // Formatting methods - delegate to utilities
        formatValue(field, value) {
            return formatValueUtil(field, value);
        },

        formatRawValue(value) {
            return formatRawValueUtil(value);
        },

        getBadgeClass(field, value) {
            return getBadgeClassUtil(field, value);
        },

        formatTime(ts) {
            return formatTimeUtil(ts);
        },


        // Tab navigation (now uses routing)
        setTab(tab) {
            this.navigateTo(tab);
        },

        // =====================================================================
        // Rules Management - delegate to rulesManager
        // =====================================================================

        toggleTrigger(triggerKey, enabled) {
            this.rulesManager.toggleTrigger(triggerKey, enabled);
        },

        toggleRule(rule, enabled) {
            this.rulesManager.toggleRule(rule, enabled);
        },

        openRuleEditor(rule = null) {
            this.rulesManager.openRuleEditor(rule, this.numericFields, this.stateFields, this.getEnumValues);
        },

        closeRuleEditor() {
            this.rulesManager.closeRuleEditor();
        },

        editRule(rule) {
            this.rulesManager.editRule(rule, this.numericFields, this.stateFields, this.getEnumValues);
        },

        deleteRule(ruleId) {
            this.rulesManager.deleteRule(ruleId);
        },

        saveRule() {
            this.rulesManager.saveRule();
        },

        getEnumValues(controlKey) {
            const field = this.fieldConfigs.find(f => f.key === controlKey);
            if (field && field.enum_values) {
                return Array.isArray(field.enum_values) ? field.enum_values : JSON.parse(field.enum_values);
            }
            return ['off', 'on'];
        },

        // Edge Rules Management
        openEdgeRuleEditor(rule = null) {
            this.rulesManager.openEdgeRuleEditor(rule);
        },

        closeEdgeRuleEditor() {
            this.rulesManager.closeEdgeRuleEditor();
        },

        saveEdgeRule() {
            this.rulesManager.saveEdgeRule();
        },

        getControlStates(controlIdx) {
            return this.rulesManager.getControlStates(controlIdx);
        },

        deleteEdgeRule(ruleId) {
            this.rulesManager.deleteEdgeRule(ruleId);
        },

        toggleEdgeRule(data) {
            this.rulesManager.toggleEdgeRule(data);
        },

        // =====================================================================
        // System Commands - delegate to systemCommandManager
        // =====================================================================

        sendSystemCommand(data) {
            this.systemCommandManager.sendSystemCommand(data);
        }
    }
}).mount('#app');
