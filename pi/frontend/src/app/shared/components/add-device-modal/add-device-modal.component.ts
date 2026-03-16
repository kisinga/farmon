import { Component, inject, signal, output, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, ProfileSummary, ProvisionResponse } from '../../../core/services/api.service';
import { copyToClipboard, formatAppKeyAsCpp } from '../../../core/utils/lorawan-credentials';

@Component({
  selector: 'app-add-device-modal',
  standalone: true,
  imports: [FormsModule],
  template: `
    <dialog class="modal" [class.modal-open]="open()" (click)="onBackdropClick($event)">
      <div class="modal-box max-w-lg rounded-2xl shadow-2xl" (click)="$event.stopPropagation()">
        @if (!result()) {
          @if (step() === 1) {
            <!-- Step 1: Select Profile -->
            <h3 class="font-bold text-lg">Select a profile</h3>
            <p class="text-sm text-base-content/70 mt-1">Choose a device profile that matches your hardware.</p>

            @if (loadingProfiles()) {
              <div class="flex justify-center py-8">
                <span class="loading loading-spinner loading-md text-primary"></span>
              </div>
            } @else if (profiles().length === 0) {
              <div class="py-8 text-center text-base-content/50 text-sm">No profiles available. Create one in Profiles first.</div>
            } @else {
              <div class="mt-4 space-y-2 max-h-72 overflow-y-auto">
                @for (p of profiles(); track p.id) {
                  <button
                    type="button"
                    class="w-full text-left rounded-xl border p-3 transition-colors"
                    [class.border-primary]="selectedProfile() === p.id"
                    [class.bg-primary]="selectedProfile() === p.id"
                    [style.--tw-bg-opacity]="selectedProfile() === p.id ? '0.05' : '0'"
                    [class.border-base-300]="selectedProfile() !== p.id"
                    (click)="selectedProfile.set(p.id)"
                  >
                    <div class="flex items-center justify-between">
                      <span class="font-medium">{{ p.name }}</span>
                      <span class="badge badge-sm" [class.badge-primary]="p.profile_type === 'airconfig'" [class.badge-secondary]="p.profile_type === 'codec'">{{ p.profile_type }}</span>
                    </div>
                    @if (p.description) {
                      <p class="text-xs text-base-content/60 mt-1">{{ p.description }}</p>
                    }
                  </button>
                }
              </div>
            }

            <div class="modal-action mt-6 p-0 justify-end gap-2">
              <button type="button" class="btn btn-ghost" (click)="close()">Cancel</button>
              <button type="button" class="btn btn-primary" [disabled]="!selectedProfile()" (click)="step.set(2)">Next</button>
            </div>

          } @else {
            <!-- Step 2: Device Details -->
            <h3 class="font-bold text-lg">Device details</h3>
            <p class="text-sm text-base-content/70 mt-1">
              Enter the Device EUI from the device label or serial. Profile: <span class="font-medium">{{ selectedProfileName() }}</span>
            </p>

            <form class="mt-4 space-y-4" (ngSubmit)="onSubmit()">
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
                <button type="button" class="btn btn-ghost" (click)="step.set(1)">Back</button>
                <button type="submit" class="btn btn-primary" [disabled]="submitting()">
                  {{ submitting() ? 'Provisioning…' : 'Provision' }}
                </button>
              </div>
            </form>
          }
        } @else {
          <!-- Result: Credentials -->
          <h3 class="font-bold text-lg">Device provisioned</h3>
          <div class="mt-4 space-y-4">
            <div class="alert alert-success text-sm rounded-xl">
              @if (result()!.profile_name) {
                Device provisioned with profile <strong>{{ result()!.profile_name }}</strong>.
              } @else {
                Device provisioned.
              }
              Copy the App Key into your firmware.
            </div>
            <label class="form-control w-full">
              <span class="label"><span class="label-text font-mono text-xs">Device EUI</span></span>
              <div class="flex gap-2">
                <input #euiInput type="text" class="input input-bordered input-sm flex-1 font-mono text-xs" [value]="result()!.device_eui" readonly />
                <button type="button" class="btn btn-ghost btn-sm btn-square" (click)="copy(euiInput, result()!.device_eui)" title="Copy EUI">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                </button>
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
  step = signal<1 | 2>(1);
  submitting = signal(false);
  error = signal<string | null>(null);
  result = signal<ProvisionResponse | null>(null);
  showKey = signal(false);
  profiles = signal<ProfileSummary[]>([]);
  loadingProfiles = signal(false);
  selectedProfile = signal<string | null>(null);

  eui = '';
  name = '';

  deviceAdded = output<void>();

  selectedProfileName(): string {
    const id = this.selectedProfile();
    return this.profiles().find(p => p.id === id)?.name ?? '';
  }

  openModal(): void {
    this.open.set(true);
    this.step.set(1);
    this.result.set(null);
    this.error.set(null);
    this.selectedProfile.set(null);
    this.eui = '';
    this.name = '';
    this.showKey.set(false);
    this.loadProfiles();
  }

  close(): void {
    this.open.set(false);
    this.result.set(null);
  }

  onBackdropClick(e: Event): void {
    if ((e.target as HTMLElement).tagName === 'DIALOG') this.close();
  }

  addAnother(): void {
    this.step.set(1);
    this.result.set(null);
    this.error.set(null);
    this.selectedProfile.set(null);
    this.eui = '';
    this.name = '';
    this.loadProfiles();
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

  private loadProfiles(): void {
    this.loadingProfiles.set(true);
    this.api.getProfiles(true).subscribe({
      next: (list) => {
        this.profiles.set(list);
        this.loadingProfiles.set(false);
      },
      error: () => {
        this.profiles.set([]);
        this.loadingProfiles.set(false);
      },
    });
  }

  onSubmit(): void {
    const devEui = this.eui.replace(/\s/g, '').toLowerCase();
    if (!/^[0-9a-f]{16}$/.test(devEui)) {
      this.error.set('Device EUI must be exactly 16 hex characters (0-9, a-f).');
      return;
    }
    const profileId = this.selectedProfile();
    if (!profileId) {
      this.error.set('Please select a profile first.');
      return;
    }
    this.error.set(null);
    this.submitting.set(true);
    this.api.provisionDevice(devEui, this.name.trim() || undefined, profileId).subscribe({
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
