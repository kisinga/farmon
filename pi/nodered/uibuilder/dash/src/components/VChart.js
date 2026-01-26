// VChart Component - ECharts wrapper
// IIFE pattern for Vue 3 without build process
window.VChart = {
    props: {
        option: { type: Object, required: true },
        autoresize: { type: Boolean, default: false }
    },
    template: '<div ref="chart" style="width: 100%;"></div>',
    data() {
        return { chart: null, resizeObserver: null, initRetries: 0 };
    },
    mounted() {
        this.$nextTick(() => {
            this.initChart();
        });
    },
    methods: {
        initChart() {
            if (this.chart || !this.$refs.chart) return;

            const el = this.$refs.chart;

            // Check if container has dimensions (max 20 retries = 2 seconds)
            if ((el.offsetWidth === 0 || el.offsetHeight === 0) && this.initRetries < 20) {
                this.initRetries++;
                setTimeout(() => this.initChart(), 100);
                return;
            }

            // Force minimum height if no CSS height is applied
            if (el.offsetHeight === 0) {
                console.warn('VChart: Container has no height, applying default');
                el.style.height = '200px';
            }

            try {
                this.chart = echarts.init(el);
                if (this.option?.series?.length) {
                    this.chart.setOption(this.option);
                }

                if (this.autoresize) {
                    this.resizeObserver = new ResizeObserver(() => {
                        if (this.chart) {
                            this.chart.resize();
                        }
                    });
                    this.resizeObserver.observe(el);
                }
            } catch (e) {
                console.error('VChart init error:', e);
            }
        }
    },
    watch: {
        option: {
            deep: true,
            immediate: true,
            handler(newOption) {
                if (!newOption?.series?.length) return;

                this.$nextTick(() => {
                    if (!this.chart && this.$refs.chart) {
                        this.initChart();
                    }
                    if (this.chart) {
                        try {
                            this.chart.setOption(newOption, true);
                        } catch (e) {
                            console.error('VChart setOption error:', e);
                        }
                    }
                });
            }
        }
    },
    beforeUnmount() {
        if (this.resizeObserver) this.resizeObserver.disconnect();
        if (this.chart) {
            this.chart.dispose();
            this.chart = null;
        }
    }
};
