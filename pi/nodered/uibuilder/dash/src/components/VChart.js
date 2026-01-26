// VChart - alias for vue-echarts
// vue-echarts 7.x UMD exports to VueECharts global
// Fallback checks for different possible export names

if (window.VueECharts) {
    window.VChart = window.VueECharts;
} else if (window['vue-echarts']) {
    window.VChart = window['vue-echarts'];
} else if (window.VueEcharts) {
    window.VChart = window.VueEcharts;
} else {
    console.error('[VChart] vue-echarts not found. Available globals:',
        Object.keys(window).filter(k => k.toLowerCase().includes('vue') || k.toLowerCase().includes('echart'))
    );
    // Create a stub to prevent crashes
    window.VChart = {
        name: 'VChartStub',
        template: '<div class="text-error text-xs p-2">Chart library failed to load</div>'
    };
}
