import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';

@Component({
  selector: 'app-wifi-settings',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="card bg-base-100 shadow-md h-full">
      <div class="card-body">
        <!-- Header with enabled toggle -->
        <div class="flex items-center justify-between mb-4">
          <h3 class="card-title">
            <span class="badge badge-secondary">WiFi</span>
          </h3>
          <label class="label cursor-pointer gap-2">
            <span class="label-text text-sm">{{ enabled() ? 'Enabled' : 'Disabled' }}</span>
            <input
              type="checkbox"
              class="toggle toggle-secondary"
              [checked]="enabled()"
              (change)="toggleEnabled()"
              [disabled]="loading()"
            />
          </label>
        </div>

        @if (loading()) {
          <div class="flex justify-center py-8">
            <span class="loading loading-spinner loading-lg text-secondary"></span>
          </div>
        } @else {
          <div [class.opacity-50]="!enabled()" [class.pointer-events-none]="!enabled()">
            <!-- Test mode toggle -->
            <div class="form-control mb-5">
              <label class="label cursor-pointer justify-start gap-3">
                <input
                  type="checkbox"
                  class="toggle toggle-secondary"
                  [checked]="testMode()"
                  (change)="toggleTestMode()"
                />
                <div>
                  <span class="label-text font-semibold">Test mode</span>
                  <p class="text-sm text-base-content/60">Accept ingest requests but flag telemetry as test data.</p>
                </div>
              </label>
            </div>

            <div class="divider my-2"></div>

            <!-- Ingest endpoint -->
            <div class="form-control w-full mb-4">
              <label class="label">
                <span class="label-text font-semibold">Ingest endpoint</span>
              </label>
              <div class="rounded-lg bg-base-200 px-3 py-2 font-mono text-sm break-all">
                POST {{ ingestUrl }}/api/farmon/ingest
              </div>
              <p class="text-sm text-base-content/60 mt-1">
                Devices authenticate with <code class="text-xs">Authorization: Bearer &lt;device_token&gt;</code>.
                The token is generated when you provision a WiFi device.
              </p>
            </div>

            <!-- Request format -->
            <div class="form-control w-full mb-4">
              <label class="label">
                <span class="label-text font-semibold">Request format</span>
              </label>
              <div class="rounded-lg bg-base-200 px-3 py-3 font-mono text-xs whitespace-pre">{{ wifiExample }}</div>
            </div>

            <!-- How it works -->
            <div class="form-control w-full">
              <label class="label">
                <span class="label-text font-semibold">How it works</span>
              </label>
              <ul class="list-disc list-inside text-sm text-base-content/70 space-y-1">
                <li>Device sends telemetry via HTTP POST with its bearer token</li>
                <li>Backend decodes the payload using the device's profile (same as LoRaWAN)</li>
                <li>Any pending downlink commands are returned in the response</li>
                <li>No gateway hardware required \u2014 runs on any machine with network access</li>
              </ul>
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class WifiSettingsComponent implements OnInit {
  private api = inject(ApiService);

  loading = signal(true);
  enabled = signal(true);
  testMode = signal(false);

  ingestUrl = window.location.origin;
  wifiExample = `{\n  "fport": 2,\n  "payload_hex": "7064002a..."\n}`;

  ngOnInit(): void {
    this.api.getWifiSettings().subscribe({
      next: (res) => {
        this.enabled.set(res.enabled);
        this.testMode.set(res.test_mode);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  toggleEnabled(): void {
    const newVal = !this.enabled();
    this.enabled.set(newVal);
    this.api.patchWifiSettings({ enabled: newVal }).subscribe();
  }

  toggleTestMode(): void {
    const newVal = !this.testMode();
    this.testMode.set(newVal);
    this.api.patchWifiSettings({ test_mode: newVal }).subscribe();
  }
}
