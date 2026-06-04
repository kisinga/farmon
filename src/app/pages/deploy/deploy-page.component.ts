import { Component, inject, signal, computed } from '@angular/core';
import { WorkspaceService } from '../../core/services/workspace.service';
import { SystemEditorService } from '../../core/services/system-editor.service';
import { BackendService } from '../../core/services/backend.service';
import { FormsModule } from '@angular/forms';
import { EMPTY_FIRMWARE_SECRETS, type FirmwareSecrets } from '../../core/models/firmware-secrets';
import { randomHex } from '../../core/util/random-keys';

interface FileEntry {
  path: string;
  description: string;
  lines: number;
}

@Component({
  selector: 'app-deploy-page',
  standalone: true,
  imports: [FormsModule],
  host: { class: 'flex-1 flex flex-col overflow-hidden' },
  template: `
    <div class="flex-1 flex flex-col min-h-0">
      <div class="flex items-center gap-0 bg-base-100 border-b border-base-300/30 px-6 shrink-0">
        <span class="px-4 py-3 text-sm font-medium border-b-2 border-primary text-primary">Firmware</span>
      </div>

      <div class="flex-1 flex flex-col min-h-0 overflow-auto p-6 space-y-4">
        <!-- Controller selector -->
        <div class="flex items-center gap-3 bg-base-100 rounded-xl border border-base-300/40 px-5 py-3">
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
        </div>

        @if (!selectedSystemId()) {
          <div class="bg-base-100 rounded-xl border border-base-300/40 flex items-center justify-center py-16">
            <p class="text-sm text-base-content/40">Select a controller to manage firmware.</p>
          </div>
        }

        @if (selectedSystemId()) {
          <!-- Secrets -->
          <div class="bg-base-100 rounded-xl border border-base-300/40 px-5 py-4 space-y-3">
            <h3 class="font-semibold text-sm">Device Secrets</h3>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label-text text-[11px] text-base-content/50">Wi-Fi SSID</label>
                <input class="input input-bordered input-sm w-full" [(ngModel)]="secrets().wifi_ssid" (change)="markSecretsDirty()" />
              </div>
              <div>
                <label class="label-text text-[11px] text-base-content/50">Wi-Fi Password</label>
                <input type="password" class="input input-bordered input-sm w-full" [(ngModel)]="secrets().wifi_password" (change)="markSecretsDirty()" />
              </div>
              <div>
                <label class="label-text text-[11px] text-base-content/50">OTA Password</label>
                <div class="flex gap-2">
                  <input type="password" class="input input-bordered input-sm w-full font-mono text-[10px]" [(ngModel)]="secrets().ota_password" (change)="markSecretsDirty()" />
                  <button class="btn btn-ghost btn-sm" (click)="regenerateKey('ota_password')">Regen</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Generate -->
          <div class="bg-base-100 rounded-xl border border-base-300/40 px-5 py-4">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="font-semibold text-sm">Generate Firmware</h3>
                <p class="text-xs text-base-content/50 mt-0.5">Produces ESPHome YAML + C++ headers for this controller.</p>
              </div>
              <div class="flex items-center gap-2">
                <button
                  class="btn btn-primary btn-sm gap-1.5"
                  (click)="generate()"
                  [disabled]="generating()"
                >
                  @if (generating()) { <span class="loading loading-spinner loading-xs"></span> }
                  Generate
                </button>
                @if (downloadUrl()) {
                  <a
                    class="btn btn-outline btn-sm gap-1"
                    [href]="downloadUrl()"
                    target="_blank"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download ZIP
                  </a>
                }
              </div>
            </div>

            @if (fwError()) {
              <div class="mt-3 text-xs text-error">{{ fwError() }}</div>
            }

            @if (fwFiles().length > 0) {
              <div class="mt-3 border-t border-base-300/30 pt-3">
                <table class="table table-xs">
                  <thead>
                    <tr>
                      <th class="text-xs uppercase tracking-wider text-base-content/50 font-semibold">File</th>
                      <th class="text-xs uppercase tracking-wider text-base-content/50 font-semibold">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (f of fwFiles(); track f.path) {
                      <tr>
                        <td class="font-mono text-[11px]">{{ f.path }}</td>
                        <td class="text-[11px] text-base-content/60">{{ f.description }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>

          <!-- Build instructions -->
          <div class="bg-base-100 rounded-xl border border-base-300/40 px-5 py-4">
            <h3 class="font-semibold text-sm">Build & Flash</h3>
            <p class="text-xs text-base-content/50 mt-1">
              After downloading the ZIP, extract it and run:
            </p>
            <div class="mt-2 bg-base-200 rounded-lg p-3 font-mono text-[11px] space-y-1">
              <div><span class="text-base-content/40"># Compile</span></div>
              <div>esphome compile device.yaml</div>
              <div class="pt-1"><span class="text-base-content/40"># Flash</span></div>
              <div>esphome run device.yaml</div>
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class DeployPageComponent {
  private workspace = inject(WorkspaceService);
  private editor = inject(SystemEditorService);
  private backend = inject(BackendService);

  protected selectedSystemId = signal('');
  protected systemEntries = signal<Array<{ id: string; friendlyName: string; board: string; deviceName: string }>>([]);

  protected generating = signal(false);
  protected fwFiles = signal<FileEntry[]>([]);
  protected fwError = signal<string | null>(null);
  protected downloadUrl = signal<string | null>(null);

  protected secrets = signal<FirmwareSecrets>({ ...EMPTY_FIRMWARE_SECRETS });
  private secretsDirty = false;

  constructor() {
    this.updateSystemEntries();
    // Default to the controller currently focused in the workspace.
    const focused = this.editor.controllerId();
    if (focused) this.selectSystem(focused);
  }

  protected selectedBoardId = computed(() => {
    const id = this.selectedSystemId();
    if (!id) return '';
    return this.workspace.boards().get(id)?.model ?? '';
  });

  private updateSystemEntries() {
    const topology = this.workspace.siteTopology();
    const entries = (topology?.controllers ?? []).map(ctrl => ({
      id: ctrl.id,
      friendlyName: (ctrl as any).friendlyName ?? ctrl.id,
      board: ctrl.board,
      deviceName: slug((ctrl as any).friendlyName ?? ctrl.id),
    }));
    this.systemEntries.set(entries);
  }

  protected toInputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected async selectSystem(systemId: string) {
    this.selectedSystemId.set(systemId);
    this.fwFiles.set([]);
    this.fwError.set(null);
    this.downloadUrl.set(null);

    if (!systemId) return;

    // Auto-generate on selection
    this.generate();
  }

  async generate() {
    const systemId = this.selectedSystemId();
    if (!systemId) return;

    const siteId = this.workspace.site()?.id;
    if (!siteId) return;

    this.generating.set(true);
    this.fwError.set(null);
    try {
      const result = await this.backend.generate(siteId, systemId);
      if (this.selectedSystemId() !== systemId) return;

      this.fwFiles.set(result.files);
      this.downloadUrl.set(result.downloadUrl);
    } catch (err) {
      this.fwError.set(String(err));
    } finally {
      this.generating.set(false);
    }
  }

  protected markSecretsDirty() {
    this.secretsDirty = true;
  }

  protected regenerateKey(key: 'ota_password') {
    const fresh = randomHex(16);
    this.secrets.update(s => ({ ...s, [key]: fresh }));
    this.secretsDirty = true;
  }
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
