import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ApiService, PipelineDebug, RawLorawanFrame, LorawanStats, GatewaySettings } from '../../core/services/api.service';
import { PocketBaseService } from '../../core/services/pocketbase.service';
import { DatePipe, DecimalPipe, JsonPipe, SlicePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

/** Map a PocketBase lorawan_frames record to RawLorawanFrame for the table. */
function recordToFrame(r: Record<string, unknown>): RawLorawanFrame {
  let decoded: Record<string, unknown> | undefined;
  if (typeof r?.['decoded_json'] === 'string' && r['decoded_json']) {
    try { decoded = JSON.parse(r['decoded_json'] as string); } catch {}
  } else if (typeof r?.['decoded_json'] === 'object' && r['decoded_json']) {
    decoded = r['decoded_json'] as Record<string, unknown>;
  }
  return {
    time: (r?.['time'] as string) ?? '',
    direction: (r?.['direction'] === 'down' ? 'down' : 'up') as 'up' | 'down',
    dev_eui: (r?.['dev_eui'] as string) ?? '',
    f_port: typeof r?.['f_port'] === 'number' ? r['f_port'] : 0,
    kind: (r?.['kind'] as string) ?? '',
    payload_hex: (r?.['payload_hex'] as string) ?? '',
    phy_len: typeof r?.['phy_len'] === 'number' ? r['phy_len'] : 0,
    rssi: typeof r?.['rssi'] === 'number' ? r['rssi'] : undefined,
    snr: typeof r?.['snr'] === 'number' ? r['snr'] : undefined,
    gateway_id: (r?.['gateway_id'] as string) ?? '',
    error: (r?.['error'] as string) ?? '',
    decoded_json: decoded,
  };
}

type TransportFilter = 'all' | 'lorawan' | 'wifi';

function getTransport(kind: string): 'lorawan' | 'wifi' {
  return kind === 'wifi' ? 'wifi' : 'lorawan';
}

@Component({
  selector: 'app-lorawan-monitor',
  standalone: true,
  imports: [DatePipe, DecimalPipe, JsonPipe, SlicePipe, RouterLink],
  template: `
    <header class="page-header">
      <div>
        <h1 class="page-title">Network Traffic</h1>
        <p class="page-description">
          All network frames across transports (max 500, newest first).
        </p>
      </div>
    </header>

    <!-- Per-transport stats -->
    <div class="stats stats-vertical md:stats-horizontal w-full shadow-sm bg-base-100 rounded-2xl border border-base-300 mb-6">
      <!-- LoRaWAN status -->
      <div class="stat place-items-center md:place-items-start">
        <div class="stat-title">LoRaWAN</div>
        <div class="stat-value text-2xl">
          @if (pipeline(); as p) {
            @if (gatewaySettings()?.test_mode) {
              <span class="text-warning">Test mode</span>
            } @else if (p.concentratord_configured) {
              <span class="text-success">Connected</span>
            } @else {
              <span class="text-base-content/40">Off</span>
            }
          } @else {
            <span class="loading loading-spinner loading-sm"></span>
          }
        </div>
        @if (pipeline(); as p) {
          @if (p.gateway_id) {
            <div class="stat-desc font-mono text-xs">{{ p.gateway_id }}</div>
          }
        }
      </div>

      <!-- WiFi status -->
      <div class="stat place-items-center md:place-items-start">
        <div class="stat-title">WiFi</div>
        <div class="stat-value text-2xl text-success">Active</div>
        <div class="stat-desc font-mono text-xs truncate max-w-[14rem]" [title]="ingestUrl">POST {{ ingestUrl }}/api/farmon/ingest</div>
      </div>

      <!-- Frame counts -->
      @if (stats(); as s) {
        <div class="stat place-items-center md:place-items-start">
          <div class="stat-title">Frames</div>
          <div class="stat-value text-2xl">{{ s.buffer_size }}</div>
          <div class="stat-desc">{{ s.total_uplinks }} up, {{ s.total_downlinks }} down</div>
        </div>
      }

      <!-- Live indicator -->
      <div class="stat place-items-center md:place-items-start">
        <div class="stat-title">Realtime</div>
        <div class="stat-value text-2xl flex items-center gap-2">
          <span class="inline-block w-2.5 h-2.5 rounded-full bg-success animate-pulse"></span>
          Live
        </div>
        <div class="stat-desc">Auto-updating via websocket</div>
      </div>
    </div>

    <!-- Filter pills + table -->
    <div class="card-elevated">
      <div class="card-body-spaced">
        <!-- Transport filter pills -->
        <div class="flex items-center gap-2 mb-4">
          <span class="text-sm font-medium text-base-content/60 mr-1">Filter:</span>
          @for (f of filterOptions; track f.value) {
            <button
              class="btn btn-xs rounded-lg"
              [class.btn-primary]="transportFilter() === f.value"
              [class.btn-ghost]="transportFilter() !== f.value"
              (click)="transportFilter.set(f.value)"
            >
              {{ f.label }}
              @if (f.value !== 'all') {
                <span class="badge badge-xs ml-0.5"
                  [class.badge-primary]="transportFilter() === f.value"
                  [class.badge-ghost]="transportFilter() !== f.value"
                >{{ f.value === 'lorawan' ? lorawanCount() : wifiCount() }}</span>
              }
            </button>
          }
        </div>

        @if (framesError()) {
          <div class="alert alert-error rounded-xl">{{ framesError() }}</div>
        } @else if (filteredFrames().length === 0 && !loading()) {
          <div class="flex flex-col items-center justify-center py-12 text-center">
            <p class="text-base-content/60">No frames yet.</p>
            <p class="text-sm text-base-content/50 mt-1">Send an uplink or downlink to see entries here.</p>
            <a routerLink="/" class="link link-primary mt-2">View devices</a>
          </div>
        } @else {
          <div class="overflow-x-auto max-h-[60vh] overflow-y-auto rounded-xl border border-base-300">
            <table class="table table-zebra table-pin-rows table-xs md:table-sm">
              <thead>
                <tr class="bg-base-200/60 sticky top-0 z-10">
                  <th class="font-semibold">Time</th>
                  <th class="font-semibold">Transport</th>
                  <th class="font-semibold">Dir</th>
                  <th class="font-semibold">Device</th>
                  <th class="font-semibold hidden sm:table-cell">FPort</th>
                  <th class="font-semibold hidden sm:table-cell">Kind</th>
                  <th class="font-semibold hidden md:table-cell">Payload</th>
                  <th class="font-semibold hidden lg:table-cell">Decoded</th>
                  <th class="font-semibold hidden md:table-cell">RSSI</th>
                  <th class="font-semibold hidden md:table-cell">SNR</th>
                  <th class="font-semibold">Error</th>
                </tr>
              </thead>
              <tbody>
                @for (f of filteredFrames(); track f.time + f.payload_hex + f.direction) {
                  <tr class="hover">
                    <td class="whitespace-nowrap font-mono text-xs">{{ f.time | date:'short' }}</td>
                    <td>
                      <span
                        class="badge badge-xs"
                        [class.badge-primary]="getTransport(f.kind) === 'lorawan'"
                        [class.badge-secondary]="getTransport(f.kind) === 'wifi'"
                      >
                        {{ getTransport(f.kind) === 'wifi' ? 'WiFi' : 'LoRa' }}
                      </span>
                    </td>
                    <td>
                      <span
                        class="badge badge-xs"
                        [class.badge-info]="f.direction === 'up'"
                        [class.badge-accent]="f.direction === 'down'"
                      >
                        {{ f.direction === 'up' ? '\u2191' : '\u2193' }}
                      </span>
                    </td>
                    <td class="font-mono text-xs">
                      @if (f.dev_eui) {
                        <a [routerLink]="['/device', f.dev_eui]" class="link link-hover">{{ f.dev_eui | slice:-8 }}</a>
                      } @else {
                        <span class="text-base-content/30">\u2014</span>
                      }
                    </td>
                    <td class="hidden sm:table-cell">{{ f.f_port }}</td>
                    <td class="hidden sm:table-cell"><span class="badge badge-ghost badge-xs">{{ f.kind }}</span></td>
                    <td class="font-mono text-xs max-w-[8rem] truncate hidden md:table-cell" [title]="f.payload_hex">{{ f.payload_hex || '\u2014' }}</td>
                    <td class="hidden lg:table-cell max-w-[14rem]">
                      @if (f.decoded_json) {
                        <div class="flex flex-wrap gap-0.5">
                          @for (entry of objectEntries(f.decoded_json); track entry[0]) {
                            <span class="badge badge-ghost badge-xs font-mono">{{ entry[0] }}:{{ formatValue(entry[1]) }}</span>
                          }
                          @if (objectKeys(f.decoded_json).length > 4) {
                            <span class="badge badge-ghost badge-xs cursor-help" [title]="f.decoded_json | json">+{{ objectKeys(f.decoded_json).length - 4 }}</span>
                          }
                        </div>
                      } @else {
                        <span class="text-base-content/30">\u2014</span>
                      }
                    </td>
                    <td class="hidden md:table-cell">{{ f.rssi ?? '\u2014' }}</td>
                    <td class="hidden md:table-cell">{{ f.snr != null ? (f.snr | number:'1.1-1') : '\u2014' }}</td>
                    <td>
                      @if (f.error) {
                        <span class="text-error text-xs max-w-[6rem] truncate inline-block" [title]="f.error">{{ f.error }}</span>
                      } @else {
                        <span class="text-base-content/30">\u2014</span>
                      }
                    </td>
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
  `,
})
export class LorawanMonitorComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private pb = inject(PocketBaseService).pb;

  pipeline = signal<PipelineDebug | null>(null);
  stats = signal<LorawanStats | null>(null);
  frames = signal<RawLorawanFrame[]>([]);
  framesError = signal<string | null>(null);
  loading = signal(false);
  gatewaySettings = signal<GatewaySettings | null>(null);
  transportFilter = signal<TransportFilter>('all');
  ingestUrl = window.location.origin;

  readonly filterOptions: { value: TransportFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'lorawan', label: 'LoRaWAN' },
    { value: 'wifi', label: 'WiFi' },
  ];

  filteredFrames = computed(() => {
    const filter = this.transportFilter();
    const all = this.frames();
    if (filter === 'all') return all;
    return all.filter((f) => getTransport(f.kind) === filter);
  });

  lorawanCount = computed(() => this.frames().filter((f) => getTransport(f.kind) === 'lorawan').length);
  wifiCount = computed(() => this.frames().filter((f) => getTransport(f.kind) === 'wifi').length);

  getTransport = getTransport;

  private unsubscribeFrames: (() => void) | null = null;
  private unsubscribeFramesPromise: Promise<unknown> | null = null;

  ngOnInit(): void {
    this.loading.set(true);
    this.framesError.set(null);

    forkJoin({
      pipeline: this.api.getPipelineDebug(),
      stats: this.api.getLorawanStats(),
      settings: this.api.getGatewaySettings(),
    }).subscribe({
      next: ({ pipeline, stats, settings }) => {
        this.pipeline.set(pipeline);
        this.stats.set(stats);
        this.gatewaySettings.set(settings);
      },
      error: () => {},
    });

    this.api.getLorawanFrames(200).subscribe({
      next: (list) => {
        this.frames.set(list);
        this.framesError.set(null);
        this.loading.set(false);
      },
      error: (err) => {
        const msg = err?.error?.error ?? err?.message ?? 'Failed to load frames';
        this.framesError.set(msg);
        this.loading.set(false);
      },
    });

    this.unsubscribeFramesPromise = this.pb.collection('lorawan_frames').subscribe('*', (e) => {
      if (e.action === 'create' && e.record) {
        const f = recordToFrame(e.record as Record<string, unknown>);
        this.frames.update((prev) => [f, ...prev]);
        this.stats.update((s) =>
          s
            ? {
                ...s,
                buffer_size: s.buffer_size + 1,
                total_uplinks: f.direction === 'up' ? s.total_uplinks + 1 : s.total_uplinks,
                total_downlinks: f.direction === 'down' ? s.total_downlinks + 1 : s.total_downlinks,
              }
            : s,
        );
      }
      if (e.action === 'update' && e.record) {
        // Frame was patched with decoded_json after decode
        const updated = recordToFrame(e.record as Record<string, unknown>);
        this.frames.update((prev) =>
          prev.map((f) =>
            f.time === updated.time && f.dev_eui === updated.dev_eui && f.direction === updated.direction
              ? updated
              : f,
          ),
        );
      }
    });
    this.unsubscribeFramesPromise?.then((unsub) => {
      this.unsubscribeFrames = unsub as () => void;
    });
  }

  ngOnDestroy(): void {
    if (this.unsubscribeFrames) {
      this.unsubscribeFrames();
      this.unsubscribeFrames = null;
    } else if (this.unsubscribeFramesPromise) {
      this.unsubscribeFramesPromise.then((unsub) => (unsub as () => void)());
    }
  }

  objectEntries(obj: Record<string, unknown>): [string, unknown][] {
    return Object.entries(obj).slice(0, 4);
  }

  objectKeys(obj: Record<string, unknown>): string[] {
    return Object.keys(obj);
  }

  formatValue(v: unknown): string {
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
    if (typeof v === 'string') return v;
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return JSON.stringify(v);
  }
}
