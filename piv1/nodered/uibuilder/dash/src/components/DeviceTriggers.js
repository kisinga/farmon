// DeviceTriggers Component
export default {
    props: {
        triggers: { type: Array, default: () => [] }
    },
    methods: {
        toggleTrigger(key, enabled) {
            this.$emit('toggle-trigger', key, enabled);
        }
    },
    template: `
        <div class="card bg-base-100 shadow-xl">
            <div class="card-body p-3">
                <h2 class="card-title text-sm sm:text-base mb-2">Device Triggers</h2>
                <p class="text-xs opacity-60 mb-3">These triggers are defined by the device firmware and run on the device itself.</p>

                <div v-if="triggers.length === 0" class="text-sm opacity-50">
                    No device-defined triggers.
                </div>

                <div v-else class="space-y-2">
                    <div v-for="t in triggers" :key="t.key"
                         class="flex items-center justify-between p-2 bg-base-200 rounded-lg">
                        <div>
                            <div class="font-medium text-sm">{{ t.name || t.key }}</div>
                            <div class="text-xs opacity-60">
                                If {{ t.field }} {{ t.op }} {{ t.th }}
                                &rarr; {{ t.ctrl }} = {{ t.st }}
                            </div>
                        </div>
                        <input type="checkbox" class="toggle toggle-sm toggle-success"
                               :checked="t.enabled"
                               @change="toggleTrigger(t.key, $event.target.checked)" />
                    </div>
                </div>
            </div>
        </div>
    `
};
