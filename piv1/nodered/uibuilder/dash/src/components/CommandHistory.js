// CommandHistory Component - Shows command and state change history
import deviceStore from '../store/deviceStore.js';

export default {
    props: {
        deviceEui: { type: String, required: true }
    },
    data() {
        return {
            activeFilter: 'all' // 'all', 'commands', 'state'
        };
    },
    computed: {
        commandHistory() {
            if (!this.deviceEui) return [];
            return deviceStore.getCommandHistoryForDevice(this.deviceEui);
        },
        stateChangeHistory() {
            if (!this.deviceEui) return [];
            return deviceStore.getStateChangeHistoryForDevice(this.deviceEui);
        },
        combinedHistory() {
            const commands = this.commandHistory.map(cmd => ({
                ...cmd,
                historyType: 'command',
                displayType: cmd.type === 'system' ? 'System Command' : 'Control Command',
                displayName: cmd.type === 'system'
                    ? cmd.command
                    : `${cmd.control} → ${cmd.state}`,
                displaySource: cmd.source || 'user'
            }));

            const stateChanges = this.stateChangeHistory.map(change => ({
                ...change,
                historyType: 'state',
                displayType: 'State Change',
                displayName: `${change.control}: ${change.oldState || '?'} → ${change.newState}`,
                displaySource: change.source || change.reason || 'unknown'
            }));

            // Combine and sort by timestamp (newest first)
            return [...commands, ...stateChanges]
                .sort((a, b) => (b.ts || 0) - (a.ts || 0));
        },
        filteredHistory() {
            if (this.activeFilter === 'all') return this.combinedHistory;
            if (this.activeFilter === 'commands') {
                return this.combinedHistory.filter(h => h.historyType === 'command');
            }
            if (this.activeFilter === 'state') {
                return this.combinedHistory.filter(h => h.historyType === 'state');
            }
            return this.combinedHistory;
        }
    },
    methods: {
        formatTime(ts) {
            if (!ts) return '--';
            const date = new Date(ts);
            const now = new Date();
            const diffMs = now - date;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);

            if (diffMins < 1) return 'Just now';
            if (diffMins < 60) return `${diffMins}m ago`;
            if (diffHours < 24) return `${diffHours}h ago`;
            if (diffDays < 7) return `${diffDays}d ago`;

            return date.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        },
        getStatusBadgeClass(status) {
            if (status === 'ack' || status === 'success') return 'badge-success';
            if (status === 'pending') return 'badge-warning';
            if (status === 'error' || status === 'failed') return 'badge-error';
            return 'badge-ghost';
        },
        getSourceBadgeClass(source) {
            const sourceLower = (source || '').toLowerCase();
            if (sourceLower.includes('user') || sourceLower === 'manual') return 'badge-info';
            if (sourceLower.includes('rule') || sourceLower.includes('trigger')) return 'badge-warning';
            if (sourceLower.includes('edge') || sourceLower.includes('device')) return 'badge-success';
            return 'badge-ghost';
        }
    },
    template: `
        <div class="space-y-3">
            <!-- Filter Tabs -->
            <div class="tabs tabs-boxed bg-base-100 justify-center p-1">
                <a class="tab tab-sm"
                   :class="{ 'tab-active': activeFilter === 'all' }"
                   @click="activeFilter = 'all'">
                    All
                </a>
                <a class="tab tab-sm"
                   :class="{ 'tab-active': activeFilter === 'commands' }"
                   @click="activeFilter = 'commands'">
                    Commands
                </a>
                <a class="tab tab-sm"
                   :class="{ 'tab-active': activeFilter === 'state' }"
                   @click="activeFilter = 'state'">
                    State Changes
                </a>
            </div>

            <!-- History List -->
            <div v-if="filteredHistory.length === 0" class="alert alert-info">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <span>No history available yet. History will appear as commands are sent and state changes occur.</span>
            </div>

            <div v-else class="space-y-2">
                <div v-for="(entry, idx) in filteredHistory" :key="idx"
                     class="card bg-base-100 shadow-sm">
                    <div class="card-body p-3">
                        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <!-- Left: Type and Name -->
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2 mb-1">
                                    <span class="badge badge-sm"
                                          :class="entry.historyType === 'command' ? 'badge-primary' : 'badge-secondary'">
                                        {{ entry.displayType }}
                                    </span>
                                    <span class="font-medium text-sm truncate">{{ entry.displayName }}</span>
                                </div>

                                <!-- Additional details for commands -->
                                <div v-if="entry.historyType === 'command' && entry.value !== undefined"
                                     class="text-xs opacity-60">
                                    Value: {{ entry.value }}
                                </div>

                                <!-- Additional details for state changes -->
                                <div v-if="entry.historyType === 'state'"
                                     class="text-xs opacity-60">
                                    <span v-if="entry.oldState">From: {{ entry.oldState }}</span>
                                    <span v-if="entry.oldState && entry.newState"> → </span>
                                    <span v-if="entry.newState">To: {{ entry.newState }}</span>
                                </div>
                            </div>

                            <!-- Right: Source and Time -->
                            <div class="flex flex-col sm:items-end gap-1">
                                <div class="flex items-center gap-2">
                                    <span class="badge badge-xs"
                                          :class="getSourceBadgeClass(entry.displaySource)">
                                        {{ entry.displaySource }}
                                    </span>
                                    <span v-if="entry.historyType === 'command'"
                                          class="badge badge-xs"
                                          :class="getStatusBadgeClass(entry.status)">
                                        {{ entry.status || 'pending' }}
                                    </span>
                                </div>
                                <span class="text-xs opacity-50">{{ formatTime(entry.ts) }}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `
};
