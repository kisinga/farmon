// Sidebar Component - Mobile drawer sidebar
import deviceStore from '../store/deviceStore.js';

export default {
    computed: {
        activeTab() {
            return deviceStore.state.activeTab;
        },
        devices() {
            return deviceStore.state.devices;
        },
        selectedDevice() {
            return deviceStore.state.selectedDevice;
        }
    },
    methods: {
        setTab(tab) {
            this.$emit('set-tab', tab);
            this.closeDrawer();
        },
        selectDeviceAndClose(eui) {
            this.$emit('select-device', eui);
            this.closeDrawer();
        },
        closeDrawer() {
            const drawer = document.getElementById('main-drawer');
            if (drawer) drawer.checked = false;
        }
    },
    template: `
        <div class="drawer-side z-50">
            <label for="main-drawer" aria-label="close sidebar" class="drawer-overlay"></label>
            <div class="menu p-4 w-64 min-h-full bg-base-200 text-base-content">
                <!-- Sidebar header -->
                <div class="flex items-center gap-2 mb-6 px-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span class="font-bold text-lg">Farm Monitor</span>
                </div>

                <!-- Navigation -->
                <ul class="space-y-1">
                    <li>
                        <a :class="{ active: activeTab === 'dashboard' }" @click="setTab('dashboard')">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                            </svg>
                            Dashboard
                        </a>
                    </li>
                    <li>
                        <a :class="{ active: activeTab === 'controls' }" @click="setTab('controls')">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                            </svg>
                            Controls
                        </a>
                    </li>
                    <li>
                        <a :class="{ active: activeTab === 'rules' }" @click="setTab('rules')">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                            </svg>
                            Rules
                        </a>
                    </li>
                    <li>
                        <a :class="{ active: activeTab === 'history' }" @click="setTab('history')">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            History
                        </a>
                    </li>
                    <li>
                        <a :class="{ active: activeTab === 'firmware' }" @click="setTab('firmware')">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                            </svg>
                            Firmware
                        </a>
                    </li>
                </ul>

                <!-- Devices section -->
                <div class="divider mt-6">Devices</div>
                <ul class="space-y-1">
                    <li v-for="device in devices" :key="device.eui">
                        <a @click="selectDeviceAndClose(device.eui)" :class="{ active: selectedDevice === device.eui }">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                            </svg>
                            {{ device.name || device.eui }}
                        </a>
                    </li>
                    <li v-if="devices.length === 0">
                        <span class="text-xs opacity-50 px-2">No devices registered</span>
                    </li>
                </ul>
            </div>
        </div>
    `
};
