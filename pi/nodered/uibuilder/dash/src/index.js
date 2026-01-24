// @ts-nocheck
'use strict'
const { createApp, ref, computed, watch, onMounted, nextTick } = Vue;

// =============================================================================
// VChart Component - ECharts wrapper
// =============================================================================
const VChart = {
    props: {
        option: { type: Object, required: true },
        autoresize: { type: Boolean, default: false }
    },
    template: '<div ref="chart"></div>',
    data() {
        return { chart: null, resizeObserver: null };
    },
    mounted() {
        this.$nextTick(() => {
            this.chart = echarts.init(this.$refs.chart);
            this.chart.setOption(this.option);
            if (this.autoresize) {
                this.resizeObserver = new ResizeObserver(() => {
                    this.chart && this.chart.resize();
                });
                this.resizeObserver.observe(this.$refs.chart);
            }
        });
    },
    watch: {
        option: {
            deep: true,
            handler(newOption) {
                if (this.chart) this.chart.setOption(newOption, true);
            }
        }
    },
    beforeUnmount() {
        if (this.resizeObserver) this.resizeObserver.disconnect();
        if (this.chart) this.chart.dispose();
    }
};

// =============================================================================
// Gauge Component - Dynamic gauge based on gauge_style
// =============================================================================
const GaugeComponent = {
    props: {
        field: { type: Object, required: true },
        value: { type: Number, default: 0 }
    },
    components: { VChart },
    template: `<v-chart :option="gaugeOption" autoresize class="gauge-container" />`,
    computed: {
        gaugeOption() {
            const style = this.field.gauge_style || 'radial';
            if (style === 'liquid') return this.liquidGauge();
            if (style === 'bar') return this.barGauge();
            return this.radialGauge();
        }
    },
    methods: {
        getThresholdColor(percent) {
            const thresholds = this.field.thresholds || [
                { pct: 0.2, color: '#ef4444' },
                { pct: 0.5, color: '#f59e0b' },
                { pct: 1.0, color: '#10b981' }
            ];
            for (const t of thresholds) {
                if (percent <= t.pct) return t.color;
            }
            return thresholds[thresholds.length - 1]?.color || '#10b981';
        },

        radialGauge() {
            const min = this.field.min ?? 0;
            const max = this.field.max ?? 100;
            const value = this.value ?? min;
            const percent = (value - min) / (max - min);
            const color = this.getThresholdColor(percent);
            const unit = this.field.unit || '';

            // Build color stops for axis line
            const thresholds = this.field.thresholds || [
                { pct: 0.2, color: '#ef4444' },
                { pct: 0.5, color: '#f59e0b' },
                { pct: 1.0, color: '#10b981' }
            ];
            const axisColors = thresholds.map(t => [t.pct, t.color]);

            return {
                backgroundColor: 'transparent',
                series: [{
                    type: 'gauge',
                    min, max,
                    startAngle: 200, endAngle: -20,
                    splitNumber: 4,
                    radius: '95%',
                    center: ['50%', '60%'],
                    axisLine: { lineStyle: { width: 10, color: axisColors } },
                    pointer: {
                        icon: 'path://M12.8,0.7l12,40.1H0.7L12.8,0.7z',
                        length: '50%', width: 6,
                        offsetCenter: [0, '-15%'],
                        itemStyle: { color, shadowColor: color + '60', shadowBlur: 4 }
                    },
                    axisTick: { show: false },
                    splitLine: { length: 8, lineStyle: { color: '#475569', width: 1 } },
                    axisLabel: { color: '#64748b', fontSize: 8, distance: 12, formatter: v => Math.round(v) },
                    anchor: { show: true, size: 8, itemStyle: { color: '#1e293b', borderColor: color, borderWidth: 2 } },
                    detail: { valueAnimation: true, formatter: '{value}', color, fontSize: 16, fontWeight: 'bold', offsetCenter: [0, '30%'] },
                    title: { show: true, offsetCenter: [0, '55%'], fontSize: 10, color: '#64748b' },
                    data: [{ value, name: unit }]
                }]
            };
        },

        liquidGauge() {
            const min = this.field.min ?? 0;
            const max = this.field.max ?? 100;
            const value = this.value ?? min;
            const percent = (value - min) / (max - min);
            const color = this.getThresholdColor(percent);

            return {
                backgroundColor: 'transparent',
                series: [{
                    type: 'liquidFill',
                    data: [percent, percent - 0.05, percent - 0.1].filter(v => v > 0),
                    radius: '75%',
                    center: ['50%', '50%'],
                    color: [color, color + 'cc', color + '99'],
                    backgroundStyle: { color: '#1e293b', borderColor: '#475569', borderWidth: 3 },
                    outline: { show: true, borderDistance: 4, itemStyle: { borderColor: color + '80', borderWidth: 3 } },
                    label: { show: true, fontSize: 28, fontWeight: 'bold', color: '#fff', insideColor: '#fff', formatter: p => `${Math.round(p.value * 100)}%` },
                    waveAnimation: true, animationDuration: 2000, animationDurationUpdate: 1000, amplitude: 8, waveLength: '150%'
                }]
            };
        },

        barGauge() {
            const min = this.field.min ?? 0;
            const max = this.field.max ?? 100;
            const value = this.value ?? min;
            const percent = (value - min) / (max - min);
            const color = this.getThresholdColor(percent);

            return {
                backgroundColor: 'transparent',
                series: [{
                    type: 'gauge',
                    min: 0, max: 100,
                    startAngle: 90, endAngle: -270,
                    radius: '90%', center: ['50%', '50%'],
                    pointer: { show: false },
                    progress: { show: true, overlap: false, roundCap: true, width: 12, itemStyle: { color } },
                    axisLine: { lineStyle: { width: 12, color: [[1, '#1e293b']] } },
                    axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
                    detail: { valueAnimation: true, formatter: '{value}%', color, fontSize: 18, fontWeight: 'bold', offsetCenter: [0, 0] },
                    title: { show: false },
                    data: [{ value: Math.round(percent * 100), name: this.field.name }]
                }]
            };
        }
    }
};

// =============================================================================
// Chart Component - Time series line chart
// =============================================================================
const ChartComponent = {
    props: {
        field: { type: Object, required: true },
        data: { type: Array, default: () => [] }
    },
    components: { VChart },
    template: `<v-chart :option="chartOption" autoresize class="chart-container" />`,
    computed: {
        chartOption() {
            const color = this.field.chart_color || '#3b82f6';
            const unit = this.field.unit || '';
            const name = this.field.name || this.field.key;
            const hasData = this.data && this.data.length > 0;

            const option = {
                backgroundColor: 'transparent',
                grid: { left: 10, right: 10, top: 25, bottom: hasData ? 60 : 30, containLabel: true },
                tooltip: {
                    trigger: 'axis',
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    borderColor: color, borderWidth: 1,
                    padding: [10, 14],
                    textStyle: { color: '#e2e8f0', fontSize: 12 },
                    formatter: params => {
                        if (!params || !params[0]) return '';
                        const p = params[0];
                        const date = new Date(p.value[0]);
                        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                        const val = typeof p.value[1] === 'number' ? p.value[1].toFixed(1) : p.value[1];
                        return `<div style="font-size:11px;color:#94a3b8;margin-bottom:4px">${dateStr} ${timeStr}</div>
                            <div style="display:flex;align-items:center;gap:6px">
                                <span style="width:8px;height:8px;border-radius:50%;background:${color}"></span>
                                <span>${name}:</span>
                                <span style="font-weight:600;color:${color}">${val} ${unit}</span>
                            </div>`;
                    }
                },
                xAxis: {
                    type: 'time',
                    axisLabel: { color: '#64748b', fontSize: 10, formatter: '{MM}/{dd} {HH}:{mm}' },
                    axisLine: { lineStyle: { color: '#334155' } },
                    splitLine: { show: false }
                },
                yAxis: {
                    type: 'value', name: unit,
                    nameTextStyle: { color: '#64748b', fontSize: 10 },
                    axisLabel: { color: '#64748b', fontSize: 10 },
                    axisLine: { show: false },
                    splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } }
                },
                series: [{
                    name, type: 'line',
                    data: this.data.map(d => [d.ts, d.value]),
                    smooth: 0.3, symbol: 'circle', symbolSize: 5, showSymbol: false,
                    lineStyle: { color, width: 2 },
                    areaStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: color + '30' },
                            { offset: 1, color: color + '05' }
                        ])
                    }
                }]
            };

            if (hasData) {
                option.dataZoom = [
                    { type: 'inside', start: 0, end: 100 },
                    { type: 'slider', start: 0, end: 100, height: 20, bottom: 5,
                      borderColor: '#334155', backgroundColor: '#0f172a', fillerColor: color + '20',
                      handleStyle: { color }, textStyle: { color: '#64748b', fontSize: 9 } }
                ];
            }
            return option;
        }
    }
};

// =============================================================================
// Control Card Component - For state fields with override support
// =============================================================================
const ControlCard = {
    props: {
        field: { type: Object, required: true },
        control: { type: Object, default: () => ({}) }
    },
    emits: ['set-control', 'clear-override'],
    template: `
        <div class="card bg-base-200 shadow">
            <div class="card-body p-3">
                <div class="flex items-center justify-between mb-2">
                    <h3 class="font-medium">{{ field.name }}</h3>
                    <div class="badge" :class="modeClass">{{ control.mode || 'auto' }}</div>
                </div>

                <!-- Current State -->
                <div class="flex items-center gap-2 mb-3">
                    <span class="text-sm opacity-60">Current:</span>
                    <span class="badge badge-lg" :class="stateClass">{{ control.current_state || 'unknown' }}</span>
                </div>

                <!-- Control Buttons (for enum types) -->
                <div v-if="field.enum_values" class="btn-group w-full mb-3">
                    <button v-for="state in field.enum_values" :key="state"
                            class="btn btn-sm flex-1"
                            :class="{ 'btn-primary': control.current_state === state }"
                            @click="setState(state)">
                        {{ state }}
                    </button>
                </div>

                <!-- Override Duration -->
                <div v-if="control.mode !== 'manual'" class="flex flex-wrap gap-1">
                    <span class="text-xs opacity-60 w-full mb-1">Override for:</span>
                    <button class="btn btn-xs btn-outline" @click="setOverride(15)">15m</button>
                    <button class="btn btn-xs btn-outline" @click="setOverride(30)">30m</button>
                    <button class="btn btn-xs btn-outline" @click="setOverride(60)">1h</button>
                    <button class="btn btn-xs btn-outline" @click="setOverride(0)">Indefinite</button>
                </div>

                <!-- Return to Auto -->
                <button v-else class="btn btn-sm btn-warning w-full" @click="clearOverride">
                    Return to Auto
                </button>

                <!-- Last Change Info -->
                <div v-if="control.last_change_at" class="text-xs opacity-50 mt-2">
                    Last: {{ formatTime(control.last_change_at) }}
                    <span v-if="control.last_change_by">by {{ control.last_change_by }}</span>
                </div>
            </div>
        </div>
    `,
    computed: {
        modeClass() {
            return this.control.mode === 'manual' ? 'badge-warning' : 'badge-success';
        },
        stateClass() {
            const state = this.control.current_state;
            if (state === 'on' || state === 'open' || state === 'active') return 'badge-success';
            if (state === 'off' || state === 'closed' || state === 'inactive') return 'badge-ghost';
            return 'badge-info';
        }
    },
    methods: {
        setState(state) {
            this.$emit('set-control', { control: this.field.key, state, duration: null });
        },
        setOverride(minutes) {
            const currentState = this.control.current_state;
            const nextState = this.getNextState();
            this.$emit('set-control', { control: this.field.key, state: nextState, duration: minutes || null });
        },
        getNextState() {
            const states = this.field.enum_values || ['off', 'on'];
            const current = this.control.current_state;
            const idx = states.indexOf(current);
            return states[(idx + 1) % states.length];
        },
        clearOverride() {
            this.$emit('clear-override', { control: this.field.key });
        },
        formatTime(ts) {
            return new Date(ts).toLocaleString('en-US', {
                month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        }
    }
};

// =============================================================================
// Badge Component - Simple value display
// =============================================================================
const BadgeComponent = {
    props: {
        field: { type: Object, required: true },
        value: { default: null }
    },
    template: `
        <div class="stat bg-base-200 rounded-lg p-2">
            <div class="stat-title text-xs">{{ field.name }}</div>
            <div class="stat-value text-lg" :class="valueClass">{{ displayValue }}</div>
            <div v-if="field.unit" class="stat-desc">{{ field.unit }}</div>
        </div>
    `,
    computed: {
        displayValue() {
            if (this.value === null || this.value === undefined) return '--';
            if (typeof this.value === 'number') return this.value.toFixed(1);
            return this.value;
        },
        valueClass() {
            if (this.field.type !== 'num' || !this.field.thresholds) return '';
            const min = this.field.min ?? 0;
            const max = this.field.max ?? 100;
            const percent = (this.value - min) / (max - min);

            const thresholds = this.field.thresholds;
            for (const t of thresholds) {
                if (percent <= t.pct) {
                    if (t.color.includes('ef44')) return 'text-error';
                    if (t.color.includes('f59e')) return 'text-warning';
                    return 'text-success';
                }
            }
            return 'text-success';
        }
    }
};

// =============================================================================
// Main Application
// =============================================================================
createApp({
    components: { VChart, GaugeComponent, ChartComponent, ControlCard, BadgeComponent },

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
            deviceMeta: null
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

        // System fields (battery, rssi, snr)
        systemFields() {
            const systemKeys = ['bp', 'battery', 'rssi', 'snr'];
            return this.fieldConfigs
                .filter(f => f.is_visible && systemKeys.includes(f.key))
                .sort((a, b) => a.sort_order - b.sort_order);
        },

        // Non-system continuous fields
        sensorFields() {
            const systemKeys = ['bp', 'battery', 'rssi', 'snr'];
            return this.fieldConfigs
                .filter(f => f.is_visible && f.category === 'cont' && !systemKeys.includes(f.key))
                .sort((a, b) => a.sort_order - b.sort_order);
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
            console.log('Received:', msg.topic, msg.payload);

            switch (msg.topic) {
                case 'devices':
                    this.devices = msg.payload;
                    if (this.devices.length > 0 && !this.selectedDevice) {
                        this.selectDevice(this.devices[0].eui);
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
                    this.fieldConfigs = msg.payload.fields || [];
                    this.controls = {};
                    (msg.payload.controls || []).forEach(c => {
                        this.controls[c.control_key] = c;
                    });
                    this.triggers = msg.payload.triggers || [];
                    this.userRules = msg.payload.rules || [];
                    this.deviceMeta = msg.payload.device || null;
                    this.loading = false;
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
                    // Historical data for charts
                    this.historyData[msg.payload.field] = msg.payload.data;
                    // Force reactivity
                    this.historyData = { ...this.historyData };
                    break;

                case 'commandAck':
                    // Command acknowledged - could show toast notification
                    console.log('Command acknowledged:', msg.payload);
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

            uibuilder.send({
                topic: 'selectDevice',
                payload: { eui, range: this.timeRange }
            });
        },

        selectDeviceAndClose(eui) {
            this.selectDevice(eui);
            const drawer = document.getElementById('main-drawer');
            if (drawer) drawer.checked = false;
        },

        onTimeRangeChange() {
            if (!this.selectedDevice) return;
            if (this.timeRange === 'custom') return;
            this.requestHistory();
        },

        onCustomRangeChange() {
            if (!this.selectedDevice || !this.customFrom || !this.customTo) return;
            this.requestHistory();
        },

        requestHistory() {
            const payload = { eui: this.selectedDevice, range: this.timeRange };
            if (this.timeRange === 'custom' && this.customFrom && this.customTo) {
                payload.from = this.customFrom;
                payload.to = this.customTo;
            }

            // Request history for each chart field
            this.chartFields.forEach(f => {
                uibuilder.send({
                    topic: 'getHistory',
                    payload: { ...payload, field: f.key }
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

        // Tab navigation
        setTab(tab) {
            this.activeTab = tab;
        }
    }
}).mount('#app');
