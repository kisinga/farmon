// ChartComponent - Time series line chart using echarts directly

export default {
    props: {
        field: { type: Object, required: true },
        data: { type: Array, default: () => [] }
    },
    template: `<div ref="chart" class="chart-container"></div>`,
    mounted() {
        const el = this.$refs.chart;
        this.chart = echarts.init(el);
        this.chart.setOption(this.buildOption());
        this._ro = new ResizeObserver(() => this.chart?.resize());
        this._ro.observe(el);
    },
    beforeUnmount() {
        this._ro?.disconnect();
        this.chart?.dispose();
    },
    watch: {
        data: {
            handler() {
                this.chart?.setOption(this.buildOption(), true);
            },
            deep: true
        },
        field: {
            handler() { this.chart?.setOption(this.buildOption(), true); },
            deep: true
        }
    },
    methods: {
        buildOption() {
            const color = this.field?.chart_color || '#3b82f6';
            const unit = this.field?.unit || '';
            const name = this.field?.name || this.field?.key || 'Value';

            const validData = (this.data || [])
                .filter(d => d && d.ts != null && typeof d.value === 'number' && !isNaN(d.value))
                .map(d => [d.ts, d.value]);

            const hasData = validData.length > 0;

            return {
                backgroundColor: 'transparent',
                grid: { left: 10, right: 10, top: 25, bottom: hasData ? 60 : 30, containLabel: true },
                tooltip: {
                    trigger: 'axis',
                    confine: true,
                    renderMode: 'richText',
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    borderColor: color,
                    borderWidth: 1,
                    padding: [4, 8],
                    textStyle: { color: '#e2e8f0', fontSize: 11 },
                    formatter: params => {
                        if (!params?.[0]) return '';
                        const p = params[0];
                        const date = new Date(p.value[0]);
                        const label = date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                        const val = typeof p.value[1] === 'number' ? p.value[1].toFixed(1) : p.value[1];
                        return `${label}\n${name}: ${val} ${unit}`.trim();
                    }
                },
                xAxis: {
                    type: 'time',
                    axisLabel: { color: '#64748b', fontSize: 10, formatter: '{MM}/{dd} {HH}:{mm}' },
                    axisLine: { lineStyle: { color: '#334155' } },
                    splitLine: { show: false }
                },
                yAxis: {
                    type: 'value',
                    name: unit,
                    nameTextStyle: { color: '#64748b', fontSize: 10 },
                    axisLabel: { color: '#64748b', fontSize: 10 },
                    axisLine: { show: false },
                    splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } }
                },
                series: [{
                    name,
                    type: 'line',
                    data: validData,
                    smooth: 0.3,
                    symbol: 'circle',
                    symbolSize: 5,
                    showSymbol: false,
                    lineStyle: { color, width: 2 },
                    areaStyle: {
                        color: {
                            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                            colorStops: [
                                { offset: 0, color: color + '30' },
                                { offset: 1, color: color + '05' }
                            ]
                        }
                    }
                }],
                dataZoom: hasData ? [
                    { type: 'inside', start: 0, end: 100 },
                    {
                        type: 'slider', start: 0, end: 100, height: 20, bottom: 5,
                        borderColor: '#334155', backgroundColor: '#0f172a',
                        fillerColor: color + '20', handleStyle: { color },
                        textStyle: { color: '#64748b', fontSize: 9 }
                    }
                ] : undefined
            };
        }
    }
};
