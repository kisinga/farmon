// ControlsPreview Component - Quick controls preview in dashboard
import deviceStore from '../store/deviceStore.js';

const { computed } = Vue;

export default {
    setup() {
        const controls = computed(() => deviceStore.state.controls);
        const fieldConfigs = computed(() => deviceStore.state.fieldConfigs);

        const stateFields = computed(() => {
            const controlsObj = controls.value;
            const configs = fieldConfigs.value;
            const controlsFromState = [];

            for (const key in controlsObj) {
                const control = controlsObj[key];
                if (control) {
                    const fieldConfig = configs.find(f => f.key === key);
                    controlsFromState.push({
                        key,
                        name: fieldConfig?.name || key,
                        type: 'enum',
                        category: 'state',
                        viz_type: 'toggle',
                        enum_values: control.enum_values || ['off', 'on'],
                        is_visible: true,
                        sort_order: fieldConfig?.sort_order ?? 100
                    });
                }
            }

            const explicitStateFields = configs
                .filter(f => (f.is_visible !== false) && f.category === 'state' && !controlsObj[f.key]);

            const allControls = [...controlsFromState, ...explicitStateFields];
            const seen = new Set();
            return allControls
                .filter(f => {
                    if (seen.has(f.key)) return false;
                    seen.add(f.key);
                    return true;
                })
                .sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100));
        });

        const getControl = (key) => controls.value[key] || {};

        return { stateFields, controls, getControl };
    },
    methods: {
        navigateToControls() {
            this.$emit('navigate-to-controls');
        }
    },
    template: `
        <collapsible-section
            v-if="stateFields.length > 0"
            title="Controls"
            :default-open="true"
            :badge-count="stateFields.length">

            <div class="pt-2">
                <div class="flex flex-wrap gap-2">
                    <div v-for="f in stateFields.slice(0, 3)" :key="'ctrl-' + f.key"
                         class="badge badge-lg gap-2"
                         :class="getControl(f.key).current_state === 'on' || getControl(f.key).current_state === 'open' ? 'badge-success' : 'badge-ghost'">
                        {{ f.name }}: {{ getControl(f.key).current_state || 'unknown' }}
                        <span v-if="getControl(f.key).mode === 'manual'" class="badge badge-xs badge-warning">M</span>
                    </div>
                </div>
                <button v-if="stateFields.length > 3" class="btn btn-xs btn-ghost mt-2" @click="navigateToControls">
                    View All Controls
                </button>
            </div>
        </collapsible-section>
    `
};
