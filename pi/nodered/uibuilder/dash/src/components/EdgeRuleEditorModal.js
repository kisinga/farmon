// EdgeRuleEditorModal Component
export default {
    inject: ['deviceStore'],
    computed: {
        editingEdgeRule() {
            return this.deviceStore?.editingEdgeRule || {};
        },
        deviceSchema() {
            return this.deviceStore?.deviceSchema || null;
        },
        schemaFields() {
            return this.deviceStore?.schemaFields || [];
        },
        schemaControls() {
            return this.deviceStore?.schemaControls || [];
        },
        isEdgeRuleValid() {
            return this.deviceStore?.isEdgeRuleValid || false;
        },
        show() {
            return this.deviceStore?.showEdgeRuleEditor || false;
        }
    },
    watch: {
        show(newVal) {
            if (newVal) {
                this.$nextTick(() => {
                    const dialog = this.$refs.dialog || this.$el;
                    if (dialog && typeof dialog.showModal === 'function') {
                        dialog.showModal();
                    }
                });
            } else {
                const dialog = this.$refs.dialog || this.$el;
                if (dialog && typeof dialog.close === 'function') {
                    dialog.close();
                }
            }
        }
    },
    mounted() {
        if (this.show) {
            const dialog = this.$refs.dialog || this.$el;
            if (dialog && typeof dialog.showModal === 'function') {
                dialog.showModal();
            }
        }
    },
    methods: {
        getControlStates(controlIdx) {
            if (!this.deviceSchema?.controls || controlIdx >= this.deviceSchema.controls.length) {
                return ['off', 'on'];
            }
            return this.deviceSchema.controls[controlIdx]?.v || ['off', 'on'];
        },
        close() {
            if (this.deviceStore) {
                this.deviceStore.showEdgeRuleEditor = false;
            }
            this.$emit('close');
        },
        save() {
            this.$emit('save');
        }
    },
    template: `
        <dialog v-if="show" ref="dialog" class="modal">
            <div class="modal-box">
                <h3 class="font-bold text-lg mb-4">{{ editingEdgeRule?.rule_id !== null ? 'Edit Edge Rule' : 'Create Edge Rule' }}</h3>

                <div v-if="!deviceSchema" class="alert alert-warning mb-4">
                    <span>Device schema not available. Cannot create edge rules.</span>
                </div>

                <template v-else>
                    <div class="divider text-xs">Condition</div>

                    <div class="grid grid-cols-3 gap-2 mb-3">
                        <div class="form-control">
                            <label class="label"><span class="label-text text-xs">Field</span></label>
                            <select class="select select-bordered select-sm" v-model.number="editingEdgeRule.field_idx">
                                <option v-if="schemaFields.length === 0" disabled value="">No fields</option>
                                <option v-for="(f, idx) in schemaFields" :key="idx" :value="idx">
                                    {{ f.n || f.k || 'Field ' + idx }}
                                </option>
                            </select>
                        </div>
                        <div class="form-control">
                            <label class="label"><span class="label-text text-xs">Operator</span></label>
                            <select class="select select-bordered select-sm" v-model="editingEdgeRule.operator">
                                <option value="<">&lt;</option>
                                <option value=">">&gt;</option>
                                <option value="<=">&le;</option>
                                <option value=">=">&ge;</option>
                                <option value="==">=</option>
                                <option value="!=">≠</option>
                            </select>
                        </div>
                        <div class="form-control">
                            <label class="label"><span class="label-text text-xs">Threshold</span></label>
                            <input type="number" step="any" class="input input-bordered input-sm" v-model.number="editingEdgeRule.threshold">
                        </div>
                    </div>

                    <div class="divider text-xs">Action</div>

                    <div class="grid grid-cols-2 gap-2 mb-3">
                        <div class="form-control">
                            <label class="label"><span class="label-text text-xs">Control</span></label>
                            <select class="select select-bordered select-sm" v-model.number="editingEdgeRule.control_idx">
                                <option v-if="schemaControls.length === 0" disabled value="">No controls</option>
                                <option v-for="(c, idx) in schemaControls" :key="idx" :value="idx">
                                    {{ c.n || c.k || 'Control ' + idx }}
                                </option>
                            </select>
                        </div>
                        <div class="form-control">
                            <label class="label"><span class="label-text text-xs">Set to</span></label>
                            <select class="select select-bordered select-sm" v-model.number="editingEdgeRule.action_state">
                                <option v-for="(state, idx) in getControlStates(editingEdgeRule.control_idx)" :key="idx" :value="idx">
                                    {{ state }}
                                </option>
                            </select>
                        </div>
                    </div>

                    <div class="divider text-xs">Options</div>

                    <div class="grid grid-cols-2 gap-2 mb-3">
                        <div class="form-control">
                            <label class="label"><span class="label-text text-xs">Priority (0-255)</span></label>
                            <input type="number" min="0" max="255" class="input input-bordered input-sm" v-model.number="editingEdgeRule.priority">
                            <label class="label"><span class="label-text-alt opacity-60">Lower = higher priority</span></label>
                        </div>
                        <div class="form-control">
                            <label class="label"><span class="label-text text-xs">Cooldown (seconds)</span></label>
                            <input type="number" min="0" class="input input-bordered input-sm" v-model.number="editingEdgeRule.cooldown_seconds">
                            <label class="label"><span class="label-text-alt opacity-60">Min time between triggers</span></label>
                        </div>
                    </div>

                    <div class="modal-action">
                        <button class="btn btn-ghost" @click="close()">Cancel</button>
                        <button class="btn btn-primary" @click="save()" :disabled="!isEdgeRuleValid">Save Edge Rule</button>
                    </div>
                </template>
            </div>
            <form method="dialog" class="modal-backdrop"><button>close</button></form>
        </dialog>
    `
};
