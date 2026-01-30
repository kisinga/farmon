// DeviceInfoBar Component - Device metadata and top-bar stats (by show_in_top_bar)
import deviceStore from '../store/deviceStore.js';

function formatDuration(seconds) {
    if (seconds == null || isNaN(seconds)) return null;
    const s = Math.floor(Number(seconds));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60) % 60;
    const h = Math.floor(s / 3600) % 24;
    const d = Math.floor(s / 86400);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0 || parts.length === 0) parts.push(`${m}m`);
    return parts.join(' ');
}

function formatTopBarValue(field, value) {
    if (value === null || value === undefined) return '--';
    if (field.value_format === 'duration') return formatDuration(value);
    if (field.value_format === 'integer') return Math.round(Number(value)).toLocaleString();
    if (typeof value === 'number') return Math.abs(value) >= 1000 ? value.toLocaleString('en-US', { maximumFractionDigits: 1 }) : value.toFixed(1);
    return value;
}

const { computed } = Vue;

export default {
    setup() {
        const deviceMeta = computed(() => deviceStore.state.deviceMeta);
        const currentData = computed(() => deviceStore.state.currentData);
        const topBarFields = computed(() => {
            const raw = deviceStore.topBarFields;
            const arr = raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw;
            return Array.isArray(arr) ? arr : [];
        });
        const hasTopBarFields = computed(() => topBarFields.value.length > 0);
        const uptimeStr = computed(() => formatDuration(currentData.value?.tsr));
        const errCount = computed(() => {
            const ec = currentData.value?.ec;
            return ec != null && !isNaN(ec) ? Number(ec) : null;
        });
        const hasTopBarStats = computed(() =>
            deviceMeta.value || hasTopBarFields.value || (uptimeStr.value != null) || (errCount.value != null)
        );
        return { deviceMeta, currentData, topBarFields, uptimeStr, errCount, hasTopBarStats, formatTopBarValue };
    },
    template: `
        <div v-if="hasTopBarStats" class="flex flex-wrap items-center justify-center gap-2 py-1">
            <template v-if="deviceMeta">
            <div class="badge badge-ghost text-xs">
                <span class="opacity-50 mr-1">Type:</span>
                <span>{{ deviceMeta.type || 'unknown' }}</span>
            </div>
            <div class="badge badge-ghost text-xs">
                <span class="opacity-50 mr-1">Version:</span>
                <span class="font-mono">{{ deviceMeta.fw || '--' }}</span>
            </div>
            </template>
            <template v-for="(f, i) of topBarFields" :key="f?.key ?? i">
            <div v-if="f" class="badge badge-ghost text-xs" :class="f.key === 'ec' && (currentData[f.key] > 0) ? 'badge-warning' : ''">
                <span class="opacity-50 mr-1">{{ f.name }}:</span>
                <span>{{ formatTopBarValue(f, currentData[f.key]) }}</span>
            </div>
            </template>
            <template v-if="topBarFields.length === 0">
            <div v-if="uptimeStr" class="badge badge-ghost text-xs">
                <span class="opacity-50 mr-1">Uptime:</span>
                <span>{{ uptimeStr }}</span>
            </div>
            <div v-if="errCount != null" class="badge badge-ghost text-xs" :class="errCount > 0 ? 'badge-warning' : ''">
                <span class="opacity-50 mr-1">Err:</span>
                <span>{{ errCount }}</span>
            </div>
            </template>
        </div>
    `
};
