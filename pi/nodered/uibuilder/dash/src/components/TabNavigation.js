// TabNavigation Component - Mobile tab navigation
export default {
    inject: ['deviceStore'],
    computed: {
        activeTab() {
            return this.deviceStore?.activeTab || 'dashboard';
        }
    },
    methods: {
        setTab(tab) {
            this.$emit('set-tab', tab);
        }
    },
    template: `
        <div class="tabs tabs-boxed bg-base-100 justify-center lg:hidden p-1">
            <a class="tab tab-sm" :class="{ 'tab-active': activeTab === 'dashboard' }" @click="setTab('dashboard')">Dashboard</a>
            <a class="tab tab-sm" :class="{ 'tab-active': activeTab === 'controls' }" @click="setTab('controls')">Controls</a>
            <a class="tab tab-sm" :class="{ 'tab-active': activeTab === 'rules' }" @click="setTab('rules')">Rules</a>
            <a class="tab tab-sm" :class="{ 'tab-active': activeTab === 'history' }" @click="setTab('history')">History</a>
        </div>
    `
};
