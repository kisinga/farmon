// ControlsPreview Component - Quick controls preview in dashboard
export default {
    inject: ['deviceStore'],
    computed: {
        stateFields() {
            // Access stateFields from parent component's computed property
            // We'll need to pass this as a prop or access via store
            // For now, we'll compute it here similar to index.js
            const controls = this.deviceStore?.controls || {};
            const fieldConfigs = this.deviceStore?.fieldConfigs || [];
            const controlsFromState = [];
            
            for (const key in controls) {
                const control = controls[key];
                if (control) {
                    const fieldConfig = fieldConfigs.find(f => f.key === key);
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

            const explicitStateFields = fieldConfigs
                .filter(f => (f.is_visible !== false) && f.category === 'state' && !controls[f.key]);

            const allControls = [...controlsFromState, ...explicitStateFields];
            const seen = new Set();
            return allControls
                .filter(f => {
                    if (seen.has(f.key)) return false;
                    seen.add(f.key);
                    return true;
                })
                .sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100));
        },
        controls() {
            return this.deviceStore?.controls || {};
        }
    },
    methods: {
        getControl(key) {
            return this.controls[key] || {};
        },
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
