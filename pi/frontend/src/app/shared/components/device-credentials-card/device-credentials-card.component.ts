import { Component, inject, input, OnInit, signal } from '@angular/core';
import { ApiService, CredentialsResponse } from '../../../core/services/api.service';
import { copyToClipboard, formatAppKeyAsCpp } from '../../../core/utils/lorawan-credentials';

@Component({
  selector: 'app-device-credentials-card',
  standalone: true,
  imports: [],
  template: `
    <div class="card-elevated">
      <div class="card-body-spaced">
        <h2 class="section-title">
          @if (creds()?.transport === 'wifi') {
            WiFi credentials
          } @else {
            LoRaWAN credentials
          }
        </h2>
        <p class="text-sm text-base-content/70 -mt-1">
          @if (creds()?.transport === 'wifi') {
            Device Token for HTTP bearer auth. Use in firmware for ingest calls.
          } @else {
            App Key for OTAA. Use in firmware (e.g. <code class="bg-base-200 px-1.5 py-0.5 rounded text-xs">secrets.h</code>).
          }
        </p>
        @if (loading()) {
          <div class="flex items-center gap-2 py-2">
            <span class="loading loading-spinner loading-sm"></span>
            <span class="text-sm text-base-content/60">Loading…</span>
          </div>
        } @else if (error()) {
          <div class="alert alert-error rounded-xl text-sm">
            <span>{{ error() }}</span>
          </div>
          @if (error()?.includes('app_key') || error()?.includes('provision')) {
            <p class="text-sm text-base-content/70 mb-2">This device has no App Key yet (e.g. it was created before provisioning). Generate one now — the existing device will be updated.</p>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              [disabled]="provisioning()"
              (click)="generateAppKey()"
            >
              {{ provisioning() ? 'Generating…' : 'Generate App Key' }}
            </button>
          }
        } @else if (creds()) {
          @if (creds()!.transport === 'wifi' && creds()!.device_token) {
            <!-- WiFi: show device token -->
            <label class="form-control w-full">
              <span class="label"><span class="label-text font-mono text-xs">Device Token</span></span>
              <div class="flex flex-wrap gap-2 items-center">
                <input
                  #tokenInput
                  [type]="showKey() ? 'text' : 'password'"
                  class="input input-bordered input-sm flex-1 min-w-0 font-mono text-xs"
                  [value]="creds()!.device_token"
                  readonly
                />
                <button type="button" class="btn btn-ghost btn-sm" (click)="showKey.set(!showKey())">{{ showKey() ? 'Hide' : 'Show' }}</button>
                <button type="button" class="btn btn-ghost btn-sm" (click)="copy(tokenInput, creds()!.device_token)">Copy</button>
              </div>
            </label>
          } @else {
            <!-- LoRaWAN: show app key -->
            <label class="form-control w-full">
              <span class="label"><span class="label-text font-mono text-xs">App Key</span></span>
              <div class="flex flex-wrap gap-2 items-center">
                <input
                  #keyInput
                  [type]="showKey() ? 'text' : 'password'"
                  class="input input-bordered input-sm flex-1 min-w-0 font-mono text-xs"
                  [value]="creds()!.app_key"
                  readonly
                />
                <button type="button" class="btn btn-ghost btn-sm" (click)="showKey.set(!showKey())">{{ showKey() ? 'Hide' : 'Show' }}</button>
                <button type="button" class="btn btn-ghost btn-sm" (click)="copy(keyInput, creds()!.app_key)">Copy hex</button>
                <button type="button" class="btn btn-primary btn-sm" (click)="copyCpp(creds()!.app_key)">Copy as C++</button>
              </div>
            </label>
          }
        }
      </div>
    </div>
  `,
})
export class DeviceCredentialsCardComponent implements OnInit {
  private api = inject(ApiService);

  eui = input.required<string>();
  loading = signal(true);
  error = signal<string | null>(null);
  creds = signal<CredentialsResponse | null>(null);
  showKey = signal(false);
  provisioning = signal(false);

  ngOnInit() {
    const e = this.eui();
    if (!e) return;
    this.api.getDeviceCredentials(e).subscribe({
      next: (res) => {
        this.creds.set(res);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.error ?? err?.message ?? 'Failed to load credentials');
        this.loading.set(false);
      },
    });
  }

  async copy(inputEl: HTMLInputElement, text: string): Promise<void> {
    const ok = await copyToClipboard(text);
    if (!ok) this.fallbackCopyInput(inputEl, text);
  }

  async copyCpp(hex: string): Promise<void> {
    const cpp = formatAppKeyAsCpp(hex);
    if (cpp) await copyToClipboard(cpp);
  }

  private fallbackCopyInput(el: HTMLInputElement, text: string): void {
    el.type = 'text';
    el.value = text;
    el.select();
    el.setSelectionRange(0, text.length);
    try {
      document.execCommand('copy');
    } finally {
      el.type = this.showKey() ? 'text' : 'password';
    }
  }

  /** Provision this device (same EUI) to set or regenerate App Key. Updates existing record. */
  generateAppKey(): void {
    const e = this.eui();
    if (!e) return;
    this.provisioning.set(true);
    this.error.set(null);
    this.api.provisionDevice(e).subscribe({
      next: (res) => {
        this.creds.set({ device_eui: res.device_eui, app_key: res.app_key, device_token: res.device_token, transport: res.transport });
        this.error.set(null);
        this.provisioning.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.error ?? err?.message ?? 'Failed to generate App Key');
        this.provisioning.set(false);
      },
    });
  }
}
