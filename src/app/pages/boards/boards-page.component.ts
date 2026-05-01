import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ElectronService } from '../../core/services/electron.service';
import { SerialMonitorComponent } from '../../shared/serial-monitor/serial-monitor.component';
import { ConnectivityConfigComponent } from '../../shared/connectivity-config/connectivity-config.component';
import { FirmwareFilesTableComponent } from '../../shared/firmware-files-table/firmware-files-table.component';
import { FirmwareBuildPanelComponent } from '../../shared/firmware-build-panel/firmware-build-panel.component';
import type { BoardListEntry, ToolchainInfo } from '../../core/models/electron-api';
import { type FirmwareSecrets, EMPTY_FIRMWARE_SECRETS } from '../../core/models/firmware-secrets';
import { randomBase64, randomHex } from '../../core/util/random-keys';
import { effectiveTransport, type NetworkConfig, type NetworkTransport } from '@far-mon/core';

interface FileEntry {
  path: string;
  description: string;
  lines: number;
}

@Component({
  selector: 'app-boards-page',
  standalone: true,
  imports: [
    FormsModule,
    SerialMonitorComponent,
    ConnectivityConfigComponent,
    FirmwareFilesTableComponent,
    FirmwareBuildPanelComponent,
  ],
  host: { class: 'flex-1 overflow-auto' },
  template: `
    <div class="flex-1 flex flex-col h-full overflow-auto">
      <div class="max-w-5xl mx-auto w-full px-8 py-8">

        <!-- Header -->
        <div class="flex items-center justify-between mb-8">
          <div>
            <h1 class="text-2xl font-bold tracking-tight">Boards</h1>
            <p class="text-sm text-base-content/50 mt-1">Manage board definitions and run hardware self-tests</p>
          </div>
          <button class="btn btn-ghost btn-sm gap-1.5" routerLink="/overview">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Sites
          </button>
        </div>

        <!-- Board cards -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          @for (board of boards(); track board.id) {
            <button
              class="card bg-base-100 border transition-all text-left"
              [class.border-primary]="selectedBoard() === board.id"
              [class.shadow-md]="selectedBoard() === board.id"
              [class.border-base-300/50]="selectedBoard() !== board.id"
              [class.hover:border-primary/40]="selectedBoard() !== board.id"
              (click)="selectBoard(board.id)"
            >
              <div class="card-body p-4 gap-1">
                <h2 class="card-title text-sm">{{ board.label }}</h2>
                <p class="text-xs font-mono text-base-content/40">{{ board.model }}</p>
                @if (board.id === selectedBoard() && boardFeatures()) {
                  <div class="flex flex-wrap gap-1 mt-2">
                    @for (feat of boardFeatures(); track feat) {
                      <span class="badge badge-ghost badge-xs">{{ feat }}</span>
                    }
                  </div>
                }
              </div>
            </button>
          }
        </div>

        <!-- Self-Test section (when board selected) -->
        @if (selectedBoard()) {
          <div class="space-y-4">
            <h2 class="text-lg font-semibold">Self-Test: {{ selectedBoardLabel() }}</h2>

            <!-- Connectivity -->
            <app-connectivity-config
              [ssid]="secrets().wifi_ssid"
              [password]="secrets().wifi_password"
              [network]="network()"
              [supportedTransports]="supportedTransports()"
              [apiKey]="secrets().api_key"
              [otaPassword]="secrets().ota_password"
              (ssidChange)="updateSecret('wifi_ssid', $event)"
              (passwordChange)="updateSecret('wifi_password', $event)"
              (networkChange)="network.set($event)"
              (apiKeyChange)="updateSecret('api_key', $event)"
              (otaPasswordChange)="updateSecret('ota_password', $event)"
              (regenerateApiKey)="regenerateKey('api_key')"
              (regenerateOtaPassword)="regenerateKey('ota_password')"
            />

            <!-- Generate -->
            <div class="bg-base-100 rounded-xl border border-base-300/40 overflow-hidden">
              <div class="flex items-center justify-between px-5 py-3.5">
                <div>
                  <h3 class="font-semibold text-sm">Self-Test Firmware</h3>
                  <p class="text-xs text-base-content/60 mt-0.5">Cycles through all hardware features without wiring</p>
                </div>
                <button
                  class="btn btn-primary btn-xs gap-1.5"
                  (click)="generate()"
                  [disabled]="generating() || (transport() === 'wifi' && !secrets()['wifi_ssid'])"
                >
                  @if (generating()) { <span class="loading loading-spinner loading-xs"></span> }
                  {{ files().length > 0 ? 'Regenerate' : 'Generate' }}
                </button>
              </div>

              @if (files().length > 0) {
                <app-firmware-files-table
                  [files]="files()"
                  [outputDir]="outputDir()"
                  (fileClick)="openFile($event)"
                  (openFolder)="openOutputFolder()"
                />
              }
            </div>

            <!-- Compile & Flash -->
            @if (files().length > 0) {
              <app-firmware-build-panel
                heading="Build & Flash"
                subheading="Compile and flash self-test firmware"
                [deviceDir]="deviceDir()"
                [toolchain]="toolchain()"
                (errorOccurred)="error.set($event)"
              />
            }

            <!-- Error -->
            @if (error()) {
              <div class="alert alert-error py-2 text-sm rounded-xl">
                <span class="font-mono text-xs">{{ error() }}</span>
              </div>
            }

            <!-- Serial Monitor -->
            <app-serial-monitor />
          </div>
        }
      </div>
    </div>
  `,
})
export class BoardsPageComponent implements OnInit {
  private electron = inject(ElectronService);

  protected boards = signal<BoardListEntry[]>([]);
  protected selectedBoard = signal<string | null>(null);
  private boardDefs = new Map<string, { board: unknown; svg: string | null }>();

  protected generating = signal(false);
  protected files = signal<FileEntry[]>([]);
  protected outputDir = signal('');
  protected deviceDir = signal('');
  protected error = signal<string | null>(null);

  protected secrets = signal<FirmwareSecrets>({ ...EMPTY_FIRMWARE_SECRETS });

  protected network = signal<NetworkConfig>({ mode: 'dhcp' });

  protected toolchain = signal<ToolchainInfo | null>(null);

  protected selectedBoardLabel = computed(() => {
    const id = this.selectedBoard();
    return this.boards().find(b => b.id === id)?.label ?? '';
  });

  protected supportedTransports = computed<readonly NetworkTransport[]>(() => {
    const id = this.selectedBoard();
    if (!id) return ['wifi'];
    const def = this.boardDefs.get(id);
    if (!def) return ['wifi'];
    const b = def.board as Record<string, unknown>;
    const periphs = b['peripherals'] as Record<string, unknown> | undefined;
    return periphs?.['ethernet'] ? ['ethernet', 'wifi'] : ['wifi'];
  });

  protected transport = computed(() =>
    effectiveTransport(this.network(), this.supportedTransports())
  );

  protected boardFeatures = computed(() => {
    const id = this.selectedBoard();
    if (!id) return [];
    const def = this.boardDefs.get(id);
    if (!def) return [];
    const b = def.board as Record<string, unknown>;
    const periphs = b['peripherals'] as Record<string, unknown> | undefined;
    const pins = b['pins'] as unknown[] | undefined;
    const expanders = b['expanders'] as unknown[] | undefined;
    const features: string[] = [];
    if (periphs?.['ethernet']) features.push('Ethernet');
    if (!periphs?.['ethernet']) features.push('WiFi');
    if (periphs?.['oled']) features.push('OLED');
    if (periphs?.['lora']) features.push('LoRa');
    if (periphs?.['battery']) features.push('Battery');
    if (expanders?.length) features.push(`${expanders.length}x I2C Expander`);
    if (pins?.length) features.push(`${pins.length} pins`);
    return features;
  });

  async ngOnInit() {
    this.boards.set(await this.electron.boardList());
    this.toolchain.set(await this.electron.toolchainStatus());
  }

  async selectBoard(id: string) {
    this.selectedBoard.set(id);
    this.files.set([]);
    this.outputDir.set('');
    this.deviceDir.set('');
    this.error.set(null);

    if (!this.boardDefs.has(id)) {
      const data = await this.electron.boardLoad(id);
      this.boardDefs.set(id, data);
    }

    const saved = await this.electron.secretsGet('__selftest__', id);
    if (saved && Object.keys(saved).length > 0) {
      this.secrets.set({
        wifi_ssid: saved['wifi_ssid'] ?? '',
        wifi_password: saved['wifi_password'] ?? '',
        api_key: saved['api_key'] ?? '',
        ota_password: saved['ota_password'] ?? '',
      });
    } else {
      const fresh: FirmwareSecrets = {
        ...EMPTY_FIRMWARE_SECRETS,
        api_key: randomBase64(32),
        ota_password: randomHex(16),
      };
      this.secrets.set(fresh);
      await this.electron.secretsSet('__selftest__', id, fresh);
    }
  }

  updateSecret(key: keyof FirmwareSecrets, value: string) {
    const s: FirmwareSecrets = { ...this.secrets(), [key]: value };
    this.secrets.set(s);
    const id = this.selectedBoard();
    if (id) this.electron.secretsSet('__selftest__', id, s);
  }

  regenerateKey(key: 'api_key' | 'ota_password') {
    // Self-test firmware is throwaway — regenerate immediately, no confirm needed.
    const value = key === 'api_key' ? randomBase64(32) : randomHex(16);
    this.updateSecret(key, value);
  }

  async generate() {
    const boardId = this.selectedBoard();
    if (!boardId) return;
    this.generating.set(true);
    this.error.set(null);
    try {
      const result = await this.electron.generateSelfTest(boardId, this.secrets(), this.network());
      this.files.set(result.files);
      this.outputDir.set(result.outputDir);
      this.deviceDir.set(result.deviceDir);
    } catch (err) {
      this.error.set(String(err));
    } finally {
      this.generating.set(false);
    }
  }

  async openFile(relativePath: string) {
    const dir = this.outputDir();
    if (dir) await this.electron.shellOpenPath(`${dir}/${relativePath}`);
  }

  async openOutputFolder() {
    const dir = this.outputDir();
    if (dir) await this.electron.shellShowInFolder(dir);
  }
}
