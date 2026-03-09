import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ApiService, PipelineDebug, RawLorawanFrame, LorawanStats, GatewaySettings } from '../../core/services/api.service';
import { PocketBaseService } from '../../core/services/pocketbase.service';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { GatewaySettingsComponent } from '../gateway-settings/gateway-settings.component';

/** Map a PocketBase lorawan_frames record to RawLorawanFrame for the table. */
function recordToFrame(r: { time?: string; direction?: string; dev_eui?: string; f_port?: number; kind?: string; payload_hex?: string; phy_len?: number; rssi?: number; snr?: number; gateway_id?: string; error?: string }): RawLorawanFrame {
  return {
    time: r?.time ?? '',
    direction: (r?.direction === 'down' ? 'down' : 'up') as 'up' | 'down',
    dev_eui: r?.dev_eui ?? '',
    f_port: typeof r?.f_port === 'number' ? r.f_port : 0,
    kind: r?.kind ?? '',
    payload_hex: r?.payload_hex ?? '',
    phy_len: typeof r?.phy_len === 'number' ? r.phy_len : 0,
    rssi: typeof r?.rssi === 'number' ? r.rssi : undefined,
    snr: typeof r?.snr === 'number' ? r.snr : undefined,
    gateway_id: r?.gateway_id ?? '',
    error: r?.error ?? '',
  };
}

@Component({
  selector: 'app-lorawan-monitor',
  standalone: true,
  imports: [DatePipe, RouterLink, GatewaySettingsComponent],
  template: `
    <header class="page-header">
      <h1 class="page-title">LoRaWAN</h1>
      <p class="page-description">
        Raw frames and concentratord connection status. Frames are persisted (max 500). Use this page to verify uplinks and downlinks.
      </p>
    </header>

    @if (pipelineError() || statsError()) {
      <div class="alert alert-warning rounded-xl mb-6">
        {{ pipelineError() || statsError() }}
      </div>
    }

    <!-- Stats: DaisyUI stats -->
    <div class="stats stats-vertical md:stats-horizontal w-full shadow-sm bg-base-100 rounded-2xl border border-base-200 mb-6">
      @if (pipeline(); as p) {
        <div class="stat place-items-center md:place-items-start">
          <div class="stat-title">Pipeline</div>
          <div class="stat-value text-2xl">
            @if (p.concentratord_configured) {
              <span class="text-success">Connected</span>
            } @else {
              <span class="text-base-content/60">Not configured</span>
            }
          </div>
          @if (!p.concentratord_configured) {
            <div class="stat-desc text-base-content/60 text-sm">Save gateway settings below (event URL, command URL, region) to connect.</div>
          }
          @if (p.gateway_id) {
            <div class="stat-desc font-mono text-xs">{{ p.gateway_id }}</div>
          }
        </div>
      }
      @if (stats(); as s) {
        <div class="stat place-items-center md:place-items-start">
          <div class="stat-title">Buffer</div>
          <div class="stat-value text-2xl">{{ s.buffer_size }}</div>
          <div class="stat-desc">frames ({{ s.total_uplinks }} up, {{ s.total_downlinks }} down)</div>
        </div>
      }
      <div class="stat place-items-center md:place-items-start">
        <div class="stat-title">ZMQ</div>
        @if (pipeline(); as p) {
          @if (p.event_url) {
            <div class="stat-desc font-mono text-xs truncate max-w-full" [title]="p.event_url">Event: {{ p.event_url }}</div>
          }
          @if (p.command_url) {
            <div class="stat-desc font-mono text-xs truncate max-w-full" [title]="p.command_url">Command: {{ p.command_url }}</div>
          }
        }
      </div>
    </div>

    <!-- Frames table -->
    <div class="card-elevated">
      <div class="card-body-spaced">
        <h2 class="section-title">Raw frames (newest first)</h2>
        @if (framesError()) {
          <div class="alert alert-error rounded-xl">{{ framesError() }}</div>
        } @else if (frames().length === 0 && !loading()) {
          <div class="flex flex-col items-center justify-center py-12 text-center">
            <p class="text-base-content/60">No frames yet.</p>
            <p class="text-sm text-base-content/50 mt-1">Send an uplink or downlink to see entries here.</p>
            <a routerLink="/" class="link link-primary mt-2">View devices</a>
          </div>
        } @else {
          <div class="overflow-x-auto max-h-[55vh] overflow-y-auto rounded-xl border border-base-200">
            <table class="table table-zebra table-pin-rows">
              <thead>
                <tr class="bg-base-200/60 sticky top-0 z-10">
                  <th class="font-semibold">Time (UTC)</th>
                  <th class="font-semibold">Dir</th>
                  <th class="font-semibold">Dev EUI</th>
                  <th class="font-semibold">FPort</th>
                  <th class="font-semibold">Kind</th>
                  <th class="font-semibold">Payload (hex)</th>
                  <th class="font-semibold">RSSI</th>
                  <th class="font-semibold">SNR</th>
                  <th class="font-semibold hidden lg:table-cell">Gateway</th>
                  <th class="font-semibold">Error</th>
                </tr>
              </thead>
              <tbody>
                @for (f of frames(); track f.time + f.payload_hex + f.direction) {
                  <tr class="hover">
                    <td class="whitespace-nowrap font-mono text-xs">{{ f.time | date:'short' }}</td>
                    <td>
                      <span
                        class="badge badge-sm"
                        [class.badge-info]="f.direction === 'up'"
                        [class.badge-secondary]="f.direction === 'down'"
                      >
                        {{ f.direction }}
                      </span>
                    </td>
                    <td class="font-mono text-xs">{{ f.dev_eui || '—' }}</td>
                    <td>{{ f.f_port }}</td>
                    <td><span class="badge badge-ghost badge-sm">{{ f.kind }}</span></td>
                    <td class="font-mono text-xs max-w-[10rem] truncate" [title]="f.payload_hex">{{ f.payload_hex || '—' }}</td>
                    <td>{{ f.rssi ?? '—' }}</td>
                    <td>{{ f.snr ?? '—' }}</td>
                    <td class="font-mono text-xs hidden lg:table-cell">{{ f.gateway_id || '—' }}</td>
                    <td class="text-error text-xs max-w-[8rem] truncate" [title]="f.error">{{ f.error || '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        @if (loading()) {
          <div class="flex justify-center py-4">
            <span class="loading loading-spinner loading-md text-primary"></span>
          </div>
        }
      </div>
    </div>

    <!-- Gateway configuration (collapsible; default open when no saved config) -->
    <div class="collapse collapse-arrow bg-base-100 border border-base-200 rounded-2xl mt-6">
      <input type="checkbox" [checked]="configPanelOpen()" (change)="configPanelOpen.set($any($event.target).checked)" />
      <div class="collapse-title font-semibold text-lg">
        Gateway configuration
      </div>
      <div class="collapse-content">
        @if (gatewaySettings()) {
          <app-gateway-settings
            [embedded]="true"
            [initialSettings]="gatewaySettings()!"
            (gatewaySaved)="onGatewaySaved($event)"
          />
        } @else {
          <div class="flex justify-center py-6">
            <span class="loading loading-spinner loading-md text-primary"></span>
          </div>
        }
      </div>
    </div>
  `,
})
export class LorawanMonitorComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private pb = inject(PocketBaseService).pb;

  pipeline = signal<PipelineDebug | null>(null);
  pipelineError = signal<string | null>(null);
  stats = signal<LorawanStats | null>(null);
  statsError = signal<string | null>(null);
  frames = signal<RawLorawanFrame[]>([]);
  framesError = signal<string | null>(null);
  loading = signal(false);

  gatewaySettings = signal<GatewaySettings | null>(null);
  configPanelOpen = signal(true);

  private unsubscribeFrames: (() => void) | null = null;
  private unsubscribeFramesPromise: Promise<unknown> | null = null;

  ngOnInit(): void {
    this.loading.set(true);
    this.pipelineError.set(null);
    this.statsError.set(null);
    this.framesError.set(null);

    forkJoin({
      pipeline: this.api.getPipelineDebug(),
      stats: this.api.getLorawanStats(),
    }).subscribe({
      next: ({ pipeline, stats }) => {
        this.pipeline.set(pipeline);
        this.stats.set(stats);
      },
      error: (err) => {
        this.pipelineError.set(err?.message ?? 'Failed to load');
        this.statsError.set(err?.message ?? 'Failed to load');
      },
    });

    this.pb.collection('lorawan_frames').getList(1, 200, { sort: '-created' }).then(
      (res) => {
        const list = (res.items ?? []).map((r: Record<string, unknown>) => recordToFrame(r as Parameters<typeof recordToFrame>[0]));
        this.frames.set(list);
        this.loading.set(false);
      },
      (err) => {
        const msg = err?.message ?? 'Failed to load frames';
        // Only show "collection missing" when the error clearly indicates that; otherwise show the real error
        const actionable = /Missing collection context|collection context/i.test(msg)
          ? 'LoRaWAN frames collection is missing. Restart the backend so migrations run (pb_migrations), or check the server logs.'
          : msg;
        this.framesError.set(actionable);
        this.loading.set(false);
      }
    );

    this.unsubscribeFramesPromise = this.pb.collection('lorawan_frames').subscribe('*', (e) => {
      if (e.action === 'create' && e.record) {
        const f = recordToFrame(e.record as Parameters<typeof recordToFrame>[0]);
        this.frames.update((prev) => [f, ...prev]);
        this.stats.update((s) =>
          s
            ? {
                ...s,
                buffer_size: s.buffer_size + 1,
                total_uplinks: f.direction === 'up' ? s.total_uplinks + 1 : s.total_uplinks,
                total_downlinks: f.direction === 'down' ? s.total_downlinks + 1 : s.total_downlinks,
              }
            : s
        );
      }
    });
    this.unsubscribeFramesPromise?.then((unsub) => {
      this.unsubscribeFrames = unsub as () => void;
    });

    this.api.getGatewaySettings().subscribe({
      next: (res) => {
        this.gatewaySettings.set(res);
        this.configPanelOpen.set(!res.saved);
      },
      error: () => {
        this.gatewaySettings.set(null);
      },
    });
  }

  onGatewaySaved(settings: GatewaySettings): void {
    this.gatewaySettings.set(settings);
    this.configPanelOpen.set(false);
  }

  ngOnDestroy(): void {
    if (this.unsubscribeFrames) {
      this.unsubscribeFrames();
      this.unsubscribeFrames = null;
    } else if (this.unsubscribeFramesPromise) {
      this.unsubscribeFramesPromise.then((unsub) => (unsub as () => void)());
    }
  }
}
