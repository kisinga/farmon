import { Component, inject, signal, computed, effect } from '@angular/core';
import { WorkspaceService } from '../../core/services/workspace.service';
import { SystemEditorService } from '../../core/services/system-editor.service';
import { BackendService } from '../../core/services/backend.service';
import { BuildService, type FirmwareRelease } from '../../core/services/build.service';
import { DevicesStore } from '../../core/stores/devices.store';
import { AuthStore } from '../../core/services/auth.store';
import { ConfirmService } from '../../core/services/confirm.service';
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
 * picker. The controller is registered when its design is saved; generation is a
 * deliberate button press that downloads its build and bakes its secrets, so it
 * must not fire just from opening the page.
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

      <!-- Site documentation (whole-site) — the lead action: renders + publishes
           the topology diagrams the customer sees, independent of any one
           controller. Stays usable on a live site (publishing the cached diagrams
           doesn't touch the locked topology). -->
      <div class="surface p-5 border-l-2 border-primary/40">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="font-semibold text-sm">Site documentation</h3>
            <p class="text-xs text-base-content/50 mt-0.5">
              Render this site's topology diagrams and open the full installer + operator document.
              This also publishes the diagrams so the customer can view their docs.
            </p>
            <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              @if (docMeta(); as m) {
                @if (m.published) {
                  <span class="text-base-content/60">
                    @if (m.generatedAt) { Last generated {{ rel(m.generatedAt) }} } @else { Published }
                  </span>
                  @if (m.stale) {
                    <span class="badge badge-warning badge-xs gap-1" title="Topology changed since these were published — the customer sees no diagrams until you regenerate.">topology changed since</span>
                  }
                } @else {
                  <span class="text-base-content/40">Not generated yet — the customer can't see diagrams.</span>
                }
              }
            </div>
          </div>
          <button class="btn btn-outline btn-sm gap-1.5 shrink-0" (click)="generateDocs()" [disabled]="docBusy()">
            @if (docBusy()) { <span class="loading loading-spinner loading-xs"></span> }
            {{ docMeta()?.published ? 'Regenerate' : 'Generate docs' }}
          </button>
        </div>
        @if (docError()) { <div class="mt-3 text-xs text-error">{{ docError() }}</div> }
      </div>

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
              Not registered yet. Save the site design to register this controller, then generate its firmware.
            </p>
          }

          @if (device(); as d) {
            @if (d.macConflict) {
              <div class="mt-3 rounded-lg border border-error/40 bg-error/10 p-3">
                <p class="text-xs font-semibold text-error">⚠ Duplicate hardware detected</p>
                <p class="text-[11px] text-base-content/70 mt-1 leading-relaxed">
                  A second board is connecting as this controller with a different chip MAC
                  (<code class="text-[10px] px-1 py-0.5 rounded bg-base-200">{{ d.conflictMac }}</code>) — almost
                  always the same firmware flashed to two boards. They will fight over the connection and their
                  data will mix. Reflash one board with its own build. If you replaced the board, clear the
                  binding to bind the new one.
                </p>
                @if (isAdmin()) {
                  <button class="btn btn-warning btn-xs mt-2 gap-1.5" (click)="clearMacBinding()" [disabled]="clearingBinding()">
                    @if (clearingBinding()) { <span class="loading loading-spinner loading-xs"></span> }
                    Clear hardware binding
                  </button>
                }
              </div>
            }
          }

          <p class="text-xs text-base-content/50 mt-3 leading-relaxed border-t border-base-300/30 pt-3">
            Generating firmware downloads the build for this registered controller: it bakes the
            controller's stable MQTT token and OTA password into
            <code class="text-[10px] px-1 py-0.5 rounded bg-base-200">secrets.yaml</code>.
            These stay the same across rebuilds, so a flashed device keeps connecting.
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
            <div class="pt-1"><span class="text-base-content/40"># build + isolate the image for an OTA upload (./ota/)</span></div>
            <div>bash compile.sh ota</div>
            <div class="pt-1"><span class="text-base-content/40"># tail device logs</span></div>
            <div>bash compile.sh logs</div>
          </div>
        </div>

        <!-- Over-the-air update -->
        <div class="surface p-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="font-semibold text-sm">Over-the-air update</h3>
              <p class="text-xs text-base-content/50 mt-0.5">
                Build with <code class="text-[10px] px-1 py-0.5 rounded bg-base-200">bash compile.sh ota</code>,
                upload the image it writes to <code class="text-[10px] px-1 py-0.5 rounded bg-base-200">./ota/</code>,
                then deploy — the device pulls and flashes itself over MQTT.
              </p>
            </div>
            @if (release(); as r) {
              <span class="badge badge-sm shrink-0" [class]="statusClass(r.status)">{{ r.status }}</span>
            }
          </div>

          @if (isAdmin()) {
            <div class="mt-3 flex flex-wrap items-end gap-2">
              <label class="text-xs text-base-content/50">
                Firmware image (.bin)
                <input type="file" accept=".bin"
                  class="file-input file-input-bordered file-input-sm w-full mt-1"
                  (change)="onOtaFile($event)" />
              </label>
              <label class="text-xs text-base-content/50">
                Version
                <input type="text" #verInput [value]="otaVersion()" (input)="otaVersion.set(verInput.value)"
                  class="input input-bordered input-sm w-40 mt-1" placeholder="e.g. a3f7b2d1" />
              </label>
              <button class="btn btn-outline btn-sm gap-1.5" (click)="uploadOta()"
                      [disabled]="!otaFile() || !otaVersion().trim() || uploading()">
                @if (uploading()) { <span class="loading loading-spinner loading-xs"></span> }
                Upload
              </button>
              <button class="btn btn-primary btn-sm gap-1.5" (click)="deployOta()" [disabled]="!release() || deploying()">
                @if (deploying()) { <span class="loading loading-spinner loading-xs"></span> }
                Deploy to device
              </button>
            </div>
            @if (release(); as r) {
              <p class="mt-2 text-[11px] text-base-content/50">
                Latest: <span class="font-mono">{{ r.version || '—' }}</span> ·
                md5 <span class="font-mono">{{ r.md5 }}</span> · {{ r.status }}
                @if (r.status === 'confirmed') { · running on device }
              </p>
            }
            @if (otaError()) { <div class="mt-2 text-xs text-error">{{ otaError() }}</div> }
          } @else {
            <p class="mt-2 text-xs text-base-content/50">OTA upload and deploy are admin-only.</p>
          }
        </div>

      }
    </div>
  `,
})
export class DeployPageComponent {
  private workspace = inject(WorkspaceService);
  private editor = inject(SystemEditorService);
  private backend = inject(BackendService);
  private build = inject(BuildService);
  private devicesStore = inject(DevicesStore);
  private auth = inject(AuthStore);
  protected isAdmin = this.auth.isAdmin;
  private confirmService = inject(ConfirmService);
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
  protected clearingBinding = signal(false);

  /** OTA: the picked image, its version, and the latest release row for status. */
  protected otaFile = signal<File | null>(null);
  protected otaVersion = signal('');
  protected uploading = signal(false);
  protected deploying = signal(false);
  protected otaError = signal<string | null>(null);
  protected release = signal<FirmwareRelease | null>(null);

  /** Building the whole-site documentation (render diagrams → publish → open). */
  protected docBusy = signal(false);
  protected docError = signal<string | null>(null);
  /** Last-published status (when, and whether the topology has drifted since). */
  protected docMeta = signal<{ generatedAt?: string; published: boolean; stale: boolean } | null>(null);

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
      const boards = await this.backend.boardBundles(new Set(topo.controllers.map((c) => c.board)));
      const diagrams = await this.diagrams.renderSiteDiagrams(topo, boards);
      await this.backend.saveSiteDiagrams(siteId, topo, diagrams);
      const html = await this.backend.buildSiteDoc(siteId, { diagrams });
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      void this.loadDocMeta();
    } catch (err) {
      this.docError.set(String(err));
    } finally {
      this.docBusy.set(false);
    }
  }

  /** Refresh the doc publication status for the current site (best-effort). */
  private async loadDocMeta(): Promise<void> {
    const siteId = this.workspace.site()?.id;
    if (!siteId) return;
    try {
      this.docMeta.set(await this.backend.docStatus(siteId));
    } catch {
      this.docMeta.set(null);
    }
  }

  constructor() {
    // On controller switch: reset the panel and refresh the (read-only)
    // registration status. Generation is NOT auto-run — it downloads the build and
    // bakes the controller's secrets, so it stays a deliberate button press.
    // Site-level: load the doc publication status once the site resolves (and on
    // a site switch). Independent of the per-controller refresh below.
    let lastSite: string | null = null;
    effect(() => {
      const siteId = this.workspace.site()?.id ?? null;
      if (siteId && siteId !== lastSite) {
        lastSite = siteId;
        this.docMeta.set(null);
        void this.loadDocMeta();
      }
    });

    let lastId: string | null = null;
    effect(() => {
      const id = this.controllerId();
      if (id && id !== lastId) {
        lastId = id;
        this.fwFiles.set([]);
        this.fwError.set(null);
        this.downloadUrl.set(null);
        this.device.set(null);
        this.otaFile.set(null);
        this.otaVersion.set('');
        this.otaError.set(null);
        this.release.set(null);
        void this.loadDevice();
        void this.loadRelease();
      }
    });
  }

  protected rel(iso: string): string {
    return relTime(iso);
  }

  private async loadDevice() {
    const id = this.controllerId();
    if (!id) return;
    this.device.set(await this.devicesStore.status(id));
  }

  private async loadRelease() {
    const id = this.controllerId();
    if (!id) return;
    try {
      const r = await this.build.latestRelease(id);
      if (this.controllerId() === id) this.release.set(r);
    } catch {
      /* no releases yet — leave null */
    }
  }

  /** File picked for OTA. compile.sh writes `<device>-<version>.bin`, so pre-fill
   *  the version field from the filename (still editable). */
  protected onOtaFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.otaFile.set(file);
    if (file) {
      const m = /-([^-/\\]+)\.bin$/.exec(file.name);
      if (m) this.otaVersion.set(m[1]);
    }
  }

  /** Upload the built binary as a firmware release (no device contact yet). */
  protected async uploadOta() {
    const ctrl = this.controllerId();
    const siteId = this.workspace.site()?.id;
    const file = this.otaFile();
    if (!ctrl || !siteId || !file || this.uploading()) return;
    this.uploading.set(true);
    this.otaError.set(null);
    try {
      await this.build.uploadFirmware(siteId, ctrl, this.otaVersion(), file);
      await this.loadRelease();
    } catch (err) {
      this.otaError.set(String(err));
    } finally {
      this.uploading.set(false);
    }
  }

  /** Publish the firmware_update command — the device pulls + flashes. Confirmed. */
  protected async deployOta() {
    const ctrl = this.controllerId();
    const siteId = this.workspace.site()?.id;
    const rel = this.release();
    if (!ctrl || !siteId || !rel || this.deploying()) return;
    const confirmed = await this.confirmService.confirm({
      title: 'Deploy firmware over the air',
      message:
        `Tell "${this.controllerName()}" to download and flash version ` +
        `${rel.version || rel.md5.slice(0, 8)} now? The device reboots into the new image.`,
    });
    if (!confirmed) return;
    this.deploying.set(true);
    this.otaError.set(null);
    try {
      await this.build.deployFirmware(siteId, ctrl, rel.id);
      await this.loadRelease();
    } catch (err) {
      this.otaError.set(String(err));
    } finally {
      this.deploying.set(false);
    }
  }

  protected statusClass(status?: string): string {
    switch (status) {
      case 'confirmed':
        return 'badge-success';
      case 'deployed':
        return 'badge-warning';
      case 'failed':
        return 'badge-error';
      default:
        return 'badge-ghost';
    }
  }

  /** Clear the hardware binding after a legit board swap, then refresh status.
   *  Admin-only (the button is gated and the collection rule enforces it). */
  protected async clearMacBinding() {
    const id = this.controllerId();
    if (!id || this.clearingBinding()) return;
    const confirmed = await this.confirmService.confirm({
      title: 'Clear hardware binding',
      message:
        `Clear the hardware binding for "${this.controllerName()}"? Do this only if the board was ` +
        `replaced. The next board to connect becomes the new bound device. If two boards are still ` +
        `running this firmware, the conflict will simply re-trigger.`,
    });
    if (!confirmed) return;
    this.clearingBinding.set(true);
    try {
      await this.devicesStore.clearMacBinding(id);
      await this.loadDevice();
    } finally {
      this.clearingBinding.set(false);
    }
  }

  async generate() {
    const systemId = this.controllerId();
    const siteId = this.workspace.site()?.id;
    if (!systemId || !siteId) return;

    this.generating.set(true);
    this.fwError.set(null);
    try {
      const result = await this.build.generate(siteId, systemId);
      if (this.controllerId() !== systemId) return;
      this.fwFiles.set(result.files);
      this.downloadUrl.set(result.downloadUrl);
      void this.loadDevice(); // generation refreshed the device's secrets
      this.devicesStore.invalidateAfterProvision(); // fleet list + site counts changed

    } catch (err) {
      this.fwError.set(String(err));
    } finally {
      this.generating.set(false);
    }
  }
}
