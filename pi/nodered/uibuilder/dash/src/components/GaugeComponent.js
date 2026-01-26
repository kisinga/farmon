// GaugeComponent - Dynamic gauge based on gauge_style
window.GaugeComponent = {
    components: {
        'v-chart': window.VChart
    },
    props: {
        field: { type: Object, required: true },
        value: { type: Number, default: 0 }
    },
    template: `
        <div class="gauge-container" :class="{ 'gauge-tank': isTankStyle }">
            <v-chart :option="gaugeOption" autoresize />
        </div>
    `,
    computed: {
        isTankStyle() {
            return this.field?.gauge_style === 'tank';
        },
        gaugeOption() {
            const style = this.field?.gauge_style || 'radial';
            if (style === 'tank') return this.tankGauge();
            if (style === 'liquid') return this.liquidGauge();
            if (style === 'bar') return this.barGauge();
            return this.radialGauge();
        }
    },
    methods: {
        getThresholdColor(percent) {
            const thresholds = this.field?.thresholds || [
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
            const min = this.field?.min ?? 0;
            const max = this.field?.max ?? 100;
            const value = this.value ?? min;
            const range = max - min || 1;
            const percent = Math.max(0, Math.min(1, (value - min) / range));
            const color = this.getThresholdColor(percent);
            const unit = this.field?.unit || '';

            const thresholds = this.field?.thresholds || [
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
                    data: [{ value: value ?? 0, name: unit }]
                }]
            };
        },

        liquidGauge() {
            const min = this.field?.min ?? 0;
            const max = this.field?.max ?? 100;
            const value = this.value ?? min;
            const range = max - min || 1;
            const percent = Math.round(Math.max(0, Math.min(100, ((value - min) / range) * 100)));
            const color = this.getThresholdColor(percent / 100);

            return {
                backgroundColor: 'transparent',
                grid: { left: '30%', right: '30%', top: 20, bottom: 20 },
                xAxis: { type: 'category', data: ['Level'], show: false },
                yAxis: { type: 'value', min: 0, max: 100, show: false },
                series: [{
                    type: 'bar',
                    data: [percent],
                    barWidth: '100%',
                    itemStyle: {
                        color: {
                            type: 'linear', x: 0, y: 1, x2: 0, y2: 0,
                            colorStops: [
                                { offset: 0, color: color + '40' },
                                { offset: 1, color: color }
                            ]
                        },
                        borderRadius: [4, 4, 0, 0]
                    },
                    label: {
                        show: true, position: 'inside', formatter: '{c}%',
                        color: '#fff', fontSize: 18, fontWeight: 'bold'
                    },
                    showBackground: true,
                    backgroundStyle: { color: '#1e293b', borderRadius: [4, 4, 0, 0] }
                }]
            };
        },

        barGauge() {
            const min = this.field?.min ?? 0;
            const max = this.field?.max ?? 100;
            const value = this.value ?? min;
            const range = max - min || 1;
            const percent = Math.max(0, Math.min(1, (value - min) / range));
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
                    data: [{ value: Math.round(percent * 100), name: this.field?.name || '' }]
                }]
            };
        },

        // Tank gauge using echarts-liquidfill for water tank visualization
        tankGauge() {
            const min = this.field?.min ?? 0;
            const max = this.field?.max ?? 100;
            const value = this.value ?? min;
            const range = max - min || 1;
            const percent = Math.max(0, Math.min(1, (value - min) / range));
            const color = this.getThresholdColor(percent);
            const unit = this.field?.unit || '';

            // Tank shape path - rectangular tank with rounded bottom
            const tankPath = 'path://M20,5 L80,5 L80,5 Q85,5 85,10 L85,85 Q85,95 75,95 L25,95 Q15,95 15,85 L15,10 Q15,5 20,5 Z';

            return {
                backgroundColor: 'transparent',
                series: [{
                    type: 'liquidFill',
                    data: [percent, percent * 0.9, percent * 0.8],
                    radius: '85%',
                    center: ['50%', '52%'],
                    shape: tankPath,
                    outline: {
                        show: true,
                        borderDistance: 0,
                        itemStyle: {
                            borderWidth: 3,
                            borderColor: color,
                            shadowBlur: 8,
                            shadowColor: color + '40'
                        }
                    },
                    backgroundStyle: {
                        color: '#1e293b',
                        borderWidth: 0
                    },
                    color: [
                        {
                            type: 'linear',
                            x: 0, y: 1, x2: 0, y2: 0,
                            colorStops: [
                                { offset: 0, color: color + 'cc' },
                                { offset: 0.5, color: color },
                                { offset: 1, color: color + 'dd' }
                            ]
                        },
                        {
                            type: 'linear',
                            x: 0, y: 1, x2: 0, y2: 0,
                            colorStops: [
                                { offset: 0, color: color + '99' },
                                { offset: 1, color: color + 'bb' }
                            ]
                        },
                        {
                            type: 'linear',
                            x: 0, y: 1, x2: 0, y2: 0,
                            colorStops: [
                                { offset: 0, color: color + '66' },
                                { offset: 1, color: color + '88' }
                            ]
                        }
                    ],
                    label: {
                        show: true,
                        fontSize: 20,
                        fontWeight: 'bold',
                        color: '#fff',
                        insideColor: '#fff',
                        formatter: () => {
                            const displayVal = Math.round(percent * 100);
                            return displayVal + '%';
                        }
                    },
                    waveAnimation: true,
                    animationDuration: 2000,
                    animationDurationUpdate: 1000,
                    amplitude: 8,
                    period: 2000
                }],
                // Add value label below tank
                graphic: [{
                    type: 'text',
                    left: 'center',
                    bottom: 5,
                    style: {
                        text: `${value}${unit}`,
                        fill: '#94a3b8',
                        fontSize: 11,
                        fontWeight: 'normal'
                    }
                }]
            };
        }
    }
};
