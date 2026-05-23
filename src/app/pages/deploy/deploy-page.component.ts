import {
  Component, inject, OnInit, OnDestroy, signal, computed,
  ElementRef, ViewChild, NgZone, Injector, AfterViewInit,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';
import { WorkspaceService } from '../../core/services/workspace.service';
import { ElectronService } from '../../core/services/electron.service';
import { BoardService } from '../../core/services/board.service';
import { ValidationPanelComponent } from '../../shared/validation-panel/validation-panel.component';
import { SerialMonitorComponent } from '../../shared/serial-monitor/serial-monitor.component';
import { ConnectivityConfigComponent } from '../../shared/connectivity-config/connectivity-config.component';
import { FirmwareFilesTableComponent } from '../../shared/firmware-files-table/firmware-files-table.component';
import { FirmwareBuildPanelComponent } from '../../shared/firmware-build-panel/firmware-build-panel.component';
import { TopologyRenderer } from '../../shared/canvas/topology-renderer';
import { renderCompositeOverlays, renderPerSystemOverlays } from '../../shared/canvas/topology-overlays';
// TODO(anchor-mesh): enrichPerSystemInterconnects removed — replace with site-level route analysis
import { ConfirmService } from '../../core/services/confirm.service';
import { FormsModule } from '@angular/forms';
import type { ToolchainInfo, GenerationMeta } from '../../core/models/electron-api';
import { type FirmwareSecrets, EMPTY_FIRMWARE_SECRETS, isApiKeyValid } from '../../core/models/firmware-secrets';
import { randomBase64, randomHex } from '../../core/util/random-keys';
import { boardSupportedTransports, effectiveTransport, type NetworkConfig, type NetworkTransport } from '@far-mon/core';

type ActiveTab = 'docs' | 'firmware' | 'ha' | 'serial';

interface FileEntry {
  path: string;
  description: string;
  lines: number;
}

@Component({
  selector: 'app-deploy-page',
  standalone: true,
  imports: [
    ValidationPanelComponent,
    SerialMonitorComponent,
    ConnectivityConfigComponent,
    FirmwareFilesTableComponent,
    FirmwareBuildPanelComponent,
    FormsModule,
  ],
  host: { class: 'flex-1 flex flex-col overflow-hidden' },
  template: `
    <div class="flex-1 flex flex-col min-h-0">
      <!-- Tab bar -->
      <div class="flex items-center gap-0 bg-base-100 border-b border-base-300/30 px-6 shrink-0">
        <button
          class="px-4 py-3 text-sm font-medium border-b-2 transition-colors"
          [class.border-primary]="activeTab() === 'docs'"
          [class.text-primary]="activeTab() === 'docs'"
          [class.border-transparent]="activeTab() !== 'docs'"
          [class.text-base-content/50]="activeTab() !== 'docs'"
          (click)="activeTab.set('docs')"
        >Documentation</button>
        <button
          class="px-4 py-3 text-sm font-medium border-b-2 transition-colors"
          [class.border-primary]="activeTab() === 'firmware'"
          [class.text-primary]="activeTab() === 'firmware'"
          [class.border-transparent]="activeTab() !== 'firmware'"
          [class.text-base-content/50]="activeTab() !== 'firmware'"
          (click)="activeTab.set('firmware')"
        >Firmware</button>
        <button
          class="px-4 py-3 text-sm font-medium border-b-2 transition-colors"
          [class.border-primary]="activeTab() === 'ha'"
          [class.text-primary]="activeTab() === 'ha'"
          [class.border-transparent]="activeTab() !== 'ha'"
          [class.text-base-content/50]="activeTab() !== 'ha'"
          (click)="activeTab.set('ha')"
        >Home Assistant</button>
        <button
          class="px-4 py-3 text-sm font-medium border-b-2 transition-colors"
          [class.border-primary]="activeTab() === 'serial'"
          [class.text-primary]="activeTab() === 'serial'"
          [class.border-transparent]="activeTab() !== 'serial'"
          [class.text-base-content/50]="activeTab() !== 'serial'"
          (click)="activeTab.set('serial')"
        >Serial</button>
      </div>

      @if (activeTab() === 'docs') {
        <div class="flex-1 flex flex-col min-h-0 overflow-auto">
          <div class="p-6 space-y-4">
            <!-- Generate docs -->
            <div class="bg-base-100 rounded-xl border border-base-300/40 px-5 py-4">
              <div class="flex items-center justify-between">
                <div>
                  <h2 class="font-semibold text-sm">Site Documentation</h2>
                  <p class="text-xs text-base-content/50 mt-0.5">
                    Generates comprehensive documentation for the entire site including per-controller wiring, topology, and installation guides.
                  </p>
                </div>
                <div class="flex items-center gap-2">
                  @if (siteDocHtml()) {
                    <button class="btn btn-ghost btn-xs gap-1" (click)="openDocInBrowser()">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2z"/>
                      </svg>
                      Print
                    </button>
                  }
                  <button
                    class="btn btn-primary btn-xs gap-1.5"
                    (click)="generateSiteDocs()"
                    [disabled]="generatingDocs()"
                  >
                    @if (generatingDocs()) { <span class="loading loading-spinner loading-xs"></span> }
                    {{ siteDocHtml() ? 'Regenerate' : 'Generate' }}
                  </button>
                </div>
              </div>
            </div>

            <!-- Doc preview -->
            @if (siteDocHtml()) {
              <div class="bg-base-100 rounded-xl border border-base-300/40 overflow-hidden" style="height: 70vh;">
                <iframe [srcdoc]="trustedSiteDocHtml()" class="w-full h-full border-0"></iframe>
              </div>
            } @else {
              <div class="bg-base-100 rounded-xl border border-base-300/40 flex items-center justify-center py-16">
                <div class="text-center text-base-content/40">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p class="text-sm font-medium">No documentation generated yet</p>
                  <p class="text-xs mt-1">Click "Generate" to create site-wide documentation.</p>
                </div>
              </div>
            }
          </div>
        </div>

        <!-- Hidden canvas for SVG export -->
        <div style="position: absolute; left: -9999px; top: -9999px; width: 1200px; height: 800px;">
          <div #hiddenCanvas></div>
        </div>
      }

      <!-- Firmware tab -->
      @if (activeTab() === 'firmware') {
        <div class="flex-1 flex flex-col min-h-0 overflow-auto">
          <div class="p-6 space-y-4">
            <!-- Controller selector -->
            <div class="flex items-center gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
              <span class="text-xs font-medium text-base-content/50 shrink-0">Controller</span>
              <select
                class="select select-bordered select-sm flex-1 max-w-xs"
                [value]="selectedSystemId()"
                (change)="selectSystem(toInputValue($event))"
              >
                <option value="">Select controller...</option>
                @for (entry of systemEntries(); track entry.id) {
                  <option [value]="entry.id">{{ entry.friendlyName }} ({{ entry.board }})</option>
                }
              </select>
              @if (selectedSystemId()) {
                <span class="badge badge-ghost badge-sm font-mono text-[10px]">{{ selectedBoardId() }}</span>
              }
            </div>

            @if (!selectedSystemId()) {
              <div class="bg-base-100 rounded-xl border border-base-300/40 flex items-center justify-center py-16">
                <p class="text-sm text-base-content/40">Select a controller to manage firmware.</p>
              </div>
            }

            @if (selectedSystemId()) {
              <!-- Network, credentials, security keys — single card -->
              <app-connectivity-config
                [ssid]="secrets().wifi_ssid"
                [password]="secrets().wifi_password"
                [network]="selectedNetwork()"
                [supportedTransports]="supportedTransports()"
                [apiKey]="secrets().api_key"
                [otaPassword]="secrets().ota_password"
                (ssidChange)="updateSecret('wifi_ssid', $event)"
                (passwordChange)="updateSecret('wifi_password', $event)"
                (networkChange)="updateNetwork($event)"
                (apiKeyChange)="updateSecret('api_key', $event)"
                (otaPasswordChange)="updateSecret('ota_password', $event)"
                (regenerateApiKey)="regenerateKey('api_key')"
                (regenerateOtaPassword)="regenerateKey('ota_password')"
              />
              <!-- Validation summary -->
              <div class="bg-base-100 rounded-xl border border-base-300/40 px-5 py-3.5">
                <h3 class="text-xs font-semibold text-base-content/50 uppercase tracking-wider mb-3">Validation</h3>
                <app-validation-panel
                  [result]="fwValidation()"
                  [gpioUsage]="null"
                />
              </div>

              <!-- Generate ESPHome -->
              <div class="bg-base-100 rounded-xl border border-base-300/40 overflow-hidden">
                <div class="flex items-center justify-between px-5 py-3.5">
                  <div class="flex items-center gap-3">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                    </svg>
                    <div>
                      <h2 class="font-semibold text-sm">ESPHome Firmware</h2>
                      <p class="text-xs text-base-content/60 mt-0.5">Device YAML, board package, route table, hardware + sensors</p>
                    </div>
                  </div>
                  <button
                    class="btn btn-primary btn-xs gap-1.5"
                    (click)="generate()"
                    [disabled]="generating()"
                  >
                    @if (generating()) { <span class="loading loading-spinner loading-xs"></span> }
                    {{ fwFiles().length > 0 ? 'Regenerate' : 'Generate' }}
                  </button>
                </div>

                @if (fwFiles().length > 0) {
                  <app-firmware-files-table
                    [files]="fwFiles()"
                    [outputDir]="fwOutputDir()"
                    (fileClick)="openFile($event)"
                    (openFolder)="openOutputFolder()"
                  />
                }
              </div>

              <!-- Generation History -->
              @if (fwLastGeneration() || fwFiles().length > 0) {
                <div class="bg-base-100 rounded-xl border border-base-300/40 overflow-hidden">
                  <div class="flex items-center justify-between px-5 py-3.5">
                    <div class="flex items-center gap-3">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div>
                        <h2 class="font-semibold text-sm">Generation History</h2>
                        <p class="text-xs text-base-content/50 mt-0.5">
                          @if (fwLastGeneration(); as gen) {
                            Latest: <span class="font-mono text-primary/70">{{ gen.version }}</span>
                            · {{ formatDate(gen.createdAt) }}
                            · {{ gen.fileCount }} files
                          } @else {
                            No previous generations
                          }
                        </p>
                      </div>
                    </div>
                    <button class="btn btn-ghost btn-xs" (click)="toggleHistory()">
                      {{ showHistory() ? 'Hide' : 'History' }}
                    </button>
                  </div>

                  @if (showHistory()) {
                    <div class="border-t border-base-300/30 px-5 py-3 bg-base-200/30 space-y-3">
                      @if (filteredHistory().length > 0) {
                        <table class="table table-xs">
                          <thead>
                            <tr>
                              <th class="text-xs uppercase tracking-wider text-base-content/50 font-semibold">Version</th>
                              <th class="text-xs uppercase tracking-wider text-base-content/50 font-semibold">Date</th>
                              <th class="text-xs uppercase tracking-wider text-base-content/50 font-semibold text-right">Files</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            @for (gen of filteredHistory(); track gen.id) {
                              <tr class="hover" [class.bg-primary/5]="gen.id === fwLastGeneration()?.id">
                                <td class="font-mono text-[11px] text-primary/70">{{ gen.version }}</td>
                                <td class="text-[11px] text-base-content/60">{{ formatDate(gen.createdAt) }}</td>
                                <td class="text-right text-[11px] tabular-nums text-base-content/60">{{ gen.fileCount }}</td>
                                <td class="text-right">
                                  <button
                                    class="btn btn-ghost btn-xs text-primary/60"
                                    (click)="restoreGeneration(gen.id)"
                                    [disabled]="generating()"
                                  >Restore</button>
                                </td>
                              </tr>
                            }
                          </tbody>
                        </table>
                      } @else {
                        <p class="text-xs text-base-content/40 italic py-2">No generation history</p>
                      }
                    </div>
                  }
                </div>
              }

              <!-- Build & Deploy -->
              <app-firmware-build-panel
                [deviceDir]="fwDeviceDir()"
                [toolchain]="toolchain()"
                [generator]="'esphome'"
                [canBuild]="canBuild()"
                [canBuildReason]="buildBlockedReason()"
                [showOta]="true"
                [showOpenFiles]="true"
                [initialOtaAddress]="otaAddress()"
                (errorOccurred)="fwError.set($event)"
                (openFiles)="openDeviceFolder()"
                (toolchainRefreshRequested)="refreshToolchain()"
              />

              <!-- Errors -->
              @if (fwError()) {
                <div class="alert alert-error py-2 text-sm rounded-xl">
                  <span class="font-mono text-xs">{{ fwError() }}</span>
                </div>
              }
            }
          </div>
        </div>
      }

      <!-- Home Assistant tab -->
      @if (activeTab() === 'ha') {
        <div class="flex-1 flex flex-col min-h-0 overflow-auto">
          <div class="p-6 space-y-4">
            <!-- Generate HA config (site-level) -->
            <div class="bg-base-100 rounded-xl border border-base-300/40 overflow-hidden">
              <div class="flex items-center justify-between px-5 py-3.5">
                <div class="flex items-center gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                  <div>
                    <h2 class="font-semibold text-sm">Home Assistant Config</h2>
                    <p class="text-xs text-base-content/60 mt-0.5">
                      Site dashboard (overview + per-controller tabs) and automations for all {{ systemEntries().length }} controllers
                    </p>
                  </div>
                </div>
                <button
                  class="btn btn-primary btn-xs gap-1.5"
                  (click)="generateHaConfig()"
                  [disabled]="haGenerating()"
                >
                  @if (haGenerating()) { <span class="loading loading-spinner loading-xs"></span> }
                  {{ haFiles().length > 0 ? 'Regenerate' : 'Generate' }}
                </button>
              </div>

              @if (haFiles().length > 0) {
                <app-firmware-files-table
                  [files]="haFiles()"
                  [outputDir]="haOutputDir()"
                  (fileClick)="openFile($event)"
                  (openFolder)="openHaFolder()"
                />
              }
            </div>

            <!-- Integration Steps -->
            <div class="bg-base-100 rounded-xl border border-base-300/40 px-5 py-4">
              <div class="flex items-center gap-3 mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <h2 class="font-semibold text-sm">After generating</h2>
              </div>
              <ol class="list-decimal list-inside text-sm text-base-content/80 space-y-2">
                <li>
                  Copy the generated files into your Home Assistant config directory.
                  @if (haFiles().length > 0) {
                    <button class="btn btn-ghost btn-xs ml-1 align-baseline" (click)="openHaFolder()">Open folder</button>
                  }
                </li>
                <li>
                  Pair each controller in HA: <em>Settings → Devices &amp; Services → Add Integration → ESPHome</em>.
                  @if (systemEntries().length > 0) {
                    <ul class="list-disc list-inside ml-6 mt-1 text-xs text-base-content/60 space-y-0.5">
                      @for (entry of systemEntries(); track entry.id) {
                        <li>
                          <span class="font-medium text-base-content/80">{{ entry.friendlyName }}</span>
                          <span class="opacity-60"> — </span>
                          <code class="font-mono text-[11px]">{{ entry.deviceName }}.local</code>
                        </li>
                      }
                    </ul>
                  }
                  <p class="text-xs text-base-content/50 mt-1 ml-6">API key for each controller is in its <code class="font-mono">secrets.yaml</code>.</p>
                </li>
                <li>Reload Home Assistant — <em>Developer Tools → YAML → All YAML configuration</em>, or restart the service.</li>
                <li>Open the dashboard. Every entity card should resolve (no &ldquo;entity not found&rdquo;).</li>
              </ol>
            </div>

            <!-- HA Errors -->
            @if (haError()) {
              <div class="alert alert-error py-2 text-sm rounded-xl">
                <span class="font-mono text-xs">{{ haError() }}</span>
              </div>
            }
          </div>
        </div>
      }

      <!-- Serial tab -->
      @if (activeTab() === 'serial') {
        <div class="flex-1 flex flex-col min-h-0 p-6">
          <app-serial-monitor class="flex-1 flex flex-col min-h-0" />
        </div>
      }
    </div>
  `,
})
export class DeployPageComponent implements OnInit, OnDestroy, AfterViewInit {
  protected workspace = inject(WorkspaceService);
  private electron = inject(ElectronService);
  private boards = inject(BoardService);
  private confirmService = inject(ConfirmService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private zone = inject(NgZone);
  private injector = inject(Injector);
  private sanitizer = inject(DomSanitizer);

  @ViewChild('hiddenCanvas') private hiddenCanvasRef?: ElementRef<HTMLElement>;

  protected activeTab = signal<ActiveTab>('firmware');
  private siteName: string | null = null;

  // === Docs state ===
  protected generatingDocs = signal(false);
  protected siteDocHtml = signal<string | null>(null);
  private topologyRenderer: TopologyRenderer | null = null;

  // === Firmware state ===
  protected selectedSystemId = signal('');
  protected systemEntries = signal<Array<{ id: string; friendlyName: string; board: string; deviceName: string }>>([]);

  // Generate
  protected fwFiles = signal<FileEntry[]>([]);
  protected fwOutputDir = signal('');
  protected fwDeviceDir = signal('');
  protected generating = signal(false);
  protected fwValidation = signal<any>(null);
  protected fwError = signal<string | null>(null);

  // Build state owned by the embedded panel; deploy keeps just the toolchain
  // (used for canBuild) and the OTA address (per-system seed).
  protected toolchain = signal<ToolchainInfo | null>(null);
  protected otaAddress = signal('');

  // Firmware generation history
  protected fwLastGeneration = signal<GenerationMeta | null>(null);
  protected generationHistory = signal<GenerationMeta[]>([]);
  protected showHistory = signal(false);

  // Secrets
  protected secrets = signal<FirmwareSecrets>({ ...EMPTY_FIRMWARE_SECRETS });
  private secretsSaveTimer: ReturnType<typeof setTimeout> | null = null;

  protected transport = computed(() =>
    effectiveTransport(this.selectedNetwork(), this.supportedTransports())
  );

  protected secretsHasPlaceholders = computed(() => {
    if (this.transport() !== 'wifi') return false;
    const s = this.secrets();
    return !s.wifi_ssid || !s.wifi_password;
  });

  protected secretsValid = computed(() => {
    const s = this.secrets();
    const wifiOk = this.transport() !== 'wifi' || (!!s.wifi_ssid && !!s.wifi_password && s.wifi_password.length >= 8);
    return wifiOk && !!s.ota_password && isApiKeyValid(s.api_key);
  });

  // HA state (site-level)
  protected haFiles = signal<FileEntry[]>([]);
  protected haOutputDir = signal('');
  protected haGenerating = signal(false);
  protected haError = signal<string | null>(null);


  protected canBuild = computed(() =>
    !!this.toolchain()?.esphomePath && this.fwFiles().length > 0 && this.secretsValid()
  );

  protected buildBlockedReason = computed(() => {
    if (this.secretsHasPlaceholders()) return 'Configure WiFi secrets above before compiling';
    if (!this.secretsValid()) return 'Fix secret validation errors above';
    return '';
  });

  protected filteredHistory = computed(() => this.generationHistory());

  protected selectedBoardId = computed(() => {
    const id = this.selectedSystemId();
    if (!id) return '';
    const sys = this.workspace.systems().get(id);
    return sys?.topology.device.board ?? '';
  });

  protected selectedNetwork = computed(() => {
    const id = this.selectedSystemId();
    if (!id) return undefined;
    return this.workspace.systems().get(id)?.topology.device.network;
  });

  protected supportedTransports = computed<readonly NetworkTransport[]>(() => {
    const board = this.boards.activeBoard();
    return board ? boardSupportedTransports(board) : ['wifi'];
  });

  protected updateNetwork(network: NetworkConfig) {
    const id = this.selectedSystemId();
    if (!id) return;
    this.workspace.updateSystemTopology(id, (t) => {
      t.device.network = network;
    });
  }

  protected trustedSiteDocHtml = computed(() => {
    const html = this.siteDocHtml();
    return html ? this.sanitizer.bypassSecurityTrustHtml(html) : '';
  });

  async ngOnInit() {
    this.siteName = this.route.snapshot.paramMap.get('name');
    if (!this.siteName) { this.router.navigate(['/overview']); return; }

    if (!this.workspace.site() || this.workspace.site()?.id !== this.siteName) {
      await this.workspace.load(this.siteName);
    }

    this.updateSystemEntries();
    this.toolchain.set(await this.electron.toolchainStatus());
  }

  ngAfterViewInit() {
    this.initTopologyRenderer();
  }

  ngOnDestroy() {
    this.topologyRenderer?.destroy();
  }

  private updateSystemEntries() {
    const entries: Array<{ id: string; friendlyName: string; board: string; deviceName: string }> = [];
    for (const [id, { topology }] of this.workspace.systems()) {
      entries.push({
        id,
        friendlyName: topology.device.friendly_name,
        board: topology.device.board,
        deviceName: topology.device.name,
      });
    }
    this.systemEntries.set(entries);
  }

  private initTopologyRenderer() {
    if (!this.hiddenCanvasRef) return;
    this.topologyRenderer = new TopologyRenderer(this.hiddenCanvasRef.nativeElement);
  }

  // === Docs methods ===

  async generateSiteDocs() {
    if (!this.workspace.site()) return;

    if (!this.topologyRenderer && this.hiddenCanvasRef) this.initTopologyRenderer();
    const renderer = this.topologyRenderer;
    const composite = this.workspace.compositeTopology();
    if (!renderer || !composite || composite.nodes.length === 0) return;

    this.generatingDocs.set(true);
    try {
      const systemsMap = this.workspace.systems();
      const linksData = this.workspace.links();
      const overlayCtx = { systems: systemsMap, links: linksData };

      const friendlyNames = new Map<string, string>();
      for (const [id, { topology }] of systemsMap) {
        friendlyNames.set(id, topology.device.friendly_name ?? id);
      }
      const compositeSvg = await renderer.export(composite, [
        (canvas, topology) => renderCompositeOverlays(canvas.graphInstance, topology, { friendlyNames }),
      ]);

      const perSystemSvgs: Record<string, string> = {};
      for (const [id, { topology }] of systemsMap) {
        // TODO(anchor-mesh): replace enrichPerSystemInterconnects with site-level analysis
        perSystemSvgs[id] = await renderer.export(topology, [
          (canvas, t) => renderPerSystemOverlays(canvas.graphInstance, t),
        ]);
      }

      const systems: Array<{ systemId: string; friendlyName: string; board: string; deviceName: string; topology: unknown }> = [];
      for (const [id, { topology }] of systemsMap) {
        systems.push({
          systemId: id,
          friendlyName: topology.device.friendly_name,
          board: topology.device.board,
          deviceName: topology.device.name,
          topology,
        });
      }

      const siteId = this.workspace.site()!.id;
      const routesData = this.workspace.compositeRoutes();
      const result = await this.electron.generateSiteDocs(siteId, compositeSvg, perSystemSvgs, systems, linksData, routesData);
      this.siteDocHtml.set(result.html);
    } finally {
      this.generatingDocs.set(false);
    }
  }

  openDocInBrowser() {
    const html = this.siteDocHtml();
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  // === Firmware methods ===

  async selectSystem(systemId: string) {
    this.selectedSystemId.set(systemId);
    // Reset firmware state
    this.fwFiles.set([]);
    this.fwOutputDir.set('');
    this.fwDeviceDir.set('');
    this.fwError.set(null);
    this.showHistory.set(false);
    this.fwLastGeneration.set(null);
    this.generationHistory.set([]);
    this.fwValidation.set(null);
    // Reset secrets
    this.secrets.set({ ...EMPTY_FIRMWARE_SECRETS });

    if (!systemId) return;

    const sys = this.workspace.systems().get(systemId);
    if (!sys) return;

    // Load board SVG for display, use workspace board for validation
    await this.boards.refresh();
    await this.boards.load(sys.topology.device.board);

    // Set OTA address
    this.otaAddress.set(`${sys.topology.device.name}.local`);

    const siteId = this.workspace.site()?.id;

    // Run validation
    if (sys.board) {
      const result = await this.electron.validate(sys.topology, sys.board, siteId);
      this.fwValidation.set(result);
    }
    if (!siteId) return;

    // Load secrets (or initialize defaults)
    const saved = await this.electron.secretsGet(siteId, systemId);
    if (Object.keys(saved).length > 0) {
      this.secrets.set({
        wifi_ssid: saved['wifi_ssid'] ?? '',
        wifi_password: saved['wifi_password'] ?? '',
        api_key: saved['api_key'] ?? '',
        ota_password: saved['ota_password'] ?? '',
      });
    } else {
      // First time: auto-generate crypto fields, save to DB
      const fresh = { ...EMPTY_FIRMWARE_SECRETS };
      fresh.api_key = randomBase64(32);
      fresh.ota_password = randomHex(16);
      this.secrets.set(fresh);
      await this.electron.secretsSet(siteId, systemId, fresh);
    }

    // Restore latest ESPHome generation
    const fwLatest = await this.electron.generationLatest(siteId, systemId, 'esphome');
    if (fwLatest) {
      this.fwLastGeneration.set(fwLatest);
      this.fwOutputDir.set(await this.electron.outputDir());
      this.fwDeviceDir.set(fwLatest.systemId);
    }

    // Stale guard for auto-generate
    if (this.selectedSystemId() !== systemId) return;

    // Auto-generate ESPHome firmware
    this.generate();
  }

  async generate() {
    const systemId = this.selectedSystemId();
    if (!systemId) return;

    const sys = this.workspace.systems().get(systemId);
    if (!sys) return;

    this.generating.set(true);
    this.fwError.set(null);
    try {
      if (!sys.board) throw new Error('No board loaded');
      const siteId = this.workspace.site()?.id ?? '';
      const result = await this.electron.generate(siteId, systemId, sys.topology, sys.board);
      // Stale guard
      if (this.selectedSystemId() !== systemId) return;
      this.fwFiles.set(result.files);
      this.fwOutputDir.set(result.outputDir);
      this.fwDeviceDir.set(result.deviceDir);

      this.fwLastGeneration.set({
        id: result.generationId,
        version: result.version,
        siteId,
        systemId,
        genType: 'esphome',
        schemaVersion: 0,
        fileCount: result.files.length,
        createdAt: new Date().toISOString(),
      });

      if (this.showHistory() && siteId) {
        this.generationHistory.set(await this.electron.generationList(siteId, systemId, 'esphome'));
      }
    } catch (err) {
      this.fwError.set(String(err));
    } finally {
      this.generating.set(false);
    }
  }

  async openFile(relativePath: string) {
    const dir = this.fwOutputDir() || this.haOutputDir();
    if (dir) await this.electron.shellOpenPath(`${dir}/${relativePath}`);
  }

  async openOutputFolder() {
    const dir = this.fwOutputDir();
    if (dir) await this.electron.shellShowInFolder(dir);
  }

  async refreshToolchain() {
    this.toolchain.set(await this.electron.toolchainRefresh());
  }

  async openDeviceFolder() {
    const dir = this.fwOutputDir();
    const device = this.fwDeviceDir();
    if (dir && device) await this.electron.shellShowInFolder(`${dir}/${device}`);
  }

  async toggleHistory() {
    this.showHistory.update(v => !v);
    if (this.showHistory() && this.generationHistory().length === 0) {
      const siteId = this.workspace.site()?.id;
      const systemId = this.selectedSystemId();
      if (siteId && systemId) {
        this.generationHistory.set(await this.electron.generationList(siteId, systemId, 'esphome'));
      }
    }
  }

  async restoreGeneration(id: number) {
    const snapshot = await this.electron.generationLoad(id);
    if (!snapshot) return;
    const topology = JSON.parse(snapshot.topology);
    const board = JSON.parse(snapshot.board);
    this.generating.set(true);
    this.fwError.set(null);
    try {
      const siteId = this.workspace.site()?.id ?? '';
      const systemId = this.selectedSystemId();
      const result = await this.electron.generate(siteId, systemId, topology, board);
      this.fwFiles.set(result.files);
      this.fwOutputDir.set(result.outputDir);
      this.fwDeviceDir.set(result.deviceDir);

      if (siteId && systemId) {
        this.generationHistory.set(await this.electron.generationList(siteId, systemId, 'esphome'));
        this.fwLastGeneration.set(this.generationHistory()[0] ?? null);
      }
    } catch (err) {
      this.fwError.set(String(err));
    } finally {
      this.generating.set(false);
    }
  }

  // === Secrets methods ===

  protected updateSecret(key: string, value: string) {
    this.secrets.update(s => ({ ...s, [key]: value }));
    // Debounced save to DB
    if (this.secretsSaveTimer) clearTimeout(this.secretsSaveTimer);
    this.secretsSaveTimer = setTimeout(() => this.saveSecrets(), 500);
  }

  protected async regenerateKey(key: 'api_key' | 'ota_password') {
    const messages: Record<string, string> = {
      api_key: 'Regenerating the API encryption key will invalidate existing device pairing. The device will need to be re-adopted in Home Assistant.',
      ota_password: 'Regenerating the OTA password will require updating any existing OTA configuration.',
    };
    const confirmed = await this.confirmService.confirm({
      title: 'Regenerate Key',
      message: messages[key],
      confirmLabel: 'Regenerate',
      variant: 'warning',
    });
    if (!confirmed) return;

    const value = key === 'api_key' ? randomBase64(32) : randomHex(16);
    this.secrets.update(s => ({ ...s, [key]: value }));
    this.saveSecrets();
  }

  private async saveSecrets() {
    const siteId = this.workspace.site()?.id;
    const systemId = this.selectedSystemId();
    if (siteId && systemId) {
      await this.electron.secretsSet(siteId, systemId, this.secrets());
    }
  }

  // === HA methods ===

  async generateHaConfig() {
    const siteId = this.workspace.site()?.id;
    if (!siteId) return;

    this.haGenerating.set(true);
    this.haError.set(null);
    try {
      const result = await this.electron.generateSiteHA(siteId);
      this.haFiles.set(result.files);
      this.haOutputDir.set(result.outputDir);

      // Also render SCADA artifacts (SVG + meta) for farm-scada-card on HA.
      // Failure here is non-fatal — the YAML already landed.
      try {
        if (!this.topologyRenderer && this.hiddenCanvasRef) this.initTopologyRenderer();
        const renderer = this.topologyRenderer;
        const systemsMap = this.workspace.systems();
        if (renderer && systemsMap.size > 0) {
          const artifacts: Array<{ name: string; svg: string; meta: unknown }> = [];
          for (const [, { topology }] of systemsMap) {
            const { svg, meta } = await renderer.exportHa(topology);
            artifacts.push({ name: topology.device.name, svg, meta });
          }
          if (artifacts.length) await this.electron.writeScadaArtifacts(siteId, artifacts);
        }
      } catch (scadaErr) {
        console.warn('SCADA artifact generation failed:', scadaErr);
      }
    } catch (err) {
      this.haError.set(String(err));
    } finally {
      this.haGenerating.set(false);
    }
  }

  async openHaFolder() {
    const dir = this.haOutputDir();
    const siteId = this.workspace.site()?.id;
    if (!dir || !siteId) return;
    await this.electron.shellShowInFolder(`${dir}/sites/${siteId}/homeassistant`);
  }

  formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  protected toInputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
