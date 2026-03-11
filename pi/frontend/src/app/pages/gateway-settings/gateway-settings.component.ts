import { Component, inject, signal, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService, GatewaySettings } from '../../core/services/api.service';

const REGIONS = [
  { value: 'EU868', label: 'EU868', desc: '868 MHz (Europe)' },
  { value: 'US915', label: 'US915', desc: '902–928 MHz (Americas)' },
];

@Component({
  selector: 'app-gateway-settings',
  standalone: true,
  imports: [RouterLink, FormsModule],
  template: `
    @if (!embedded) {
      <header class="page-header">
        <div>
          <h1 class="page-title">Gateway settings</h1>
          <p class="page-description">
            Configure the LoRaWAN gateway. Save valid settings to enable the concentratord pipeline and start receiving uplinks.
          </p>
        </div>
        <a routerLink="/" class="btn btn-ghost btn-sm">← Back</a>
      </header>
    }

    @if (loading()) {
      <div class="flex justify-center py-12">
        <span class="loading loading-spinner loading-lg text-primary"></span>
      </div>
    } @else {
      @if (!saved()) {
        <div class="alert alert-info rounded-xl mb-6">
          <span>Save the form below to enable the gateway and start receiving uplinks.</span>
        </div>
      }

      <div class="alert alert-info rounded-xl mb-6">
        <span>Set event URL, command URL, and region only. <strong>Gateway ID is autodiscovered</strong> when the pipeline connects to concentratord and cannot be edited.</span>
      </div>

      <div class="card-elevated max-w-2xl">
        <div class="card-body-spaced">
          <form (ngSubmit)="save()" class="space-y-6">
            <!-- Region (frequency band) first -->
            <div class="form-control w-full">
              <label class="label" for="region">
                <span class="label-text font-semibold">Frequency band</span>
              </label>
              <select
                id="region"
                name="region"
                class="select select-bordered w-full"
                [(ngModel)]="form.region"
                required
              >
                @for (r of regions; track r.value) {
                  <option [value]="r.value">{{ r.label }} — {{ r.desc }}</option>
                }
              </select>
              <p class="text-sm text-base-content/60 mt-1">Primary setting; determines channel set and region profile.</p>
            </div>

            <div class="form-control w-full">
              <label class="label" for="event_url">
                <span class="label-text font-semibold">Event URL</span>
              </label>
              <input
                id="event_url"
                name="event_url"
                type="text"
                class="input input-bordered w-full font-mono text-sm"
                placeholder="ipc:///tmp/concentratord_event"
                [(ngModel)]="form.event_url"
                required
              />
              <p class="text-sm text-base-content/60 mt-1">ZMQ SUB bind for concentratord uplink events (e.g. ipc:// or tcp://).</p>
            </div>

            <div class="form-control w-full">
              <label class="label" for="command_url">
                <span class="label-text font-semibold">Command URL</span>
              </label>
              <input
                id="command_url"
                name="command_url"
                type="text"
                class="input input-bordered w-full font-mono text-sm"
                placeholder="ipc:///tmp/concentratord_command"
                [(ngModel)]="form.command_url"
                required
              />
              <p class="text-sm text-base-content/60 mt-1">ZMQ REQ bind for concentratord commands (downlink, config).</p>
            </div>

            <div class="form-control w-full">
              <label class="label">
                <span class="label-text font-semibold">Gateway ID</span>
              </label>
              <div class="rounded-lg bg-base-200 px-3 py-2 font-mono text-sm">
                {{ form.gateway_id || '—' }}
              </div>
              <p class="text-sm text-base-content/60 mt-1">Autodiscovered from concentratord when the pipeline is connected. You cannot set this; it appears after the gateway is running.</p>
            </div>

            <div class="form-control w-full max-w-xs">
              <label class="label" for="rx1_delay">
                <span class="label-text font-semibold">RX1 delay (seconds)</span>
              </label>
              <input
                id="rx1_delay"
                name="rx1_delay"
                type="number"
                min="1"
                max="15"
                class="input input-bordered w-full"
                [(ngModel)]="form.rx1_delay"
              />
              <p class="text-sm text-base-content/60 mt-1">Class A RX1 delay (1–15).</p>
            </div>

            <div class="form-control w-full max-w-xs">
              <label class="label" for="rx1_frequency_hz">
                <span class="label-text font-semibold">RX1 frequency override (Hz)</span>
              </label>
              <input
                id="rx1_frequency_hz"
                name="rx1_frequency_hz"
                type="number"
                min="0"
                class="input input-bordered w-full"
                placeholder="0 = use region default"
                [(ngModel)]="form.rx1_frequency_hz"
              />
            </div>

            @if (saveError()) {
              <div class="alert alert-error rounded-xl">
                <span>{{ saveError() }}</span>
              </div>
            }
            @if (saveSuccess()) {
              <div class="alert alert-success rounded-xl">
                <span>Gateway settings saved. Pipeline {{ saved() ? 'restarted' : 'started' }}.</span>
              </div>
            }

            <div class="flex flex-wrap gap-3 pt-2">
              <button
                type="submit"
                class="btn btn-primary"
                [disabled]="!canSave() || saving()"
              >
                @if (saving()) {
                  <span class="loading loading-spinner loading-sm"></span>
                  Saving…
                } @else {
                  Save
                }
              </button>
              <button
                type="button"
                class="btn btn-ghost"
                [disabled]="refreshing()"
                (click)="refresh()"
              >
                @if (refreshing()) {
                  <span class="loading loading-spinner loading-sm"></span>
                  Refreshing…
                } @else {
                  Refresh
                }
              </button>
            </div>
          </form>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .page-header {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin-bottom: 1.5rem;
      }
      .page-title {
        font-size: 1.5rem;
        font-weight: 700;
      }
      .page-description {
        color: oklch(var(--bc) / 0.7);
        font-size: 0.9375rem;
        margin-top: 0.25rem;
      }
    `,
  ],
})
export class GatewaySettingsComponent implements OnInit {
  private api = inject(ApiService);

  @Input() embedded = false;
  @Input() set initialSettings(v: GatewaySettings | null) {
    if (v) {
      this.form = { ...v };
      this.saved.set(v.saved);
      this.loading.set(false);
    }
  }
  @Output() gatewaySaved = new EventEmitter<GatewaySettings>();

  regions = REGIONS;
  loading = signal(true);
  refreshing = signal(false);
  saving = signal(false);
  saveError = signal<string | null>(null);
  saveSuccess = signal(false);
  saved = signal(false);

  form: GatewaySettings = {
    region: 'US915',
    event_url: 'ipc:///tmp/concentratord_event',
    command_url: 'ipc:///tmp/concentratord_command',
    gateway_id: '',
    rx1_delay: 1,
    rx1_frequency_hz: 0,
    saved: false,
  };

  ngOnInit() {
    if (!this.embedded) {
      this.loadSettings();
    }
  }

  refresh() {
    this.refreshing.set(true);
    this.api.getGatewaySettings().subscribe({
      next: (res) => {
        this.form = { ...res };
        this.saved.set(res.saved);
        this.refreshing.set(false);
      },
      error: () => {
        this.refreshing.set(false);
      },
    });
  }

  private loadSettings() {
    this.api.getGatewaySettings().subscribe({
      next: (res) => {
        this.form = { ...res };
        this.saved.set(res.saved);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  canSave(): boolean {
    const r = this.form.region?.trim();
    const e = this.form.event_url?.trim();
    const c = this.form.command_url?.trim();
    const d = this.form.rx1_delay;
    return !!(r && e && c && d >= 1 && d <= 15);
  }

  save() {
    if (!this.canSave() || this.saving()) return;
    this.saveError.set(null);
    this.saveSuccess.set(false);
    this.saving.set(true);
    const payload = {
      region: this.form.region.trim(),
      event_url: this.form.event_url.trim(),
      command_url: this.form.command_url.trim(),
      rx1_delay: Math.max(1, Math.min(15, this.form.rx1_delay ?? 1)),
      rx1_frequency_hz: this.form.rx1_frequency_hz ?? 0,
    };
    this.api.patchGatewaySettings(payload).subscribe({
      next: (res) => {
        this.form = { ...res };
        this.saved.set(true);
        this.saveSuccess.set(true);
        this.saving.set(false);
        this.gatewaySaved.emit(res);
        setTimeout(() => this.saveSuccess.set(false), 4000);
      },
      error: (err) => {
        this.saveError.set(err?.error?.error ?? err?.message ?? 'Failed to save');
        this.saving.set(false);
      },
    });
  }
}
