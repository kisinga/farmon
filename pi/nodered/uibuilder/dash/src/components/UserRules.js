// UserRules Component
export default {
    props: {
        rules: { type: Array, default: () => [] }
    },
    methods: {
        formatTime(ts) {
            if (!ts) return '';
            return new Date(ts).toLocaleString('en-US', {
                month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        },
        editRule(rule) {
            this.$emit('edit-rule', rule);
        },
        deleteRule(id) {
            this.$emit('delete-rule', id);
        },
        toggleRule(rule, enabled) {
            this.$emit('toggle-rule', rule, enabled);
        }
    },
    template: `
        <div class="card bg-base-100 shadow-xl">
            <div class="card-body p-3">
                <div class="flex items-center justify-between mb-2">
                    <h2 class="card-title text-sm sm:text-base">User Rules</h2>
                    <button class="btn btn-xs btn-primary" @click="$emit('add-rule')">+ Add Rule</button>
                </div>
                <p class="text-xs opacity-60 mb-3">Custom automation rules that run on the backend server.</p>

                <div v-if="rules.length === 0" class="text-sm opacity-50">
                    No user-defined rules. Create one to add custom automation.
                </div>

                <div v-else class="space-y-2">
                    <div v-for="r in rules" :key="r.id"
                         class="flex items-center justify-between p-2 bg-base-200 rounded-lg">
                        <div class="flex-1 min-w-0">
                            <div class="font-medium text-sm">{{ r.name }}</div>
                            <div class="text-xs opacity-60">
                                If {{ r.condition?.field }} {{ r.condition?.op }} {{ r.condition?.val }}
                                &rarr; {{ r.action_control }} = {{ r.action_state }}
                            </div>
                            <div v-if="r.last_triggered" class="text-xs opacity-40 mt-1">
                                Last triggered: {{ formatTime(r.last_triggered) }}
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <button class="btn btn-xs btn-ghost" @click="editRule(r)">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                            </button>
                            <button class="btn btn-xs btn-ghost text-error" @click="deleteRule(r.id)">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                            <input type="checkbox" class="toggle toggle-sm toggle-success"
                                   :checked="r.enabled"
                                   @change="toggleRule(r, $event.target.checked)" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `
};
