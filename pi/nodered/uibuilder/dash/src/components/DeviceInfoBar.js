// DeviceInfoBar Component - Device metadata and top-bar stats (by show_in_top_bar)
// Error object per DATA_CONTRACT §5: ec, ec_na, ec_jf, ec_sf with standard labels
import deviceStore from '../store/deviceStore.js';
import { ERROR_OBJECT_KEYS, ERROR_FIELD_LABELS } from '../utils/errorFields.js';

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
    if (field && field.value_format === 'duration') return formatDuration(value);
    if (field && field.value_format === 'integer') return Math.round(Number(value)).toLocaleString();
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
        /** Error object values for display (DATA_CONTRACT §5). Keys: ec, ec_na, ec_jf, ec_sf */
        const errorEntries = computed(() => {
            const data = currentData.value || {};
            return ERROR_OBJECT_KEYS.map(key => ({
                key,
                label: ERROR_FIELD_LABELS[key],
                value: data[key] != null && !isNaN(Number(data[key])) ? Number(data[key]) : null
            })).filter(e => e.value !== null);
        });
        const hasAnyErrors = computed(() => errorEntries.value.some(e => e.value > 0));
        const hasTopBarStats = computed(() =>
            deviceMeta.value || hasTopBarFields.value || (uptimeStr.value != null) || errorEntries.value.length > 0
        );
        return {
            deviceMeta,
            currentData,
            topBarFields,
            uptimeStr,
            errorEntries,
            hasAnyErrors,
            hasTopBarStats,
            formatTopBarValue
        };
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
            <div v-if="f && !['ec','ec_na','ec_jf','ec_sf','tsr'].includes(f.key)" class="badge badge-ghost text-xs">
                <span class="opacity-50 mr-1">{{ f.name }}:</span>
                <span>{{ formatTopBarValue(f, currentData[f.key]) }}</span>
            </div>
            </template>
            <div v-if="uptimeStr" class="badge badge-ghost text-xs">
                <span class="opacity-50 mr-1">Uptime:</span>
                <span>{{ uptimeStr }}</span>
            </div>
            <template v-for="e in errorEntries" :key="'err-' + e.key">
            <div class="badge text-xs" :class="e.value > 0 ? 'badge-warning' : 'badge-ghost'">
                <span class="opacity-50 mr-1">{{ e.label }}:</span>
                <span>{{ e.value }}</span>
            </div>
            </template>
        </div>
    `
};
