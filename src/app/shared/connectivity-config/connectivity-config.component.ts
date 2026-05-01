import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { effectiveTransport, type NetworkConfig, type NetworkTransport } from '@far-mon/core';
import { isApiKeyValid } from '../../core/models/firmware-secrets';

/**
 * Transport selector + (conditional) WiFi credentials + IP configuration +
 * security keys (OTA password, API encryption key). Presentational only —
 * caller owns state and persists via outputs, including the regenerate flow.
 *
 * ESPHome treats ethernet and wifi as XOR per device. The selector reflects
 * the effective transport (board capability + stored choice). Wifi-only
 * boards skip the selector entirely. Wifi credentials only render — and
 * are only validated by callers — when the effective transport is wifi.
 */
@Component({
  selector: 'app-connectivity-config',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="bg-base-100 rounded-xl border border-base-300/40 overflow-hidden">
      <!-- Transport selector -->
      @if (hasChoice()) {
        <div class="px-5 py-4 border-b border-base-300/30">
          <span class="block text-xs font-semibold text-base-content/50 uppercase tracking-wider mb-2">Connection</span>
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              class="btn btn-sm gap-2 justify-start"
              [class.btn-primary]="transport() === 'ethernet'"
              [class.btn-ghost]="transport() !== 'ethernet'"
              [class.border]="transport() !== 'ethernet'"
              [class.border-base-300]="transport() !== 'ethernet'"
              (click)="select('ethernet')"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
              <div class="flex flex-col items-start text-left">
                <span class="text-sm font-semibold leading-tight">Ethernet</span>
                <span class="text-[10px] opacity-70 leading-tight">Wired, no creds</span>
              </div>
            </button>
            <button
              type="button"
              class="btn btn-sm gap-2 justify-start"
              [class.btn-primary]="transport() === 'wifi'"
              [class.btn-ghost]="transport() !== 'wifi'"
              [class.border]="transport() !== 'wifi'"
              [class.border-base-300]="transport() !== 'wifi'"
              (click)="select('wifi')"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0" />
              </svg>
              <div class="flex flex-col items-start text-left">
                <span class="text-sm font-semibold leading-tight">WiFi</span>
                <span class="text-[10px] opacity-70 leading-tight">+ fallback AP</span>
              </div>
            </button>
          </div>
          <p class="text-[11px] text-base-content/50 mt-2">
            @if (transport() === 'ethernet') {
              No on-device recovery if the cable drops — switch transport &amp; re-flash to regain access.
            } @else {
              Fallback AP <span class="font-mono">&lt;device&gt; Fallback</span> (same password as WiFi) exposes the captive portal at <span class="font-mono">192.168.4.1</span> for re-entering credentials and OTA updates. The entity dashboard is served only on the home network at <span class="font-mono">http://&lt;device&gt;.local/</span>.
            }
          </p>
        </div>
      }

      <!-- WiFi credentials (only for the wifi transport) -->
      @if (transport() === 'wifi') {
        <div class="px-5 py-4 border-b border-base-300/30">
          <span class="block text-xs font-semibold text-base-content/50 uppercase tracking-wider mb-3">WiFi Credentials</span>
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1">
              <span class="text-xs font-medium">SSID</span>
              <input
                type="text"
                class="input input-bordered input-sm w-full"
                [class.input-warning]="!ssid()"
                [ngModel]="ssid()"
                (ngModelChange)="ssidChange.emit($event)"
                placeholder="Network name"
              />
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs font-medium">Password</span>
              <input
                type="password"
                class="input input-bordered input-sm w-full"
                [class.input-warning]="!password() || password().length < 8"
                [ngModel]="password()"
                (ngModelChange)="passwordChange.emit($event)"
                placeholder="Min 8 characters"
              />
              @if (password().length > 0 && password().length < 8) {
                <span class="text-warning text-[10px]">Min 8 characters (WPA2)</span>
              }
            </div>
          </div>
        </div>
      }

      <!-- IP configuration -->
      <div class="px-5 py-4">
        <div class="flex items-center justify-between mb-3">
          <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider">IP Configuration</span>
          <div class="flex items-center gap-1 bg-base-200/60 rounded-lg p-0.5">
            <button class="btn btn-xs border-0 rounded-md"
              [class.btn-primary]="mode() === 'dhcp'"
              [class.btn-ghost]="mode() === 'static'"
              (click)="setMode('dhcp')">DHCP</button>
            <button class="btn btn-xs border-0 rounded-md"
              [class.btn-primary]="mode() === 'static'"
              [class.btn-ghost]="mode() === 'dhcp'"
              (click)="setMode('static')">Static</button>
          </div>
        </div>
        @if (mode() === 'static') {
          <div class="grid grid-cols-2 gap-3">
            <div class="flex flex-col gap-1">
              <span class="text-xs font-medium">IP Address</span>
              <input type="text" class="input input-bordered input-sm font-mono w-full"
                [ngModel]="network()?.static_ip ?? ''"
                (ngModelChange)="setField('static_ip', $event)"
                placeholder="192.168.1.100" />
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs font-medium">Gateway</span>
              <input type="text" class="input input-bordered input-sm font-mono w-full"
                [ngModel]="network()?.gateway ?? ''"
                (ngModelChange)="setField('gateway', $event)"
                placeholder="192.168.1.1" />
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs font-medium">Subnet</span>
              <input type="text" class="input input-bordered input-sm font-mono w-full"
                [ngModel]="network()?.subnet ?? ''"
                (ngModelChange)="setField('subnet', $event)"
                placeholder="255.255.255.0" />
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs font-medium">DNS</span>
              <input type="text" class="input input-bordered input-sm font-mono w-full"
                [ngModel]="network()?.dns1 ?? ''"
                (ngModelChange)="setField('dns1', $event)"
                placeholder="8.8.8.8" />
            </div>
          </div>
        } @else {
          <p class="text-xs text-base-content/40">IP address assigned automatically by router.</p>
        }
      </div>

      <!-- Security Keys (collapsible) -->
      <div class="border-t border-base-300/30">
        <button
          type="button"
          class="flex items-center justify-between w-full px-5 py-3 text-left hover:bg-base-200/30 transition-colors"
          (click)="showSecurityKeys.set(!showSecurityKeys())"
        >
          <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider">Security Keys</span>
          <svg xmlns="http://www.w3.org/2000/svg"
            class="h-3.5 w-3.5 text-base-content/40 transition-transform"
            [class.rotate-180]="showSecurityKeys()"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        @if (showSecurityKeys()) {
          <div class="px-5 pb-4 space-y-3">
            <p class="text-[11px] text-base-content/50">
              The fallback AP <span class="font-mono">&lt;device&gt; Fallback</span> reuses your WiFi password. The captive portal at <span class="font-mono">192.168.4.1</span> only re-collects WiFi credentials &amp; accepts OTA uploads — the entity dashboard is reachable only on the home network.
            </p>
            <div class="flex flex-col gap-1">
              <span class="text-xs font-medium">OTA Password</span>
              <div class="join w-full">
                <input type="text" class="input input-bordered input-sm font-mono text-sm join-item flex-1"
                  [ngModel]="otaPassword()"
                  (ngModelChange)="otaPasswordChange.emit($event)" />
                <button type="button"
                  class="btn btn-ghost btn-sm join-item border border-base-300"
                  (click)="regenerateOtaPassword.emit()"
                  title="Regenerate">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1z" clip-rule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-xs font-medium">API Encryption Key</span>
              <div class="join w-full">
                <input type="text" class="input input-bordered input-sm font-mono text-sm join-item flex-1"
                  [ngModel]="apiKey()"
                  (ngModelChange)="apiKeyChange.emit($event)" />
                <button type="button"
                  class="btn btn-ghost btn-sm join-item border border-base-300"
                  (click)="regenerateApiKey.emit()"
                  title="Regenerate">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1z" clip-rule="evenodd" />
                  </svg>
                </button>
              </div>
              @if (!apiKeyValid()) {
                <span class="text-warning text-[10px]">Must be valid base64 (32 bytes)</span>
              }
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class ConnectivityConfigComponent {
  readonly ssid = input.required<string>();
  readonly password = input.required<string>();
  readonly network = input<NetworkConfig | undefined>(undefined);
  /** Network transports the board supports (e.g. `['wifi']` or `['ethernet','wifi']`). */
  readonly supportedTransports = input<readonly NetworkTransport[]>(['wifi']);
  readonly apiKey = input.required<string>();
  readonly otaPassword = input.required<string>();

  readonly ssidChange = output<string>();
  readonly passwordChange = output<string>();
  readonly networkChange = output<NetworkConfig>();
  readonly apiKeyChange = output<string>();
  readonly otaPasswordChange = output<string>();
  readonly regenerateApiKey = output<void>();
  readonly regenerateOtaPassword = output<void>();

  protected showSecurityKeys = signal(false);

  /** True when the board has more than one transport — i.e. the user has a real choice. */
  protected hasChoice = computed(() => this.supportedTransports().length > 1);
  protected transport = computed(() => effectiveTransport(this.network(), this.supportedTransports()));
  protected mode = computed(() => this.network()?.mode ?? 'dhcp');
  protected apiKeyValid = computed(() => isApiKeyValid(this.apiKey()));

  protected select(transport: NetworkTransport) {
    this.networkChange.emit({ ...(this.network() ?? { mode: 'dhcp' }), transport });
  }

  protected setMode(mode: 'dhcp' | 'static') {
    this.networkChange.emit({ ...(this.network() ?? { mode: 'dhcp' }), mode });
  }

  protected setField(field: 'static_ip' | 'gateway' | 'subnet' | 'dns1' | 'dns2', value: string) {
    const current = this.network() ?? { mode: 'static' as const };
    this.networkChange.emit({ ...current, [field]: value });
  }
}
