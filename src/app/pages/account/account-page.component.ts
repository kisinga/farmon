import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { BackendService } from '../../core/services/backend.service';
import { AuthStore } from '../../core/services/auth.store';
import { DEFAULT_NOTIFICATION_PREFS } from '../../core/models/alerts';
import { SiteThresholdsComponent } from './site-thresholds.component';

/** A site the signed-in user owns, for the per-site threshold editors. */
interface OwnedSite { id: string; name: string }

/**
 * Account / notifications page - per-user notification preferences plus the
 * per-site alert thresholds the enabled types depend on.
 *
 * The toggles (one `notification_prefs` row per user, find-or-create) gate which
 * alert types reach the in-app bell and whether the server also emails them. Two
 * of those types have a tunable level, stored per-site on the `sites` record: the
 * tank-level alert (low/full %) and the controller-offline alert (timeout). So when
 * either is on, a thresholds section appears below with one editor per owned site,
 * showing only the fields for the alerts that are actually enabled.
 */
@Component({
  selector: 'app-account-page',
  standalone: true,
  imports: [SiteThresholdsComponent],
  host: { class: 'flex-1 overflow-auto' },
  template: `
    <div class="content-pane space-y-6 max-w-2xl">
      <header>
        <h1 class="app-title text-lg font-bold">Notifications</h1>
        <p class="text-xs text-base-content/50 mt-0.5">{{ auth.user()?.email }}</p>
      </header>

      @if (loading()) {
        <div class="flex items-center justify-center py-24"><span class="loading loading-spinner loading-lg text-primary"></span></div>
      } @else {
        <!-- Which alerts, and where they go. Per-user; one Save commits the lot. -->
        <section class="surface p-5 space-y-4">
          <div>
            <h2 class="font-semibold text-sm">Alerts you receive</h2>
            <p class="text-[11px] text-base-content/40 mt-0.5">Choose which alerts reach the in-app bell, and whether to also get them by email.</p>
          </div>

          <div class="space-y-2.5">
            @for (t of types; track t.key) {
              <label class="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" class="toggle toggle-sm toggle-primary mt-0.5 shrink-0" [disabled]="saving()"
                  [checked]="value(t.key)" (change)="set(t.key, $any($event.target).checked)" />
                <span class="min-w-0">
                  <span class="text-sm">{{ t.label }}</span>
                  @if (t.hasThreshold && value(t.key)) {
                    <span class="block text-[11px] text-base-content/40">Set the level under Alert thresholds below.</span>
                  }
                </span>
              </label>
            }
          </div>

          <div class="pt-3 border-t border-base-300/30 space-y-1">
            <label class="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" class="toggle toggle-sm toggle-primary" [disabled]="saving()"
                [checked]="channelEmail()" (change)="setChannelEmail($any($event.target).checked)" />
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
        </section>

        <!-- Thresholds for the enabled alerts, per site. The values live on each
             site, so they're edited (and saved) per site, not with the prefs above. -->
        @if (showTank() || showOffline()) {
          <section class="surface p-5 space-y-4">
            <div>
              <h2 class="font-semibold text-sm">Alert thresholds</h2>
              <p class="text-[11px] text-base-content/40 mt-0.5">The levels that trigger the alerts above, set per site.</p>
            </div>

            @if (sites().length) {
              <div class="space-y-3">
                @for (s of sites(); track s.id) {
                  <div class="rounded-xl ring-1 ring-base-300/40 p-4 space-y-3">
                    <div class="text-xs font-semibold text-base-content/60">{{ s.name }}</div>
                    <app-site-thresholds [siteId]="s.id" [showTank]="showTank()" [showOffline]="showOffline()" />
                  </div>
                }
              </div>
            } @else {
              <p class="text-sm text-base-content/50 py-2">No sites yet. Thresholds appear here once you own a site.</p>
            }
          </section>
        }
      }
    </div>
  `,
})
export class AccountPageComponent implements OnInit {
  private backend = inject(BackendService);
  protected auth = inject(AuthStore);

  protected readonly types = [
    { key: 'alert_device_offline', label: 'Controller offline', hasThreshold: true },
    { key: 'alert_fault', label: 'Faults (no flow, tank low, max runtime)', hasThreshold: false },
    { key: 'alert_tank', label: 'Tank level (low / full volume)', hasThreshold: true },
    { key: 'alert_command_failed', label: 'Command did not apply', hasThreshold: false },
  ] as const;

  protected loading = signal(true);
  protected saving = signal(false);
  protected saved = signal(false);
  protected error = signal<string | null>(null);

  // The four alert-type toggles. The email channel is tracked separately in
  // `channelEmail`, so it deliberately isn't part of this map.
  // Offline is opt-in (default off); the rest default on. See
  // DEFAULT_NOTIFICATION_PREFS for why.
  private flags = signal<Record<string, boolean>>({
    alert_device_offline: false,
    alert_fault: true,
    alert_tank: true,
    alert_command_failed: true,
  });
  protected channelEmail = signal(DEFAULT_NOTIFICATION_PREFS.channel_email);
  private recordId = '';

  /** Sites the user owns - each gets a threshold editor in the section below. */
  protected sites = signal<OwnedSite[]>([]);

  // The thresholds section follows the live toggle state (immediate feedback),
  // not the last-saved prefs: tank-level → low/full %, controller-offline → timeout.
  protected showTank = computed(() => this.flags()['alert_tank'] ?? true);
  protected showOffline = computed(() => this.flags()['alert_device_offline'] ?? false);

  protected value(key: string): boolean {
    return this.flags()[key] ?? true;
  }
  protected set(key: string, v: boolean): void {
    this.flags.update((f) => ({ ...f, [key]: v }));
    this.saved.set(false); // edits invalidate the "Saved" confirmation
  }
  protected setChannelEmail(v: boolean): void {
    this.channelEmail.set(v);
    this.saved.set(false);
  }

  async ngOnInit() {
    const user = this.auth.user();
    if (!user) { this.loading.set(false); return; }
    void this.loadSites(user.id);
    try {
      const r = await this.backend.pb
        .collection('notification_prefs')
        .getFirstListItem(this.backend.pb.filter('user = {:u}', { u: user.id }), { requestKey: 'prefs:edit' });
      this.recordId = r['id'];
      this.flags.set({
        alert_device_offline: r['alert_device_offline'] === true, // opt-in
        alert_fault: r['alert_fault'] !== false,
        alert_tank: r['alert_tank'] !== false,
        alert_command_failed: r['alert_command_failed'] !== false,
      });
      this.channelEmail.set(r['channel_email'] === true);
    } catch {
      // No row yet - defaults already loaded.
    } finally {
      this.loading.set(false);
    }
  }

  /** Load the sites this user owns, for the per-site threshold editors. */
  private async loadSites(userId: string): Promise<void> {
    try {
      // Display name is the `name` field; the owners multi-relation is `owner`
      // (see BackendService.siteLoad). Non-admins are already list-scoped to their
      // sites server-side, but filtering keeps it correct for admins too.
      const rows = await this.backend.pb.collection('sites').getFullList({
        filter: this.backend.pb.filter('owner ~ {:u}', { u: userId }),
        fields: 'id,name',
        sort: 'name',
        requestKey: 'prefs:sites',
      });
      this.sites.set(rows.map((r) => ({ id: r['id'], name: (r['name'] as string) || r['id'] })));
    } catch {
      // Leave empty - the thresholds section shows a gentle empty state.
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
      this.saved.set(true); // stays until the next edit clears it
    } catch (err) {
      this.error.set(String(err));
    } finally {
      this.saving.set(false);
    }
  }
}
