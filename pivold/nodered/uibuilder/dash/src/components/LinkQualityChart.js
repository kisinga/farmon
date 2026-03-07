// LinkQualityChart - RSSI + SNR on shared time axis (dual y-axis) to show link correlation
// Data: historyData.rssi and historyData.snr as [{ ts, value }, ...] from telemetry

export default {
    props: {
        rssiData: { type: Array, default: () => [] },
        snrData: { type: Array, default: () => [] }
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
        rssiData: { handler() { this.chart?.setOption(this.buildOption(), true); }, deep: true },
        snrData: { handler() { this.chart?.setOption(this.buildOption(), true); }, deep: true }
    },
    methods: {
        buildOption() {
            const rssiColor = '#f59e0b';
            const snrColor = '#8b5cf6';

            const rssiValid = (this.rssiData || [])
                .filter(d => d && d.ts != null && typeof d.value === 'number' && !isNaN(d.value))
                .map(d => [d.ts, d.value]);
            const snrValid = (this.snrData || [])
                .filter(d => d && d.ts != null && typeof d.value === 'number' && !isNaN(d.value))
                .map(d => [d.ts, d.value]);

            const hasData = rssiValid.length > 0 || snrValid.length > 0;
            const bottom = hasData ? 60 : 30;

            return {
                backgroundColor: 'transparent',
                grid: { left: 48, right: 48, top: 28, bottom, containLabel: true },
                tooltip: {
                    trigger: 'axis',
                    confine: true,
                    renderMode: 'richText',
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    borderColor: '#475569',
                    borderWidth: 1,
                    padding: [6, 10],       
                    textStyle: { color: '#e2e8f0', fontSize: 11 },
                    formatter: params => {
                        if (!params?.length) return '';
                        const lines = [];
                        const p0 = params[0];
                        const ts = p0?.value?.[0];
                        if (ts != null) {
                            const date = new Date(ts);
                            lines.push(date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
                        }
                        params.forEach(p => {
                            const v = p.value?.[1];
                            if (v != null && !Number.isNaN(v)) {
                                const unit = p.seriesName === 'RSSI' ? ' dBm' : ' dB';
                                lines.push(`${p.seriesName}: ${typeof v === 'number' ? v.toFixed(1) : v}${unit}`);
                            }
                        });
                        return lines.join('\n');
                    }
                },
                legend: {
                    data: ['RSSI', 'SNR'],
                    top: 4,
                    right: 8,
                    textStyle: { color: '#94a3b8', fontSize: 10 },
                    itemGap: 12,
                    itemWidth: 14,
                    itemHeight: 8
                },
                xAxis: {
                    type: 'time',
                    axisLabel: { color: '#64748b', fontSize: 10, formatter: '{MM}/{dd} {HH}:{mm}' },
                    axisLine: { lineStyle: { color: '#334155' } },
                    splitLine: { show: false }
                },
                yAxis: [
                    {
                        type: 'value',
                        name: 'RSSI (dBm)',
                        nameTextStyle: { color: rssiColor, fontSize: 10 },
                        position: 'left',
                        min: -120,
                        max: -20,
                        axisLabel: { color: '#64748b', fontSize: 10 },
                        axisLine: { show: true, lineStyle: { color: rssiColor } },
                        splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } }
                    },
                    {
                        type: 'value',
                        name: 'SNR (dB)',
                        nameTextStyle: { color: snrColor, fontSize: 10 },
                        position: 'right',
                        min: -20,
                        max: 15,
                        axisLabel: { color: '#64748b', fontSize: 10 },
                        axisLine: { show: true, lineStyle: { color: snrColor } },
                        splitLine: { show: false }
                    }
                ],
                series: [
                    {
                        type: 'line',
                        yAxisIndex: 0,
                        data: rssiValid,
                        smooth: 0.3,
                        symbol: 'circle',
                        symbolSize: 5,
                        showSymbol: false,
                        lineStyle: { color: rssiColor, width: 2 },
                        areaStyle: {
                            color: {
                                type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                                colorStops: [
                                    { offset: 0, color: rssiColor + '30' },
                                    { offset: 1, color: rssiColor + '05' }
                                ]
                            }
                        }
                    },
                    {
                        type: 'line',
                        yAxisIndex: 1,
                        data: snrValid,
                        smooth: 0.3,
                        symbol: 'circle',
                        symbolSize: 5,
                        showSymbol: false,
                        lineStyle: { color: snrColor, width: 2 },
                        areaStyle: {
                            color: {
                                type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                                colorStops: [
                                    { offset: 0, color: snrColor + '30' },
                                    { offset: 1, color: snrColor + '05' }
                                ]
                            }
                        }
                    }
                ],
                dataZoom: hasData ? [
                    { type: 'inside', start: 0, end: 100 },
                    {
                        type: 'slider', start: 0, end: 100, height: 20, bottom: 5,
                        borderColor: '#334155', backgroundColor: '#0f172a',
                        fillerColor: 'rgba(148, 163, 184, 0.2)',
                        handleStyle: { color: '#94a3b8' },
                        textStyle: { color: '#64748b', fontSize: 9 }
                    }
                ] : undefined
            };
        }
    }
};
