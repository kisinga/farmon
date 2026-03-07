// EdgeRulesPanel Component - Edge rules management (device-side rules)
export default {
    props: {
        deviceEui: { type: String, required: true },
        schema: { type: Object, default: null },
        edgeRules: { type: Array, default: () => [] }
    },
    emits: ['add-rule', 'edit-rule', 'delete-rule', 'toggle-rule'],
    template: `
        <div class="card bg-base-100 shadow-xl">
            <div class="card-body p-3">
                <div class="flex items-center justify-between mb-2">
                    <h2 class="card-title text-sm sm:text-base">Edge Rules</h2>
                    <span class="badge badge-ghost text-xs">Runs on device</span>
                </div>
                <p class="text-xs opacity-60 mb-3">
                    Rules that execute locally on the device for low-latency response.
                </p>

                <div v-if="!schema" class="alert alert-info py-2">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    <span class="text-xs">Device schema not yet received. Edge rules require device registration.</span>
                </div>

                <div v-else-if="edgeRules.length === 0" class="text-sm opacity-50">
                    No edge rules configured.
                </div>

                <div v-else class="space-y-2">
                    <div v-for="rule in edgeRules" :key="rule.rule_id"
                         class="flex items-center justify-between p-2 bg-base-200 rounded-lg">
                        <div class="flex-1 min-w-0">
                            <div class="font-medium text-sm">
                                {{ getFieldName(rule.field_idx) }}
                                {{ formatOperator(rule.operator) }}
                                {{ rule.threshold }}
                            </div>
                            <div class="text-xs opacity-60">
                                &rarr; {{ getControlName(rule.control_idx) }} =
                                {{ getStateName(rule.control_idx, rule.action_state) }}
                            </div>
                            <div class="text-xs opacity-40">
                                Priority: {{ rule.priority }}, Cooldown: {{ rule.cooldown_seconds }}s
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <button class="btn btn-xs btn-ghost"
                                    @click="$emit('edit-rule', rule)"
                                    title="Edit rule">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                            </button>
                            <button class="btn btn-xs btn-ghost text-error"
                                    @click="$emit('delete-rule', rule.rule_id)"
                                    title="Delete rule">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                            <input type="checkbox" class="toggle toggle-sm toggle-success"
                                   :checked="rule.enabled"
                                   @change="$emit('toggle-rule', { ruleId: rule.rule_id, enabled: $event.target.checked })" />
                        </div>
                    </div>
                </div>

                <button v-if="schema" class="btn btn-sm btn-primary mt-3" @click="$emit('add-rule')">
                    + Add Edge Rule
                </button>
            </div>
        </div>
    `,
    methods: {
        getFieldName(idx) {
            if (!this.schema?.fields || idx >= this.schema.fields.length) {
                return 'Field ' + idx;
            }
            return this.schema.fields[idx]?.n || this.schema.fields[idx]?.k || 'Field ' + idx;
        },
        getControlName(idx) {
            if (!this.schema?.controls || idx >= this.schema.controls.length) {
                return 'Control ' + idx;
            }
            return this.schema.controls[idx]?.n || this.schema.controls[idx]?.k || 'Control ' + idx;
        },
        getStateName(ctrlIdx, stateIdx) {
            if (!this.schema?.controls || ctrlIdx >= this.schema.controls.length) {
                return 'State ' + stateIdx;
            }
            const states = this.schema.controls[ctrlIdx]?.v || ['off', 'on'];
            return states[stateIdx] || 'State ' + stateIdx;
        },
        formatOperator(op) {
            const opMap = {
                '<': '<',
                '>': '>',
                '<=': '\u2264',
                '>=': '\u2265',
                '==': '=',
                '!=': '\u2260',
                '0': '<',
                '1': '>',
                '2': '\u2264',
                '3': '\u2265',
                '4': '=',
                '5': '\u2260'
            };
            return opMap[op] || op;
        }
    }
};
