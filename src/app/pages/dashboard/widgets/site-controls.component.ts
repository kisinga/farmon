import { Component, computed, inject, input, signal } from '@angular/core';
import type { UnsubscribeFunc } from 'pocketbase';
import { DashboardStore } from '../dashboard.store';
import { CommandLifecycleStore } from '../command-lifecycle.store';
import { ConfirmService } from '../../../core/services/confirm.service';
import { DEVICE_MODE } from '../../../core/tokens/device-mode';
import { AutomationsService, type AutomationRecord } from '../../automations/automations.service';
import { AutomationsManagerComponent } from '../../automations/automations-manager.component';
import { TunableNumbersComponent } from './tunable-numbers.component';
import { TankCalibrationComponent } from './tank-calibration.component';

/**
 * SiteControlsComponent - the dashboard's quiet utility actions: two icon buttons,
 * Automations and Setup, that live in the page header beside Docs and each open a
 * focused modal. Rendered with `display:contents` so the buttons participate
 * directly in the header's flex row instead of nesting under a wrapper box.
 *
 * Alerts moved out entirely - alert thresholds are configured per-site on the
 * account/notifications page now, gated by the matching notification toggle.
 * Automations is the everyday action; Setup is the outlier (rare commissioning,
 * operator-gated, shown only when there's something to commission). Runs inside the
 * dashboard's injector, so it inherits DashboardStore + CommandLifecycleStore.
 */
@Component({
  selector: 'app-site-controls',
  standalone: true,
  imports: [AutomationsManagerComponent, TunableNumbersComponent, TankCalibrationComponent],
  // display:contents - the host box drops out so the two buttons are direct flex
  // items of the header row they're slotted into.
  host: { class: 'contents' },
  template: `
    <!-- Automations - the everyday action. The badge counts the active ones. -->
    <button type="button" (click)="open.set('automations')" class="btn btn-sm btn-ghost btn-square relative shrink-0"
      [title]="autoTotal() ? autoEnabled() + ' of ' + autoTotal() + ' automations active' : 'Automations'" aria-label="Automations">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      @if (autoEnabled()) {
        <span class="absolute -top-1 -right-1 badge badge-xs badge-primary px-1">{{ autoEnabled() }}</span>
      }
    </button>

    <!-- Setup - the outlier: rare commissioning, operator-only. A red dot warns
         when a safety override is live. -->
    @if (showSetup()) {
      <button type="button" (click)="open.set('setup')" class="btn btn-sm btn-ghost btn-square relative shrink-0"
        [title]="anyOverride() ? 'Setup: safety override ON' : 'Setup'" aria-label="Setup">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        @if (anyOverride()) {
          <span class="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-error ring-2 ring-base-100"></span>
        }
      </button>
    }

    <!-- ── Modals ───────────────────────────────────────────────────────── -->
    @switch (open()) {
      @case ('automations') {
        <dialog class="modal modal-open" style="position: fixed;">
          <div class="modal-box max-w-4xl flex flex-col max-h-[85vh] p-0">
            <div class="flex items-start justify-between gap-3 px-6 pt-5 pb-3 border-b border-base-300/30 shrink-0">
              <div class="min-w-0">
                <h3 class="font-bold text-base">Automations</h3>
                <p class="text-xs text-base-content/50 mt-0.5">Run a route on a schedule, stopping at a target volume or time.</p>
              </div>
              <button class="btn btn-ghost btn-xs btn-circle shrink-0" (click)="open.set(null)" aria-label="Close">✕</button>
            </div>
            <div class="px-6 py-4 overflow-y-auto">
              <app-automations-manager [siteId]="siteId()" [showRouteDefaults]="false" />
            </div>
          </div>
          <div class="modal-backdrop" (click)="open.set(null)"></div>
        </dialog>
      }

      @case ('setup') {
        <dialog class="modal modal-open" style="position: fixed;">
          <div class="modal-box max-w-4xl flex flex-col max-h-[85vh] p-0">
            <div class="flex items-start justify-between gap-3 px-6 pt-5 pb-3 border-b border-base-300/30 shrink-0">
              <div class="min-w-0">
                <h3 class="font-bold text-base">Setup</h3>
                <p class="text-xs text-base-content/50 mt-0.5">Route defaults, calibration, safety timings, and manual override for this site.</p>
              </div>
              <button class="btn btn-ghost btn-xs btn-circle shrink-0" (click)="open.set(null)" aria-label="Close">✕</button>
            </div>
            <div class="px-6 py-4 overflow-y-auto flex flex-col gap-3">
              <div class="alert alert-warning text-xs py-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <span>These change device behaviour and its safety limits. Adjust them deliberately, from known values.</span>
              </div>

              <!-- Sections follow the chain automations read top to bottom: safety timings
                   (hard caps) -> route defaults (normal values automations inherit) ->
                   calibration (sensor mapping) -> safety override (per device). Each is a
                   collapsed disclosure; only the override summary flags its live state. -->

              @if (hasSafetyTimings()) {
                <details class="group rounded-2xl ring-1 ring-base-300/40 bg-base-100 overflow-hidden">
                  <summary class="cursor-pointer list-none flex items-center justify-between gap-3 px-4 h-12 hover:bg-base-200/30 transition-colors">
                    <span class="flex items-baseline gap-2 min-w-0">
                      <span class="text-sm font-semibold">Safety timings</span>
                      <span class="text-xs text-base-content/40 truncate hidden sm:inline">watchdog &amp; timeout limits the device enforces</span>
                    </span>
                    <svg class="w-4 h-4 text-base-content/40 shrink-0 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                  </summary>
                  <div class="px-4 pb-4 pt-3 border-t border-base-300/40">
                    <app-tunable-numbers [controllers]="store.spec().controllers" scope="controller" [canEdit]="canControl()" />
                  </div>
                </details>
              }

              @if (hasRouteDefaults()) {
                <details class="group rounded-2xl ring-1 ring-base-300/40 bg-base-100 overflow-hidden">
                  <summary class="cursor-pointer list-none flex items-center justify-between gap-3 px-4 h-12 hover:bg-base-200/30 transition-colors">
                    <span class="flex items-baseline gap-2 min-w-0">
                      <span class="text-sm font-semibold">Route defaults</span>
                      <span class="text-xs text-base-content/40 truncate hidden sm:inline">per-route runtime, volume, duration &amp; levels automations inherit</span>
                    </span>
                    <svg class="w-4 h-4 text-base-content/40 shrink-0 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                  </summary>
                  <div class="px-4 pb-4 pt-3 border-t border-base-300/40">
                    <app-tunable-numbers [controllers]="store.spec().controllers" scope="route" [canEdit]="canControl()" />
                  </div>
                </details>
              }

              @if (hasCalibration()) {
                <details class="group rounded-2xl ring-1 ring-base-300/40 bg-base-100 overflow-hidden">
                  <summary class="cursor-pointer list-none flex items-center justify-between gap-3 px-4 h-12 hover:bg-base-200/30 transition-colors">
                    <span class="flex items-baseline gap-2 min-w-0">
                      <span class="text-sm font-semibold">Calibration</span>
                      <span class="text-xs text-base-content/40 truncate hidden sm:inline">map each tank's level sensor to real depth</span>
                    </span>
                    <svg class="w-4 h-4 text-base-content/40 shrink-0 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                  </summary>
                  <div class="px-4 pb-4 pt-3 border-t border-base-300/40 flex flex-col gap-4">
                    @for (c of store.spec().controllers; track c.controller) {
                      @if (c.calibrations.length) {
                        <div class="flex flex-col gap-2">
                          @if (multiController()) {
                            <div class="flex items-center gap-2">
                              <span class="w-1.5 h-1.5 rounded-full shrink-0" [class]="store.presence(c.controller).online ? 'bg-success' : 'bg-base-content/30'"></span>
                              <span class="text-xs font-semibold text-base-content/60">{{ c.name }}</span>
                            </div>
                          }
                          @for (cal of c.calibrations; track cal.nodeId) {
                            <app-tank-calibration [cal]="cal" [controller]="c.controller" [canEdit]="canControl()" />
                          }
                        </div>
                      }
                    }
                  </div>
                </details>
              }

              @if (hasActuators()) {
                <details class="group rounded-2xl ring-1 ring-base-300/40 bg-base-100 overflow-hidden">
                  <summary class="cursor-pointer list-none flex items-center justify-between gap-3 px-4 h-12 hover:bg-base-200/30 transition-colors">
                    <span class="flex items-baseline gap-2 min-w-0">
                      <span class="text-sm font-semibold">Safety override</span>
                      <span class="text-xs text-base-content/40 truncate hidden sm:inline">bypass safety checks to test hardware by hand</span>
                    </span>
                    <span class="flex items-center gap-2 shrink-0">
                      @if (anyOverride()) { <span class="badge badge-error badge-sm">ON</span> }
                      <svg class="w-4 h-4 text-base-content/40 shrink-0 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                    </span>
                  </summary>
                  <div class="px-4 pb-4 pt-3 border-t border-base-300/40 flex flex-col gap-3">
                    @for (c of store.spec().controllers; track c.controller) {
                      @if (c.actuators.length) {
                        <div class="rounded-xl ring-1 px-4 py-3 flex flex-col gap-2 transition-colors"
                          [class]="store.overrideOn(c.controller) ? 'ring-error/40 bg-error/5' : 'ring-base-300/40'">
                          <div class="flex items-center gap-2">
                            <span class="w-1.5 h-1.5 rounded-full shrink-0" [class]="store.presence(c.controller).online ? 'bg-success' : 'bg-base-content/30'"></span>
                            <span class="text-sm font-medium">{{ c.name }}</span>
                            <span class="grow"></span>
                            <button class="btn btn-xs gap-1 min-w-12" [class]="store.overrideOn(c.controller) ? 'btn-error' : 'btn-ghost ring-1 ring-base-300/50'"
                              [disabled]="!canControl() || overrideBusy(c.controller)" (click)="toggleOverride(c.controller)">
                              @if (overrideBusy(c.controller)) { <span class="loading loading-spinner loading-xs"></span> }
                              {{ store.overrideOn(c.controller) ? 'ON' : 'OFF' }}
                            </button>
                          </div>
                          @if (store.overrideOn(c.controller)) {
                            <p class="text-[11px] text-warning">Safety checks are OFF: a pump can run with no route and the watchdogs are bypassed. Turn this off when you finish.</p>
                          }
                          <p class="text-[11px] text-base-content/50">On the dashboard, tap a valve or pump card to hold it open or running; it releases automatically if you disconnect.</p>
                        </div>
                      }
                    }
                  </div>
                </details>
              }
            </div>
          </div>
          <div class="modal-backdrop" (click)="open.set(null)"></div>
        </dialog>
      }
    }
  `,
})
export class SiteControlsComponent {
  readonly siteId = input.required<string>();
  readonly canControl = input(false);

  protected store = inject(DashboardStore);
  private lifecycle = inject(CommandLifecycleStore);
  private confirm = inject(ConfirmService);
  private autoSvc = inject(AutomationsService);
  private deviceMode = inject(DEVICE_MODE);

  protected open = signal<'automations' | 'setup' | null>(null);

  // --- Automations (badge only; full CRUD lives in the modal's manager) -----
  protected autos = signal<AutomationRecord[]>([]);
  protected autoTotal = computed(() => this.autos().length);
  protected autoEnabled = computed(() => this.autos().filter((a) => a.enabled).length);

  // --- Setup ---------------------------------------------------------------
  protected multiController = computed(() => this.store.spec().controllers.length > 1);
  protected hasSafetyTimings = computed(() => this.store.spec().controllers.some((c) => c.tunables.some((t) => t.scope === 'controller')));
  protected hasRouteDefaults = computed(() => this.store.spec().controllers.some((c) => c.tunables.some((t) => t.scope === 'route')));
  protected hasCalibration = computed(() => this.store.spec().controllers.some((c) => c.calibrations.length > 0));
  protected hasActuators = computed(() => this.store.spec().controllers.some((c) => c.actuators.length > 0));
  /** Setup is cloud provisioning (commissioning writes ride PocketBase desired-
   *  config) — hidden on the device build; Automations stays (device-backed). */
  protected showSetup = computed(() => !this.deviceMode && this.canControl() && this.store.spec().controllers.some((c) =>
    c.tunables.some((t) => t.scope === 'controller' || t.scope === 'route') || c.calibrations.length > 0 || c.actuators.length > 0));
  protected anyOverride = computed(() => this.store.spec().controllers.some((c) => this.store.overrideOn(c.controller)));

  private unsub?: UnsubscribeFunc;

  constructor() {
    queueMicrotask(() => { void this.loadAutos(); });
  }

  ngOnDestroy(): void { this.unsub?.(); }

  private async loadAutos(): Promise<void> {
    try {
      this.autos.set(await this.autoSvc.list(this.siteId()));
      this.unsub = await this.autoSvc.subscribe(this.siteId(), () => void this.refreshAutos());
    } catch { /* leave empty */ }
  }
  private async refreshAutos(): Promise<void> {
    try { this.autos.set(await this.autoSvc.list(this.siteId())); } catch { /* transient */ }
  }

  // --- Safety override (the live, hard-confirmed control) -------------------
  private overrideKey(controller: string): string { return `${controller}/override`; }
  protected overrideBusy(controller: string): boolean { return this.lifecycle.isBusy(this.overrideKey(controller)); }
  protected async toggleOverride(controller: string): Promise<void> {
    if (!this.canControl()) return;
    const turningOn = !this.store.overrideOn(controller);
    if (turningOn) {
      const name = this.store.spec().controllers.find((c) => c.controller === controller)?.name ?? controller;
      const ok = await this.confirm.confirm({
        title: 'Disable all safety checks?',
        message: `Safety override turns OFF every runtime safety check on ${name}: tank-level gates, the no-flow watchdog, runtime level stops and the max-runtime limit. A pump can run with no route and no protection. Use it only for commissioning or manual recovery. It reverts to off when the device reboots.`,
        confirmLabel: 'Disable safety',
        variant: 'error',
      });
      if (!ok) return;
    }
    await this.lifecycle.dispatch(this.overrideKey(controller), controller, 'safety_override', { on: turningOn });
  }
}
