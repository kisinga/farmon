// Navbar Component
import deviceStore from '../store/deviceStore.js';

export default {
    computed: {
        loading() {
            return deviceStore.state.loading;
        },
        deviceOnline() {
            return deviceStore.deviceOnline.value;
        },
        gatewayOnline() {
            return deviceStore.state.gatewayOnline;
        },
        activeTab() {
            return deviceStore.state.activeTab;
        }
    },
    methods: {
        setTab(tab) {
            this.$emit('set-tab', tab);
        }
    },
    template: `
        <nav class="navbar bg-base-100 shadow-lg sticky top-0 z-50">
            <div class="navbar-start">
                <label for="main-drawer" class="btn btn-ghost btn-circle lg:hidden">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7" />
                    </svg>
                </label>
                <a class="btn btn-ghost text-lg sm:text-xl font-bold normal-case">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 sm:h-6 sm:w-6 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span class="hidden xs:inline">Farm Monitor</span>
                    <span class="xs:hidden">FarmMon</span>
                </a>
            </div>

            <div class="navbar-center hidden lg:flex">
                <ul class="menu menu-horizontal px-1">
                    <li><a :class="{ active: activeTab === 'dashboard' }" @click="setTab('dashboard')">Dashboard</a></li>
                    <li><a :class="{ active: activeTab === 'controls' }" @click="setTab('controls')">Controls</a></li>
                    <li><a :class="{ active: activeTab === 'rules' }" @click="setTab('rules')">Rules</a></li>
                    <li><a :class="{ active: activeTab === 'history' }" @click="setTab('history')">History</a></li>
                    <li><a :class="{ active: activeTab === 'firmware' }" @click="setTab('firmware')">Firmware</a></li>
                </ul>
            </div>

            <div class="navbar-end gap-2">
                <span class="loading loading-spinner loading-sm" v-if="loading"></span>
                <div v-if="!gatewayOnline" class="badge badge-sm sm:badge-md badge-error font-semibold" title="Gateway is offline — no data can flow">
                    <span class="hidden sm:inline">Gateway offline</span>
                    <span class="sm:hidden">GW off</span>
                </div>
                <div v-else class="badge badge-sm sm:badge-md" :class="deviceOnline ? 'badge-success' : 'badge-warning'">
                    <span class="hidden sm:inline">{{ deviceOnline ? 'Online' : 'Offline' }}</span>
                    <span class="sm:hidden">{{ deviceOnline ? 'On' : 'Off' }}</span>
                </div>
            </div>
        </nav>
    `
};
