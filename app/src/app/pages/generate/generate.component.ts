import { Component, inject, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ElectronService } from '../../core/services/electron.service';
import { LibraryService } from '../../core/services/library.service';
import type { EsphomeStatus } from '../../core/models/electron-api';

interface FileEntry {
  path: string;
  description: string;
  lines: number;
}

@Component({
  selector: 'app-generate',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="p-8 max-w-4xl mx-auto">
      <!-- Header -->
      <div class="flex items-center gap-3 mb-8">
        <a [routerLink]="['/editor', configName()]" class="btn btn-ghost btn-sm gap-1">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd" />
          </svg>
          Editor
        </a>
        <h1 class="text-3xl font-bold tracking-tight">Generate & Flash</h1>
      </div>

      <!-- Step 1: Generate -->
      <div class="card bg-base-100 shadow-sm border border-base-200 mb-6">
        <div class="card-body">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="font-semibold text-lg">1. Generate Firmware</h2>
              <p class="text-sm text-base-content/50">Produce ESPHome YAML, C++ route table, and HA dashboard.</p>
            </div>
            <button
              class="btn btn-primary gap-2"
              (click)="generate()"
              [disabled]="generating()"
            >
              @if (generating()) {
                <span class="loading loading-spinner loading-sm"></span>
              }
              {{ files().length > 0 ? 'Regenerate' : 'Generate' }}
            </button>
          </div>

          @if (files().length > 0) {
            <div class="divider my-2"></div>
            <div class="overflow-x-auto">
              <table class="table table-xs">
                <thead>
                  <tr class="bg-base-200/50">
                    <th>File</th>
                    <th>Description</th>
                    <th class="text-right">Lines</th>
                  </tr>
                </thead>
                <tbody>
                  @for (f of files(); track f.path) {
                    <tr>
                      <td class="font-mono text-xs text-primary/80">{{ f.path }}</td>
                      <td class="text-xs text-base-content/60">{{ f.description }}</td>
                      <td class="text-right text-xs tabular-nums">{{ f.lines }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (outputDir()) {
              <div class="text-xs text-base-content/40 mt-2 font-mono">{{ outputDir() }}</div>
            }
          }
        </div>
      </div>

      <!-- Step 2: Compile (ESPHome required) -->
      <div class="card bg-base-100 shadow-sm border border-base-200 mb-6" [class.opacity-50]="!canCompile()">
        <div class="card-body">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="font-semibold text-lg">2. Compile</h2>
              @if (esphome()?.installed) {
                <p class="text-sm text-base-content/50">Build firmware binary using ESPHome.</p>
              } @else {
                <p class="text-sm text-warning">ESPHome not found on PATH. Install it to compile and flash.</p>
              }
            </div>
            <button
              class="btn btn-outline gap-2"
              (click)="compile()"
              [disabled]="!canCompile() || running()"
            >
              @if (running() && activeAction() === 'compile') {
                <span class="loading loading-spinner loading-sm"></span>
              }
              Compile
            </button>
          </div>
        </div>
      </div>

      <!-- Step 3: Flash (ESPHome required) -->
      <div class="card bg-base-100 shadow-sm border border-base-200 mb-6" [class.opacity-50]="!canCompile()">
        <div class="card-body">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="font-semibold text-lg">3. Flash Device</h2>
              <p class="text-sm text-base-content/50">Upload firmware via USB or OTA.</p>
            </div>
            <div class="flex gap-2">
              <button
                class="btn btn-outline gap-2"
                (click)="flash()"
                [disabled]="!canCompile() || running()"
              >
                @if (running() && activeAction() === 'flash') {
                  <span class="loading loading-spinner loading-sm"></span>
                }
                Flash (USB)
              </button>
              <button
                class="btn btn-outline btn-sm gap-1"
                (click)="flash(deviceIp())"
                [disabled]="!canCompile() || running() || !deviceIp()"
              >
                OTA
              </button>
              <input
                type="text"
                class="input input-bordered input-sm w-36 font-mono"
                placeholder="192.168.1.50"
                [value]="deviceIp()"
                (input)="deviceIp.set(toInputValue($event))"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Terminal output -->
      @if (terminalLines().length > 0) {
        <div class="card bg-neutral text-neutral-content shadow-sm mb-6">
          <div class="card-body p-0">
            <div class="flex items-center justify-between px-4 pt-3 pb-1">
              <span class="text-xs font-mono text-neutral-content/50">ESPHome Output</span>
              <button class="btn btn-ghost btn-xs text-neutral-content/50" (click)="terminalLines.set([])">Clear</button>
            </div>
            <pre class="px-4 pb-4 text-xs font-mono overflow-auto max-h-80 whitespace-pre-wrap">{{ terminalText() }}</pre>
          </div>
        </div>
      }

      <!-- Errors -->
      @if (error()) {
        <div class="alert alert-error shadow-sm">
          <span class="font-mono text-sm">{{ error() }}</span>
        </div>
      }
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
  protected esphome = signal<EsphomeStatus | null>(null);
  protected deviceIp = signal('');
  protected terminalLines = signal<string[]>([]);

  protected terminalText = computed(() => this.terminalLines().join(''));
  protected canCompile = computed(() => this.esphome()?.installed && this.files().length > 0);

  private unsubOutput: (() => void) | null = null;
  private unsubDone: (() => void) | null = null;

  async ngOnInit() {
    const name = this.route.snapshot.paramMap.get('name');
    if (!name) { this.router.navigate(['/library']); return; }
    this.configName.set(name);

    this.esphome.set(await this.electron.esphomeAvailable());

    // Subscribe to ESPHome process output
    this.unsubOutput = this.electron.onEsphomeOutput((data) => {
      this.terminalLines.update((lines) => [...lines, data.text]);
    });
    this.unsubDone = this.electron.onEsphomeDone((data) => {
      const msg = data.code === 0
        ? '\n--- Done (success) ---\n'
        : `\n--- Exited with code ${data.code} ---\n`;
      this.terminalLines.update((lines) => [...lines, msg]);
      this.running.set(false);
      this.activeAction.set(null);
    });
  }

  ngOnDestroy() {
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
      const dir = this.configName(); // e.g. "pump-controller"
      await this.electron.esphomeCompile(dir);
    } catch (err) {
      this.error.set(String(err));
      this.running.set(false);
      this.activeAction.set(null);
    }
  }

  async flash(device?: string) {
    this.running.set(true);
    this.activeAction.set('flash');
    this.terminalLines.set([]);
    this.error.set(null);
    try {
      const dir = this.configName();
      await this.electron.esphomeFlash(dir, device);
    } catch (err) {
      this.error.set(String(err));
      this.running.set(false);
      this.activeAction.set(null);
    }
  }

  protected toInputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
