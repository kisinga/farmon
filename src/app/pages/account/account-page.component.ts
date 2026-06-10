import { Component, inject, OnInit, signal } from '@angular/core';
import { BackendService } from '../../core/services/backend.service';
import { AuthStore } from '../../core/services/auth.store';
import { DEFAULT_NOTIFICATION_PREFS } from '../../core/models/alerts';

/**
 * Account page — per-user notification preferences. One row per user in the
 * `notification_prefs` collection (find-or-create). The toggles gate which alert
 * types reach the in-app bell, and whether the server also emails them. Email is
 * the only setting that needs the backend; the rest are read by the browser.
 */
@Component({
  selector: 'app-account-page',
  standalone: true,
  host: { class: 'flex-1 overflow-auto' },
  template: `
    <div class="content-pane space-y-6 max-w-2xl">
      <header>
        <h1 class="text-lg font-bold tracking-tight">Account</h1>
        <p class="text-xs text-base-content/50 mt-0.5">{{ auth.user()?.email }}</p>
      </header>

      @if (loading()) {
        <div class="flex items-center justify-center py-24"><span class="loading loading-spinner loading-lg text-cyan-400"></span></div>
      } @else {
        <div class="surface p-5 space-y-4">
          <div>
            <h3 class="font-semibold text-sm">Notifications</h3>
            <p class="text-[11px] text-base-content/40 mt-0.5">Choose which alerts you want to see, and whether to also get them by email.</p>
          </div>

          <div class="space-y-2.5">
            @for (t of types; track t.key) {
              <label class="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" class="toggle toggle-sm toggle-primary"
                  [checked]="value(t.key)" (change)="set(t.key, $any($event.target).checked)" />
                <span class="text-sm">{{ t.label }}</span>
              </label>
            }
          </div>

          <div class="pt-3 border-t border-base-300/30 space-y-1">
            <label class="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" class="toggle toggle-sm toggle-primary"
                [checked]="channelEmail()" (change)="channelEmail.set($any($event.target).checked)" />
              <span class="text-sm">Email me alerts</span>
            </label>
            <p class="text-[11px] text-base-content/40 pl-12">Sent to {{ auth.user()?.email }} even when the app is closed. Requires email to be configured on the server.</p>
          </div>

          <div class="flex items-center gap-3 pt-2 border-t border-base-300/30">
            <button class="btn btn-primary btn-sm w-24" (click)="save()" [disabled]="saving()">
              @if (saving()) { <span class="loading loading-spinner loading-xs"></span> } @else { Save }
            </button>
            @if (saved()) { <span class="text-xs text-emerald-400">Saved</span> }
            @if (error()) { <span class="text-xs text-error">{{ error() }}</span> }
          </div>
        </div>
      }
    </div>
  `,
})
export class AccountPageComponent implements OnInit {
  private backend = inject(BackendService);
  protected auth = inject(AuthStore);

  protected readonly types = [
    { key: 'alert_device_offline', label: 'Controller offline' },
    { key: 'alert_fault', label: 'Faults (no flow, tank low, max runtime)' },
    { key: 'alert_tank', label: 'Tank level thresholds' },
    { key: 'alert_command_failed', label: 'Command did not apply' },
  ] as const;

  protected loading = signal(true);
  protected saving = signal(false);
  protected saved = signal(false);
  protected error = signal<string | null>(null);

  // The four alert-type toggles. The email channel is tracked separately in
  // `channelEmail`, so it deliberately isn't part of this map.
  private flags = signal<Record<string, boolean>>({
    alert_device_offline: true,
    alert_fault: true,
    alert_tank: true,
    alert_command_failed: true,
  });
  protected channelEmail = signal(DEFAULT_NOTIFICATION_PREFS.channel_email);
  private recordId = '';

  protected value(key: string): boolean {
    return this.flags()[key] ?? true;
  }
  protected set(key: string, v: boolean): void {
    this.flags.update((f) => ({ ...f, [key]: v }));
  }

  async ngOnInit() {
    const user = this.auth.user();
    if (!user) { this.loading.set(false); return; }
    try {
      const r = await this.backend.pb
        .collection('notification_prefs')
        .getFirstListItem(this.backend.pb.filter('user = {:u}', { u: user.id }), { requestKey: 'prefs:edit' });
      this.recordId = r['id'];
      this.flags.set({
        alert_device_offline: r['alert_device_offline'] !== false,
        alert_fault: r['alert_fault'] !== false,
        alert_tank: r['alert_tank'] !== false,
        alert_command_failed: r['alert_command_failed'] !== false,
      });
      this.channelEmail.set(r['channel_email'] === true);
    } catch {
      // No row yet — defaults already loaded.
    } finally {
      this.loading.set(false);
    }
  }

  async save() {
    const user = this.auth.user();
    if (!user) return;
    this.saving.set(true);
    this.saved.set(false);
    this.error.set(null);
    const body = {
      user: user.id,
      ...this.flags(),
      channel_email: this.channelEmail(),
    };
    try {
      if (this.recordId) {
        await this.backend.pb.collection('notification_prefs').update(this.recordId, body);
      } else {
        const r = await this.backend.pb.collection('notification_prefs').create(body);
        this.recordId = r['id'];
      }
      this.saved.set(true);
      setTimeout(() => this.saved.set(false), 2500);
    } catch (err) {
      this.error.set(String(err));
    } finally {
      this.saving.set(false);
    }
  }
}
