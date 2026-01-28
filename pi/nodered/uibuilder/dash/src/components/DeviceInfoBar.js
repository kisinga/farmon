// DeviceInfoBar Component - Device metadata display
export default {
    inject: ['deviceStore'],
    computed: {
        deviceMeta() {
            return this.deviceStore?.deviceMeta || null;
        }
    },
    template: `
        <div v-if="deviceMeta" class="flex flex-wrap items-center justify-center gap-2 py-1">
            <div class="badge badge-ghost text-xs">
                <span class="opacity-50 mr-1">Type:</span>
                <span>{{ deviceMeta.type || 'unknown' }}</span>
            </div>
            <div class="badge badge-ghost text-xs">
                <span class="opacity-50 mr-1">FW:</span>
                <span class="font-mono">{{ deviceMeta.fw || '--' }}</span>
            </div>
        </div>
    `
};
