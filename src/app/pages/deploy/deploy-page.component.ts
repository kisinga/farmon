import { Component, inject, signal, computed, effect } from '@angular/core';
import { WorkspaceService } from '../../core/services/workspace.service';
import { SystemEditorService } from '../../core/services/system-editor.service';
import { BackendService } from '../../core/services/backend.service';
import { TopologyDiagramService } from '../../core/services/topology-diagram.service';
import { SectionHeaderComponent } from '../editor/shared/section-header.component';
import type { DeviceEntry } from '../../core/models/backend-api';

interface FileEntry {
  path: string;
  description: string;
  lines: number;
}

/** Human "x ago" for a last-seen ISO timestamp. */
function relTime(iso: string): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return 'never';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Firmware section. Generates the ESPHome bundle for the controller currently
 * selected in the workspace sub-header (the one switcher) — no local controller
 * picker. Auto-generates on entry and whenever the active controller changes.
 */
@Component({
  selector: 'app-deploy-page',
  standalone: true,
  imports: [SectionHeaderComponent],
  template: `
    <div class="content-pane space-y-6">
      <app-section-header
        title="Firmware"
        subtitle="Generate the ESPHome bundle for this controller: device YAML plus C++ headers. Download the ZIP, then build and flash it with esphome." />

      @if (!controllerId()) {
        <div class="surface px-6 py-12 text-center">
          <p class="text-sm text-base-content/50">Add a controller in Design to generate firmware.</p>
        </div>
      } @else {
        <!-- Registration status + secrets -->
        <div class="surface p-5">
          <div class="flex items-center justify-between gap-3">
            <h3 class="font-semibold text-sm">Device registration</h3>
            @if (device(); as d) {
              <span class="flex items-center gap-1.5 text-xs"
                    [class]="d.online ? 'text-emerald-400' : 'text-base-content/50'">
                <span class="w-2 h-2 rounded-full" [class]="d.online ? 'bg-emerald-400' : 'bg-base-content/30'"></span>
                {{ d.online ? 'Online' : 'Offline' }}
              </span>
            }
          </div>

          @if (device(); as d) {
            <div class="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-base-content/60">
              <span>Registered <span class="text-emerald-400">&check;</span></span>
              <span [title]="d.lastSeen">last seen {{ rel(d.lastSeen) }}</span>
              @if (d.boardType) { <span>{{ d.boardType }}</span> }
              @if (d.firmwareVersion) { <span>fw {{ d.firmwareVersion }}</span> }
            </div>
          } @else {
            <p class="mt-2 text-xs text-base-content/50">
              Not yet registered. Generating firmware registers this device on the platform.
            </p>
          }

          <p class="text-xs text-base-content/50 mt-3 leading-relaxed border-t border-base-300/30 pt-3">
            Generating firmware <span class="text-base-content/70">(re)provisions</span> this device: it rotates the
            per-controller MQTT token and bakes it with a stable OTA password into
            <code class="text-[10px] px-1 py-0.5 rounded bg-base-200">secrets.yaml</code>.
            <span class="text-base-content/40">Wi-Fi is not stored here:</span> set it on the device's
            setup page (captive portal or Improv) after flashing — it lives in the device's own flash.
          </p>
        </div>

        <!-- Generate -->
        <div class="surface p-5">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h3 class="font-semibold text-sm">Generate firmware</h3>
              <p class="text-xs text-base-content/50 mt-0.5">Produces ESPHome YAML + C++ headers for {{ controllerName() }}.</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button class="btn btn-primary btn-sm gap-1.5" (click)="generate()" [disabled]="generating()">
                @if (generating()) { <span class="loading loading-spinner loading-xs"></span> }
                Generate
              </button>
              @if (downloadUrl()) {
                <a class="btn btn-outline btn-sm gap-1" [href]="downloadUrl()" target="_blank">
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
            <div class="mt-4 border-t border-base-300/30 pt-3">
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
        <div class="surface p-5">
          <h3 class="font-semibold text-sm">Build &amp; flash</h3>
          <p class="text-xs text-base-content/50 mt-1.5">
            Extract the ZIP to a folder whose path has <span class="text-base-content/70 font-medium">no spaces</span>
            (ESP-IDF can't build otherwise), then run the bundled helper:
          </p>
          <div class="mt-2 bg-base-200 rounded-lg p-3 font-mono text-[11px] space-y-1 ring-1 ring-base-300/30">
            <div><span class="text-base-content/40"># compile only</span></div>
            <div>bash compile.sh</div>
            <div class="pt-1"><span class="text-base-content/40"># build + flash (USB or OTA)</span></div>
            <div>bash compile.sh flash</div>
            <div class="pt-1"><span class="text-base-content/40"># tail device logs</span></div>
            <div>bash compile.sh logs</div>
          </div>
        </div>

        <!-- Site documentation (whole-site) -->
        <div class="surface p-5">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h3 class="font-semibold text-sm">Site documentation</h3>
              <p class="text-xs text-base-content/50 mt-0.5">
                Render this site's topology diagrams and open the full installer + operator document.
                This also publishes the diagrams so the customer can view their docs.
              </p>
            </div>
            <button class="btn btn-outline btn-sm gap-1.5" (click)="generateDocs()" [disabled]="docBusy()">
              @if (docBusy()) { <span class="loading loading-spinner loading-xs"></span> }
              Generate docs
            </button>
          </div>
          @if (docError()) { <div class="mt-3 text-xs text-error">{{ docError() }}</div> }
        </div>
      }
    </div>
  `,
})
export class DeployPageComponent {
  private workspace = inject(WorkspaceService);
  private editor = inject(SystemEditorService);
  private backend = inject(BackendService);
  private diagrams = inject(TopologyDiagramService);

  /** The controller selected in the sub-header — the one switcher. */
  protected controllerId = this.editor.controllerId;
  protected controllerName = computed(
    () => this.editor.activeController()?.friendlyName ?? this.controllerId() ?? '',
  );

  protected generating = signal(false);
  protected fwFiles = signal<FileEntry[]>([]);
  protected fwError = signal<string | null>(null);
  protected downloadUrl = signal<string | null>(null);
  /** This controller's registry status (null until provisioned). */
  protected device = signal<DeviceEntry | null>(null);

  /** Building the whole-site documentation (render diagrams → publish → open). */
  protected docBusy = signal(false);
  protected docError = signal<string | null>(null);

  /**
   * Render the site's topology diagrams (same X6 engine as the editor), cache
   * them on the site for the customer view, then assemble + open the full doc.
   */
  async generateDocs(): Promise<void> {
    const siteId = this.workspace.site()?.id;
    if (!siteId || this.docBusy()) return;
    this.docBusy.set(true);
    this.docError.set(null);
    try {
      const topo = await this.backend.siteTopology(siteId);
      const diagrams = await this.diagrams.renderSiteDiagrams(topo);
      await this.backend.saveSiteDiagrams(siteId, topo, diagrams);
      const html = await this.backend.buildSiteDoc(siteId, { diagrams });
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      this.docError.set(String(err));
    } finally {
      this.docBusy.set(false);
    }
  }

  constructor() {
    // Auto-generate on entry and whenever the active controller changes.
    let lastId: string | null = null;
    effect(() => {
      const id = this.controllerId();
      if (id && id !== lastId) {
        lastId = id;
        this.fwFiles.set([]);
        this.fwError.set(null);
        this.downloadUrl.set(null);
        this.device.set(null);
        void this.loadDevice();
        void this.generate();
      }
    });
  }

  protected rel(iso: string): string {
    return relTime(iso);
  }

  private async loadDevice() {
    const id = this.controllerId();
    if (!id) return;
    this.device.set(await this.backend.deviceStatus(id));
  }

  async generate() {
    const systemId = this.controllerId();
    const siteId = this.workspace.site()?.id;
    if (!systemId || !siteId) return;

    this.generating.set(true);
    this.fwError.set(null);
    try {
      const result = await this.backend.generate(siteId, systemId);
      if (this.controllerId() !== systemId) return;
      this.fwFiles.set(result.files);
      this.downloadUrl.set(result.downloadUrl);
      void this.loadDevice(); // generation registers/updates the device row

    } catch (err) {
      this.fwError.set(String(err));
    } finally {
      this.generating.set(false);
    }
  }
}
