// SystemCommands Component - Device system controls
window.SystemCommands = {
    props: {
        deviceEui: { type: String, required: true },
        currentInterval: { type: Number, default: 60 }
    },
    emits: ['send-command'],
    data() {
        return {
            newInterval: 60,
            commandPending: null
        };
    },
    template: `
        <div class="card bg-base-100 shadow-xl">
            <div class="card-body p-3">
                <h2 class="card-title text-sm sm:text-base mb-3">System Commands</h2>

                <!-- Reporting Interval -->
                <div class="form-control mb-4">
                    <label class="label py-1">
                        <span class="label-text text-xs">Reporting Interval</span>
                        <span class="label-text-alt text-xs opacity-60">Current: {{ currentInterval }}s</span>
                    </label>
                    <div class="join w-full">
                        <input type="number" class="input input-bordered input-sm join-item flex-1"
                               v-model.number="newInterval" min="10" max="3600" placeholder="seconds">
                        <button class="btn btn-sm btn-primary join-item"
                                @click="sendInterval"
                                :disabled="commandPending === 'interval'">
                            <span v-if="commandPending === 'interval'" class="loading loading-spinner loading-xs"></span>
                            <span v-else>Set</span>
                        </button>
                    </div>
                    <label class="label py-0.5">
                        <span class="label-text-alt opacity-50">10s - 3600s (1 hour)</span>
                    </label>
                </div>

                <!-- Command Buttons -->
                <div class="grid grid-cols-2 gap-2">
                    <button class="btn btn-sm btn-warning"
                            @click="confirmCommand('clearErrors', 'Clear error count?')"
                            :disabled="commandPending === 'clearErrors'">
                        <span v-if="commandPending === 'clearErrors'" class="loading loading-spinner loading-xs"></span>
                        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Clear Errors
                    </button>

                    <button class="btn btn-sm btn-info"
                            @click="confirmCommand('reset', 'Reset all counters (volume, errors, time)?')"
                            :disabled="commandPending === 'reset'">
                        <span v-if="commandPending === 'reset'" class="loading loading-spinner loading-xs"></span>
                        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Reset Counters
                    </button>

                    <button class="btn btn-sm btn-secondary"
                            @click="confirmCommand('forceReg', 'Force device to re-register?')"
                            :disabled="commandPending === 'forceReg'">
                        <span v-if="commandPending === 'forceReg'" class="loading loading-spinner loading-xs"></span>
                        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Force Register
                    </button>

                    <button class="btn btn-sm btn-error"
                            @click="confirmCommand('reboot', 'Reboot device? It will rejoin the network.')"
                            :disabled="commandPending === 'reboot'">
                        <span v-if="commandPending === 'reboot'" class="loading loading-spinner loading-xs"></span>
                        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Reboot
                    </button>
                </div>

                <!-- Request Status -->
                <button class="btn btn-sm btn-ghost btn-block mt-3"
                        @click="requestStatus"
                        :disabled="commandPending === 'status'">
                    <span v-if="commandPending === 'status'" class="loading loading-spinner loading-xs"></span>
                    <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    Request Device Status
                </button>
            </div>
        </div>
    `,
    watch: {
        currentInterval: {
            immediate: true,
            handler(val) {
                if (val) this.newInterval = val;
            }
        }
    },
    methods: {
        confirmCommand(cmd, message) {
            if (confirm(message)) {
                this.sendCommand(cmd);
            }
        },
        sendCommand(cmd) {
            this.commandPending = cmd;
            this.$emit('send-command', { command: cmd, eui: this.deviceEui });
            // Clear pending state after timeout (in case no ACK received)
            setTimeout(() => {
                if (this.commandPending === cmd) {
                    this.commandPending = null;
                }
            }, 10000);
        },
        sendInterval() {
            if (this.newInterval < 10 || this.newInterval > 3600) {
                alert('Interval must be between 10 and 3600 seconds');
                return;
            }
            this.commandPending = 'interval';
            this.$emit('send-command', {
                command: 'setInterval',
                eui: this.deviceEui,
                value: this.newInterval
            });
            setTimeout(() => {
                if (this.commandPending === 'interval') {
                    this.commandPending = null;
                }
            }, 10000);
        },
        requestStatus() {
            this.commandPending = 'status';
            this.$emit('send-command', { command: 'requestStatus', eui: this.deviceEui });
            setTimeout(() => {
                if (this.commandPending === 'status') {
                    this.commandPending = null;
                }
            }, 10000);
        },
        clearPending() {
            this.commandPending = null;
        }
    }
};
