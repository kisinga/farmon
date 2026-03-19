import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, GatewaySettings } from '../../core/services/api.service';

const REGIONS = [
  { value: 'EU868', label: 'EU868', desc: '868 MHz (Europe)' },
  { value: 'US915', label: 'US915', desc: '902\u2013928 MHz (Americas)' },
];

@Component({
  selector: 'app-lorawan-settings',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="card bg-base-100 shadow-md h-full">
      <div class="card-body">
        <!-- Header with enabled toggle -->
        <div class="flex items-center justify-between mb-4">
          <h3 class="card-title">
            <span class="badge badge-primary">LoRaWAN</span>
          </h3>
          <label class="label cursor-pointer gap-2">
            <span class="label-text text-sm">{{ form.enabled ? 'Enabled' : 'Disabled' }}</span>
            <input
              type="checkbox"
              class="toggle toggle-primary"
              name="enabled"
              [(ngModel)]="form.enabled"
              [disabled]="loading()"
            />
          </label>
        </div>

        @if (loading()) {
          <div class="flex justify-center py-8">
            <span class="loading loading-spinner loading-lg text-primary"></span>
          </div>
        } @else {
          <div [class.opacity-50]="!form.enabled" [class.pointer-events-none]="!form.enabled">
            @if (!saved()) {
              <div class="alert alert-info rounded-xl mb-4">
                <span>Save the form below to enable the LoRaWAN gateway and start receiving uplinks.</span>
              </div>
            }

            @if (!form.test_mode) {
              <div class="alert alert-info rounded-xl mb-4">
                <span>Set event URL, command URL, and region only. <strong>Gateway ID is autodiscovered</strong> when the pipeline connects to concentratord.</span>
              </div>
            }

            <form (ngSubmit)="save()" class="space-y-5">
              <!-- Test mode toggle -->
              <div class="form-control">
                <label class="label cursor-pointer justify-start gap-3">
                  <input
                    type="checkbox"
                    class="toggle toggle-primary"
                    name="test_mode"
                    [(ngModel)]="form.test_mode"
                  />
                  <div>
                    <span class="label-text font-semibold">Test mode</span>
                    <p class="text-sm text-base-content/60">Skip concentratord \u2014 uplinks via inject endpoint only, downlinks logged but not sent.</p>
                  </div>
                </label>
              </div>

              <!-- Region -->
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
                    <option [value]="r.value">{{ r.label }} \u2014 {{ r.desc }}</option>
                  }
                </select>
                <p class="text-sm text-base-content/60 mt-1">Determines channel set and region profile.</p>
              </div>

              <!-- Event URL -->
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
                <p class="text-sm text-base-content/60 mt-1">ZMQ SUB bind for concentratord uplink events.</p>
              </div>

              <!-- Command URL -->
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

              <!-- Gateway ID (read-only) -->
              <div class="form-control w-full">
                <label class="label">
                  <span class="label-text font-semibold">Gateway ID</span>
                </label>
                <div class="rounded-lg bg-base-200 px-3 py-2 font-mono text-sm">
                  {{ form.gateway_id || '\u2014' }}
                </div>
                <p class="text-sm text-base-content/60 mt-1">Autodiscovered from concentratord when connected.</p>
              </div>

              <!-- RX1 frequency override -->
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
                    Saving\u2026
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
                    Refreshing\u2026
                  } @else {
                    Refresh
                  }
                </button>
              </div>
            </form>
          </div>
        }
      </div>
    </div>
  `,
})
export class LorawanSettingsComponent implements OnInit {
  private api = inject(ApiService);

  loading = signal(true);
  refreshing = signal(false);
  saving = signal(false);
  saveError = signal<string | null>(null);
  saveSuccess = signal(false);
  saved = signal(false);

  regions = REGIONS;

  form: GatewaySettings = {
    region: 'US915',
    event_url: 'ipc:///tmp/concentratord_event',
    command_url: 'ipc:///tmp/concentratord_command',
    gateway_id: '',
    rx1_frequency_hz: 0,
    test_mode: false,
    enabled: true,
    saved: false,
  };

  ngOnInit(): void {
    this.api.getGatewaySettings().subscribe({
      next: (res) => {
        this.form = { ...res };
        this.saved.set(res.saved);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  canSave(): boolean {
    if (this.form.test_mode) return true;
    const r = this.form.region?.trim();
    const e = this.form.event_url?.trim();
    const c = this.form.command_url?.trim();
    return !!(r && e && c);
  }

  save(): void {
    if (!this.canSave() || this.saving()) return;
    this.saveError.set(null);
    this.saveSuccess.set(false);
    this.saving.set(true);
    const payload = {
      region: this.form.region.trim(),
      event_url: this.form.event_url.trim(),
      command_url: this.form.command_url.trim(),
      rx1_frequency_hz: this.form.rx1_frequency_hz ?? 0,
      test_mode: this.form.test_mode,
      enabled: this.form.enabled,
    };
    this.api.patchGatewaySettings(payload).subscribe({
      next: (res) => {
        this.form = { ...res };
        this.saved.set(true);
        this.saveSuccess.set(true);
        this.saving.set(false);
        setTimeout(() => this.saveSuccess.set(false), 4000);
      },
      error: (err) => {
        this.saveError.set(err?.error?.error ?? err?.message ?? 'Failed to save');
        this.saving.set(false);
      },
    });
  }

  refresh(): void {
    this.refreshing.set(true);
    this.api.getGatewaySettings().subscribe({
      next: (res) => {
        this.form = { ...res };
        this.saved.set(res.saved);
        this.refreshing.set(false);
      },
      error: () => this.refreshing.set(false),
    });
  }
}
