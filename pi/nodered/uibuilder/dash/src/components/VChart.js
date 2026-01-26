// VChart Component - ECharts wrapper
// IIFE pattern for Vue 3 without build process
window.VChart = {
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
            // Guard: only init if we have valid series
            if (!this.option?.series?.length) return;
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
                if (!newOption?.series?.length) return;
                if (!this.chart && this.$refs.chart) {
                    this.chart = echarts.init(this.$refs.chart);
                }
                if (this.chart) this.chart.setOption(newOption, true);
            }
        }
    },
    beforeUnmount() {
        if (this.resizeObserver) this.resizeObserver.disconnect();
        if (this.chart) this.chart.dispose();
    }
};
