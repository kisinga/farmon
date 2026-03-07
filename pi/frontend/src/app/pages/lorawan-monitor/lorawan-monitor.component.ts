import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ApiService, PipelineDebug, RawLorawanFrame, LorawanStats } from '../../core/services/api.service';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-lorawan-monitor',
  standalone: true,
  imports: [DatePipe, RouterLink],
  template: `
    <header class="page-header">
      <h1 class="page-title">LoRaWAN</h1>
      <p class="page-description">
        Raw frames and concentratord connection status. Frames are kept in a ring buffer (max 500). Use this page to verify uplinks and downlinks.
      </p>
    </header>

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

    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <button
        type="button"
        class="btn btn-sm"
        [class.btn-primary]="!paused()"
        [class.btn-ghost]="paused()"
        (click)="togglePause()"
      >
        {{ paused() ? 'Resume' : 'Pause' }} auto-refresh
      </button>
      <button type="button" class="btn btn-sm btn-outline" (click)="refresh()">Refresh now</button>
      <button type="button" class="btn btn-sm btn-outline btn-error" (click)="clearFrames()">Clear buffer</button>
      <span class="text-sm text-base-content/50 ml-1">Every {{ refreshIntervalSec }}s when not paused</span>
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
  `,
})
export class LorawanMonitorComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private intervalId: ReturnType<typeof setInterval> | null = null;

  readonly refreshIntervalSec = 3;

  pipeline = signal<PipelineDebug | null>(null);
  pipelineError = signal<string | null>(null);
  stats = signal<LorawanStats | null>(null);
  statsError = signal<string | null>(null);
  frames = signal<RawLorawanFrame[]>([]);
  framesError = signal<string | null>(null);
  loading = signal(false);
  paused = signal(false);

  ngOnInit(): void {
    this.refresh();
    this.intervalId = setInterval(() => {
      if (!this.paused()) this.refresh();
    }, this.refreshIntervalSec * 1000);
  }

  ngOnDestroy(): void {
    if (this.intervalId != null) clearInterval(this.intervalId);
  }

  togglePause(): void {
    this.paused.update((v) => !v);
  }

  refresh(): void {
    this.loading.set(true);
    this.pipelineError.set(null);
    this.statsError.set(null);
    this.framesError.set(null);
    forkJoin({
      pipeline: this.api.getPipelineDebug(),
      stats: this.api.getLorawanStats(),
      frames: this.api.getLorawanFrames(200),
    }).subscribe({
      next: ({ pipeline, stats, frames }) => {
        this.pipeline.set(pipeline);
        this.stats.set(stats);
        this.frames.set(frames?.frames ?? []);
        this.loading.set(false);
      },
      error: (err) => {
        this.pipelineError.set(err?.message ?? 'Failed to load pipeline');
        this.statsError.set(err?.message ?? 'Failed to load stats');
        this.framesError.set(err?.message ?? 'Failed to load frames');
        this.loading.set(false);
      },
    });
  }

  clearFrames(): void {
    this.api.clearLorawanFrames().subscribe({
      next: () => this.refresh(),
      error: (err) => this.framesError.set(err?.message ?? 'Failed to clear'),
    });
  }
}
