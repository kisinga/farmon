const { createApp } = Vue;

createApp({
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
            charts: {},
            gauges: {}
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
        this.initCharts();
        this.initGauges();
    },

    methods: {
        initUIBuilder() {
            uibuilder.start();

            uibuilder.onChange('connected', (connected) => {
                this.connected = connected;
                if (connected) {
                    this.requestDeviceList();
                }
            });

            uibuilder.onChange('msg', (msg) => {
                this.handleMessage(msg);
            });
        },

        handleMessage(msg) {
            console.log('Received:', msg);

            switch (msg.topic) {
                case 'deviceList':
                    this.devices = msg.payload;
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
        initCharts() {
            this.charts.battery = echarts.init(this.$refs.batteryChart);
            this.charts.water = echarts.init(this.$refs.waterChart);
            this.charts.rssi = echarts.init(this.$refs.rssiChart);
            this.charts.snr = echarts.init(this.$refs.snrChart);

            // Set initial empty options
            Object.values(this.charts).forEach(chart => {
                chart.setOption(this.getLineChartOption([], 'No data'));
            });

            // Handle resize
            window.addEventListener('resize', () => {
                Object.values(this.charts).forEach(c => c.resize());
            });
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
                this.charts.battery.setOption(
                    this.getLineChartOption(chartData, 'Battery', '%', '#10b981')
                );
            }

            if (data.water) {
                const chartData = data.water.map(d => [d.ts, d.value]);
                this.charts.water.setOption(
                    this.getLineChartOption(chartData, 'Water Volume', 'L', '#3b82f6')
                );
            }

            if (data.rssi) {
                const chartData = data.rssi.map(d => [d.ts, d.value]);
                this.charts.rssi.setOption(
                    this.getLineChartOption(chartData, 'RSSI', 'dBm', '#f59e0b')
                );
            }

            if (data.snr) {
                const chartData = data.snr.map(d => [d.ts, d.value]);
                this.charts.snr.setOption(
                    this.getLineChartOption(chartData, 'SNR', 'dB', '#8b5cf6')
                );
            }
        },

        // ============ GAUGES ============
        initGauges() {
            this.gauges.battery = echarts.init(this.$refs.batteryGauge);
            this.gauges.rssi = echarts.init(this.$refs.rssiGauge);
            this.gauges.snr = echarts.init(this.$refs.snrGauge);
            this.gauges.water = echarts.init(this.$refs.waterGauge);

            // Set initial values
            this.updateGauges(this.current);

            window.addEventListener('resize', () => {
                Object.values(this.gauges).forEach(g => g.resize());
            });
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
            this.gauges.battery.setOption(this.getGaugeOption(
                data.battery || 0, 0, 100, '%',
                [[0.2, '#ef4444'], [0.5, '#f59e0b'], [1, '#10b981']]
            ));

            // RSSI Gauge
            this.gauges.rssi.setOption(this.getGaugeOption(
                data.rssi || -120, -120, 0, 'dBm',
                [[0.25, '#ef4444'], [0.6, '#f59e0b'], [1, '#10b981']]
            ));

            // SNR Gauge
            this.gauges.snr.setOption(this.getGaugeOption(
                data.snr || -20, -20, 10, 'dB',
                [[0.33, '#ef4444'], [0.67, '#f59e0b'], [1, '#10b981']]
            ));

            // Water Level Gauge
            this.gauges.water.setOption(this.getGaugeOption(
                data.waterLevel || 0, 0, 100, '%',
                [[0.2, '#ef4444'], [0.5, '#f59e0b'], [1, '#3b82f6']]
            ));
        }
    }
}).mount('#app');
