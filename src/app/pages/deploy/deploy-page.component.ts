import {
  Component, inject, OnInit, OnDestroy, signal, computed,
  ElementRef, ViewChild, AfterViewChecked, NgZone, Injector, effect, AfterViewInit,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';
import { WorkspaceService } from '../../core/services/workspace.service';
import { ElectronService } from '../../core/services/electron.service';
import { BoardService } from '../../core/services/board.service';
import { ValidationPanelComponent } from '../../shared/validation-panel/validation-panel.component';
import { X6Canvas, type CanvasEvents } from '../editor/topology-x6-tab/x6-canvas';
import { renderBoundaries, BOUNDARY_COLORS } from '../../shared/canvas/boundary-renderer';
import { ConfirmService } from '../../core/services/confirm.service';
import { FormsModule } from '@angular/forms';
import type { ToolchainInfo, SerialDevice, GenerationMeta, GenerationType } from '../../core/models/electron-api';

type ActiveTab = 'docs' | 'firmware' | 'ha';

interface FileEntry {
  path: string;
  description: string;
  lines: number;
}

interface TerminalLine {
  text: string;
  stream: 'stdout' | 'stderr' | 'system';
}

@Component({
  selector: 'app-deploy-page',
  standalone: true,
  imports: [ValidationPanelComponent, FormsModule],
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
      </div>

      <!-- Docs tab -->
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
              <!-- Network & Credentials — unified card -->
              <div class="bg-base-100 rounded-xl border border-base-300/40 overflow-hidden">
                <!-- WiFi -->
                <div class="px-5 py-4">
                  <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0" />
                      </svg>
                      <h2 class="font-semibold text-sm">WiFi</h2>
                    </div>
                    @if (secretsHasPlaceholders()) {
                      <span class="badge badge-warning badge-sm gap-1">Not configured</span>
                    }
                  </div>
                  <div class="grid grid-cols-2 gap-4">
                    <div class="flex flex-col gap-1">
                      <span class="text-xs font-medium">SSID</span>
                      <input type="text" class="input input-bordered input-sm w-full"
                        [class.input-warning]="!secrets().wifi_ssid"
                        [ngModel]="secrets().wifi_ssid"
                        (ngModelChange)="updateSecret('wifi_ssid', $event)"
                        placeholder="Network name" />
                    </div>
                    <div class="flex flex-col gap-1">
                      <span class="text-xs font-medium">Password</span>
                      <input type="password" class="input input-bordered input-sm w-full"
                        [class.input-warning]="!secrets().wifi_password || secrets().wifi_password.length < 8"
                        [ngModel]="secrets().wifi_password"
                        (ngModelChange)="updateSecret('wifi_password', $event)"
                        placeholder="Min 8 characters" />
                      @if (secrets().wifi_password && secrets().wifi_password.length > 0 && secrets().wifi_password.length < 8) {
                        <span class="text-warning text-[10px]">Min 8 characters (WPA2)</span>
                      }
                    </div>
                  </div>
                </div>

                <!-- IP Configuration -->
                <div class="border-t border-base-300/30 px-5 py-4">
                  <div class="flex items-center justify-between mb-3">
                    <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider">IP Configuration</span>
                    <div class="flex items-center gap-1 bg-base-200/60 rounded-lg p-0.5">
                      <button class="btn btn-xs border-0 rounded-md"
                        [class.btn-primary]="(selectedNetwork()?.mode ?? 'dhcp') === 'dhcp'"
                        [class.btn-ghost]="selectedNetwork()?.mode === 'static'"
                        (click)="updateNetworkMode('dhcp')">DHCP</button>
                      <button class="btn btn-xs border-0 rounded-md"
                        [class.btn-primary]="selectedNetwork()?.mode === 'static'"
                        [class.btn-ghost]="(selectedNetwork()?.mode ?? 'dhcp') === 'dhcp'"
                        (click)="updateNetworkMode('static')">Static</button>
                    </div>
                  </div>
                  @if (selectedNetwork()?.mode === 'static') {
                    <div class="grid grid-cols-2 gap-3">
                      <div class="flex flex-col gap-1">
                        <span class="text-xs font-medium">IP Address</span>
                        <input type="text" class="input input-bordered input-sm font-mono w-full"
                          [ngModel]="selectedNetwork()?.static_ip ?? ''"
                          (ngModelChange)="updateNetworkField('static_ip', $event)"
                          placeholder="192.168.1.100" />
                      </div>
                      <div class="flex flex-col gap-1">
                        <span class="text-xs font-medium">Gateway</span>
                        <input type="text" class="input input-bordered input-sm font-mono w-full"
                          [ngModel]="selectedNetwork()?.gateway ?? ''"
                          (ngModelChange)="updateNetworkField('gateway', $event)"
                          placeholder="192.168.1.1" />
                      </div>
                      <div class="flex flex-col gap-1">
                        <span class="text-xs font-medium">Subnet</span>
                        <input type="text" class="input input-bordered input-sm font-mono w-full"
                          [ngModel]="selectedNetwork()?.subnet ?? ''"
                          (ngModelChange)="updateNetworkField('subnet', $event)"
                          placeholder="255.255.255.0" />
                      </div>
                      <div class="flex flex-col gap-1">
                        <span class="text-xs font-medium">DNS</span>
                        <input type="text" class="input input-bordered input-sm font-mono w-full"
                          [ngModel]="selectedNetwork()?.dns1 ?? ''"
                          (ngModelChange)="updateNetworkField('dns1', $event)"
                          placeholder="8.8.8.8" />
                      </div>
                    </div>
                  } @else {
                    <p class="text-xs text-base-content/40">IP address assigned automatically by router.</p>
                  }
                </div>

                <!-- Security Keys (collapsible) -->
                <div class="border-t border-base-300/30">
                  <button class="flex items-center justify-between w-full px-5 py-3 text-left hover:bg-base-200/30 transition-colors"
                    (click)="showSecurityKeys.set(!showSecurityKeys())">
                    <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider">Security Keys</span>
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-base-content/40 transition-transform"
                      [class.rotate-180]="showSecurityKeys()" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  @if (showSecurityKeys()) {
                    <div class="px-5 pb-4 space-y-3">
                      <div class="flex flex-col gap-1">
                        <span class="text-xs font-medium">Fallback AP Password</span>
                        <div class="join w-full">
                          <input type="text" class="input input-bordered input-sm font-mono text-sm join-item flex-1"
                            [ngModel]="secrets().fallback_password"
                            (ngModelChange)="updateSecret('fallback_password', $event)" />
                          <button class="btn btn-ghost btn-sm join-item border border-base-300" (click)="regenerateKey('fallback_password')" title="Regenerate">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1z" clip-rule="evenodd" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <div class="flex flex-col gap-1">
                        <span class="text-xs font-medium">OTA Password</span>
                        <div class="join w-full">
                          <input type="text" class="input input-bordered input-sm font-mono text-sm join-item flex-1"
                            [ngModel]="secrets().ota_password"
                            (ngModelChange)="updateSecret('ota_password', $event)" />
                          <button class="btn btn-ghost btn-sm join-item border border-base-300" (click)="regenerateKey('ota_password')" title="Regenerate">
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
                            [ngModel]="secrets().api_key"
                            (ngModelChange)="updateSecret('api_key', $event)" />
                          <button class="btn btn-ghost btn-sm join-item border border-base-300" (click)="regenerateKey('api_key')" title="Regenerate">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1z" clip-rule="evenodd" />
                            </svg>
                          </button>
                        </div>
                        @if (!secretsApiKeyValid()) {
                          <span class="text-warning text-[10px]">Must be valid base64 (32 bytes)</span>
                        }
                      </div>
                    </div>
                  }
                </div>
              </div>
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
                  <div class="border-t border-base-300/30 px-5 py-3 bg-base-200/30">
                    <table class="table table-xs">
                      <thead>
                        <tr>
                          <th class="text-xs uppercase tracking-wider text-base-content/50 font-semibold">File</th>
                          <th class="text-xs uppercase tracking-wider text-base-content/50 font-semibold">Description</th>
                          <th class="text-xs uppercase tracking-wider text-base-content/50 font-semibold text-right">Lines</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (f of fwFiles(); track f.path) {
                          <tr class="hover cursor-pointer" (click)="openFile(f.path)">
                            <td class="font-mono text-[11px] text-primary/70 underline decoration-primary/30">{{ f.path }}</td>
                            <td class="text-[11px] text-base-content/50">{{ f.description }}</td>
                            <td class="text-right text-[11px] tabular-nums text-base-content/60">{{ f.lines }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                    @if (fwOutputDir()) {
                      <div class="flex items-center gap-2 mt-2">
                        <span class="text-xs text-base-content/50 font-mono truncate flex-1">{{ fwOutputDir() }}</span>
                        <button class="btn btn-ghost btn-xs gap-1 text-base-content/50 hover:text-base-content" (click)="openOutputFolder()">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                          </svg>
                          Open
                        </button>
                      </div>
                    }
                  </div>
                }
              </div>

              <!-- Self-Test Firmware -->
              <div class="bg-base-100 rounded-xl border border-base-300/40 overflow-hidden">
                <div class="flex items-center justify-between px-5 py-3.5">
                  <div class="flex items-center gap-3">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <div>
                      <h2 class="font-semibold text-sm">Board Self-Test</h2>
                      <p class="text-xs text-base-content/60 mt-0.5">Generate test firmware that cycles through all hardware features without wiring</p>
                    </div>
                  </div>
                  <button
                    class="btn btn-ghost btn-xs gap-1.5 border border-base-300/50"
                    (click)="generateSelfTest()"
                    [disabled]="generatingSelfTest()"
                  >
                    @if (generatingSelfTest()) { <span class="loading loading-spinner loading-xs"></span> }
                    Generate Self-Test
                  </button>
                </div>
                @if (selfTestFiles().length > 0) {
                  <div class="border-t border-base-300/30 px-5 py-3 bg-base-200/30">
                    <table class="table table-xs">
                      <thead>
                        <tr>
                          <th class="text-xs uppercase tracking-wider text-base-content/50 font-semibold">File</th>
                          <th class="text-xs uppercase tracking-wider text-base-content/50 font-semibold">Description</th>
                          <th class="text-xs uppercase tracking-wider text-base-content/50 font-semibold text-right">Lines</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (f of selfTestFiles(); track f.path) {
                          <tr class="hover cursor-pointer" (click)="openFile(f.path)">
                            <td class="font-mono text-[11px] text-primary/70 underline decoration-primary/30">{{ f.path }}</td>
                            <td class="text-[11px] text-base-content/50">{{ f.description }}</td>
                            <td class="text-right text-[11px] tabular-nums text-base-content/60">{{ f.lines }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                    <p class="text-xs text-base-content/40 mt-2">Use Compile &amp; Flash below with config <span class="font-mono text-primary/70">{{ selfTestDeviceDir() }}</span></p>
                  </div>
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
              <div
                class="bg-base-100 rounded-xl border overflow-hidden transition-opacity"
                [class.border-base-300/40]="canBuild()"
                [class.border-warning/30]="!canBuild()"
                [class.opacity-50]="!canBuild()"
                [class.pointer-events-none]="!canBuild()"
              >
                <div class="flex items-center justify-between px-5 py-3.5">
                  <div class="flex items-center gap-3">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <div>
                      <h2 class="font-semibold text-sm">Build & Deploy</h2>
                      @if (!toolchain()?.esphomePath) {
                        <p class="text-xs text-warning mt-0.5">ESPHome not found on PATH</p>
                      } @else if (secretsHasPlaceholders()) {
                        <p class="text-xs text-warning mt-0.5">Configure WiFi secrets above before compiling</p>
                      } @else if (!secretsValid()) {
                        <p class="text-xs text-warning mt-0.5">Fix secret validation errors above</p>
                      } @else {
                        <p class="text-xs text-base-content/60 mt-0.5">Compile firmware and flash to device</p>
                      }
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    @if (running() && activeAction()) {
                      <button class="btn btn-error btn-xs gap-1" (click)="cancel()">Cancel</button>
                    }
                    <button
                      class="btn btn-ghost btn-xs gap-1.5 border border-base-300/50"
                      (click)="compile()"
                      [disabled]="!canBuild() || running()"
                    >
                      @if (running() && activeAction() === 'compile') {
                        <span class="loading loading-spinner loading-xs"></span>
                      }
                      Compile
                    </button>
                  </div>
                </div>

                <!-- Post-compile actions -->
                @if (compileSuccess()) {
                  <div class="border-t border-base-300/30 px-5 py-3.5 bg-base-200/30">
                    <div class="flex items-center gap-2 mb-3">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-success" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                      </svg>
                      <span class="text-sm font-medium text-success">Build succeeded</span>
                    </div>

                    <div class="flex flex-wrap gap-2">
                      <!-- Flash USB -->
                      <div class="dropdown dropdown-top">
                        <div tabindex="0" role="button" class="btn btn-primary btn-xs gap-1" [class.btn-disabled]="running()">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clip-rule="evenodd" />
                          </svg>
                          Flash USB
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 opacity-60" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
                          </svg>
                        </div>
                        <div tabindex="0" class="dropdown-content bg-base-100 rounded-lg shadow-lg border border-base-300/50 p-3 w-72 mb-2 z-10">
                          <div class="flex items-center gap-2">
                            <select
                              class="select select-bordered select-xs flex-1 font-mono"
                              [disabled]="running() || serialPorts().length === 0"
                              [value]="selectedPort()"
                              (change)="selectedPort.set(toInputValue($event))"
                            >
                              @if (serialPorts().length === 0) {
                                <option value="">No ports found</option>
                              }
                              @for (p of serialPorts(); track p.port) {
                                <option [value]="p.port">{{ p.port }} -- {{ p.description }}</option>
                              }
                            </select>
                            <button
                              class="btn btn-ghost btn-xs border border-base-300/50"
                              (click)="scanPorts()"
                              [disabled]="scanningPorts()"
                              title="Refresh ports"
                            >
                              @if (scanningPorts()) {
                                <span class="loading loading-spinner loading-xs"></span>
                              } @else {
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                  <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
                                </svg>
                              }
                            </button>
                          </div>
                          <button
                            class="btn btn-primary btn-xs w-full mt-2"
                            (click)="flash(selectedPort())"
                            [disabled]="running() || !selectedPort()"
                          >Flash</button>
                        </div>
                      </div>

                      <!-- Flash OTA -->
                      @if (!showOtaInput()) {
                        <button
                          class="btn btn-ghost btn-xs gap-1 border border-base-300/50"
                          (click)="showOtaInput.set(true)"
                          [disabled]="running()"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M17.778 8.222c-4.296-4.296-11.26-4.296-15.556 0A1 1 0 01.808 6.808c5.076-5.076 13.308-5.076 18.384 0a1 1 0 01-1.414 1.414zM14.95 11.05a7 7 0 00-9.9 0 1 1 0 01-1.414-1.414 9 9 0 0112.728 0 1 1 0 01-1.414 1.414zM12.12 13.88a3 3 0 00-4.242 0 1 1 0 01-1.414-1.414 5 5 0 017.07 0 1 1 0 01-1.414 1.414zM10 16a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
                          </svg>
                          Flash OTA
                        </button>
                      } @else {
                        <div class="flex items-center gap-1.5">
                          <input
                            type="text"
                            class="input input-bordered input-xs w-48 font-mono"
                            placeholder="device.local or 192.168.1.x"
                            [value]="otaAddress()"
                            (input)="otaAddress.set(toInputValue($event))"
                          />
                          <button class="btn btn-primary btn-xs" (click)="flash(otaAddress())" [disabled]="running() || !otaAddress()">Flash</button>
                          <button class="btn btn-ghost btn-xs" (click)="showOtaInput.set(false)">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                            </svg>
                          </button>
                        </div>
                      }

                      <!-- Open Files -->
                      <button class="btn btn-ghost btn-xs gap-1 border border-base-300/50" (click)="openDeviceFolder()">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                        </svg>
                        Open Files
                      </button>
                    </div>
                  </div>
                }
              </div>

              <!-- Terminal output -->
              @if (terminalLines().length > 0 || running()) {
                <div class="rounded-xl overflow-hidden border border-neutral/80">
                  <div class="flex items-center justify-between px-4 py-2 bg-neutral">
                    <div class="flex items-center gap-2">
                      @if (running()) {
                        <span class="loading loading-spinner loading-xs text-neutral-content/60"></span>
                        <span class="text-[10px] font-mono text-neutral-content/60 uppercase tracking-wider">
                          {{ activeAction() === 'compile' ? 'Compiling' : activeAction() === 'flash' ? 'Flashing' : 'Running' }}...
                        </span>
                      } @else if (terminalStatus() === 'success') {
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-success" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                        </svg>
                        <span class="text-[10px] font-mono text-success/80 uppercase tracking-wider">Done</span>
                      } @else if (terminalStatus() === 'error') {
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-error" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
                        </svg>
                        <span class="text-[10px] font-mono text-error/80 uppercase tracking-wider">Failed</span>
                      } @else {
                        <span class="text-[10px] font-mono text-neutral-content/40 uppercase tracking-wider">Output</span>
                      }
                    </div>
                    <div class="flex items-center gap-1">
                      @if (running()) {
                        <button class="btn btn-ghost btn-xs text-neutral-content/40 hover:text-error" (click)="cancel()">Cancel</button>
                      }
                      @if (terminalLines().length > 0) {
                        <button class="btn btn-ghost btn-xs text-neutral-content/40 hover:text-neutral-content" (click)="clearTerminal()">Clear</button>
                      }
                    </div>
                  </div>
                  <pre
                    #terminalEl
                    class="px-4 py-3 text-[11px] font-mono bg-neutral overflow-auto max-h-72 leading-relaxed"
                  >@for (line of terminalLines(); track $index) {<span
                      [class]="line.stream === 'stderr' ? 'text-warning/80' : line.stream === 'system' ? 'text-info/60 italic' : 'text-neutral-content/80'"
                    >{{ line.text }}</span>}@if (terminalLines().length === 0 && running()) {<span class="text-neutral-content/30 italic">Waiting for output...</span>}</pre>
                </div>
              }

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
                <div class="border-t border-base-300/30 px-5 py-3 bg-base-200/30">
                  <table class="table table-xs">
                    <thead>
                      <tr>
                        <th class="text-xs uppercase tracking-wider text-base-content/50 font-semibold">File</th>
                        <th class="text-xs uppercase tracking-wider text-base-content/50 font-semibold">Description</th>
                        <th class="text-xs uppercase tracking-wider text-base-content/50 font-semibold text-right">Lines</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (f of haFiles(); track f.path) {
                        <tr class="hover cursor-pointer" (click)="openFile(f.path)">
                          <td class="font-mono text-[11px] text-primary/70 underline decoration-primary/30">{{ f.path }}</td>
                          <td class="text-[11px] text-base-content/50">{{ f.description }}</td>
                          <td class="text-right text-[11px] tabular-nums text-base-content/60">{{ f.lines }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                  @if (haOutputDir()) {
                    <div class="flex items-center gap-2 mt-2">
                      <span class="text-xs text-base-content/50 font-mono truncate flex-1">{{ haOutputDir() }}</span>
                      <button class="btn btn-ghost btn-xs gap-1 text-base-content/50 hover:text-base-content" (click)="openHaFolder()">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                        </svg>
                        Open
                      </button>
                    </div>
                  }
                </div>
              }
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
    </div>
  `,
})
export class DeployPageComponent implements OnInit, OnDestroy, AfterViewInit, AfterViewChecked {
  protected workspace = inject(WorkspaceService);
  private electron = inject(ElectronService);
  private boards = inject(BoardService);
  private confirmService = inject(ConfirmService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private zone = inject(NgZone);
  private injector = inject(Injector);
  private sanitizer = inject(DomSanitizer);

  @ViewChild('terminalEl') private terminalEl?: ElementRef<HTMLPreElement>;
  @ViewChild('hiddenCanvas') private hiddenCanvasRef?: ElementRef<HTMLElement>;

  protected activeTab = signal<ActiveTab>('docs');
  private siteName: string | null = null;

  // === Docs state ===
  protected generatingDocs = signal(false);
  protected siteDocHtml = signal<string | null>(null);
  private hiddenCanvas: X6Canvas | null = null;

  // === Firmware state ===
  protected selectedSystemId = signal('');
  protected systemEntries = signal<Array<{ id: string; friendlyName: string; board: string }>>([]);

  // Generate
  protected fwFiles = signal<FileEntry[]>([]);
  protected fwOutputDir = signal('');
  protected fwDeviceDir = signal('');
  protected generating = signal(false);
  protected fwValidation = signal<any>(null);
  protected fwError = signal<string | null>(null);

  // Build & Deploy
  protected running = signal(false);
  protected activeAction = signal<'compile' | 'flash' | null>(null);
  protected compileSuccess = signal(false);
  protected toolchain = signal<ToolchainInfo | null>(null);

  // Terminal
  protected terminalLines = signal<TerminalLine[]>([]);
  protected terminalStatus = signal<'idle' | 'running' | 'success' | 'error'>('idle');
  private shouldAutoScroll = true;

  // Flash
  protected serialPorts = signal<SerialDevice[]>([]);
  protected selectedPort = signal('');
  protected scanningPorts = signal(false);
  protected otaAddress = signal('');
  protected showOtaInput = signal(false);
  private activeProcessId = signal<string | null>(null);

  // Firmware generation history
  protected fwLastGeneration = signal<GenerationMeta | null>(null);
  protected generationHistory = signal<GenerationMeta[]>([]);
  protected showHistory = signal(false);

  // Self-test
  protected generatingSelfTest = signal(false);
  protected selfTestFiles = signal<FileEntry[]>([]);
  protected selfTestDeviceDir = signal('');

  // Secrets
  protected showSecurityKeys = signal(false);
  private static readonly DEFAULT_SECRETS = { wifi_ssid: '', wifi_password: '', fallback_password: '', api_key: '', ota_password: '' };
  protected secrets = signal<{ wifi_ssid: string; wifi_password: string; fallback_password: string; api_key: string; ota_password: string }>(
    { ...DeployPageComponent.DEFAULT_SECRETS }
  );
  private secretsSaveTimer: ReturnType<typeof setTimeout> | null = null;

  protected secretsHasPlaceholders = computed(() => {
    const s = this.secrets();
    return !s.wifi_ssid || !s.wifi_password;
  });

  protected secretsApiKeyValid = computed(() => {
    const key = this.secrets().api_key;
    if (!key) return false;
    try { return atob(key).length === 32; } catch { return false; }
  });

  protected secretsValid = computed(() => {
    const s = this.secrets();
    return !!s.wifi_ssid && !!s.wifi_password && s.wifi_password.length >= 8
      && s.fallback_password.length >= 8 && !!s.ota_password && this.secretsApiKeyValid();
  });

  // HA state (site-level)
  protected haFiles = signal<FileEntry[]>([]);
  protected haOutputDir = signal('');
  protected haGenerating = signal(false);
  protected haError = signal<string | null>(null);

  protected canBuild = computed(() =>
    !!this.toolchain()?.esphomePath && this.fwFiles().length > 0 && this.secretsValid()
  );

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

  protected updateNetworkMode(mode: 'dhcp' | 'static') {
    const id = this.selectedSystemId();
    if (!id) return;
    this.workspace.updateSystemTopology(id, (t) => {
      if (mode === 'dhcp') {
        t.device.network = undefined;
      } else {
        t.device.network = { mode: 'static', static_ip: '', gateway: '', subnet: '', dns1: '' };
      }
    });
  }

  protected updateNetworkField(field: 'static_ip' | 'gateway' | 'subnet' | 'dns1' | 'dns2', value: string) {
    const id = this.selectedSystemId();
    if (!id) return;
    this.workspace.updateSystemTopology(id, (t) => {
      if (!t.device.network) t.device.network = { mode: 'static' };
      (t.device.network as any)[field] = value;
    });
  }

  protected trustedSiteDocHtml = computed(() => {
    const html = this.siteDocHtml();
    return html ? this.sanitizer.bypassSecurityTrustHtml(html) : '';
  });

  private unsubStarted: (() => void) | null = null;
  private unsubOutput: (() => void) | null = null;
  private unsubDone: (() => void) | null = null;

  async ngOnInit() {
    this.siteName = this.route.snapshot.paramMap.get('name');
    if (!this.siteName) { this.router.navigate(['/overview']); return; }

    if (!this.workspace.site() || this.workspace.site()?.id !== this.siteName) {
      await this.workspace.load(this.siteName);
    }

    this.updateSystemEntries();
    this.toolchain.set(await this.electron.toolchainStatus());

    if (this.toolchain()?.esphomePath) {
      this.scanPorts();
    }

    // ESPHome process listeners
    this.unsubStarted = this.electron.onEsphomeStarted((handle) => {
      this.activeProcessId.set(handle.id);
    });
    this.unsubOutput = this.electron.onEsphomeOutput((data) => {
      this.terminalLines.update((lines) => [
        ...lines,
        { text: data.text, stream: data.stream as 'stdout' | 'stderr' },
      ]);
    });
    this.unsubDone = this.electron.onEsphomeDone((data) => {
      const cancelled = data.signal === 'SIGTERM';
      const success = data.code === 0;
      const msg = cancelled
        ? '--- Cancelled ---\n'
        : success
          ? '--- Done ---\n'
          : `--- Exited with code ${data.code} ---\n`;
      this.terminalLines.update((lines) => [...lines, { text: msg, stream: 'system' }]);
      this.running.set(false);
      this.activeAction.set(null);
      this.activeProcessId.set(null);

      if (data.operation === 'compile' && success && !cancelled) {
        this.compileSuccess.set(true);
        this.terminalStatus.set('success');
      } else if (cancelled) {
        this.terminalStatus.set('idle');
      } else {
        this.terminalStatus.set('error');
      }
    });
  }

  ngAfterViewInit() {
    // Initialize hidden canvas for composite SVG export
    this.initHiddenCanvas();
  }

  ngAfterViewChecked() {
    if (this.shouldAutoScroll && this.terminalEl) {
      const el = this.terminalEl.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }

  ngOnDestroy() {
    this.unsubStarted?.();
    this.unsubOutput?.();
    this.unsubDone?.();
    this.hiddenCanvas?.destroy();
  }

  private updateSystemEntries() {
    const entries: Array<{ id: string; friendlyName: string; board: string }> = [];
    for (const [id, { topology }] of this.workspace.systems()) {
      entries.push({
        id,
        friendlyName: topology.device.friendly_name,
        board: topology.device.board,
      });
    }
    this.systemEntries.set(entries);
  }

  private initHiddenCanvas() {
    if (!this.hiddenCanvasRef) return;
    const noopEvents: CanvasEvents = {
      onNodesMoved: () => {},
      onPipeCreated: () => {},
      onPipeDeleted: () => {},
      onSelected: () => {},
      onDanglingPipe: () => {},
    };
    this.hiddenCanvas = new X6Canvas(this.hiddenCanvasRef.nativeElement, noopEvents);
    this.hiddenCanvas.setReadonly(true);
    this.hiddenCanvas.resize(1200, 800);
  }

  private renderCompositeOnHiddenCanvas() {
    const composite = this.workspace.compositeTopology();
    if (!this.hiddenCanvas || !composite || composite.nodes.length === 0) return;

    this.hiddenCanvas.reset(composite);
    const graph = this.hiddenCanvas.graphInstance;
    const systems = this.workspace.systems();
    const links = this.workspace.links();

    const systemNodes = new Map<string, string[]>();
    const friendlyNames = new Map<string, string>();
    for (const [systemId, { topology }] of systems) {
      systemNodes.set(systemId, topology.nodes.map(n => `${systemId}/${n.id}`));
      friendlyNames.set(systemId, topology.device.friendly_name);
    }
    renderBoundaries(graph, systemNodes, friendlyNames);

    for (const link of links) {
      const edge = graph.getCellById(`pipe-link-${link.id}`);
      if (edge?.isEdge()) {
        edge.setAttrs({
          line: {
            stroke: '#8b5cf6',
            strokeWidth: 2,
            strokeDasharray: '8,4',
            targetMarker: { name: 'classic', size: 8 },
          },
        });
      }
    }
  }

  // === Docs methods ===

  async generateSiteDocs() {
    if (!this.workspace.site()) return;

    // Ensure hidden canvas exists
    if (!this.hiddenCanvas && this.hiddenCanvasRef) {
      this.initHiddenCanvas();
    }

    this.generatingDocs.set(true);
    try {
      this.renderCompositeOnHiddenCanvas();
      const compositeSvg = this.hiddenCanvas ? await this.hiddenCanvas.exportSvg() : '';
      const siteId = this.workspace.site()!.id;

      const systems: Array<{ systemId: string; friendlyName: string; board: string; deviceName: string; topology: unknown }> = [];
      for (const [id, { topology }] of this.workspace.systems()) {
        systems.push({
          systemId: id,
          friendlyName: topology.device.friendly_name,
          board: topology.device.board,
          deviceName: topology.device.name,
          topology,
        });
      }

      const linksData = this.workspace.links();
      const routesData = this.workspace.compositeRoutes();

      const result = await this.electron.generateSiteDocs(siteId, compositeSvg, systems, linksData, routesData);
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
    this.compileSuccess.set(false);
    this.terminalLines.set([]);
    this.terminalStatus.set('idle');
    this.showHistory.set(false);
    this.fwLastGeneration.set(null);
    this.generationHistory.set([]);
    this.fwValidation.set(null);
    // Reset secrets
    this.secrets.set({ ...DeployPageComponent.DEFAULT_SECRETS });

    if (!systemId) return;

    const sys = this.workspace.systems().get(systemId);
    if (!sys) return;

    // Load board for validation
    await this.boards.refresh();
    await this.boards.load(sys.topology.device.board);

    // Run validation
    const board = this.boards.activeBoard();
    if (board) {
      const result = await this.electron.validate(sys.topology, board);
      this.fwValidation.set(result);
    }

    // Set OTA address
    this.otaAddress.set(`${sys.topology.device.name}.local`);

    const siteId = this.workspace.site()?.id;
    if (!siteId) return;

    // Load secrets (or initialize defaults)
    const saved = await this.electron.secretsGet(siteId, systemId);
    if (Object.keys(saved).length > 0) {
      this.secrets.set({
        wifi_ssid: saved['wifi_ssid'] ?? '',
        wifi_password: saved['wifi_password'] ?? '',
        fallback_password: saved['fallback_password'] ?? '',
        api_key: saved['api_key'] ?? '',
        ota_password: saved['ota_password'] ?? '',
      });
    } else {
      // First time: auto-generate crypto fields, save to DB
      const fresh = { ...DeployPageComponent.DEFAULT_SECRETS };
      fresh.fallback_password = this.randomHex(16);
      fresh.api_key = this.randomBase64(32);
      fresh.ota_password = this.randomHex(16);
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
    this.compileSuccess.set(false);
    try {
      const board = this.boards.activeBoard();
      if (!board) throw new Error('No board loaded');
      const siteId = this.workspace.site()?.id ?? '';
      const result = await this.electron.generate(siteId, systemId, sys.topology, board);
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

  async generateSelfTest() {
    const boardId = this.selectedBoardId();
    if (!boardId) return;
    this.generatingSelfTest.set(true);
    this.fwError.set(null);
    try {
      const result = await this.electron.generateSelfTest(boardId);
      this.selfTestFiles.set(result.files);
      this.selfTestDeviceDir.set(result.deviceDir);
      this.fwOutputDir.set(result.outputDir);
      // Set deviceDir so compile/flash targets self-test firmware
      this.fwDeviceDir.set(result.deviceDir);
    } catch (err) {
      this.fwError.set(String(err));
    } finally {
      this.generatingSelfTest.set(false);
    }
  }

  async compile() {
    const dir = this.fwDeviceDir();
    if (!dir) return;
    this.running.set(true);
    this.activeAction.set('compile');
    this.compileSuccess.set(false);
    this.terminalLines.set([]);
    this.terminalStatus.set('running');
    this.fwError.set(null);
    this.shouldAutoScroll = true;
    try {
      await this.electron.esphomeCompile(dir);
    } catch (err) {
      this.fwError.set(String(err));
      this.running.set(false);
      this.activeAction.set(null);
      this.terminalStatus.set('error');
    }
  }

  async flash(device?: string) {
    if (!device) return;
    const dir = this.fwDeviceDir();
    if (!dir) return;
    this.running.set(true);
    this.activeAction.set('flash');
    this.terminalLines.set([]);
    this.terminalStatus.set('running');
    this.fwError.set(null);
    this.shouldAutoScroll = true;
    try {
      await this.electron.esphomeFlash(dir, device);
    } catch (err) {
      this.fwError.set(String(err));
      this.running.set(false);
      this.activeAction.set(null);
      this.terminalStatus.set('error');
    }
  }

  async cancel() {
    const id = this.activeProcessId();
    if (id) await this.electron.esphomeCancel(id);
  }

  clearTerminal() {
    this.terminalLines.set([]);
    this.terminalStatus.set('idle');
  }

  async openFile(relativePath: string) {
    const dir = this.fwOutputDir() || this.haOutputDir();
    if (dir) await this.electron.shellOpenPath(`${dir}/${relativePath}`);
  }

  async openOutputFolder() {
    const dir = this.fwOutputDir();
    if (dir) await this.electron.shellShowInFolder(dir);
  }

  async openDeviceFolder() {
    const dir = this.fwOutputDir();
    const device = this.fwDeviceDir();
    if (dir && device) await this.electron.shellShowInFolder(`${dir}/esphome/${device}`);
  }

  async scanPorts() {
    this.scanningPorts.set(true);
    try {
      const ports = await this.electron.deviceListSerial();
      this.serialPorts.set(ports);
      if (ports.length > 0 && !ports.some(p => p.port === this.selectedPort())) {
        this.selectedPort.set(ports[0].port);
      }
      if (ports.length === 0) this.selectedPort.set('');
    } finally {
      this.scanningPorts.set(false);
    }
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
    this.compileSuccess.set(false);
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

  protected async regenerateKey(key: 'api_key' | 'ota_password' | 'fallback_password') {
    const messages: Record<string, string> = {
      api_key: 'Regenerating the API encryption key will invalidate existing device pairing. The device will need to be re-adopted in Home Assistant.',
      ota_password: 'Regenerating the OTA password will require updating any existing OTA configuration.',
      fallback_password: 'Regenerating the fallback AP password will change the password used when the device enters AP mode.',
    };
    const confirmed = await this.confirmService.confirm({
      title: 'Regenerate Key',
      message: messages[key],
      confirmLabel: 'Regenerate',
      variant: 'warning',
    });
    if (!confirmed) return;

    const value = key === 'api_key' ? this.randomBase64(32) : this.randomHex(16);
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

  private randomHex(bytes: number): string {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  private randomBase64(bytes: number): string {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode(...arr));
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
    } catch (err) {
      this.haError.set(String(err));
    } finally {
      this.haGenerating.set(false);
    }
  }

  async openHaFolder() {
    const dir = this.haOutputDir();
    if (dir) await this.electron.shellShowInFolder(`${dir}/config/homeassistant`);
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
