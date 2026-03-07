// DashboardEmptyState Component - Empty states for dashboard
export default {
    props: {
        state: { type: String, required: true } // 'no-devices' | 'no-device-selected' | 'loading' | 'waiting-for-data'
    },
    mounted() {
        console.log('[DashboardEmptyState] Mounted with state:', this.state);
    },
    computed: {
        message() {
            const messages = {
                'no-devices': 'No devices registered yet. Waiting for a device to send its registration message...',
                'no-device-selected': 'Select a device to view data',
                'loading': 'Loading...',
                'waiting-for-data': 'Waiting for device data...'
            };
            return messages[this.state] || '';
        },
        alertClass() {
            const classes = {
                'no-devices': 'alert-warning',
                'no-device-selected': 'alert-info',
                'loading': '',
                'waiting-for-data': 'alert-info'
            };
            return classes[this.state] || 'alert-info';
        }
    },
    template: `
        <div v-if="state === 'loading'" class="flex justify-center py-8">
            <span class="loading loading-lg loading-spinner text-primary"></span>
        </div>
        <div v-else class="alert" :class="alertClass">
            <svg v-if="state === 'no-devices'" xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <span>{{ message }}</span>
        </div>
    `
};
