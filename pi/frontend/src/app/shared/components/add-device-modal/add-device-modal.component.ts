import { Component, inject, signal, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, ProvisionResponse } from '../../../core/services/api.service';
import { copyToClipboard, formatAppKeyAsCpp } from '../../../core/utils/lorawan-credentials';

@Component({
  selector: 'app-add-device-modal',
  standalone: true,
  imports: [FormsModule],
  template: `
    <dialog class="modal" [class.modal-open]="open()" (click)="onBackdropClick($event)">
      <div class="modal-box max-w-md rounded-2xl shadow-2xl" (click)="$event.stopPropagation()">
        <h3 class="font-bold text-lg">Register device</h3>
        <p class="text-sm text-base-content/70 mt-1">
          Create a device and get an App Key for LoRaWAN (OTAA). Use the EUI from the device label or serial.
        </p>

        @if (!result()) {
          <form class="mt-6 space-y-4" (ngSubmit)="onSubmit()">
            <label class="form-control w-full">
              <span class="label"><span class="label-text font-medium">Device EUI</span><span class="text-error">*</span></span>
              <input
                type="text"
                class="input input-bordered w-full font-mono input-sm"
                placeholder="e.g. 0102030405060708"
                maxlength="16"
                [(ngModel)]="eui"
                name="eui"
                required
              />
              <span class="label-text-alt text-base-content/50">16 hex characters</span>
            </label>
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
            @if (error()) {
              <div class="alert alert-error text-sm rounded-xl">{{ error() }}</div>
            }
            <div class="modal-action mt-6 p-0 justify-end gap-2">
              <button type="button" class="btn btn-ghost" (click)="close()">Cancel</button>
              <button type="submit" class="btn btn-primary" [disabled]="submitting()">
                {{ submitting() ? 'Registering…' : 'Register' }}
              </button>
            </div>
          </form>
        } @else {
          <div class="mt-6 space-y-4">
            <div class="alert alert-success text-sm rounded-xl">
              Device registered. Copy the App Key into your firmware (e.g. <code class="bg-success/20 px-1 rounded">secrets.h</code>).
            </div>
            <label class="form-control w-full">
              <span class="label"><span class="label-text font-mono text-xs">Device EUI</span></span>
              <div class="flex gap-2">
                <input #euiInput type="text" class="input input-bordered input-sm flex-1 font-mono text-xs" [value]="result()!.device_eui" readonly />
                <button type="button" class="btn btn-ghost btn-sm btn-square" (click)="copy(euiInput, result()!.device_eui)" title="Copy EUI">📋</button>
              </div>
            </label>
            <label class="form-control w-full">
              <span class="label"><span class="label-text font-mono text-xs">App Key</span></span>
              <div class="flex gap-2 flex-wrap">
                <input
                  #appKeyInput
                  [type]="showKey() ? 'text' : 'password'"
                  class="input input-bordered input-sm flex-1 min-w-0 font-mono text-xs"
                  [value]="result()!.app_key"
                  readonly
                />
                <button type="button" class="btn btn-ghost btn-sm" (click)="showKey.set(!showKey())">{{ showKey() ? 'Hide' : 'Show' }}</button>
                <button type="button" class="btn btn-ghost btn-sm" (click)="copy(appKeyInput, result()!.app_key)">Copy hex</button>
                <button type="button" class="btn btn-primary btn-sm" (click)="copyCpp(result()!.app_key)">Copy as C++</button>
              </div>
            </label>
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
  result = signal<ProvisionResponse | null>(null);
  showKey = signal(false);

  eui = '';
  name = '';

  deviceAdded = output<void>();

  openModal(): void {
    this.open.set(true);
    this.result.set(null);
    this.error.set(null);
    this.eui = '';
    this.name = '';
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
    this.eui = '';
    this.name = '';
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
    if (!/^[0-9a-f]{16}$/.test(devEui)) {
      this.error.set('Device EUI must be exactly 16 hex characters (0-9, a-f).');
      return;
    }
    this.error.set(null);
    this.submitting.set(true);
    this.api.provisionDevice(devEui, this.name.trim() || undefined).subscribe({
      next: (res) => {
        this.result.set(res);
        this.submitting.set(false);
        this.deviceAdded.emit();
      },
      error: (err) => {
        this.error.set(err?.error?.error ?? err?.message ?? 'Registration failed');
        this.submitting.set(false);
      },
    });
  }
}
