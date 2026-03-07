import { Component, inject, signal, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, ProvisionResponse } from '../../../core/services/api.service';

@Component({
  selector: 'app-add-device-modal',
  standalone: true,
  imports: [FormsModule],
  template: `
    <dialog class="modal" [class.modal-open]="open()" (click)="onBackdropClick($event)">
      <div class="modal-box max-w-md" (click)="$event.stopPropagation()">
        <h3 class="font-bold text-lg">Register device</h3>
        <p class="text-sm text-base-content/70 py-1">Create a device and get an App Key for LoRaWAN (OTAA). Use the EUI from the device label or serial.</p>

        @if (!result()) {
          <form class="form-control gap-2 mt-4" (ngSubmit)="onSubmit()">
            <label class="label">
              <span class="label-text">Device EUI <span class="text-error">*</span></span>
            </label>
            <input
              type="text"
              class="input input-bordered w-full font-mono"
              placeholder="e.g. 0102030405060708"
              maxlength="16"
              [(ngModel)]="eui"
              name="eui"
              required
            />
            <label class="label">
              <span class="label-text">Device name (optional)</span>
            </label>
            <input
              type="text"
              class="input input-bordered w-full"
              placeholder="e.g. pump-1"
              [(ngModel)]="name"
              name="name"
            />
            @if (error()) {
              <div class="alert alert-error text-sm">{{ error() }}</div>
            }
            <div class="modal-action mt-4">
              <button type="button" class="btn btn-ghost" (click)="close()">Cancel</button>
              <button type="submit" class="btn btn-primary" [disabled]="submitting()">
                {{ submitting() ? 'Registering…' : 'Register' }}
              </button>
            </div>
          </form>
        } @else {
          <div class="mt-4 space-y-3">
            <div class="alert alert-success text-sm">Device registered. Use the App Key in firmware (e.g. secrets.h).</div>
            <div class="form-control">
              <label class="label py-0"><span class="label-text font-mono text-sm">Device EUI</span></label>
              <div class="flex gap-2">
                <input type="text" class="input input-bordered input-sm flex-1 font-mono" [value]="result()!.device_eui" readonly />
                <button type="button" class="btn btn-sm btn-ghost" (click)="copy(result()!.device_eui)">Copy</button>
              </div>
            </div>
            <div class="form-control">
              <label class="label py-0"><span class="label-text font-mono text-sm">App Key</span></label>
              <div class="flex gap-2">
                <input [type]="showKey() ? 'text' : 'password'" class="input input-bordered input-sm flex-1 font-mono" [value]="result()!.app_key" readonly />
                <button type="button" class="btn btn-sm btn-ghost" (click)="showKey.set(!showKey())">{{ showKey() ? 'Hide' : 'Show' }}</button>
                <button type="button" class="btn btn-sm btn-primary" (click)="copy(result()!.app_key)">Copy</button>
              </div>
            </div>
            <div class="modal-action mt-4">
              <button type="button" class="btn btn-ghost" (click)="addAnother()">Add another</button>
              <button type="button" class="btn btn-primary" (click)="close()">Done</button>
            </div>
          </div>
        }
      </div>
      <form method="dialog" class="modal-backdrop">
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

  copy(text: string): void {
    navigator.clipboard.writeText(text).catch(() => {});
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
