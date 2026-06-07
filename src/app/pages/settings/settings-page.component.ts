import { Component, inject, OnInit, signal } from '@angular/core';
import { ConfigStore } from '../../core/stores/config.store';
import { SectionHeaderComponent } from '../editor/shared/section-header.component';

/**
 * Settings (admin). Edits the global `app_config` singleton — business rules that
 * are deliberately NOT environment config (env owns infrastructure; this owns
 * tunable policy). Today: the managed hosting device cap. Add fields here as the
 * config grows.
 */
@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [SectionHeaderComponent],
  host: { class: 'flex-1 overflow-auto' },
  template: `
    <div class="content-pane space-y-6">
      <app-section-header title="Settings" subtitle="Global platform configuration. Applies to all sites." />

      @if (loading()) {
        <div class="flex items-center justify-center py-24"><span class="loading loading-spinner loading-lg text-cyan-400"></span></div>
      } @else {
        <div class="surface p-5 space-y-4">
          <h3 class="font-semibold text-sm">Hosting</h3>

          <label class="form-control">
            <span class="label-text text-xs text-base-content/60 mb-1">Devices per managed site</span>
            <input
              type="number" min="1" max="50"
              class="input input-bordered input-sm w-32"
              [value]="cap()"
              (input)="cap.set(+$any($event.target).value)"
            />
            <span class="text-[11px] text-base-content/40 mt-1">
              The number of devices a site's yearly hosting fee covers. Enforced when provisioning a new device.
            </span>
          </label>

          <div class="flex items-center gap-3 pt-2 border-t border-base-300/30">
            <button class="btn btn-primary btn-sm" (click)="save()" [disabled]="saving() || cap() < 1">
              @if (saving()) { <span class="loading loading-spinner loading-xs"></span> }
              Save
            </button>
            @if (saved()) { <span class="text-xs text-emerald-400">Saved</span> }
            @if (error()) { <span class="text-xs text-error">{{ error() }}</span> }
          </div>
        </div>
      }
    </div>
  `,
})
export class SettingsPageComponent implements OnInit {
  private config = inject(ConfigStore);

  protected loading = signal(true);
  protected saving = signal(false);
  protected saved = signal(false);
  protected error = signal<string | null>(null);
  protected cap = signal(0);
  private recordId = '';

  async ngOnInit() {
    try {
      const cfg = await this.config.loadForEdit();
      this.recordId = cfg.id;
      this.cap.set(cfg.hostingDeviceCap);
    } catch (err) {
      this.error.set(String(err));
    } finally {
      this.loading.set(false);
    }
  }

  async save() {
    if (this.cap() < 1) return;
    this.saving.set(true);
    this.saved.set(false);
    this.error.set(null);
    try {
      await this.config.save(this.recordId, { hostingDeviceCap: this.cap() });
      this.saved.set(true);
    } catch (err) {
      this.error.set(String(err));
    } finally {
      this.saving.set(false);
    }
  }
}
