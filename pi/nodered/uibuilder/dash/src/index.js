// @ts-nocheck
'use strict'
const { createApp } = Vue;

// Simple v-chart component that mimics vue-echarts behavior
const VChart = {
    props: {
        option: {
            type: Object,
            required: true
        },
        autoresize: {
            type: Boolean,
            default: false
        }
    },
    template: '<div ref="chart"></div>',
    data() {
        return {
            chart: null,
            resizeObserver: null
        };
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
                if (this.chart) {
                    this.chart.setOption(newOption);
                }
            }
        }
    },
    beforeUnmount() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        if (this.chart) {
            this.chart.dispose();
        }
    }
};

createApp({
    components: {
        VChart
    },
    data() {
        return {
            connected: false,
            loading: false,
            devices: [],
            selectedDevice: '',
            current: {
                battery: 0,
                rssi: 0,
                snr: 0,
                waterLevel: 0,
                waterVolume: 0,
                flowRate: 0,
                uptime: '--'
            },
            // Chart options (reactive)
            batteryChartOption: {},
            waterChartOption: {},
            rssiChartOption: {},
            snrChartOption: {},
            // Gauge options (reactive)
            batteryGaugeOption: {},
            rssiGaugeOption: {},
            snrGaugeOption: {},
            waterGaugeOption: {}
        };
    },

    computed: {
        batteryColor() {
            const bp = this.current.battery;
            if (bp < 20) return 'text-error';
            if (bp < 50) return 'text-warning';
            return 'text-success';
        }
    },

    mounted() {
        this.initUIBuilder();
        this.initChartOptions();
        this.initGaugeOptions();
    },

    methods: {
        initUIBuilder() {
            uibuilder.start();
            console.log("connecting")

            uibuilder.onChange('msg', (msg) => {
                this.handleMessage(msg);
            });
        },

        handleMessage(msg) {
            console.log('Received:', msg);

            switch (msg.topic) {
                case 'deviceList':
                    this.devices = msg.payload;
                    this.selectedDevice = this.devices[0].eui;
                    break;

                case 'deviceData':
                    this.updateCurrentData(msg.payload.current);
                    this.updateGauges(msg.payload.current);
                    break;

                case 'chartData':
                    this.updateCharts(msg.payload);
                    break;

                case 'realtimeUpdate':
                    this.updateCurrentData(msg.payload);
                    this.updateGauges(msg.payload);
                    break;
            }
        },

        requestDeviceList() {
            uibuilder.send({ topic: 'requestDeviceList' });
        },

        onDeviceChange() {
            if (!this.selectedDevice) return;
            this.loading = true;
            uibuilder.send({
                topic: 'selectDevice',
                payload: this.selectedDevice
            });
        },

        updateCurrentData(data) {
            Object.assign(this.current, data);
            this.loading = false;
        },

        // ============ CHARTS ============
        initChartOptions() {
            this.batteryChartOption = this.getLineChartOption([], 'Battery', '%', '#10b981');
            this.waterChartOption = this.getLineChartOption([], 'Water Volume', 'L', '#3b82f6');
            this.rssiChartOption = this.getLineChartOption([], 'RSSI', 'dBm', '#f59e0b');
            this.snrChartOption = this.getLineChartOption([], 'SNR', 'dB', '#8b5cf6');
        },

        getLineChartOption(data, seriesName, unit = '', color = '#3b82f6') {
            return {
                backgroundColor: 'transparent',
                grid: { left: 60, right: 20, top: 40, bottom: 60 },
                tooltip: {
                    trigger: 'axis',
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    borderColor: color,
                    textStyle: { color: '#fff' }
                },
                xAxis: {
                    type: 'time',
                    axisLabel: {
                        color: '#94a3b8',
                        formatter: '{HH}:{mm}'
                    },
                    axisLine: { lineStyle: { color: '#334155' } }
                },
                yAxis: {
                    type: 'value',
                    name: unit,
                    nameTextStyle: { color: '#94a3b8' },
                    axisLabel: { color: '#94a3b8' },
                    axisLine: { lineStyle: { color: '#334155' } },
                    splitLine: { lineStyle: { color: '#1e293b' } }
                },
                series: [{
                    name: seriesName,
                    type: 'line',
                    data: data,
                    smooth: true,
                    symbol: 'none',
                    lineStyle: { color: color, width: 2 },
                    areaStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: color + '40' },
                            { offset: 1, color: color + '00' }
                        ])
                    }
                }]
            };
        },

        updateCharts(data) {
            if (data.battery) {
                const chartData = data.battery.map(d => [d.ts, d.value]);
                this.batteryChartOption = this.getLineChartOption(chartData, 'Battery', '%', '#10b981');
            }

            if (data.water) {
                const chartData = data.water.map(d => [d.ts, d.value]);
                this.waterChartOption = this.getLineChartOption(chartData, 'Water Volume', 'L', '#3b82f6');
            }

            if (data.rssi) {
                const chartData = data.rssi.map(d => [d.ts, d.value]);
                this.rssiChartOption = this.getLineChartOption(chartData, 'RSSI', 'dBm', '#f59e0b');
            }

            if (data.snr) {
                const chartData = data.snr.map(d => [d.ts, d.value]);
                this.snrChartOption = this.getLineChartOption(chartData, 'SNR', 'dB', '#8b5cf6');
            }
        },

        // ============ GAUGES ============
        initGaugeOptions() {
            this.batteryGaugeOption = this.getGaugeOption(0, 0, 100, '%', [[0.2, '#ef4444'], [0.5, '#f59e0b'], [1, '#10b981']]);
            this.rssiGaugeOption = this.getGaugeOption(-120, -120, 0, 'dBm', [[0.25, '#ef4444'], [0.6, '#f59e0b'], [1, '#10b981']]);
            this.snrGaugeOption = this.getGaugeOption(-20, -20, 10, 'dB', [[0.33, '#ef4444'], [0.67, '#f59e0b'], [1, '#10b981']]);
            this.waterGaugeOption = this.getGaugeOption(0, 0, 100, '%', [[0.2, '#ef4444'], [0.5, '#f59e0b'], [1, '#3b82f6']]);
        },

        getGaugeOption(value, min, max, unit, thresholds) {
            const percent = ((value - min) / (max - min)) * 100;

            return {
                backgroundColor: 'transparent',
                series: [{
                    type: 'gauge',
                    min: min,
                    max: max,
                    splitNumber: 5,
                    radius: '80%',
                    axisLine: {
                        lineStyle: {
                            width: 20,
                            color: thresholds
                        }
                    },
                    pointer: {
                        itemStyle: { color: '#3b82f6' },
                        length: '60%',
                        width: 4
                    },
                    axisTick: { show: false },
                    splitLine: {
                        length: 15,
                        lineStyle: { color: '#334155', width: 2 }
                    },
                    axisLabel: {
                        color: '#94a3b8',
                        fontSize: 10,
                        distance: -50
                    },
                    detail: {
                        valueAnimation: true,
                        formatter: '{value}' + unit,
                        color: '#fff',
                        fontSize: 18,
                        offsetCenter: [0, '70%']
                    },
                    data: [{ value: value }]
                }]
            };
        },

        updateGauges(data) {
            // Battery Gauge
            this.batteryGaugeOption = this.getGaugeOption(
                data.battery || 0, 0, 100, '%',
                [[0.2, '#ef4444'], [0.5, '#f59e0b'], [1, '#10b981']]
            );

            // RSSI Gauge
            this.rssiGaugeOption = this.getGaugeOption(
                data.rssi || -120, -120, 0, 'dBm',
                [[0.25, '#ef4444'], [0.6, '#f59e0b'], [1, '#10b981']]
            );

            // SNR Gauge
            this.snrGaugeOption = this.getGaugeOption(
                data.snr || -20, -20, 10, 'dB',
                [[0.33, '#ef4444'], [0.67, '#f59e0b'], [1, '#10b981']]
            );

            // Water Level Gauge
            this.waterGaugeOption = this.getGaugeOption(
                data.waterLevel || 0, 0, 100, '%',
                [[0.2, '#ef4444'], [0.5, '#f59e0b'], [1, '#3b82f6']]
            );
        }
    }
}).mount('#app');
