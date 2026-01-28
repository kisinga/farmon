// VChart - alias for vue-echarts
// vue-echarts 7.x UMD exports to VueECharts global
// Fallback checks for different possible export names

let VChartComponent;

if (window.VueECharts) {
    VChartComponent = window.VueECharts;
} else if (window['vue-echarts']) {
    VChartComponent = window['vue-echarts'];
} else if (window.VueEcharts) {
    VChartComponent = window.VueEcharts;
} else {
    console.error('[VChart] vue-echarts not found. Available globals:',
        Object.keys(window).filter(k => k.toLowerCase().includes('vue') || k.toLowerCase().includes('echart'))
    );
    // Create a stub to prevent crashes
    VChartComponent = {
        name: 'VChartStub',
        template: '<div class="text-error text-xs p-2">Chart library failed to load</div>'
    };
}

export default VChartComponent;
