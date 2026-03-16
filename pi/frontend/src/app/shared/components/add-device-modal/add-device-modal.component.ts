import { Component, inject, signal, output, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, ProfileSummary, ProvisionResponse, DeviceTarget, TransportType } from '../../../core/services/api.service';
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
            <!-- Step 1: Select Target Device -->
            <h3 class="font-bold text-lg">Select device type</h3>
            <p class="text-sm text-base-content/70 mt-1">Choose the hardware you're connecting.</p>

            @if (loadingTargets()) {
              <div class="flex justify-center py-8">
                <span class="loading loading-spinner loading-md text-primary"></span>
              </div>
            } @else {
              <div class="mt-4 space-y-2">
                @for (t of targets(); track t.id) {
                  <button
                    type="button"
                    class="w-full text-left rounded-xl border p-3 transition-colors"
                    [class.border-primary]="selectedTarget() === t.id"
                    [class.bg-primary]="selectedTarget() === t.id"
                    [style.--tw-bg-opacity]="selectedTarget() === t.id ? '0.05' : '0'"
                    [class.border-base-300]="selectedTarget() !== t.id"
                    (click)="selectTarget(t)"
                  >
                    <div class="flex items-center justify-between">
                      <span class="font-medium">{{ t.name }}</span>
                      @if (t.transport) {
                        <span class="badge badge-sm" [class.badge-primary]="t.transport === 'lorawan'" [class.badge-secondary]="t.transport === 'wifi'">{{ t.transport }}</span>
                      } @else {
                        <span class="badge badge-sm badge-ghost">manual</span>
                      }
                    </div>
                    <p class="text-xs text-base-content/60 mt-1">{{ t.description }}</p>
                  </button>
                }
              </div>
            }

            <div class="modal-action mt-6 p-0 justify-end gap-2">
              <button type="button" class="btn btn-ghost" (click)="close()">Cancel</button>
              <button type="button" class="btn btn-primary" [disabled]="!selectedTarget()" (click)="step.set(2)">Next</button>
            </div>

          } @else if (step() === 2) {
            <!-- Step 2: Select Profile + Transport Override -->
            <h3 class="font-bold text-lg">Configure device</h3>
            <p class="text-sm text-base-content/70 mt-1">
              Target: <span class="font-medium">{{ selectedTargetName() }}</span>
            </p>

            <!-- Transport override -->
            <div class="mt-4">
              <label class="form-control w-full">
                <span class="label"><span class="label-text font-medium">Transport</span></span>
                <select class="select select-bordered select-sm w-full" [(ngModel)]="transport" name="transport">
                  <option value="lorawan">LoRaWAN</option>
                  <option value="wifi">WiFi</option>
                </select>
                @if (inferredTransport()) {
                  <span class="label-text-alt text-base-content/50">Default from target: {{ inferredTransport() }}</span>
                }
              </label>
            </div>

            <!-- Profile selection -->
            @if (loadingProfiles()) {
              <div class="flex justify-center py-4">
                <span class="loading loading-spinner loading-sm text-primary"></span>
              </div>
            } @else if (profiles().length === 0) {
              <div class="py-4 text-center text-base-content/50 text-sm">No profiles available. Create one in Profiles first.</div>
            } @else {
              <div class="mt-3 space-y-2 max-h-52 overflow-y-auto">
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
              <button type="button" class="btn btn-ghost" (click)="step.set(1)">Back</button>
              <button type="button" class="btn btn-primary" [disabled]="!selectedProfile()" (click)="step.set(3)">Next</button>
            </div>

          } @else {
            <!-- Step 3: Device ID + Name -->
            <h3 class="font-bold text-lg">Device details</h3>
            <p class="text-sm text-base-content/70 mt-1">
              {{ transport === 'lorawan' ? 'Enter the Device EUI from the device label.' : 'Enter a unique device identifier (e.g. MAC address).' }}
              Profile: <span class="font-medium">{{ selectedProfileName() }}</span>
            </p>

            <form class="mt-4 space-y-4" (ngSubmit)="onSubmit()">
              <label class="form-control w-full">
                <span class="label"><span class="label-text font-medium">{{ transport === 'lorawan' ? 'Device EUI' : 'Device ID' }}</span><span class="text-error">*</span></span>
                <input
                  type="text"
                  class="input input-bordered w-full font-mono input-sm"
                  [placeholder]="transport === 'lorawan' ? 'e.g. 0102030405060708' : 'e.g. aabbccddeeff0011'"
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
                <button type="button" class="btn btn-ghost" (click)="step.set(2)">Back</button>
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
                Device provisioned with profile <strong>{{ result()!.profile_name }}</strong>
                via <span class="badge badge-sm">{{ result()!.transport }}</span>.
              } @else {
                Device provisioned via <span class="badge badge-sm">{{ result()!.transport }}</span>.
              }
              @if (result()!.transport === 'lorawan') {
                Copy the App Key into your firmware.
              } @else {
                Copy the Device Token for your firmware's HTTP auth.
              }
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

            @if (result()!.transport === 'lorawan' && result()!.app_key) {
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
            }

            @if (result()!.transport === 'wifi' && result()!.device_token) {
              <label class="form-control w-full">
                <span class="label"><span class="label-text font-mono text-xs">Device Token</span></span>
                <div class="flex gap-2 flex-wrap">
                  <input
                    #tokenInput
                    [type]="showKey() ? 'text' : 'password'"
                    class="input input-bordered input-sm flex-1 min-w-0 font-mono text-xs"
                    [value]="result()!.device_token"
                    readonly
                  />
                  <button type="button" class="btn btn-ghost btn-sm" (click)="showKey.set(!showKey())">{{ showKey() ? 'Hide' : 'Show' }}</button>
                  <button type="button" class="btn btn-ghost btn-sm" (click)="copy(tokenInput, result()!.device_token)">Copy</button>
                </div>
              </label>
              <div class="bg-base-200 rounded-xl p-3 text-xs font-mono">
                <p class="text-base-content/60 mb-1">Example ingest call:</p>
                <code>curl -X POST {{ingestUrl()}}/api/farmon/ingest \\<br/>
                  &nbsp;&nbsp;-H "Authorization: Bearer {{result()!.device_token}}" \\<br/>
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
  step = signal<1 | 2 | 3>(1);
  submitting = signal(false);
  error = signal<string | null>(null);
  result = signal<ProvisionResponse | null>(null);
  showKey = signal(false);

  targets = signal<DeviceTarget[]>([]);
  loadingTargets = signal(false);
  selectedTarget = signal<string | null>(null);
  inferredTransport = signal<string>('');

  profiles = signal<ProfileSummary[]>([]);
  loadingProfiles = signal(false);
  selectedProfile = signal<string | null>(null);

  transport: TransportType = 'lorawan';
  eui = '';
  name = '';

  deviceAdded = output<void>();

  selectedTargetName(): string {
    const id = this.selectedTarget();
    return this.targets().find(t => t.id === id)?.name ?? '';
  }

  selectedProfileName(): string {
    const id = this.selectedProfile();
    return this.profiles().find(p => p.id === id)?.name ?? '';
  }

  ingestUrl(): string {
    return window.location.origin;
  }

  selectTarget(t: DeviceTarget): void {
    this.selectedTarget.set(t.id);
    if (t.transport) {
      this.transport = t.transport;
      this.inferredTransport.set(t.transport);
    } else {
      this.inferredTransport.set('');
    }
    // Pre-select default profile if available
    if (t.default_profile_id) {
      this.selectedProfile.set(t.default_profile_id);
    }
    this.loadProfiles();
  }

  openModal(): void {
    this.open.set(true);
    this.step.set(1);
    this.result.set(null);
    this.error.set(null);
    this.selectedTarget.set(null);
    this.selectedProfile.set(null);
    this.inferredTransport.set('');
    this.transport = 'lorawan';
    this.eui = '';
    this.name = '';
    this.showKey.set(false);
    this.loadTargets();
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
    this.selectedTarget.set(null);
    this.selectedProfile.set(null);
    this.inferredTransport.set('');
    this.transport = 'lorawan';
    this.eui = '';
    this.name = '';
    this.loadTargets();
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

  private loadTargets(): void {
    this.loadingTargets.set(true);
    this.api.getDeviceTargets().subscribe({
      next: (list) => {
        this.targets.set(list);
        this.loadingTargets.set(false);
      },
      error: () => {
        this.targets.set([]);
        this.loadingTargets.set(false);
      },
    });
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
      this.error.set('Device ID must be exactly 16 hex characters (0-9, a-f).');
      return;
    }
    const profileId = this.selectedProfile();
    if (!profileId) {
      this.error.set('Please select a profile first.');
      return;
    }
    this.error.set(null);
    this.submitting.set(true);
    const targetId = this.selectedTarget() ?? undefined;
    this.api.provisionDevice(devEui, this.name.trim() || undefined, profileId, this.transport, targetId).subscribe({
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
