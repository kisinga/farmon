import { Component, inject, signal, computed, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, ProvisionResponse, TransportType, getTransportMeta, DeviceSpec } from '../../../core/services/api.service';
import { copyToClipboard, formatAppKeyAsCpp } from '../../../core/utils/lorawan-credentials';

@Component({
  selector: 'app-add-device-modal',
  standalone: true,
  imports: [FormsModule],
  template: `
    <dialog class="modal" [class.modal-open]="open()" (click)="onBackdropClick($event)">
      <div class="modal-box max-w-lg rounded-2xl shadow-2xl" (click)="$event.stopPropagation()">
        @if (!result()) {
          <h3 class="font-bold text-lg">Add device</h3>
          <p class="text-sm text-base-content/70 mt-1">Provision a new device. Optionally import a spec JSON.</p>

          <form class="mt-4 space-y-4" (ngSubmit)="onSubmit()">
            <!-- Transport -->
            <label class="form-control w-full">
              <span class="label"><span class="label-text font-medium">Transport</span></span>
              <select class="select select-bordered select-sm w-full" [(ngModel)]="transport" name="transport">
                <option value="lorawan">LoRaWAN</option>
                <option value="wifi">WiFi</option>
              </select>
            </label>

            <!-- Device ID -->
            <label class="form-control w-full">
              <span class="label"><span class="label-text font-medium">Device ID</span><span class="text-error">*</span></span>
              <input
                type="text"
                class="input input-bordered w-full font-mono input-sm"
                [placeholder]="transport === 'wifi' ? 'e.g. aabbccddeeff' : 'e.g. 0102030405060708'"
                [maxlength]="16"
                [(ngModel)]="eui"
                name="eui"
                required
              />
              <span class="label-text-alt text-base-content/50">
                {{ transport === 'wifi' ? '12 hex characters (MAC)' : '16 hex characters (EUI-64)' }}
              </span>
            </label>

            <!-- Device name -->
            <label class="form-control w-full">
              <span class="label"><span class="label-text font-medium">Device name</span><span class="label-text-alt">optional</span></span>
              <input
                type="text"
                class="input input-bordered w-full input-sm"
                placeholder="e.g. pump-1"
                [(ngModel)]="name"
                name="name"
              />
            </label>

            <!-- Advanced: Spec JSON -->
            <div class="collapse collapse-arrow bg-base-200/50 rounded-xl">
              <input type="checkbox" [(ngModel)]="showAdvanced" name="showAdvanced" />
              <div class="collapse-title text-sm font-medium py-2 min-h-0">
                Import spec (Advanced)
              </div>
              <div class="collapse-content">
                <p class="text-xs text-base-content/60 mb-2">Paste a device spec JSON to pre-configure fields, controls, and decode rules.</p>
                <textarea
                  class="textarea textarea-bordered font-mono text-xs w-full"
                  rows="8"
                  [(ngModel)]="specJson"
                  name="specJson"
                  placeholder='{ "type": "codec", "fields": [...], "decode_rules": [...] }'
                ></textarea>
                @if (specError()) {
                  <p class="text-xs text-error mt-1">{{ specError() }}</p>
                }
              </div>
            </div>

            @if (error()) {
              <div class="alert alert-error text-sm rounded-xl">{{ error() }}</div>
            }
            <div class="modal-action mt-6 p-0 justify-end gap-2">
              <button type="button" class="btn btn-ghost" (click)="close()">Cancel</button>
              <button type="submit" class="btn btn-primary" [disabled]="submitting()">
                {{ submitting() ? 'Provisioning…' : 'Provision' }}
              </button>
            </div>
          </form>
        } @else {
          <!-- Result: Credentials -->
          <h3 class="font-bold text-lg">Device provisioned</h3>
          <div class="mt-4 space-y-4">
            <div class="alert alert-success text-sm rounded-xl">
              Device provisioned via <span class="badge badge-sm">{{ result()!.transport }}</span>.
              Copy the {{ resultMeta().credentialLabel }} into your firmware.
            </div>
            <label class="form-control w-full">
              <span class="label"><span class="label-text font-mono text-xs">Device ID</span></span>
              <div class="flex gap-2">
                <input #euiInput type="text" class="input input-bordered input-sm flex-1 font-mono text-xs" [value]="result()!.device_eui" readonly />
                <button type="button" class="btn btn-ghost btn-sm btn-square" (click)="copy(euiInput, result()!.device_eui)" title="Copy">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                </button>
              </div>
            </label>

            @if (result()!.app_key) {
              <label class="form-control w-full">
                <span class="label"><span class="label-text font-mono text-xs">{{ resultMeta().credentialLabel }}</span></span>
                <div class="flex gap-2 flex-wrap">
                  <input
                    #appKeyInput
                    [type]="showKey() ? 'text' : 'password'"
                    class="input input-bordered input-sm flex-1 min-w-0 font-mono text-xs"
                    [value]="result()!.app_key!"
                    readonly
                  />
                  <button type="button" class="btn btn-ghost btn-sm" (click)="showKey.set(!showKey())">{{ showKey() ? 'Hide' : 'Show' }}</button>
                  <button type="button" class="btn btn-ghost btn-sm" (click)="copy(appKeyInput, result()!.app_key!)">Copy hex</button>
                  <button type="button" class="btn btn-primary btn-sm" (click)="copyCpp(result()!.app_key!)">Copy as C++</button>
                </div>
              </label>
            }

            @if (result()!.device_token) {
              <label class="form-control w-full">
                <span class="label"><span class="label-text font-mono text-xs">{{ resultMeta().credentialLabel }}</span></span>
                <div class="flex gap-2 flex-wrap">
                  <input
                    #tokenInput
                    [type]="showKey() ? 'text' : 'password'"
                    class="input input-bordered input-sm flex-1 min-w-0 font-mono text-xs"
                    [value]="result()!.device_token!"
                    readonly
                  />
                  <button type="button" class="btn btn-ghost btn-sm" (click)="showKey.set(!showKey())">{{ showKey() ? 'Hide' : 'Show' }}</button>
                  <button type="button" class="btn btn-ghost btn-sm" (click)="copy(tokenInput, result()!.device_token!)">Copy</button>
                </div>
              </label>
              <div class="bg-base-200 rounded-xl p-3 text-xs font-mono">
                <p class="text-base-content/60 mb-1">Example ingest call:</p>
                <code>curl -X POST {{ingestUrl()}}/api/farmon/ingest \\<br/>
                  &nbsp;&nbsp;-H "Authorization: Bearer {{result()!.device_token!}}" \\<br/>
                  &nbsp;&nbsp;-H "Content-Type: application/json" \\<br/>
                  &nbsp;&nbsp;-d '{{"{"}}&#34;fport&#34;:2,&#34;payload_hex&#34;:&#34;...&#34;{{"}"}}'
                </code>
              </div>
            }

            <div class="modal-action mt-6 p-0 justify-end gap-2">
              <button type="button" class="btn btn-ghost" (click)="addAnother()">Add another</button>
              <button type="button" class="btn btn-primary" (click)="close()">Done</button>
            </div>
          </div>
        }
      </div>
      <form method="dialog" class="modal-backdrop bg-black/50">
        <button type="button" (click)="close()">close</button>
      </form>
    </dialog>
  `,
})
export class AddDeviceModalComponent {
  private api = inject(ApiService);

  open = signal(false);
  submitting = signal(false);
  error = signal<string | null>(null);
  specError = signal<string | null>(null);
  result = signal<ProvisionResponse | null>(null);
  showKey = signal(false);

  transport: TransportType = 'lorawan';
  eui = '';
  name = '';
  specJson = '';
  showAdvanced = false;

  deviceAdded = output<void>();

  resultMeta = computed(() => getTransportMeta(this.result()?.transport));

  ingestUrl(): string {
    return window.location.origin;
  }

  openModal(): void {
    this.open.set(true);
    this.result.set(null);
    this.error.set(null);
    this.specError.set(null);
    this.transport = 'lorawan';
    this.eui = '';
    this.name = '';
    this.specJson = '';
    this.showAdvanced = false;
    this.showKey.set(false);
  }

  close(): void {
    this.open.set(false);
    this.result.set(null);
  }

  onBackdropClick(e: Event): void {
    if ((e.target as HTMLElement).tagName === 'DIALOG') this.close();
  }

  addAnother(): void {
    this.result.set(null);
    this.error.set(null);
    this.specError.set(null);
    this.eui = '';
    this.name = '';
    this.specJson = '';
    this.showAdvanced = false;
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

  onSubmit(): void {
    const devEui = this.eui.replace(/\s/g, '').toLowerCase();
    const minLen = this.transport === 'wifi' ? 12 : 16;
    const idPattern = new RegExp(`^[0-9a-f]{${minLen},16}$`);
    if (!idPattern.test(devEui)) {
      this.error.set(`Device ID must be ${minLen}–16 hex characters.`);
      return;
    }

    // Parse spec JSON if provided
    let spec: DeviceSpec | undefined;
    if (this.showAdvanced && this.specJson.trim()) {
      try {
        spec = JSON.parse(this.specJson.trim());
        this.specError.set(null);
      } catch {
        this.specError.set('Invalid JSON');
        return;
      }
    }

    this.error.set(null);
    this.submitting.set(true);
    this.api.provisionDevice(devEui, this.name.trim() || undefined, this.transport, spec).subscribe({
      next: (res) => {
        this.result.set(res);
        this.submitting.set(false);
        this.deviceAdded.emit();
      },
      error: (err) => {
        this.error.set(err?.error?.error ?? err?.message ?? 'Provisioning failed');
        this.submitting.set(false);
      },
    });
  }
}
