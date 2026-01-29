// DeviceInfoBar Component - Device metadata display
import deviceStore from '../store/deviceStore.js';

const { computed } = Vue;

export default {
    setup() {
        const deviceMeta = computed(() => deviceStore.state.deviceMeta);
        return { deviceMeta };
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
