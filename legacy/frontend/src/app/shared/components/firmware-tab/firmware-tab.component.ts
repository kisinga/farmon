import { Component, input, signal, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';

@Component({
  selector: 'app-firmware-tab',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="space-y-6">

      <!-- Target info -->
      <div class="card bg-base-200">
        <div class="card-body py-4">
          <h3 class="card-title text-sm">Firmware</h3>
          <div class="text-sm text-base-content/70">
            Target: <span class="font-semibold">{{ hwLabel() }}</span>
          </div>
        </div>
      </div>

      <!-- Required Drivers (read-only, derived from IO config) -->
      <div class="card bg-base-200">
        <div class="card-body py-4">
          <h3 class="card-title text-sm">Required Drivers</h3>
          @if (requiredDrivers().length === 0) {
            <p class="text-sm text-base-content/50">No drivers configured yet. Add inputs in the Inputs tab.</p>
          } @else {
            <div class="flex flex-wrap gap-1 mt-1">
              @for (d of requiredDrivers(); track d) {
                <span class="badge badge-sm badge-outline">{{ d }}</span>
              }
            </div>
          }
        </div>
      </div>

      <!-- Device Credentials -->
      <div class="card bg-base-200">
        <div class="card-body py-4 space-y-3">
          <h3 class="card-title text-sm">Device Credentials</h3>

          @if (transport() === 'wifi') {
            <label class="form-control w-full max-w-xs">
              <div class="label py-1"><span class="label-text text-xs">WiFi SSID</span></div>
              <input class="input input-bordered input-sm" [(ngModel)]="wifiSSID" placeholder="MyNetwork" />
            </label>
            <label class="form-control w-full max-w-xs">
              <div class="label py-1"><span class="label-text text-xs">WiFi Password</span></div>
              <div class="flex gap-2">
                <input [type]="showPass() ? 'text' : 'password'" class="input input-bordered input-sm flex-1"
                  [(ngModel)]="wifiPassword" placeholder="password" />
                <button class="btn btn-ghost btn-sm btn-square" (click)="showPass.set(!showPass())">
                  {{ showPass() ? 'Hide' : 'Show' }}
                </button>
              </div>
            </label>
            <label class="form-control w-full max-w-xs">
              <div class="label py-1"><span class="label-text text-xs">Backend URL</span></div>
              <input class="input input-bordered input-sm" [(ngModel)]="backendURL" placeholder="http://192.168.1.10:8090/api/farmon/ingest" />
            </label>
            <label class="form-control w-full max-w-xs">
              <div class="label py-1"><span class="label-text text-xs">Device Token</span></div>
              <input class="input input-bordered input-sm font-mono text-xs" [value]="deviceToken()" readonly />
            </label>
          } @else {
            <label class="form-control w-full max-w-xs">
              <div class="label py-1"><span class="label-text text-xs">App Key</span></div>
              <input class="input input-bordered input-sm font-mono text-xs" [value]="appKey()" readonly />
            </label>
          }

          <button class="btn btn-sm btn-outline" [disabled]="savingCreds()" (click)="saveCredentials()">
            {{ savingCreds() ? 'Saving...' : 'Save Credentials' }}
          </button>
          @if (credsMsg()) {
            <div class="text-xs" [class.text-success]="credsOk()" [class.text-error]="!credsOk()">{{ credsMsg() }}</div>
          }
        </div>
      </div>

      <!-- Build & Flash -->
      <div class="card bg-base-200">
        <div class="card-body py-4 space-y-3">
          <h3 class="card-title text-sm">Build & Flash</h3>

          <div class="flex items-center gap-2">
            <span class="text-sm">Status:</span>
            @switch (buildStatus()) {
              @case ('none') { <span class="badge badge-sm badge-ghost">Not built</span> }
              @case ('building') { <span class="badge badge-sm badge-warning">Building...</span> }
              @case ('success') { <span class="badge badge-sm badge-success">Built</span> }
              @case ('failed') { <span class="badge badge-sm badge-error">Failed</span> }
            }
          </div>

          <button class="btn btn-primary btn-sm" [disabled]="building()"
            (click)="triggerBuild()">
            {{ building() ? 'Building...' : 'Build Firmware' }}
          </button>

          @if (buildStatus() === 'success') {
            <div class="space-y-2">
              <a [href]="downloadUrl()" class="btn btn-sm btn-outline" download>
                Download {{ fwExtension() }}
              </a>

              <div class="divider text-xs">Flash</div>
              @switch (hwModel()) {
                @case ('lorae5') {
                  <ol class="text-xs text-base-content/70 space-y-1 list-decimal list-inside">
                    <li>Connect ST-LINK to LoRa-E5 SWD pins</li>
                    <li>Run this command:</li>
                  </ol>
                }
                @case ('heltec_v3') {
                  <ol class="text-xs text-base-content/70 space-y-1 list-decimal list-inside">
                    <li>Connect USB cable to Heltec V3</li>
                    <li>Hold BOOT button, press RST, release BOOT</li>
                    <li>Run this command:</li>
                  </ol>
                }
                @default {
                  <ol class="text-xs text-base-content/70 space-y-1 list-decimal list-inside">
                    <li>Hold BOOTSEL button on Pico W</li>
                    <li>Connect USB cable while holding button</li>
                    <li>Release button — drive "RPI-RP2" appears</li>
                    <li>Run this command:</li>
                  </ol>
                }
              }
              <div class="relative bg-base-300 rounded-lg p-2">
                <code class="text-xs font-mono break-all">{{ flashCommand() }}</code>
                <button class="btn btn-ghost btn-xs absolute top-1 right-1" (click)="copyFlashCmd()">Copy</button>
              </div>
            </div>
          }

          @if (buildLog()) {
            <details class="mt-2">
              <summary class="text-xs cursor-pointer text-base-content/50">Build log</summary>
              <pre class="text-xs bg-base-300 rounded-lg p-2 mt-1 overflow-x-auto max-h-48">{{ buildLog() }}</pre>
            </details>
          }
        </div>
      </div>

    </div>
  `,
})
export class FirmwareTabComponent implements OnInit {
  eui = input.required<string>();

  private api = inject(ApiService);

  // State
  requiredDrivers = signal<string[]>([]);
  transport = signal<string>('wifi');
  hwModel = signal<string>('rp2040');
  buildStatus = signal<string>('none');
  buildLog = signal<string>('');
  deviceToken = signal<string>('');
  appKey = signal<string>('');
  showPass = signal(false);
  savingCreds = signal(false);
  credsMsg = signal('');
  credsOk = signal(true);
  building = signal(false);

  wifiSSID = '';
  wifiPassword = '';
  backendURL = '';

  hwLabel = signal('');
  downloadUrl = signal('');

  ngOnInit(): void {
    this.loadStatus();
    this.downloadUrl.set(this.api.getFirmwareDownloadUrl(this.eui()));

    // Load credentials from device record
    this.api.getDeviceCredentials(this.eui()).subscribe(creds => {
      this.transport.set(creds.transport || 'wifi');
      this.deviceToken.set(creds.device_token || '');
      this.appKey.set(creds.app_key || '');
    });
  }

  private loadStatus(): void {
    this.api.getFirmwareStatus(this.eui()).subscribe(status => {
      this.requiredDrivers.set((status['required_drivers'] as string[]) ?? []);
      this.buildStatus.set((status['build_status'] as string) ?? 'none');
      this.buildLog.set((status['build_log'] as string) ?? '');
      this.hwModel.set((status['hardware_model'] as string) ?? 'rp2040');
      this.transport.set((status['transport'] as string) ?? 'wifi');
      this.wifiSSID = (status['wifi_ssid'] as string) ?? '';
      this.backendURL = (status['backend_url'] as string) ?? '';

      const model = this.hwModel();
      const labels: Record<string, string> = {
        lorae5: 'STM32WL (Seeed LoRa-E5)',
        heltec_v3: 'ESP32-S3 (Heltec WiFi LoRa 32 V3)',
        rp2040: 'RP2040 (Raspberry Pi Pico W)',
      };
      this.hwLabel.set(labels[model] ?? model);
    });
  }

  saveCredentials(): void {
    this.savingCreds.set(true);
    this.credsMsg.set('');
    this.api.saveFirmwareCredentials(this.eui(), {
      wifi_ssid: this.wifiSSID,
      wifi_password: this.wifiPassword,
      backend_url: this.backendURL,
    }).subscribe({
      next: () => {
        this.savingCreds.set(false);
        this.credsOk.set(true);
        this.credsMsg.set('Credentials saved');
      },
      error: (err) => {
        this.savingCreds.set(false);
        this.credsOk.set(false);
        this.credsMsg.set('Save failed: ' + (err?.message ?? 'unknown'));
      },
    });
  }

  triggerBuild(): void {
    this.building.set(true);
    this.buildStatus.set('building');
    this.buildLog.set('');
    this.api.buildFirmware(this.eui()).subscribe({
      next: (res) => {
        this.building.set(false);
        this.buildStatus.set(res['success'] ? 'success' : 'failed');
        this.buildLog.set((res['build_log'] as string) ?? '');
        if (res['success']) {
          this.downloadUrl.set(this.api.getFirmwareDownloadUrl(this.eui()));
        }
      },
      error: (err) => {
        this.building.set(false);
        this.buildStatus.set('failed');
        this.buildLog.set(err?.message ?? 'Build request failed');
      },
    });
  }

  fwExtension(): string {
    switch (this.hwModel()) {
      case 'lorae5': return '.elf';
      case 'heltec_v3': return '.bin';
      default: return '.uf2';
    }
  }

  flashCommand(): string {
    const url = this.downloadUrl();
    switch (this.hwModel()) {
      case 'lorae5':
        return `curl -sL ${url} -o firmware.elf && tinygo flash -target=lorae5 firmware.elf`;
      case 'heltec_v3':
        return `curl -sL ${url} -o firmware.bin && esptool.py --chip esp32s3 write_flash 0x0 firmware.bin`;
      default:
        return `curl -sL ${url} -o fw.uf2 && cp fw.uf2 /media/$USER/RPI-RP2/`;
    }
  }

  copyFlashCmd(): void {
    navigator.clipboard?.writeText(this.flashCommand());
  }
}
