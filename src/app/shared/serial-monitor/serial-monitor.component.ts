import {
  Component, inject, OnInit, OnDestroy, signal,
  ElementRef, ViewChild, AfterViewChecked,
} from '@angular/core';
import { ElectronService } from '../../core/services/electron.service';
import type { SerialDevice } from '../../core/models/electron-api';

interface TerminalLine {
  text: string;
  stream: 'stdout' | 'stderr' | 'system';
}

@Component({
  selector: 'app-serial-monitor',
  standalone: true,
  host: { class: 'flex flex-col min-h-0' },
  template: `
    <!-- Controls -->
    <div class="bg-base-100 rounded-xl border border-base-300/40 px-5 py-4 shrink-0">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <div>
            <h2 class="font-semibold text-sm">Serial Monitor</h2>
            <p class="text-xs text-base-content/60 mt-0.5">Raw serial debug — works on any device, no flash required</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <!-- Port selector -->
          <select
            class="select select-bordered select-xs font-mono"
            [disabled]="running() || ports().length === 0"
            [value]="selectedPort()"
            (change)="selectedPort.set(toValue($event))"
          >
            @if (ports().length === 0) {
              <option value="">No ports found</option>
            }
            @for (p of ports(); track p.port) {
              <option [value]="p.port">{{ p.port }} -- {{ p.description }}</option>
            }
          </select>
          <button
            class="btn btn-ghost btn-xs border border-base-300/50"
            (click)="scanPorts()"
            [disabled]="scanning()"
            title="Refresh ports"
          >
            @if (scanning()) {
              <span class="loading loading-spinner loading-xs"></span>
            } @else {
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
              </svg>
            }
          </button>

          <!-- Baud rate -->
          <select
            class="select select-bordered select-xs font-mono w-28"
            [disabled]="running()"
            [value]="baudRate()"
            (change)="baudRate.set(+toValue($event))"
          >
            @for (b of baudRateOptions; track b) {
              <option [value]="b">{{ b }}</option>
            }
          </select>

          @if (running()) {
            <button class="btn btn-error btn-xs gap-1" (click)="disconnect()">Disconnect</button>
          } @else {
            <button
              class="btn btn-primary btn-xs gap-1"
              (click)="connect()"
              [disabled]="!selectedPort()"
            >Connect</button>
          }
        </div>
      </div>
    </div>

    <!-- Terminal -->
    @if (lines().length > 0 || running()) {
      <div class="mt-4 flex-1 flex flex-col min-h-0 rounded-xl overflow-hidden border border-neutral/80">
        <div class="flex items-center justify-between px-4 py-2 bg-neutral shrink-0">
          <div class="flex items-center gap-2">
            @if (running()) {
              <span class="loading loading-spinner loading-xs text-neutral-content/60"></span>
              <span class="text-[10px] font-mono text-neutral-content/60 uppercase tracking-wider">
                {{ selectedPort() }} @ {{ baudRate() }}
              </span>
            } @else if (status() === 'error') {
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-error" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
              </svg>
              <span class="text-[10px] font-mono text-error/80 uppercase tracking-wider">Disconnected</span>
            } @else {
              <span class="text-[10px] font-mono text-neutral-content/40 uppercase tracking-wider">Output</span>
            }
          </div>
          <div class="flex items-center gap-1">
            @if (lines().length > 0) {
              <button class="btn btn-ghost btn-xs text-neutral-content/40 hover:text-neutral-content" (click)="clear()">Clear</button>
            }
          </div>
        </div>
        <pre
          #terminalEl
          class="px-4 py-3 text-[11px] font-mono bg-neutral overflow-auto flex-1 leading-relaxed"
        >@for (line of lines(); track $index) {<span
            [class]="line.stream === 'stderr' ? 'text-warning/80' : line.stream === 'system' ? 'text-info/60 italic' : 'text-neutral-content/80'"
          >{{ line.text }}</span>}@if (lines().length === 0 && running()) {<span class="text-neutral-content/30 italic">Waiting for output...</span>}</pre>
      </div>
    }
  `,
})
export class SerialMonitorComponent implements OnInit, OnDestroy, AfterViewChecked {
  private electron = inject(ElectronService);

  @ViewChild('terminalEl') private terminalEl?: ElementRef<HTMLPreElement>;

  protected ports = signal<SerialDevice[]>([]);
  protected selectedPort = signal('');
  protected scanning = signal(false);
  protected baudRate = signal(115200);
  protected baudRateOptions = [9600, 19200, 38400, 57600, 74880, 115200, 230400, 460800, 921600];

  protected lines = signal<TerminalLine[]>([]);
  protected running = signal(false);
  protected status = signal<'idle' | 'running' | 'error'>('idle');
  private processId = signal<string | null>(null);
  private autoScroll = true;

  private unsubStarted: (() => void) | null = null;
  private unsubOutput: (() => void) | null = null;
  private unsubDone: (() => void) | null = null;

  async ngOnInit() {
    this.scanPorts();

    this.unsubStarted = this.electron.onSerialStarted((handle) => {
      this.processId.set(handle.id);
    });
    this.unsubOutput = this.electron.onSerialOutput((data) => {
      this.lines.update((l) => [
        ...l,
        { text: data.text, stream: data.stream as 'stdout' | 'stderr' },
      ]);
    });
    this.unsubDone = this.electron.onSerialDone((data) => {
      const cancelled = data.signal === 'SIGTERM';
      const msg = cancelled
        ? '--- Disconnected ---\n'
        : `--- Connection lost (code ${data.code}) ---\n`;
      this.lines.update((l) => [...l, { text: msg, stream: 'system' }]);
      this.running.set(false);
      this.processId.set(null);
      this.status.set(cancelled ? 'idle' : 'error');
    });
  }

  ngOnDestroy() {
    this.unsubStarted?.();
    this.unsubOutput?.();
    this.unsubDone?.();
  }

  ngAfterViewChecked() {
    if (this.autoScroll && this.terminalEl) {
      const el = this.terminalEl.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }

  async connect() {
    const port = this.selectedPort();
    if (!port) return;
    this.running.set(true);
    this.status.set('running');
    this.lines.set([]);
    this.autoScroll = true;
    try {
      await this.electron.serialMonitor(port, this.baudRate());
    } catch (err) {
      this.lines.update((l) => [...l, { text: `Error: ${err}\n`, stream: 'system' }]);
      this.running.set(false);
      this.status.set('error');
    }
  }

  async disconnect() {
    const id = this.processId();
    if (id) await this.electron.serialCancel(id);
  }

  clear() {
    this.lines.set([]);
    this.status.set('idle');
  }

  async scanPorts() {
    this.scanning.set(true);
    try {
      const found = await this.electron.deviceListSerial();
      this.ports.set(found);
      if (found.length > 0 && !found.some(p => p.port === this.selectedPort())) {
        this.selectedPort.set(found[0].port);
      }
      if (found.length === 0) this.selectedPort.set('');
    } finally {
      this.scanning.set(false);
    }
  }

  protected toValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
