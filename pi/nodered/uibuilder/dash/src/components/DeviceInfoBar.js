// DeviceInfoBar Component - Device metadata display
import deviceStore from '../store/deviceStore.js';
import { formatDuration } from '../utils/formatters.js';

const { computed } = Vue;

export default {
    setup() {
        const deviceMeta = computed(() => deviceStore.state.deviceMeta);
        const currentData = computed(() => deviceStore.state.currentData);
        const uptimeStr = computed(() => {
            const tsr = currentData.value?.tsr;
            return formatDuration(tsr);
        });
        return { deviceMeta, uptimeStr };
    },
    template: `
        <div v-if="deviceMeta || uptimeStr !== '--'" class="flex flex-wrap items-center justify-center gap-2 py-1">
            <template v-if="deviceMeta">
            <div class="badge badge-ghost text-xs">
                <span class="opacity-50 mr-1">Type:</span>
                <span>{{ deviceMeta.type || 'unknown' }}</span>
            </div>
            <div class="badge badge-ghost text-xs">
                <span class="opacity-50 mr-1">FW:</span>
                <span class="font-mono">{{ deviceMeta.fw || '--' }}</span>
            </div>
            </template>
            <div v-if="uptimeStr !== '--'" class="badge badge-ghost text-xs">
                <span class="opacity-50 mr-1">Uptime:</span>
                <span>{{ uptimeStr }}</span>
            </div>
        </div>
    `
};
