import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ConfigStore } from '../../core/stores/config.store';
import { SitesStore } from '../../core/stores/sites.store';
import { DevicesStore } from '../../core/stores/devices.store';
import { ConfirmService } from '../../core/services/confirm.service';
import type { DeviceEntry } from '../../core/models/backend-api';
import { SectionHeaderComponent } from '../editor/shared/section-header.component';

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

interface DeviceGroup {
  siteId: string;
  siteName: string;
  managed: boolean;
  atCap: boolean;
  /** Active (registered, not deregistered) devices — what counts toward the cap. */
  activeCount: number;
  devices: DeviceEntry[];
}

/**
 * Devices fleet (admin). The registry of provisioned devices (`controllers`
 * rows) — what actually exists on the platform, grouped by site, with online
 * status and lifecycle actions. Provisioning still originates from the site's
 * Firmware page (identity is derived from the topology); this is where you see
 * and manage the result.
 */
@Component({
  selector: 'app-devices-page',
  standalone: true,
  imports: [SectionHeaderComponent],
  host: { class: 'flex-1 overflow-auto' },
  template: `
    <div class="content-pane space-y-6">

      <app-section-header
        title="Devices"
        subtitle="Every controller registered on the platform. Provision a new one from a site's Firmware page." />

      @if (loading()) {
        <div class="flex items-center justify-center py-24"><span class="loading loading-spinner loading-lg text-cyan-400"></span></div>
      } @else if (devices().length === 0) {
        <div class="rounded-2xl border border-dashed border-base-300/50 py-16 text-center">
          <p class="text-base font-medium">No devices yet</p>
          <p class="text-sm text-base-content/50 mt-1">Generate firmware for a controller (Site → Firmware) to register its first device.</p>
        </div>
      } @else {
        <div class="space-y-5">
          @for (g of groups(); track g.siteId) {
            <div class="surface overflow-hidden">
              <!-- Group header: site + usage -->
              <div class="flex items-center justify-between gap-3 px-5 py-3 border-b border-base-300/30 bg-base-200/40">
                <button class="font-semibold text-sm hover:text-cyan-300 transition-colors" (click)="openSite(g.siteId)">
                  {{ g.siteName || g.siteId }}
                </button>
                <span class="text-xs"
                      [class]="g.atCap ? 'text-amber-400' : 'text-base-content/50'">
                  @if (g.managed) { {{ g.activeCount }} / {{ cap() }} devices }
                  @else { {{ g.activeCount }} device{{ g.activeCount !== 1 ? 's' : '' }} · on-prem }
                </span>
              </div>

              <!-- Devices -->
              <div class="divide-y divide-base-300/20">
                @for (d of g.devices; track d.id) {
                  <div class="flex items-center gap-3 px-5 py-3" [class.opacity-50]="!d.active">
                    <span class="w-2 h-2 rounded-full shrink-0"
                          [class]="!d.active ? 'bg-base-content/15' : (d.online ? 'bg-emerald-400' : 'bg-base-content/25')"
                          [title]="!d.active ? 'Deregistered' : (d.online ? 'Online' : 'Offline')"></span>
                    <div class="flex-1 min-w-0">
                      @if (renamingId() === d.id) {
                        <input
                          class="input input-xs input-bordered font-medium w-full max-w-xs"
                          [value]="d.name"
                          (keydown.enter)="confirmRename(d.id, $event)"
                          (keydown.escape)="renamingId.set(null)"
                          (blur)="confirmRename(d.id, $event)"
                        />
                      } @else {
                        <p class="text-sm font-medium truncate">
                          {{ d.name || d.deviceId }}
                          @if (!d.active) { <span class="badge badge-ghost badge-xs ml-1 align-middle">deregistered</span> }
                          @if (d.macConflict) {
                            <span class="badge badge-error badge-xs ml-1 align-middle"
                                  title="Another board is connecting as this controller with a different chip MAC ({{ d.conflictMac }}) — likely the same firmware flashed to two boards.">⚠ duplicate hardware</span>
                          }
                        </p>
                      }
                      <p class="text-[11px] text-base-content/40 font-mono truncate">{{ d.deviceId }}</p>
                    </div>
                    <div class="hidden sm:flex flex-col items-end text-[11px] text-base-content/50 shrink-0">
                      <span>{{ d.boardType || 'unknown board' }}{{ d.firmwareVersion ? ' · fw ' + d.firmwareVersion : '' }}</span>
                      <span [title]="d.lastSeen">last seen {{ rel(d.lastSeen) }}</span>
                    </div>
                    <div class="dropdown dropdown-end shrink-0">
                      <button tabindex="0" class="btn btn-xs btn-ghost btn-square" title="More">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v.01M12 12v.01M12 19v.01" />
                        </svg>
                      </button>
                      <ul tabindex="0" class="dropdown-content menu bg-base-100 rounded-box shadow-lg border border-base-300/40 z-50 w-44 p-1.5">
                        <li><button (click)="openFirmware(d)">Firmware / re-provision</button></li>
                        <li><button (click)="startRename(d.id)">Rename</button></li>
                        @if (d.active) {
                          <li><button class="text-error" (click)="deregister(d)">Deregister</button></li>
                        } @else {
                          <li><button (click)="reactivate(d)">Reactivate</button></li>
                        }
                        @if (d.macConflict) {
                          <li><button class="text-warning" (click)="clearMacBinding(d)">Clear hardware binding</button></li>
                        }
                      </ul>
                    </div>
                  </div>
                }
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class DevicesPageComponent implements OnInit {
  private configStore = inject(ConfigStore);
  private sitesStore = inject(SitesStore);
  private devicesStore = inject(DevicesStore);
  private confirmService = inject(ConfirmService);
  private router = inject(Router);

  protected devices = computed(() => this.devicesStore.list());
  protected cap = signal(0);
  protected loading = signal(true);
  protected renamingId = signal<string | null>(null);

  /** siteId → managed?, for the per-group usage label. */
  private siteMode = signal<Map<string, boolean>>(new Map());

  protected groups = computed<DeviceGroup[]>(() => {
    const modeMap = this.siteMode();
    const byId = new Map<string, DeviceGroup>();
    for (const d of this.devices()) {
      let g = byId.get(d.siteId);
      if (!g) {
        const managed = modeMap.get(d.siteId) ?? true; // unset mode → managed
        g = { siteId: d.siteId, siteName: d.siteName, managed, atCap: false, activeCount: 0, devices: [] };
        byId.set(d.siteId, g);
      }
      g.devices.push(d);
    }
    const cap = this.cap();
    const groups = [...byId.values()];
    for (const g of groups) {
      g.activeCount = g.devices.filter((d) => d.active).length;
      g.atCap = g.managed && g.activeCount >= cap;
    }
    return groups.sort((a, b) => (a.siteName || a.siteId).localeCompare(b.siteName || b.siteId));
  });

  async ngOnInit() {
    await this.refresh();
  }

  private async refresh() {
    this.loading.set(true);
    try {
      const [, sites] = await Promise.all([
        this.devicesStore.ensureLoaded(),
        this.sitesStore.ensureLoaded(),
        this.configStore.ensureLoaded(),
      ]);
      this.cap.set(this.configStore.cap());
      this.siteMode.set(new Map(sites.map((s) => [s.id, s.mode !== 'local'])));
    } finally {
      // Always clear the spinner — a failed fetch lands its cause on the store's
      // `error` signal rather than hanging the page on the loader forever.
      this.loading.set(false);
    }
  }

  protected rel(iso: string): string {
    return relTime(iso);
  }

  protected openSite(siteId: string): void {
    this.router.navigate(['/site', siteId]);
  }

  /** Deep-link to the device's controller Firmware section (regenerating there
   *  re-provisions: rotates the MQTT token + rebakes secrets). */
  protected openFirmware(d: DeviceEntry): void {
    this.router.navigate(['/site', d.siteId, 'system', d.deviceId, 'firmware']);
  }

  protected startRename(id: string): void {
    this.renamingId.set(id);
  }

  protected async confirmRename(id: string, event: Event): Promise<void> {
    const name = (event.target as HTMLInputElement).value.trim();
    if (name) {
      await this.devicesStore.rename(id, name);
    }
    this.renamingId.set(null);
  }

  protected async deregister(d: DeviceEntry): Promise<void> {
    const confirmed = await this.confirmService.confirm({
      title: 'Deregister device',
      message:
        `Deregister "${d.name || d.deviceId}"? It stops connecting to the broker and frees a ` +
        `hosting slot on its site. Its history and credentials are kept — you can reactivate it ` +
        `later. The box keeps its firmware until reflashed.`,
      confirmLabel: 'Deregister',
      variant: 'error',
    });
    if (!confirmed) return;
    await this.devicesStore.deregister(d.id);
  }

  protected async reactivate(d: DeviceEntry): Promise<void> {
    try {
      await this.devicesStore.reactivate(d.id);
    } catch (e) {
      // The server rejects reactivation that would exceed the site's device cap.
      await this.confirmService.confirm({
        title: 'Cannot reactivate',
        message: (e as Error)?.message || 'Reactivation failed (the site may be at its device cap).',
        confirmLabel: 'OK',
        acknowledge: true,
      });
    }
  }

  /** Clear the hardware binding after a legit board swap. Re-binds to the next
   *  board that connects, so confirm it's an intentional replacement (not the same
   *  firmware accidentally on two live boards). */
  protected async clearMacBinding(d: DeviceEntry): Promise<void> {
    const confirmed = await this.confirmService.confirm({
      title: 'Clear hardware binding',
      message:
        `Clear the hardware binding for "${d.name || d.deviceId}"? Do this only if the board was ` +
        `replaced. The next board to connect becomes the new bound device. If two boards are still ` +
        `running this firmware, the conflict will simply re-trigger.`,
      confirmLabel: 'Clear binding',
      variant: 'warning',
    });
    if (!confirmed) return;
    await this.devicesStore.clearMacBinding(d.id);
  }
}
