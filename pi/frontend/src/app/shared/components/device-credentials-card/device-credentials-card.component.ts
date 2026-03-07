import { Component, inject, input, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, CredentialsResponse } from '../../../core/services/api.service';

@Component({
  selector: 'app-device-credentials-card',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="card bg-base-200/50 shadow-sm">
      <div class="card-body">
        <h3 class="card-title text-base">LoRaWAN credentials</h3>
        <p class="text-sm text-base-content/70">App Key for OTAA. Use in firmware (e.g. <code class="text-xs bg-base-300 px-1 rounded">secrets.h</code>) or run <code class="text-xs bg-base-300 px-1 rounded">GET /api/devices/credentials?eui=...</code></p>
        @if (loading()) {
          <span class="loading loading-spinner loading-sm"></span>
        } @else if (error()) {
          <div class="text-sm text-error">{{ error() }}</div>
          @if (error()?.includes('app_key') || error()?.includes('provision')) {
            <p class="text-sm">Register this device first from the <a routerLink="/" class="link link-primary">device list</a> (Add device) to get an App Key.</p>
          }
        } @else if (creds()) {
          <div class="form-control gap-2">
            <label class="label py-0"><span class="label-text font-mono text-xs">App Key</span></label>
            <div class="flex flex-wrap gap-2 items-center">
              <input
                [type]="showKey() ? 'text' : 'password'"
                class="input input-bordered input-sm flex-1 min-w-[200px] font-mono text-xs"
                [value]="creds()!.app_key"
                readonly
              />
              <button type="button" class="btn btn-ghost btn-sm" (click)="showKey.set(!showKey())">
                {{ showKey() ? 'Hide' : 'Show' }}
              </button>
              <button type="button" class="btn btn-primary btn-sm" (click)="copy(creds()!.app_key)">Copy</button>
            </div>
          </div>
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
