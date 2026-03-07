import { Component, inject, input, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, CredentialsResponse } from '../../../core/services/api.service';

@Component({
  selector: 'app-device-credentials-card',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="card-elevated">
      <div class="card-body-spaced">
        <h2 class="section-title">LoRaWAN credentials</h2>
        <p class="text-sm text-base-content/70 -mt-1">App Key for OTAA. Use in firmware (e.g. <code class="bg-base-200 px-1.5 py-0.5 rounded text-xs">secrets.h</code>).</p>
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
            <p class="text-sm text-base-content/70">Register this device from the <a routerLink="/" class="link link-primary">device list</a> (Add device) to get an App Key.</p>
          }
        } @else if (creds()) {
          <label class="form-control w-full">
            <span class="label"><span class="label-text font-mono text-xs">App Key</span></span>
            <div class="flex flex-wrap gap-2 items-center">
              <input
                [type]="showKey() ? 'text' : 'password'"
                class="input input-bordered input-sm flex-1 min-w-0 font-mono text-xs"
                [value]="creds()!.app_key"
                readonly
              />
              <button type="button" class="btn btn-ghost btn-sm" (click)="showKey.set(!showKey())">{{ showKey() ? 'Hide' : 'Show' }}</button>
              <button type="button" class="btn btn-primary btn-sm" (click)="copy(creds()!.app_key)">Copy</button>
            </div>
          </label>
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

  copy(text: string): void {
    navigator.clipboard.writeText(text).catch(() => {});
  }
}
