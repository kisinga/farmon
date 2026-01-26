// ControlCard Component - For state fields with override support
window.ControlCard = {
    props: {
        field: { type: Object, required: true },
        control: { type: Object, default: () => ({}) }
    },
    emits: ['set-control', 'clear-override'],
    template: `
        <div class="card bg-base-200 shadow">
            <div class="card-body p-3">
                <div class="flex items-center justify-between mb-2">
                    <h3 class="font-medium">{{ field.name }}</h3>
                    <div class="badge" :class="modeClass">{{ control.mode || 'auto' }}</div>
                </div>

                <!-- Current State -->
                <div class="flex items-center gap-2 mb-3">
                    <span class="text-sm opacity-60">Current:</span>
                    <span class="badge badge-lg" :class="stateClass">{{ control.current_state || 'unknown' }}</span>
                </div>

                <!-- Control Buttons (for enum types) -->
                <div v-if="field.enum_values" class="btn-group w-full mb-3">
                    <button v-for="state in field.enum_values" :key="state"
                            class="btn btn-sm flex-1"
                            :class="{ 'btn-primary': control.current_state === state }"
                            @click="setState(state)">
                        {{ state }}
                    </button>
                </div>

                <!-- Override Duration -->
                <div v-if="control.mode !== 'manual'" class="flex flex-wrap gap-1">
                    <span class="text-xs opacity-60 w-full mb-1">Override for:</span>
                    <button class="btn btn-xs btn-outline" @click="setOverride(15)">15m</button>
                    <button class="btn btn-xs btn-outline" @click="setOverride(30)">30m</button>
                    <button class="btn btn-xs btn-outline" @click="setOverride(60)">1h</button>
                    <button class="btn btn-xs btn-outline" @click="setOverride(0)">Indefinite</button>
                </div>

                <!-- Return to Auto -->
                <button v-else class="btn btn-sm btn-warning w-full" @click="clearOverride">
                    Return to Auto
                </button>

                <!-- Last Change Info -->
                <div v-if="control.last_change_at" class="text-xs opacity-50 mt-2">
                    Last: {{ formatTime(control.last_change_at) }}
                    <span v-if="control.last_change_by">by {{ control.last_change_by }}</span>
                </div>
            </div>
        </div>
    `,
    computed: {
        modeClass() {
            return this.control.mode === 'manual' ? 'badge-warning' : 'badge-success';
        },
        stateClass() {
            const state = this.control.current_state;
            if (state === 'on' || state === 'open' || state === 'active') return 'badge-success';
            if (state === 'off' || state === 'closed' || state === 'inactive') return 'badge-ghost';
            return 'badge-info';
        }
    },
    methods: {
        setState(state) {
            this.$emit('set-control', { control: this.field.key, state, duration: null });
        },
        setOverride(minutes) {
            const nextState = this.getNextState();
            this.$emit('set-control', { control: this.field.key, state: nextState, duration: minutes || null });
        },
        getNextState() {
            const states = this.field.enum_values || ['off', 'on'];
            const current = this.control.current_state;
            const idx = states.indexOf(current);
            return states[(idx + 1) % states.length];
        },
        clearOverride() {
            this.$emit('clear-override', { control: this.field.key });
        },
        formatTime(ts) {
            return new Date(ts).toLocaleString('en-US', {
                month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        }
    }
};
