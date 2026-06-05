import { Component, inject, signal, computed, effect } from '@angular/core';
import { WorkspaceService } from '../../core/services/workspace.service';
import { SystemEditorService } from '../../core/services/system-editor.service';
import { BackendService } from '../../core/services/backend.service';
import { SectionHeaderComponent } from '../editor/shared/section-header.component';

interface FileEntry {
  path: string;
  description: string;
  lines: number;
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
        <!-- Secrets are provisioned automatically -->
        <div class="surface p-5">
          <h3 class="font-semibold text-sm">Device secrets</h3>
          <p class="text-xs text-base-content/50 mt-1.5 leading-relaxed">
            Generated &amp; registered automatically when you generate firmware — a per-controller
            MQTT token and a stable OTA password, baked into <code class="text-[10px] px-1 py-0.5 rounded bg-base-200">secrets.yaml</code>.
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
      }
    </div>
  `,
})
export class DeployPageComponent {
  private workspace = inject(WorkspaceService);
  private editor = inject(SystemEditorService);
  private backend = inject(BackendService);

  /** The controller selected in the sub-header — the one switcher. */
  protected controllerId = this.editor.controllerId;
  protected controllerName = computed(
    () => this.editor.activeController()?.friendlyName ?? this.controllerId() ?? '',
  );

  protected generating = signal(false);
  protected fwFiles = signal<FileEntry[]>([]);
  protected fwError = signal<string | null>(null);
  protected downloadUrl = signal<string | null>(null);

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
        void this.generate();
      }
    });
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
    } catch (err) {
      this.fwError.set(String(err));
    } finally {
      this.generating.set(false);
    }
  }
}
