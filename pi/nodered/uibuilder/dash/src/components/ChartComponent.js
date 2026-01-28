// ChartComponent - Time series line chart using vue-echarts
import VChart from './VChart.js';

export default {
    components: {
        'v-chart': VChart
    },
    props: {
        field: { type: Object, required: true },
        data: { type: Array, default: () => [] }
    },
    template: `
        <div class="chart-container">
            <v-chart :option="chartOption" autoresize />
        </div>
    `,
    computed: {
        chartOption() {
            const color = this.field?.chart_color || '#3b82f6';
            const unit = this.field?.unit || '';
            const name = this.field?.name || this.field?.key || 'Value';

            const validData = (this.data || [])
                .filter(d => d && d.ts && typeof d.value === 'number' && !isNaN(d.value))
                .map(d => [d.ts, d.value]);

            const hasData = validData.length > 0;

            return {
                backgroundColor: 'transparent',
                grid: { left: 10, right: 10, top: 25, bottom: hasData ? 60 : 30, containLabel: true },
                tooltip: {
                    trigger: 'axis',
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    borderColor: color,
                    borderWidth: 1,
                    padding: [10, 14],
                    textStyle: { color: '#e2e8f0', fontSize: 12 },
                    formatter: params => {
                        if (!params?.[0]) return '';
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
