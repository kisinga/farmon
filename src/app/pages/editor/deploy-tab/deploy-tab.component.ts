import { Component, inject, OnInit, OnDestroy, signal, computed, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import { ElectronService } from '../../../core/services/electron.service';
import { ValidationPanelComponent } from '../../../shared/validation-panel/validation-panel.component';
import type { ToolchainInfo, SerialDevice } from '../../../core/models/electron-api';

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
  selector: 'app-deploy-tab',
  standalone: true,
  imports: [ValidationPanelComponent],
  template: `
    <div class="max-w-3xl space-y-4">

      <!-- Validation summary -->
      <div class="bg-base-100 rounded-xl border border-base-300/40 px-5 py-3.5">
        <h3 class="text-xs font-semibold text-base-content/50 uppercase tracking-wider mb-3">Validation</h3>
        <app-validation-panel
          [result]="editor.validation()"
          [gpioUsage]="editor.gpioUsage()"
        />
      </div>

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
          <div class="flex items-center gap-2">
            @if (editor.dirty()) {
              <span class="badge badge-warning badge-xs">Unsaved changes</span>
            }
            <button
              class="btn btn-primary btn-xs gap-1.5"
              (click)="generate()"
              [disabled]="generating() || editor.dirty()"
              [title]="editor.dirty() ? 'Save before generating' : ''"
            >
              @if (generating()) {
                <span class="loading loading-spinner loading-xs"></span>
              }
              {{ files().length > 0 ? 'Regenerate' : 'Generate' }}
            </button>
          </div>
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
                  <tr class="hover cursor-pointer" (click)="openFile(f.path)">
                    <td class="font-mono text-[11px] text-primary/70 underline decoration-primary/30">{{ f.path }}</td>
                    <td class="text-[11px] text-base-content/50">{{ f.description }}</td>
                    <td class="text-right text-[11px] tabular-nums text-base-content/60">{{ f.lines }}</td>
                  </tr>
                }
              </tbody>
            </table>
            @if (outputDir()) {
              <div class="flex items-center gap-2 mt-2">
                <span class="text-xs text-base-content/50 font-mono truncate flex-1">{{ outputDir() }}</span>
                <button
                  class="btn btn-ghost btn-xs gap-1 text-base-content/50 hover:text-base-content"
                  (click)="openOutputFolder()"
                  title="Open in file explorer"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                  </svg>
                  Open
                </button>
              </div>
            }
          </div>
        }
      </div>

      <!-- Step 2: Build & Deploy -->
      <div
        class="bg-base-100 rounded-xl border border-base-300/40 overflow-hidden transition-opacity"
        [class.opacity-40]="!canBuild()"
        [class.pointer-events-none]="!canBuild()"
      >
        <div class="flex items-center justify-between px-5 py-3.5">
          <div class="flex items-center gap-3">
            <div class="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-sm font-bold text-primary/70">2</div>
            <div>
              <h2 class="font-semibold text-sm">Build & Deploy</h2>
              @if (toolchain()?.esphomePath) {
                <p class="text-xs text-base-content/60 mt-0.5">Compile firmware and flash to device</p>
              } @else {
                <p class="text-xs text-warning mt-0.5">ESPHome not found on PATH</p>
              }
            </div>
          </div>
          <div class="flex items-center gap-2">
            @if (running() && activeAction()) {
              <button class="btn btn-error btn-xs gap-1" (click)="cancel()">Cancel</button>
            }
            <button
              class="btn btn-ghost btn-xs gap-1.5 border border-base-300/50"
              (click)="compile()"
              [disabled]="!canBuild() || running()"
            >
              @if (running() && activeAction() === 'compile') {
                <span class="loading loading-spinner loading-xs"></span>
              }
              Compile
            </button>
          </div>
        </div>

        <!-- Post-compile actions -->
        @if (compileSuccess()) {
          <div class="border-t border-base-300/30 px-5 py-3.5 bg-base-200/30">
            <div class="flex items-center gap-2 mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-success" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
              </svg>
              <span class="text-sm font-medium text-success">Build succeeded</span>
            </div>

            <div class="flex flex-wrap gap-2">
              <!-- Flash USB -->
              <div class="dropdown dropdown-top">
                <div
                  tabindex="0"
                  role="button"
                  class="btn btn-primary btn-xs gap-1"
                  [class.btn-disabled]="running()"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clip-rule="evenodd" />
                  </svg>
                  Flash USB
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 opacity-60" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
                  </svg>
                </div>
                <div tabindex="0" class="dropdown-content bg-base-100 rounded-lg shadow-lg border border-base-300/50 p-3 w-72 mb-2 z-10">
                  <div class="flex items-center gap-2">
                    <select
                      class="select select-bordered select-xs flex-1 font-mono"
                      [disabled]="running() || serialPorts().length === 0"
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
                      class="btn btn-ghost btn-xs border border-base-300/50"
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
                    class="btn btn-primary btn-xs w-full mt-2"
                    (click)="flash(selectedPort())"
                    [disabled]="running() || !selectedPort()"
                  >
                    Flash
                  </button>
                </div>
              </div>

              <!-- Flash OTA -->
              @if (!showOtaInput()) {
                <button
                  class="btn btn-ghost btn-xs gap-1 border border-base-300/50"
                  (click)="showOtaInput.set(true)"
                  [disabled]="running()"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M17.778 8.222c-4.296-4.296-11.26-4.296-15.556 0A1 1 0 01.808 6.808c5.076-5.076 13.308-5.076 18.384 0a1 1 0 01-1.414 1.414zM14.95 11.05a7 7 0 00-9.9 0 1 1 0 01-1.414-1.414 9 9 0 0112.728 0 1 1 0 01-1.414 1.414zM12.12 13.88a3 3 0 00-4.242 0 1 1 0 01-1.414-1.414 5 5 0 017.07 0 1 1 0 01-1.414 1.414zM10 16a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
                  </svg>
                  Flash OTA
                </button>
              } @else {
                <div class="flex items-center gap-1.5">
                  <input
                    type="text"
                    class="input input-bordered input-xs w-48 font-mono"
                    placeholder="device.local or 192.168.1.x"
                    [value]="otaAddress()"
                    (input)="otaAddress.set(toInputValue($event))"
                  />
                  <button
                    class="btn btn-primary btn-xs"
                    (click)="flash(otaAddress())"
                    [disabled]="running() || !otaAddress()"
                  >
                    Flash
                  </button>
                  <button
                    class="btn btn-ghost btn-xs"
                    (click)="showOtaInput.set(false)"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </div>
              }

              <!-- Open Files -->
              <button
                class="btn btn-ghost btn-xs gap-1 border border-base-300/50"
                (click)="openDeviceFolder()"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                </svg>
                Open Files
              </button>
            </div>
          </div>
        }
      </div>

      <!-- Terminal output -->
      @if (terminalLines().length > 0 || running()) {
        <div class="rounded-xl overflow-hidden border border-neutral/80">
          <div class="flex items-center justify-between px-4 py-2 bg-neutral">
            <div class="flex items-center gap-2">
              @if (running()) {
                <span class="loading loading-spinner loading-xs text-neutral-content/60"></span>
                <span class="text-[10px] font-mono text-neutral-content/60 uppercase tracking-wider">
                  {{ activeAction() === 'compile' ? 'Compiling' : activeAction() === 'flash' ? 'Flashing' : 'Running' }}...
                </span>
              } @else if (terminalStatus() === 'success') {
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-success" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                </svg>
                <span class="text-[10px] font-mono text-success/80 uppercase tracking-wider">Done</span>
              } @else if (terminalStatus() === 'error') {
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-error" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
                </svg>
                <span class="text-[10px] font-mono text-error/80 uppercase tracking-wider">Failed</span>
              } @else {
                <span class="text-[10px] font-mono text-neutral-content/40 uppercase tracking-wider">Output</span>
              }
            </div>
            <div class="flex items-center gap-1">
              @if (running()) {
                <button class="btn btn-ghost btn-xs text-neutral-content/40 hover:text-error" (click)="cancel()">Cancel</button>
              }
              @if (terminalLines().length > 0) {
                <button class="btn btn-ghost btn-xs text-neutral-content/40 hover:text-neutral-content" (click)="clearTerminal()">Clear</button>
              }
            </div>
          </div>
          <pre
            #terminalEl
            class="px-4 py-3 text-[11px] font-mono bg-neutral overflow-auto max-h-72 leading-relaxed"
          >@for (line of terminalLines(); track $index) {<span
              [class]="line.stream === 'stderr' ? 'text-warning/80' : line.stream === 'system' ? 'text-info/60 italic' : 'text-neutral-content/80'"
            >{{ line.text }}</span>}@if (terminalLines().length === 0 && running()) {<span class="text-neutral-content/30 italic">Waiting for output...</span>}</pre>
        </div>
      }

      <!-- Errors -->
      @if (error()) {
        <div class="alert alert-error py-2 text-sm rounded-xl">
          <span class="font-mono text-xs">{{ error() }}</span>
        </div>
      }
    </div>
  `,
})
export class DeployTabComponent implements OnInit, OnDestroy, AfterViewChecked {
  protected editor = inject(SystemEditorService);
  private electron = inject(ElectronService);

  @ViewChild('terminalEl') private terminalEl?: ElementRef<HTMLPreElement>;

  // Generate
  protected files = signal<FileEntry[]>([]);
  protected outputDir = signal('');
  protected deviceDir = signal('');
  protected generating = signal(false);

  // Build & Deploy
  protected running = signal(false);
  protected activeAction = signal<'compile' | 'flash' | null>(null);
  protected compileSuccess = signal(false);
  protected error = signal<string | null>(null);
  protected toolchain = signal<ToolchainInfo | null>(null);

  // Terminal
  protected terminalLines = signal<TerminalLine[]>([]);
  protected terminalStatus = signal<'idle' | 'running' | 'success' | 'error'>('idle');
  private shouldAutoScroll = true;

  // Flash
  protected flashMode = signal<'usb' | 'ota'>('usb');
  protected serialPorts = signal<SerialDevice[]>([]);
  protected selectedPort = signal('');
  protected scanningPorts = signal(false);
  protected otaAddress = signal('');
  protected showOtaInput = signal(false);
  private activeProcessId = signal<string | null>(null);

  protected canBuild = computed(() => !!this.toolchain()?.esphomePath && this.files().length > 0);

  private unsubStarted: (() => void) | null = null;
  private unsubOutput: (() => void) | null = null;
  private unsubDone: (() => void) | null = null;

  async ngOnInit() {
    this.toolchain.set(await this.electron.toolchainStatus());

    const deviceName = this.editor.topology()?.device?.name;
    if (deviceName) {
      this.otaAddress.set(`${deviceName}.local`);
    }

    if (this.toolchain()?.esphomePath) {
      this.scanPorts();
    }

    this.unsubStarted = this.electron.onEsphomeStarted((handle) => {
      this.activeProcessId.set(handle.id);
    });
    this.unsubOutput = this.electron.onEsphomeOutput((data) => {
      this.terminalLines.update((lines) => [
        ...lines,
        { text: data.text, stream: data.stream as 'stdout' | 'stderr' },
      ]);
    });
    this.unsubDone = this.electron.onEsphomeDone((data) => {
      const cancelled = data.signal === 'SIGTERM';
      const success = data.code === 0;
      const msg = cancelled
        ? '--- Cancelled ---\n'
        : success
          ? '--- Done ---\n'
          : `--- Exited with code ${data.code} ---\n`;
      this.terminalLines.update((lines) => [...lines, { text: msg, stream: 'system' }]);
      this.running.set(false);
      this.activeAction.set(null);
      this.activeProcessId.set(null);

      if (data.operation === 'compile' && success && !cancelled) {
        this.compileSuccess.set(true);
        this.terminalStatus.set('success');
      } else if (cancelled) {
        this.terminalStatus.set('idle');
      } else {
        this.terminalStatus.set('error');
      }
    });
  }

  ngAfterViewChecked() {
    if (this.shouldAutoScroll && this.terminalEl) {
      const el = this.terminalEl.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }

  ngOnDestroy() {
    this.unsubStarted?.();
    this.unsubOutput?.();
    this.unsubDone?.();
  }

  async generate() {
    this.generating.set(true);
    this.error.set(null);
    this.compileSuccess.set(false);
    try {
      const topology = this.editor.topology();
      const board = this.editor.board();
      if (!topology || !board) throw new Error('No topology or board loaded');
      const result = await this.electron.generate(topology, board);
      this.files.set(result.files);
      this.outputDir.set(result.outputDir);
      this.deviceDir.set(result.deviceDir);
      this.editor.setGenerateResult(result);
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
    this.terminalStatus.set('running');
    this.error.set(null);
    this.shouldAutoScroll = true;
    try {
      await this.electron.esphomeCompile(dir);
    } catch (err) {
      this.error.set(String(err));
      this.running.set(false);
      this.activeAction.set(null);
      this.terminalStatus.set('error');
    }
  }

  async flash(device?: string) {
    if (!device) return;
    const dir = this.deviceDir();
    if (!dir) return;
    this.running.set(true);
    this.activeAction.set('flash');
    this.terminalLines.set([]);
    this.terminalStatus.set('running');
    this.error.set(null);
    this.shouldAutoScroll = true;
    try {
      await this.electron.esphomeFlash(dir, device);
    } catch (err) {
      this.error.set(String(err));
      this.running.set(false);
      this.activeAction.set(null);
      this.terminalStatus.set('error');
    }
  }

  async cancel() {
    const id = this.activeProcessId();
    if (id) {
      await this.electron.esphomeCancel(id);
    }
  }

  clearTerminal() {
    this.terminalLines.set([]);
    this.terminalStatus.set('idle');
  }

  async openFile(relativePath: string) {
    const dir = this.outputDir();
    if (dir) {
      await this.electron.shellOpenPath(`${dir}/${relativePath}`);
    }
  }

  async openOutputFolder() {
    const dir = this.outputDir();
    if (dir) {
      await this.electron.shellShowInFolder(dir);
    }
  }

  async openDeviceFolder() {
    const dir = this.outputDir();
    const device = this.deviceDir();
    if (dir && device) {
      await this.electron.shellShowInFolder(`${dir}/esphome/${device}`);
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
