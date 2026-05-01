import {
  Component, inject, OnInit, OnDestroy, signal, computed,
  ElementRef, ViewChild, AfterViewChecked,
} from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ElectronService } from '../../core/services/electron.service';
import { SerialMonitorComponent } from '../../shared/serial-monitor/serial-monitor.component';
import { ConnectivityConfigComponent } from '../../shared/connectivity-config/connectivity-config.component';
import type {
  BoardListEntry, ToolchainInfo, SerialDevice,
} from '../../core/models/electron-api';
import { effectiveTransport, type NetworkConfig, type NetworkTransport } from '@far-mon/core';

interface FileEntry {
  path: string;
  description: string;
  lines: number;
}

interface TerminalLine {
  text: string;
  stream: 'stdout' | 'stderr' | 'system';
}

@Component({
  selector: 'app-boards-page',
  standalone: true,
  imports: [FormsModule, SerialMonitorComponent, ConnectivityConfigComponent],
  host: { class: 'flex-1 overflow-auto' },
  template: `
    <div class="flex-1 flex flex-col h-full overflow-auto">
      <div class="max-w-5xl mx-auto w-full px-8 py-8">

        <!-- Header -->
        <div class="flex items-center justify-between mb-8">
          <div>
            <h1 class="text-2xl font-bold tracking-tight">Boards</h1>
            <p class="text-sm text-base-content/50 mt-1">Manage board definitions and run hardware self-tests</p>
          </div>
          <button class="btn btn-ghost btn-sm gap-1.5" routerLink="/overview">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Sites
          </button>
        </div>

        <!-- Board cards -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          @for (board of boards(); track board.id) {
            <button
              class="card bg-base-100 border transition-all text-left"
              [class.border-primary]="selectedBoard() === board.id"
              [class.shadow-md]="selectedBoard() === board.id"
              [class.border-base-300/50]="selectedBoard() !== board.id"
              [class.hover:border-primary/40]="selectedBoard() !== board.id"
              (click)="selectBoard(board.id)"
            >
              <div class="card-body p-4 gap-1">
                <h2 class="card-title text-sm">{{ board.label }}</h2>
                <p class="text-xs font-mono text-base-content/40">{{ board.model }}</p>
                @if (board.id === selectedBoard() && boardFeatures()) {
                  <div class="flex flex-wrap gap-1 mt-2">
                    @for (feat of boardFeatures(); track feat) {
                      <span class="badge badge-ghost badge-xs">{{ feat }}</span>
                    }
                  </div>
                }
              </div>
            </button>
          }
        </div>

        <!-- Self-Test section (when board selected) -->
        @if (selectedBoard()) {
          <div class="space-y-4">
            <h2 class="text-lg font-semibold">Self-Test: {{ selectedBoardLabel() }}</h2>

            <!-- Connectivity -->
            <app-connectivity-config
              [ssid]="secrets()['wifi_ssid']"
              [password]="secrets()['wifi_password']"
              [network]="network()"
              [supportedTransports]="supportedTransports()"
              (ssidChange)="updateSecret('wifi_ssid', $event)"
              (passwordChange)="updateSecret('wifi_password', $event)"
              (networkChange)="network.set($event)"
            />

            <!-- Generate -->
            <div class="bg-base-100 rounded-xl border border-base-300/40 overflow-hidden">
              <div class="flex items-center justify-between px-5 py-3.5">
                <div>
                  <h3 class="font-semibold text-sm">Self-Test Firmware</h3>
                  <p class="text-xs text-base-content/60 mt-0.5">Cycles through all hardware features without wiring</p>
                </div>
                <button
                  class="btn btn-primary btn-xs gap-1.5"
                  (click)="generate()"
                  [disabled]="generating() || (transport() === 'wifi' && !secrets()['wifi_ssid'])"
                >
                  @if (generating()) { <span class="loading loading-spinner loading-xs"></span> }
                  {{ files().length > 0 ? 'Regenerate' : 'Generate' }}
                </button>
              </div>

              @if (files().length > 0) {
                <div class="border-t border-base-300/30 px-5 py-3 bg-base-200/30">
                  <table class="table table-xs">
                    <thead>
                      <tr>
                        <th class="text-xs uppercase tracking-wider text-base-content/50 font-semibold">File</th>
                        <th class="text-xs uppercase tracking-wider text-base-content/50 font-semibold">Description</th>
                        <th class="text-xs uppercase tracking-wider text-base-content/50 font-semibold text-right">Lines</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (f of files(); track f.path) {
                        <tr class="hover">
                          <td class="font-mono text-[11px] text-primary/70">{{ f.path }}</td>
                          <td class="text-[11px] text-base-content/50">{{ f.description }}</td>
                          <td class="text-right text-[11px] tabular-nums text-base-content/60">{{ f.lines }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </div>

            <!-- Compile & Flash -->
            @if (files().length > 0) {
              <div class="bg-base-100 rounded-xl border border-base-300/40 overflow-hidden">
                <div class="flex items-center justify-between px-5 py-3.5">
                  <div>
                    <h3 class="font-semibold text-sm">Build & Flash</h3>
                    @if (!toolchain()?.esphomePath) {
                      <p class="text-xs text-warning mt-0.5">ESPHome not found on PATH</p>
                    } @else {
                      <p class="text-xs text-base-content/60 mt-0.5">Compile and flash self-test firmware</p>
                    }
                  </div>
                  <div class="flex items-center gap-2">
                    @if (running()) {
                      <button class="btn btn-error btn-xs" (click)="cancel()">Cancel</button>
                    }
                    <button
                      class="btn btn-ghost btn-xs gap-1.5 border border-base-300/50"
                      (click)="compile()"
                      [disabled]="!toolchain()?.esphomePath || running()"
                    >
                      @if (running() && activeAction() === 'compile') {
                        <span class="loading loading-spinner loading-xs"></span>
                      }
                      Compile
                    </button>
                  </div>
                </div>

                <!-- Post-compile: flash options -->
                @if (compileSuccess()) {
                  <div class="border-t border-base-300/30 px-5 py-3.5 bg-base-200/30">
                    <div class="flex items-center gap-3">
                      <select
                        class="select select-bordered select-xs flex-1 max-w-xs"
                        [ngModel]="selectedPort()"
                        (ngModelChange)="selectedPort.set($event)"
                      >
                        <option value="">Select USB port...</option>
                        @for (port of serialPorts(); track port.port) {
                          <option [value]="port.port">{{ port.port }} — {{ port.description }}</option>
                        }
                      </select>
                      <button class="btn btn-ghost btn-xs" (click)="scanPorts()">
                        @if (scanningPorts()) { <span class="loading loading-spinner loading-xs"></span> }
                        Scan
                      </button>
                      <button
                        class="btn btn-primary btn-xs"
                        (click)="flash()"
                        [disabled]="!selectedPort() || running()"
                      >
                        @if (running() && activeAction() === 'flash') {
                          <span class="loading loading-spinner loading-xs"></span>
                        }
                        Flash USB
                      </button>
                    </div>
                  </div>
                }

                <!-- Terminal -->
                @if (terminalLines().length > 0) {
                  <div class="border-t border-base-300/30">
                    <pre
                      #terminalEl
                      class="bg-neutral text-neutral-content text-xs font-mono p-4 max-h-[300px] overflow-auto whitespace-pre-wrap"
                    >@for (line of terminalLines(); track $index) {<span
                      [class.text-error]="line.stream === 'stderr'"
                      [class.text-info]="line.stream === 'system'"
                    >{{ line.text }}</span>}
                    </pre>
                  </div>
                }
              </div>
            }

            <!-- Error -->
            @if (error()) {
              <div class="alert alert-error py-2 text-sm rounded-xl">
                <span class="font-mono text-xs">{{ error() }}</span>
              </div>
            }

            <!-- Serial Monitor -->
            <app-serial-monitor />
          </div>
        }
      </div>
    </div>
  `,
})
export class BoardsPageComponent implements OnInit, OnDestroy, AfterViewChecked {
  private electron = inject(ElectronService);
  private router = inject(Router);

  @ViewChild('terminalEl') private terminalEl?: ElementRef<HTMLPreElement>;

  // Board list
  protected boards = signal<BoardListEntry[]>([]);
  protected selectedBoard = signal<string | null>(null);
  private boardDefs = new Map<string, { board: unknown; svg: string | null }>();

  // Self-test state
  protected generating = signal(false);
  protected files = signal<FileEntry[]>([]);
  protected deviceDir = signal('');
  protected error = signal<string | null>(null);

  // Secrets (board-scoped)
  protected secrets = signal<Record<string, string>>({
    wifi_ssid: '', wifi_password: '',
    api_key: '', ota_password: '',
  });

  // Self-test connectivity (in-memory only — board self-tests are throwaway)
  protected network = signal<NetworkConfig>({ mode: 'dhcp' });

  // Build state
  protected toolchain = signal<ToolchainInfo | null>(null);
  protected running = signal(false);
  protected activeAction = signal<'compile' | 'flash' | null>(null);
  protected compileSuccess = signal(false);
  protected terminalLines = signal<TerminalLine[]>([]);
  protected serialPorts = signal<SerialDevice[]>([]);
  protected selectedPort = signal('');
  protected scanningPorts = signal(false);
  private activeProcessId = signal<string | null>(null);
  private shouldAutoScroll = true;

  private unsubStarted: (() => void) | null = null;
  private unsubOutput: (() => void) | null = null;
  private unsubDone: (() => void) | null = null;

  // Computed
  protected selectedBoardLabel = computed(() => {
    const id = this.selectedBoard();
    return this.boards().find(b => b.id === id)?.label ?? '';
  });

  protected supportedTransports = computed<readonly NetworkTransport[]>(() => {
    const id = this.selectedBoard();
    if (!id) return ['wifi'];
    const def = this.boardDefs.get(id);
    if (!def) return ['wifi'];
    const b = def.board as Record<string, unknown>;
    const periphs = b['peripherals'] as Record<string, unknown> | undefined;
    return periphs?.['ethernet'] ? ['ethernet', 'wifi'] : ['wifi'];
  });

  protected transport = computed(() =>
    effectiveTransport(this.network(), this.supportedTransports())
  );

  protected boardFeatures = computed(() => {
    const id = this.selectedBoard();
    if (!id) return [];
    const def = this.boardDefs.get(id);
    if (!def) return [];
    const b = def.board as Record<string, unknown>;
    const periphs = b['peripherals'] as Record<string, unknown> | undefined;
    const pins = b['pins'] as unknown[] | undefined;
    const expanders = b['expanders'] as unknown[] | undefined;
    const features: string[] = [];
    if (periphs?.['ethernet']) features.push('Ethernet');
    if (!periphs?.['ethernet']) features.push('WiFi');
    if (periphs?.['oled']) features.push('OLED');
    if (periphs?.['lora']) features.push('LoRa');
    if (periphs?.['battery']) features.push('Battery');
    if (expanders?.length) features.push(`${expanders.length}x I2C Expander`);
    if (pins?.length) features.push(`${pins.length} pins`);
    return features;
  });

  async ngOnInit() {
    this.boards.set(await this.electron.boardList());
    this.toolchain.set(await this.electron.toolchainStatus());

    // ESPHome process listeners
    this.unsubStarted = this.electron.onEsphomeStarted((handle) => {
      this.activeProcessId.set(handle.id);
    });
    this.unsubOutput = this.electron.onEsphomeOutput((data) => {
      this.terminalLines.update(lines => [
        ...lines,
        { text: data.text, stream: data.stream as 'stdout' | 'stderr' },
      ]);
    });
    this.unsubDone = this.electron.onEsphomeDone((data) => {
      const cancelled = data.signal === 'SIGTERM';
      const success = data.code === 0;
      const msg = cancelled ? '--- Cancelled ---\n'
        : success ? '--- Done ---\n'
        : `--- Exited with code ${data.code} ---\n`;
      this.terminalLines.update(lines => [...lines, { text: msg, stream: 'system' }]);
      this.running.set(false);
      this.activeAction.set(null);
      this.activeProcessId.set(null);
      if (data.operation === 'compile' && success && !cancelled) {
        this.compileSuccess.set(true);
        this.scanPorts();
      }
    });
  }

  ngOnDestroy() {
    this.unsubStarted?.();
    this.unsubOutput?.();
    this.unsubDone?.();
  }

  ngAfterViewChecked() {
    if (this.shouldAutoScroll && this.terminalEl) {
      const el = this.terminalEl.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }

  async selectBoard(id: string) {
    this.selectedBoard.set(id);
    this.files.set([]);
    this.compileSuccess.set(false);
    this.terminalLines.set([]);
    this.error.set(null);

    if (!this.boardDefs.has(id)) {
      const data = await this.electron.boardLoad(id);
      this.boardDefs.set(id, data);
    }

    // Load persisted secrets for this board's self-test
    const saved = await this.electron.secretsGet('__selftest__', id);
    if (saved && Object.keys(saved).length > 0) {
      this.secrets.set(saved);
    } else {
      // Generate fresh crypto keys, keep wifi empty
      const fresh: Record<string, string> = {
        wifi_ssid: '', wifi_password: '',
        api_key: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
        ota_password: crypto.randomUUID().replace(/-/g, '').slice(0, 32),
      };
      this.secrets.set(fresh);
      await this.electron.secretsSet('__selftest__', id, fresh);
    }
  }

  updateSecret(key: string, value: string) {
    const s = { ...this.secrets(), [key]: value };
    this.secrets.set(s);
    const id = this.selectedBoard();
    if (id) this.electron.secretsSet('__selftest__', id, s);
  }

  async generate() {
    const boardId = this.selectedBoard();
    if (!boardId) return;
    this.generating.set(true);
    this.error.set(null);
    this.compileSuccess.set(false);
    try {
      const result = await this.electron.generateSelfTest(boardId, this.secrets(), this.network());
      this.files.set(result.files);
      this.deviceDir.set(result.deviceDir);
    } catch (err) {
      this.error.set(String(err));
    } finally {
      this.generating.set(false);
    }
  }

  async compile() {
    const dir = this.deviceDir();
    if (!dir) return;
    this.running.set(true);
    this.activeAction.set('compile');
    this.compileSuccess.set(false);
    this.terminalLines.set([]);
    this.shouldAutoScroll = true;
    this.error.set(null);
    try {
      await this.electron.esphomeCompile(dir);
    } catch (err) {
      this.error.set(String(err));
      this.running.set(false);
      this.activeAction.set(null);
    }
  }

  async flash() {
    const dir = this.deviceDir();
    const port = this.selectedPort();
    if (!dir || !port) return;
    this.running.set(true);
    this.activeAction.set('flash');
    this.terminalLines.set([]);
    this.shouldAutoScroll = true;
    this.error.set(null);
    try {
      await this.electron.esphomeFlash(dir, port);
    } catch (err) {
      this.error.set(String(err));
      this.running.set(false);
      this.activeAction.set(null);
    }
  }

  async cancel() {
    const pid = this.activeProcessId();
    if (pid) await this.electron.esphomeCancel(pid);
  }

  async scanPorts() {
    this.scanningPorts.set(true);
    try {
      this.serialPorts.set(await this.electron.deviceListSerial());
    } finally {
      this.scanningPorts.set(false);
    }
  }
}
