// OtaView - Firmware OTA tab: upload .bin, progress, cancel, history, error log
import deviceStore from '../store/deviceStore.js';

const { computed, watch, onMounted } = Vue;

export default {
    name: 'OtaView',
    props: {
        deviceEui: { type: String, default: null }
    },
    setup(props) {
        const selectedDevice = computed(() => props.deviceEui || deviceStore.state.selectedDevice);
        const otaJobByEui = computed(() => deviceStore.state.otaJobByEui);
        const firmwareHistory = computed(() => deviceStore.state.firmwareHistory);
        const firmwareErrorLog = computed(() => deviceStore.state.firmwareErrorLog);

        const otaJob = computed(() => {
            const eui = selectedDevice.value;
            return eui ? (deviceStore.state.otaJobByEui[eui] || null) : null;
        });

        const otaActive = computed(() => {
            const job = otaJob.value;
            return job && (job.status === 'sending' || job.status === 'done');
        });

        const canStart = computed(() => {
            return selectedDevice.value && selectedDevice.value.length > 0;
        });

        function requestHistory() {
            if (selectedDevice.value) {
                uibuilder.send({ topic: 'getFirmwareHistory', payload: { eui: selectedDevice.value } });
            }
        }

        function requestErrorLog() {
            uibuilder.send({ topic: 'getFirmwareErrorLog', payload: selectedDevice.value ? { eui: selectedDevice.value } : {} });
        }

        watch(selectedDevice, (eui) => {
            if (eui) {
                requestHistory();
                requestErrorLog();
            } else {
                deviceStore.state.firmwareHistory = [];
                deviceStore.state.firmwareErrorLog = [];
            }
        });

        onMounted(() => {
            if (selectedDevice.value) {
                requestHistory();
                requestErrorLog();
            }
        });

        return {
            selectedDevice,
            otaJobByEui,
            otaJob,
            otaActive,
            canStart,
            firmwareHistory,
            firmwareErrorLog,
            requestHistory,
            requestErrorLog
        };
    },
    data() {
        return {
            selectedFile: null,
            fileBase64: null,
            dragOver: false
        };
    },
    methods: {
        setFileFromFile(file) {
            if (!file) {
                this.selectedFile = null;
                this.fileBase64 = null;
                return;
            }
            const name = (file.name || '').toLowerCase();
            if (!name.endsWith('.bin')) {
                this.selectedFile = null;
                this.fileBase64 = null;
                return;
            }
            this.selectedFile = file;
            const reader = new FileReader();
            reader.onload = () => {
                const b64 = reader.result.split(',')[1];
                this.fileBase64 = b64 || null;
            };
            reader.readAsDataURL(file);
        },
        onFileChange(e) {
            const file = e.target.files && e.target.files[0];
            this.setFileFromFile(file || null);
        },
        onDragOver(e) {
            e.preventDefault();
            e.stopPropagation();
            this.dragOver = true;
        },
        onDragLeave(e) {
            e.preventDefault();
            e.stopPropagation();
            this.dragOver = false;
        },
        onDrop(e) {
            e.preventDefault();
            e.stopPropagation();
            this.dragOver = false;
            const file = e.dataTransfer.files && e.dataTransfer.files[0];
            this.setFileFromFile(file || null);
            if (this.$refs.fileInput) this.$refs.fileInput.value = '';
        },
        startOta() {
            // Use store/prop directly so eui is a string (Vue refs from setup() may not serialize)
            const eui = this.deviceEui || deviceStore.state.selectedDevice;
            if (!eui || !this.fileBase64) return;
            const euiStr = typeof eui === 'string' ? eui : (eui && eui.value !== undefined ? eui.value : '');
            if (!euiStr) return;
            // Normalize eui for backend (lowercase, no colons)
            const euiNorm = String(euiStr).toLowerCase().replace(/[^a-f0-9]/g, '');
            if (!euiNorm) return;
            console.log('[OtaView] otaStart', { eui: euiNorm, payloadSizeKb: (this.fileBase64?.length || 0) / 1024 });
            uibuilder.send({ topic: 'otaStart', payload: { eui: euiNorm, firmware: this.fileBase64 } });
            this.selectedFile = null;
            this.fileBase64 = null;
            if (this.$refs.fileInput) this.$refs.fileInput.value = '';
        },
        cancelOta() {
            const eui = this.deviceEui || deviceStore.state.selectedDevice;
            if (!eui) return;
            const euiStr = typeof eui === 'string' ? eui : (eui && eui.value !== undefined ? eui.value : '');
            if (!euiStr) return;
            const euiNorm = String(euiStr).toLowerCase().replace(/[^a-f0-9]/g, '');
            if (!euiNorm) return;
            uibuilder.send({ topic: 'otaCancel', payload: { eui: euiNorm } });
        },
        formatDate(ts) {
            if (!ts) return '—';
            const d = new Date(ts);
            return isNaN(d.getTime()) ? '—' : d.toLocaleString();
        },
        outcomeBadge(outcome) {
            const map = { started: 'info', done: 'success', failed: 'error', cancelled: 'warning' };
            return map[outcome] || 'neutral';
        }
    },
    template: `
        <div class="space-y-6">
            <div class="card bg-base-100 shadow">
                <div class="card-body">
                    <h2 class="card-title">Firmware OTA</h2>
                    <p class="text-sm opacity-80">Select a device and a .bin file, then Start. Progress is shown below. Cancel stops the update.</p>
                    <div class="form-control w-full max-w-md">
                        <label class="label"><span class="label-text">Device</span></label>
                        <input type="text" class="input input-bordered w-full" :value="selectedDevice || 'Select a device'" disabled />
                    </div>
                    <div class="form-control w-full max-w-md mt-2">
                        <label class="label"><span class="label-text">Firmware (.bin)</span></label>
                        <div
                            class="border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer"
                            :class="dragOver ? 'border-primary bg-primary/10' : 'border-base-300 hover:border-base-content/20'"
                            @dragover="onDragOver"
                            @dragleave="onDragLeave"
                            @drop="onDrop"
                            @click="$refs.fileInput && $refs.fileInput.click()"
                        >
                            <input ref="fileInput" type="file" accept=".bin" class="hidden" @change="onFileChange" />
                            <p v-if="!selectedFile" class="text-sm opacity-80">Drop .bin here or click to browse</p>
                            <p v-else class="text-sm font-medium">{{ selectedFile.name }}</p>
                        </div>
                    </div>
                    <div class="flex flex-wrap gap-2 mt-4">
                        <button class="btn btn-primary" :disabled="!canStart || !fileBase64" @click="startOta">Start OTA</button>
                        <button class="btn btn-ghost" :disabled="!otaActive" @click="cancelOta">Cancel</button>
                    </div>
                    <div v-if="otaJob && (otaJob.status === 'sending' || otaJob.percent != null)" class="mt-4">
                        <p class="text-sm">Sending chunk {{ otaJob.chunkIndex != null ? otaJob.chunkIndex + 1 : 0 }} / {{ otaJob.totalChunks || 0 }} ({{ otaJob.percent != null ? otaJob.percent : 0 }}%)</p>
                        <progress class="progress progress-primary w-full max-w-md" :value="otaJob.percent || 0" max="100"></progress>
                        <p v-if="otaJob.status === 'done'" class="text-success text-sm mt-1">Done.</p>
                        <p v-else-if="otaJob.status === 'failed'" class="text-error text-sm mt-1">Failed: {{ otaJob.error || 'device_reported_fail' }}</p>
                        <p v-else-if="otaJob.status === 'cancelled'" class="text-warning text-sm mt-1">Cancelled.</p>
                    </div>
                </div>
            </div>

            <div class="card bg-base-100 shadow">
                <div class="card-body">
                    <h2 class="card-title">Firmware history</h2>
                    <p class="text-sm opacity-80">Recent updates for the selected device.</p>
                    <div class="overflow-x-auto mt-2">
                        <table class="table table-sm">
                            <thead><tr><th>Started</th><th>Finished</th><th>Outcome</th><th>Chunks</th><th>Error</th></tr></thead>
                            <tbody>
                                <tr v-for="(row, i) in firmwareHistory" :key="i">
                                    <td>{{ formatDate(row.started_at) }}</td>
                                    <td>{{ formatDate(row.finished_at) }}</td>
                                    <td><span class="badge" :class="'badge-' + outcomeBadge(row.outcome)">{{ row.outcome || '—' }}</span></td>
                                    <td>{{ row.chunks_received != null ? row.chunks_received + ' / ' + (row.total_chunks || '—') : '—' }}</td>
                                    <td class="text-error text-sm">{{ row.error_message || '—' }}</td>
                                </tr>
                                <tr v-if="firmwareHistory.length === 0"><td colspan="5" class="text-base-content/60">No history.</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div class="card bg-base-100 shadow">
                <div class="card-body">
                    <h2 class="card-title">Error log</h2>
                    <p class="text-sm opacity-80">Failed or cancelled updates (selected device or all).</p>
                    <div class="overflow-x-auto mt-2">
                        <table class="table table-sm">
                            <thead><tr><th>Device</th><th>Started</th><th>Outcome</th><th>Error</th></tr></thead>
                            <tbody>
                                <tr v-for="(row, i) in firmwareErrorLog" :key="i">
                                    <td class="font-mono text-xs">{{ row.device_eui }}</td>
                                    <td>{{ formatDate(row.started_at) }}</td>
                                    <td><span class="badge" :class="'badge-' + outcomeBadge(row.outcome)">{{ row.outcome }}</span></td>
                                    <td class="text-error text-sm">{{ row.error_message || '—' }}</td>
                                </tr>
                                <tr v-if="firmwareErrorLog.length === 0"><td colspan="4" class="text-base-content/60">No errors.</td></tr>
                            </tbody>
                        </table>
                    </div>
                    <button class="btn btn-ghost btn-sm mt-2" @click="requestErrorLog">Refresh</button>
                </div>
            </div>
        </div>
    `
};
