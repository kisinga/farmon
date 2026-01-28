// RuleEditorModal Component
import { computeStateFields } from '../utils/fieldProcessors.js';

export default {
    inject: ['deviceStore'],
    computed: {
        editingRule() {
            return this.deviceStore?.editingRule || {};
        },
        allFieldsForRules() {
            return this.deviceStore?.allFieldsForRules || [];
        },
        stateFields() {
            const controls = this.deviceStore?.controls || {};
            const fieldConfigs = this.deviceStore?.fieldConfigs || [];
            return computeStateFields(controls, fieldConfigs);
        },
        fieldConfigs() {
            return this.deviceStore?.fieldConfigs || [];
        },
        isRuleValid() {
            return this.deviceStore?.isRuleValid || false;
        },
        show() {
            return this.deviceStore?.showRuleEditor || false;
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
        getFieldCategoryLabel(field) {
            return this.deviceStore?.getFieldCategoryLabel?.(field) || 'Unknown';
        },
        getFieldCategoryClass(field) {
            return this.deviceStore?.getFieldCategoryClass?.(field) || 'badge-ghost';
        },
        getEnumValues(controlKey) {
            const field = this.fieldConfigs.find(f => f.key === controlKey);
            if (field && field.enum_values) {
                return Array.isArray(field.enum_values) ? field.enum_values : JSON.parse(field.enum_values);
            }
            return ['off', 'on'];
        },
        close() {
            if (this.deviceStore) {
                this.deviceStore.showRuleEditor = false;
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
                <h3 class="font-bold text-lg mb-4">{{ editingRule?.id ? 'Edit Rule' : 'Create Rule' }}</h3>

                <div class="form-control mb-3">
                    <label class="label"><span class="label-text">Rule Name</span></label>
                    <input type="text" class="input input-bordered input-sm" v-model="editingRule.name" placeholder="e.g., Low water alert">
                </div>

                <div class="divider text-xs">Condition</div>

                <div class="space-y-2 mb-3">
                    <div class="form-control">
                        <label class="label"><span class="label-text text-xs">Field</span></label>
                        <select class="select select-bordered select-sm w-full" v-model="editingRule.condition.field">
                            <option v-for="f in allFieldsForRules" :key="f.key" :value="f.key">
                                {{ f.name }} [{{ getFieldCategoryLabel(f) }}]
                            </option>
                        </select>
                        <div v-if="editingRule.condition.field" class="mt-1">
                            <span class="badge badge-xs" :class="getFieldCategoryClass(fieldConfigs.find(f => f.key === editingRule.condition.field))">
                                {{ getFieldCategoryLabel(fieldConfigs.find(f => f.key === editingRule.condition.field)) }}
                            </span>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <div class="form-control">
                            <label class="label"><span class="label-text text-xs">Operator</span></label>
                            <select class="select select-bordered select-sm" v-model="editingRule.condition.op">
                                <option value="&lt;">&lt; Less than</option>
                                <option value="&gt;">&gt; Greater than</option>
                                <option value="&lt;=">&le; Less or equal</option>
                                <option value="&gt;=">&ge; Greater or equal</option>
                                <option value="=">= Equal</option>
                                <option value="!=">≠ Not equal</option>
                            </select>
                        </div>
                        <div class="form-control">
                            <label class="label"><span class="label-text text-xs">Value</span></label>
                            <input type="number" class="input input-bordered input-sm" v-model.number="editingRule.condition.val">
                        </div>
                    </div>
                </div>

                <div class="divider text-xs">Action</div>

                <div class="grid grid-cols-2 gap-2 mb-3">
                    <div class="form-control">
                        <label class="label"><span class="label-text text-xs">Control</span></label>
                        <select class="select select-bordered select-sm" v-model="editingRule.action_control">
                            <option v-for="f in stateFields" :key="f.key" :value="f.key">{{ f.name }}</option>
                        </select>
                    </div>
                    <div class="form-control">
                        <label class="label"><span class="label-text text-xs">Set to</span></label>
                        <select class="select select-bordered select-sm" v-model="editingRule.action_state">
                            <option v-for="s in getEnumValues(editingRule.action_control)" :key="s" :value="s">{{ s }}</option>
                        </select>
                    </div>
                </div>

                <div class="divider text-xs">Options</div>

                <div class="grid grid-cols-2 gap-2 mb-3">
                    <div class="form-control">
                        <label class="label"><span class="label-text text-xs">Priority</span></label>
                        <input type="number" class="input input-bordered input-sm" v-model.number="editingRule.priority" placeholder="100">
                        <label class="label"><span class="label-text-alt opacity-60">Lower = higher priority</span></label>
                    </div>
                    <div class="form-control">
                        <label class="label"><span class="label-text text-xs">Cooldown (seconds)</span></label>
                        <input type="number" class="input input-bordered input-sm" v-model.number="editingRule.cooldown_seconds" placeholder="300">
                        <label class="label"><span class="label-text-alt opacity-60">Min time between triggers</span></label>
                    </div>
                </div>

                <div class="modal-action">
                    <button class="btn btn-ghost" @click="close()">Cancel</button>
                    <button class="btn btn-primary" @click="save()" :disabled="!isRuleValid">Save Rule</button>
                </div>
            </div>
            <form method="dialog" class="modal-backdrop"><button>close</button></form>
        </dialog>
    `
};
