import { Component, inject, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ElectronService } from '../../core/services/electron.service';
import { LibraryService } from '../../core/services/library.service';
import type { ToolchainInfo, SerialDevice } from '../../core/models/electron-api';

interface FileEntry {
  path: string;
  description: string;
  lines: number;
}

@Component({
  selector: 'app-generate',
  standalone: true,
  imports: [],
  template: `
    <div class="min-h-full flex flex-col">
      <!-- Header -->
      <div class="px-6 pt-5 pb-4 bg-base-100 border-b border-base-300/50 sticky top-0 z-10">
        <h1 class="text-lg font-bold tracking-tight">Generate & Flash</h1>
        <p class="text-xs text-base-content/60 mt-0.5 font-mono">{{ configName() }}</p>
      </div>

      <div class="flex-1 overflow-auto">
        <div class="p-6 max-w-3xl space-y-4">

          <!-- Step 1: Generate -->
          <div class="bg-base-100 rounded-xl border border-base-300/40 overflow-hidden">
            <div class="flex items-center justify-between px-5 py-3.5">
              <div class="flex items-center gap-3">
                <div class="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-sm font-bold text-primary/70">1</div>
                <div>
                  <h2 class="font-semibold text-sm">Generate Firmware</h2>
                  <p class="text-xs text-base-content/60 mt-0.5">ESPHome YAML, C++ route table, HA dashboard</p>
                </div>
              </div>
              <button
                class="btn btn-primary btn-xs gap-1.5"
                (click)="generate()"
                [disabled]="generating()"
              >
                @if (generating()) {
                  <span class="loading loading-spinner loading-xs"></span>
                }
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
                @if (outputDir()) {
                  <div class="text-xs text-base-content/50 mt-2 font-mono truncate">{{ outputDir() }}</div>
                }
              </div>
            }
          </div>

          <!-- Step 2: Compile -->
          <div
            class="bg-base-100 rounded-xl border border-base-300/40 overflow-hidden transition-opacity"
            [class.opacity-40]="!canCompile()"
            [class.pointer-events-none]="!canCompile()"
          >
            <div class="flex items-center justify-between px-5 py-3.5">
              <div class="flex items-center gap-3">
                <div class="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-sm font-bold text-primary/70">2</div>
                <div>
                  <h2 class="font-semibold text-sm">Compile</h2>
                  @if (toolchain()?.esphomePath) {
                    <p class="text-xs text-base-content/60 mt-0.5">Build firmware binary with ESPHome</p>
                  } @else {
                    <p class="text-xs text-warning mt-0.5">ESPHome not found on PATH</p>
                  }
                </div>
              </div>
              <button
                class="btn btn-ghost btn-xs gap-1.5 border border-base-300/50"
                (click)="compile()"
                [disabled]="!canCompile() || running()"
              >
                @if (running() && activeAction() === 'compile') {
                  <span class="loading loading-spinner loading-xs"></span>
                }
                Compile
              </button>
            </div>
          </div>

          <!-- Step 3: Flash -->
          <div
            class="bg-base-100 rounded-xl border border-base-300/40 overflow-hidden transition-opacity"
            [class.opacity-40]="!canCompile()"
            [class.pointer-events-none]="!canCompile()"
          >
            <div class="px-5 py-3.5">
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-3">
                  <div class="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-sm font-bold text-primary/70">3</div>
                  <div>
                    <h2 class="font-semibold text-sm">Flash Device</h2>
                    <p class="text-xs text-base-content/60 mt-0.5">Upload firmware to your controller</p>
                  </div>
                </div>
                @if (running() && activeAction() === 'flash') {
                  <button class="btn btn-error btn-xs gap-1" (click)="cancel()">Cancel</button>
                }
              </div>

              <!-- Mode tabs -->
              <div class="flex gap-1 mb-3">
                <button
                  class="btn btn-xs"
                  [class.btn-active]="flashMode() === 'usb'"
                  (click)="flashMode.set('usb')"
                >USB</button>
                <button
                  class="btn btn-xs"
                  [class.btn-active]="flashMode() === 'ota'"
                  (click)="flashMode.set('ota')"
                >OTA</button>
              </div>

              @if (flashMode() === 'usb') {
                <div class="flex items-center gap-2">
                  <div class="join flex-1">
                    <select
                      class="select select-bordered select-xs join-item flex-1 font-mono"
                      [disabled]="!canCompile() || running() || serialPorts().length === 0"
                      [value]="selectedPort()"
                      (change)="selectedPort.set(toInputValue($event))"
                    >
                      @if (serialPorts().length === 0) {
                        <option value="">No ports found</option>
                      }
                      @for (p of serialPorts(); track p.port) {
                        <option [value]="p.port">{{ p.port }} -- {{ p.description }}</option>
                      }
                    </select>
                    <button
                      class="btn btn-ghost btn-xs join-item border border-base-300/50"
                      (click)="scanPorts()"
                      [disabled]="scanningPorts()"
                      title="Refresh ports"
                    >
                      @if (scanningPorts()) {
                        <span class="loading loading-spinner loading-xs"></span>
                      } @else {
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
                        </svg>
                      }
                    </button>
                  </div>
                  <button
                    class="btn btn-primary btn-xs"
                    (click)="flash(selectedPort())"
                    [disabled]="!canCompile() || running() || !selectedPort()"
                  >
                    @if (running() && activeAction() === 'flash') {
                      <span class="loading loading-spinner loading-xs"></span>
                    }
                    Flash
                  </button>
                </div>
              } @else {
                <div class="flex items-center gap-2">
                  <input
                    type="text"
                    class="input input-bordered input-xs flex-1 font-mono"
                    placeholder="device-name.local or 192.168.1.x"
                    [value]="otaAddress()"
                    (input)="otaAddress.set(toInputValue($event))"
                  />
                  <button
                    class="btn btn-primary btn-xs"
                    (click)="flash(otaAddress())"
                    [disabled]="!canCompile() || running() || !otaAddress()"
                  >
                    @if (running() && activeAction() === 'flash') {
                      <span class="loading loading-spinner loading-xs"></span>
                    }
                    Flash
                  </button>
                </div>
              }
            </div>
          </div>

          <!-- Terminal output -->
          @if (terminalLines().length > 0) {
            <div class="rounded-xl overflow-hidden border border-neutral/80">
              <div class="flex items-center justify-between px-4 py-2 bg-neutral">
                <span class="text-[10px] font-mono text-neutral-content/40 uppercase tracking-wider">ESPHome Output</span>
                <button class="btn btn-ghost btn-xs text-neutral-content/40 hover:text-neutral-content" (click)="terminalLines.set([])">Clear</button>
              </div>
              <pre class="px-4 py-3 text-[11px] font-mono bg-neutral text-neutral-content/80 overflow-auto max-h-72 whitespace-pre-wrap leading-relaxed">{{ terminalText() }}</pre>
            </div>
          }

          <!-- Errors -->
          @if (error()) {
            <div class="alert alert-error py-2 text-sm rounded-xl">
              <span class="font-mono text-xs">{{ error() }}</span>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class GenerateComponent implements OnInit, OnDestroy {
  private electron = inject(ElectronService);
  private library = inject(LibraryService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  protected configName = signal('');
  protected files = signal<FileEntry[]>([]);
  protected outputDir = signal('');
  protected generating = signal(false);
  protected running = signal(false);
  protected activeAction = signal<'compile' | 'flash' | null>(null);
  protected error = signal<string | null>(null);
  protected toolchain = signal<ToolchainInfo | null>(null);
  protected terminalLines = signal<string[]>([]);

  // Flash
  protected flashMode = signal<'usb' | 'ota'>('usb');
  protected serialPorts = signal<SerialDevice[]>([]);
  protected selectedPort = signal('');
  protected scanningPorts = signal(false);
  protected otaAddress = signal('');
  private activeProcessId = signal<string | null>(null);

  protected terminalText = computed(() => this.terminalLines().join(''));
  protected canCompile = computed(() => !!this.toolchain()?.esphomePath && this.files().length > 0);

  private unsubStarted: (() => void) | null = null;
  private unsubOutput: (() => void) | null = null;
  private unsubDone: (() => void) | null = null;

  async ngOnInit() {
    const name = this.route.snapshot.paramMap.get('name');
    if (!name) { this.router.navigate(['/library']); return; }
    this.configName.set(name);

    this.toolchain.set(await this.electron.toolchainStatus());

    // Auto-populate OTA address from manifest device name
    try {
      const raw = await this.library.load(name);
      const manifest = raw as Record<string, unknown>;
      const device = manifest['device'] as Record<string, string> | undefined;
      if (device?.['name']) {
        this.otaAddress.set(`${device['name']}.local`);
      }
    } catch {}

    // Auto-scan serial ports
    if (this.toolchain()?.esphomePath) {
      this.scanPorts();
    }

    // Subscribe to ESPHome process events
    this.unsubStarted = this.electron.onEsphomeStarted((handle) => {
      this.activeProcessId.set(handle.id);
    });
    this.unsubOutput = this.electron.onEsphomeOutput((data) => {
      this.terminalLines.update((lines) => [...lines, data.text]);
    });
    this.unsubDone = this.electron.onEsphomeDone((data) => {
      const msg = data.signal === 'SIGTERM'
        ? '\n--- Cancelled ---\n'
        : data.code === 0
          ? '\n--- Done (success) ---\n'
          : `\n--- Exited with code ${data.code} ---\n`;
      this.terminalLines.update((lines) => [...lines, msg]);
      this.running.set(false);
      this.activeAction.set(null);
      this.activeProcessId.set(null);
    });
  }

  ngOnDestroy() {
    this.unsubStarted?.();
    this.unsubOutput?.();
    this.unsubDone?.();
  }

  async generate() {
    this.generating.set(true);
    this.error.set(null);
    try {
      const raw = await this.library.load(this.configName());
      const manifest = raw as Record<string, unknown>;
      const boardId = (manifest['device'] as Record<string, string>)?.['board'];
      const { board } = await this.electron.boardLoad(boardId!);
      const result = await this.electron.generate(manifest, board);
      this.files.set(result.files);
      this.outputDir.set(result.outputDir);
    } catch (err) {
      this.error.set(String(err));
    } finally {
      this.generating.set(false);
    }
  }

  async compile() {
    this.running.set(true);
    this.activeAction.set('compile');
    this.terminalLines.set([]);
    this.error.set(null);
    try {
      await this.electron.esphomeCompile(this.configName());
    } catch (err) {
      this.error.set(String(err));
      this.running.set(false);
      this.activeAction.set(null);
    }
  }

  async flash(device?: string) {
    if (!device) return;
    this.running.set(true);
    this.activeAction.set('flash');
    this.terminalLines.set([]);
    this.error.set(null);
    try {
      await this.electron.esphomeFlash(this.configName(), device);
    } catch (err) {
      this.error.set(String(err));
      this.running.set(false);
      this.activeAction.set(null);
    }
  }

  async cancel() {
    const id = this.activeProcessId();
    if (id) {
      await this.electron.esphomeCancel(id);
    }
  }

  async scanPorts() {
    this.scanningPorts.set(true);
    try {
      const ports = await this.electron.deviceListSerial();
      this.serialPorts.set(ports);
      if (ports.length > 0 && !ports.some(p => p.port === this.selectedPort())) {
        this.selectedPort.set(ports[0].port);
      }
      if (ports.length === 0) {
        this.selectedPort.set('');
      }
    } finally {
      this.scanningPorts.set(false);
    }
  }

  protected toInputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
