import {
  Component, ElementRef, OnDestroy, OnInit, ViewChild,
  AfterViewChecked, computed, effect, inject, input, output, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ElectronService } from '../../core/services/electron.service';
import type { ToolchainInfo, SerialDevice } from '../../core/models/electron-api';

interface TerminalLine {
  text: string;
  stream: 'stdout' | 'stderr' | 'system';
}

/**
 * Self-contained ESPHome compile/flash UI: status header, USB + (optional) OTA
 * flash, port scanning, and terminal output. Owns the ESPHome IPC subscriptions
 * for its lifetime so hosts only need to feed it a deviceDir + toolchain.
 *
 * Resets compileSuccess + terminal when deviceDir changes (regenerate flow).
 */
@Component({
  selector: 'app-firmware-build-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    <!-- Build & Deploy header -->
    <div
      class="bg-base-100 rounded-xl border overflow-hidden transition-opacity"
      [class.border-base-300/40]="canBuild()"
      [class.border-warning/30]="!canBuild()"
      [class.opacity-50]="!canBuild() && !alwaysEnabled()"
      [class.pointer-events-none]="!canBuild() && !alwaysEnabled()"
    >
      <div class="flex items-center justify-between px-5 py-3.5">
        <div class="flex items-center gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <div>
            <h2 class="font-semibold text-sm">{{ heading() }}</h2>
            @if (!toolchain()?.esphomePath) {
              <p class="text-xs text-warning mt-0.5">ESPHome not found on PATH</p>
            } @else if (!canBuild() && canBuildReason()) {
              <p class="text-xs text-warning mt-0.5">{{ canBuildReason() }}</p>
            } @else {
              <p class="text-xs text-base-content/60 mt-0.5">{{ subheading() }}</p>
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
            [disabled]="!toolchain()?.esphomePath || running() || !deviceDir()"
          >
            @if (running() && activeAction() === 'compile') {
              <span class="loading loading-spinner loading-xs"></span>
            }
            Compile
          </button>
        </div>
      </div>

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
              <div tabindex="0" role="button" class="btn btn-primary btn-xs gap-1" [class.btn-disabled]="running()">
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
                >Flash</button>
              </div>
            </div>

            <!-- Flash OTA -->
            @if (showOta()) {
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
                  <button class="btn btn-primary btn-xs" (click)="flash(otaAddress())" [disabled]="running() || !otaAddress()">Flash</button>
                  <button class="btn btn-ghost btn-xs" (click)="showOtaInput.set(false)">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </div>
              }
            }

            <!-- Open Files -->
            @if (showOpenFiles()) {
              <button class="btn btn-ghost btn-xs gap-1 border border-base-300/50" (click)="openFiles.emit()">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                </svg>
                Open Files
              </button>
            }
          </div>
        </div>
      }
    </div>

    <!-- Terminal output -->
    @if (terminalLines().length > 0 || running()) {
      <div class="rounded-xl overflow-hidden border border-neutral/80 mt-4">
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
  `,
})
export class FirmwareBuildPanelComponent implements OnInit, OnDestroy, AfterViewChecked {
  private electron = inject(ElectronService);

  @ViewChild('terminalEl') private terminalEl?: ElementRef<HTMLPreElement>;

  readonly deviceDir = input<string>('');
  readonly toolchain = input<ToolchainInfo | null>(null);
  readonly canBuild = input<boolean>(true);
  readonly canBuildReason = input<string>('');
  readonly heading = input<string>('Build & Deploy');
  readonly subheading = input<string>('Compile firmware and flash to device');
  readonly showOta = input<boolean>(false);
  readonly showOpenFiles = input<boolean>(false);
  readonly initialOtaAddress = input<string>('');
  /** When true, the panel is interactive even if `canBuild` is false (so the user can read why). */
  readonly alwaysEnabled = input<boolean>(false);

  readonly compiled = output<void>();
  readonly openFiles = output<void>();
  readonly errorOccurred = output<string>();

  protected running = signal(false);
  protected activeAction = signal<'compile' | 'flash' | null>(null);
  protected compileSuccess = signal(false);
  protected terminalLines = signal<TerminalLine[]>([]);
  protected terminalStatus = signal<'idle' | 'running' | 'success' | 'error'>('idle');

  protected serialPorts = signal<SerialDevice[]>([]);
  protected selectedPort = signal('');
  protected scanningPorts = signal(false);
  protected otaAddress = signal('');
  protected showOtaInput = signal(false);

  private activeProcessId = signal<string | null>(null);
  private shouldAutoScroll = true;

  private unsubStarted: (() => void) | null = null;
  private unsubOutput: (() => void) | null = null;
  private unsubDone: (() => void) | null = null;

  protected toolchainReady = computed(() => !!this.toolchain()?.esphomePath);

  constructor() {
    // Reset compile state whenever the host swaps the device (e.g. regenerate or controller switch).
    effect(() => {
      this.deviceDir();
      this.compileSuccess.set(false);
      this.terminalLines.set([]);
      this.terminalStatus.set('idle');
    });

    // Seed OTA address from input when the host provides one.
    effect(() => {
      const seed = this.initialOtaAddress();
      if (seed) this.otaAddress.set(seed);
    });
  }

  ngOnInit() {
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
        this.compiled.emit();
        this.scanPorts();
      } else if (cancelled) {
        this.terminalStatus.set('idle');
      } else {
        this.terminalStatus.set('error');
      }
    });

    if (this.toolchainReady()) {
      this.scanPorts();
    }
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

  protected async compile() {
    const dir = this.deviceDir();
    if (!dir) return;
    this.running.set(true);
    this.activeAction.set('compile');
    this.compileSuccess.set(false);
    this.terminalLines.set([]);
    this.terminalStatus.set('running');
    this.shouldAutoScroll = true;
    try {
      await this.electron.esphomeCompile(dir);
    } catch (err) {
      this.errorOccurred.emit(String(err));
      this.running.set(false);
      this.activeAction.set(null);
      this.terminalStatus.set('error');
    }
  }

  protected async flash(device?: string) {
    if (!device) return;
    const dir = this.deviceDir();
    if (!dir) return;
    this.running.set(true);
    this.activeAction.set('flash');
    this.terminalLines.set([]);
    this.terminalStatus.set('running');
    this.shouldAutoScroll = true;
    try {
      await this.electron.esphomeFlash(dir, device);
    } catch (err) {
      this.errorOccurred.emit(String(err));
      this.running.set(false);
      this.activeAction.set(null);
      this.terminalStatus.set('error');
    }
  }

  protected async cancel() {
    const id = this.activeProcessId();
    if (id) await this.electron.esphomeCancel(id);
  }

  protected clearTerminal() {
    this.terminalLines.set([]);
    this.terminalStatus.set('idle');
  }

  protected async scanPorts() {
    this.scanningPorts.set(true);
    try {
      const ports = await this.electron.deviceListSerial();
      this.serialPorts.set(ports);
      if (ports.length > 0 && !ports.some(p => p.port === this.selectedPort())) {
        this.selectedPort.set(ports[0].port);
      }
      if (ports.length === 0) this.selectedPort.set('');
    } finally {
      this.scanningPorts.set(false);
    }
  }

  protected toInputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
