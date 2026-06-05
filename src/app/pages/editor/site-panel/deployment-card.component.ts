import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { BackendService } from '../../../core/services/backend.service';

/**
 * Per-site "how your controllers connect" chooser. Two options:
 *   - MajiFlow Cloud (managed): broker autofilled from the cloud defaults, locked.
 *   - My own server (local): the installer enters the on-site broker address.
 *
 * Shows a live verdict driven by the design's cross-controller "cross-talk":
 * picking Cloud while the layout needs controllers to share data is an error
 * (that only works on your own server). Writes through WorkspaceService, which
 * autosaves and feeds the same mode into validation + firmware generation.
 */
@Component({
  selector: 'app-deployment-card',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="border-b border-base-300/30 bg-base-100 px-4 py-3">
      <div class="flex items-center gap-2 mb-3">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M12 5l7 7-7 7"/></svg>
        <span class="text-xs font-semibold text-base-content/60 uppercase tracking-wide">How your controllers connect</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-2xl">
        <!-- Cloud -->
        <button type="button" (click)="selectManaged()"
          class="text-left rounded-lg border p-3 transition-colors"
          [class]="mode() === 'managed' ? 'border-primary ring-1 ring-primary bg-primary/5' : 'border-base-300 hover:border-base-content/20'">
          <div class="flex items-center gap-2">
            <span class="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0"
              [class]="mode() === 'managed' ? 'border-primary' : 'border-base-content/30'">
              @if (mode() === 'managed') { <span class="w-1.5 h-1.5 rounded-full bg-primary"></span> }
            </span>
            <span class="font-semibold text-sm">MajiFlow Cloud</span>
            <span class="badge badge-ghost badge-xs ml-auto">Recommended</span>
          </div>
          <p class="text-xs text-base-content/50 mt-1.5 pl-5.5">Online, hosted by us. Lowest cost, nothing to run. Each controller works on its own.</p>
        </button>

        <!-- Local -->
        <button type="button" (click)="selectLocal()"
          class="text-left rounded-lg border p-3 transition-colors"
          [class]="mode() === 'local' ? 'border-primary ring-1 ring-primary bg-primary/5' : 'border-base-300 hover:border-base-content/20'">
          <div class="flex items-center gap-2">
            <span class="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0"
              [class]="mode() === 'local' ? 'border-primary' : 'border-base-content/30'">
              @if (mode() === 'local') { <span class="w-1.5 h-1.5 rounded-full bg-primary"></span> }
            </span>
            <span class="font-semibold text-sm">My own server</span>
          </div>
          <p class="text-xs text-base-content/50 mt-1.5 pl-5.5">An on-site box on your network. Costs more, but controllers can work together and it runs without internet.</p>
        </button>
      </div>

      <!-- Server address -->
      <div class="mt-3 max-w-2xl">
        @if (mode() === 'managed') {
          <div class="flex items-center gap-2 text-xs">
            <span class="text-base-content/50">Server</span>
            <span class="font-mono px-2 py-1 rounded bg-base-200 text-base-content/70">{{ cloudLabel() }}</span>
            <span class="badge badge-ghost badge-xs">managed by MajiFlow</span>
          </div>
        } @else {
          <div class="flex flex-wrap items-end gap-2">
            <label class="form-control">
              <span class="text-[11px] text-base-content/50 mb-0.5">On-site server address</span>
              <input type="text" class="input input-bordered input-sm w-56 font-mono"
                placeholder="majiflow.local or 192.168.1.50"
                [ngModel]="localHost()" (ngModelChange)="localHost.set($event)" (blur)="commitLocal()" />
            </label>
            <label class="form-control">
              <span class="text-[11px] text-base-content/50 mb-0.5">Port</span>
              <input type="number" class="input input-bordered input-sm w-20 font-mono"
                [ngModel]="localPort()" (ngModelChange)="localPort.set($event)" (blur)="commitLocal()" />
            </label>
            <label class="label cursor-pointer gap-1.5 pb-1.5">
              <input type="checkbox" class="checkbox checkbox-sm"
                [ngModel]="localTls()" (ngModelChange)="localTls.set($event); commitLocal()" />
              <span class="text-xs">TLS</span>
            </label>
          </div>
        }
      </div>

      <!-- Live verdict -->
      <div class="mt-3 max-w-2xl">
        @if (verdict(); as v) {
          <div class="flex items-start gap-2 text-xs rounded-lg px-3 py-2"
            [class]="v.kind === 'error' ? 'bg-error/10 text-error' : v.kind === 'warn' ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 mt-px" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              @if (v.kind === 'ok') {
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
              } @else {
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              }
            </svg>
            <span>{{ v.text }}</span>
          </div>
        }
      </div>
    </div>
  `,
})
export class DeploymentCardComponent implements OnInit {
  private workspace = inject(WorkspaceService);
  private backend = inject(BackendService);

  protected mode = this.workspace.deploymentMode;
  protected crossTalk = this.workspace.crossTalk;

  private cloud = signal<{ host: string; port: number; tls: boolean } | null>(null);
  protected localHost = signal('');
  protected localPort = signal(8883);
  protected localTls = signal(false);

  protected cloudLabel = computed(() => {
    const c = this.cloud();
    if (!c) return 'mqtt.majiflow.io:8883 (TLS)';
    return `${c.host}:${c.port}${c.tls ? ' (TLS)' : ''}`;
  });

  async ngOnInit(): Promise<void> {
    this.cloud.set(await this.backend.cloudBrokerDefaults());
    const d = this.workspace.deployment();
    if (d?.mode === 'local') {
      this.localHost.set(d.brokerHost);
      this.localPort.set(d.brokerPort || 8883);
      this.localTls.set(d.brokerTls);
    }
  }

  protected selectManaged(): void {
    this.workspace.setDeployment({ mode: 'managed', brokerHost: '', brokerPort: 0, brokerTls: true });
  }

  protected selectLocal(): void {
    this.workspace.setDeployment({
      mode: 'local',
      brokerHost: this.localHost().trim(),
      brokerPort: this.localPort() || 8883,
      brokerTls: this.localTls(),
    });
  }

  protected commitLocal(): void {
    if (this.mode() !== 'local') return;
    this.selectLocal();
  }

  protected verdict = computed<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(() => {
    const ct = this.crossTalk();
    if (this.mode() === 'managed') {
      if (ct?.hasCrossTalk) {
        const parts: string[] = [];
        const n = ct.spanningRoutes.length;
        if (n) parts.push(`${n} route${n !== 1 ? 's' : ''} cross between controllers`);
        if (ct.importCount) parts.push(`${ct.importCount} shared sensor${ct.importCount !== 1 ? 's' : ''}`);
        return {
          kind: 'error',
          text: `This design needs your controllers to share data (${parts.join(', ')}). That only works with “My own server”. Switch to it, or remove the cross-controller links.`,
        };
      }
      return { kind: 'ok', text: 'Ready for the cloud. Each controller runs on its own.' };
    }
    // local
    if (!this.localHost().trim()) {
      return { kind: 'warn', text: 'Enter your on-site server address so the controllers know where to connect.' };
    }
    return {
      kind: 'ok',
      text: ct?.hasCrossTalk ? 'Your controllers can share data and work together.' : 'Running on your own on-site server.',
    };
  });
}
