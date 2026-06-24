import { Component, computed, inject } from '@angular/core';
import { controllerHealth, worstHealth, describeState, SYSTEM_STATE_MEANINGS, STOP_REASON_MEANINGS, SYSTEM_STATE_SENSOR, STOP_REASON_SENSOR, HEAP_FREE_SENSOR, HEAP_MIN_SENSOR, HEAP_WARN_BYTES, WIFI_SIGNAL_SENSOR, UPTIME_SENSOR, TEMP_SENSOR, type HealthLevel, type StateKind, type StateMeaning } from '@core';
import { DashboardStore } from '../dashboard.store';

/** `reset_reason` tokens (esp_reset_reason) that mean a firmware fault — the controller
 *  crashed. BROWNOUT is deliberately excluded: it's a power-supply fault (a different
 *  responsibility — site wiring / supply / pump inrush), surfaced separately. A
 *  recurring crash is the bootloop tell. */
const FIRMWARE_CRASH_REASONS = new Set(['PANIC', 'INT_WDT', 'TASK_WDT', 'WDT']);

/** daisyUI tone tokens per health level (UI mapping kept out of @core). */
const HEALTH_UI: Record<HealthLevel, { dot: string; label: string; chip: string }> = {
  healthy:  { dot: 'bg-success',         label: 'Healthy',  chip: 'text-success bg-success/10 ring-success/20' },
  warning:  { dot: 'bg-warning',         label: 'Degraded', chip: 'text-warning bg-warning/10 ring-warning/20' },
  critical: { dot: 'bg-error',           label: 'Critical', chip: 'text-error bg-error/10 ring-error/20' },
  offline:  { dot: 'bg-base-content/40', label: 'Offline',  chip: 'text-base-content/50 bg-base-content/10 ring-base-content/15' },
};

const STATE_RANK: Record<StateKind, number> = { normal: 0, active: 1, warn: 2, fault: 3 };
/** State kind → header-chip tones (consistent with the health pill styling). */
const STATE_CHIP: Record<StateKind, { dot: string; chip: string }> = {
  active: { dot: 'bg-success',         chip: 'text-success bg-success/10 ring-success/20' },
  warn:   { dot: 'bg-warning',         chip: 'text-warning bg-warning/10 ring-warning/20' },
  fault:  { dot: 'bg-error',           chip: 'text-error bg-error/10 ring-error/20' },
  normal: { dot: 'bg-base-content/40', chip: 'text-base-content/60 bg-base-content/10 ring-base-content/15' },
};

/**
 * Header status cluster for the customer dashboard: the operational-state chip
 * (what the system is doing), the device-health pill with its per-controller
 * drill-down panel (is the hardware well), and the safety-override flag. Reads
 * the shared DashboardStore (provided on DashboardComponent) — the host renders
 * `display: contents` so its three chips sit as direct flex items in the header row.
 */
@Component({
  selector: 'app-controller-health',
  standalone: true,
  host: { class: 'contents' },
  template: `
    @if (anyOverride()) {
      <span class="inline-flex items-center gap-1 text-xs rounded-full px-2.5 py-1 ring-1 ring-inset text-error bg-error/10 ring-error/20 shrink-0"
            title="Safety checks bypassed on a controller">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        </svg>
        Override ON
      </span>
    }
    <!-- Operational state (what it's doing): aggregate, hidden when nothing is online. -->
    @if (systemChip(); as sys) {
      <span class="inline-flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 ring-1 ring-inset shrink-0"
            [class]="sys.chip" [title]="'System: ' + sys.label">
        <span class="w-1.5 h-1.5 rounded-full" [class]="sys.dot"></span>
        {{ sys.label }}
      </span>
    }
    <!-- Health (is the box well): online + heap; click for the per-controller panel. -->
    <details class="dropdown dropdown-end shrink-0">
      <summary class="list-none inline-flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 cursor-pointer ring-1 ring-inset"
               [class]="healthUi().chip" [title]="'Device health: ' + healthUi().label">
        <span class="w-1.5 h-1.5 rounded-full" [class]="healthUi().dot" [class.animate-pulse]="siteHealth() === 'healthy'"></span>
        {{ healthUi().label }}
      </summary>
      <div class="dropdown-content z-10 mt-1 w-72 rounded-box bg-base-100 ring-1 ring-base-300/40 shadow-lg p-2">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-base-content/40 px-1 pb-1">Controllers</div>
        @for (c of store.spec().controllers; track c.controller) {
          <div class="px-1 py-1.5 border-b border-base-300/20 last:border-0">
            <div class="flex items-center gap-2 text-xs">
              <span class="w-1.5 h-1.5 rounded-full shrink-0" [class]="healthDot(c.controller)"></span>
              <span class="font-medium truncate flex-1">{{ c.name }}</span>
              <span class="text-[11px] text-base-content/50 shrink-0 max-w-[45%] truncate">{{ systemLabel(c.controller) }}</span>
            </div>
            <!-- Metric strip: each figure rides its icon's tooltip; warning states tint the icon. -->
            <div class="flex items-center gap-3 mt-1.5 pl-3.5 text-base-content/45">
              <span class="inline-flex" [class.text-warning]="heapLow(c.controller)" [title]="heapTip(c.controller)">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z"/>
                </svg>
              </span>
              <span class="inline-flex" [title]="'Queue depth: ' + queueText(c.controller)">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z"/>
                </svg>
              </span>
              <span class="inline-flex" [title]="'Last stop: ' + lastStopText(c.controller)">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9 9.563C9 9.252 9.252 9 9.563 9h4.874c.311 0 .563.252.563.563v4.874c0 .311-.252.563-.563.563H9.564A.562.562 0 019 14.437V9.564z"/>
                </svg>
              </span>
              @if (wifiText(c.controller); as w) {
                <span class="inline-flex" [class.text-warning]="wifiWeak(c.controller)" [title]="'WiFi: ' + w">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z"/>
                  </svg>
                </span>
              }
              @if (uptimeText(c.controller); as u) {
                <span class="inline-flex" [title]="'Uptime: ' + u">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                </span>
              }
              @if (tempText(c.controller); as t) {
                <span class="inline-flex" [title]="'Temperature: ' + t">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M14 14.76V3.5a2.5 2.5 0 00-5 0v11.26a4.5 4.5 0 105 0z"/>
                  </svg>
                </span>
              }
              @if (restartText(c.controller)) {
                <span class="inline-flex"
                      [class.text-error]="restartIsCrash(c.controller)"
                      [class.text-warning]="restartIsBrownout(c.controller)"
                      [title]="restartHint(c.controller)">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/>
                  </svg>
                </span>
              }
              @if (store.overrideOn(c.controller)) {
                <span class="inline-flex text-error" title="Safety checks bypassed on this controller">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  </svg>
                </span>
              }
              @if (deviceConsoleUrl(c.controller); as url) {
                <a [href]="url" target="_blank" rel="noopener" class="inline-flex ml-auto text-base-content/45 hover:text-primary"
                   title="Live logs — opens the controller's built-in console (same network only)">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z"/>
                  </svg>
                </a>
              }
            </div>
          </div>
        }
        <p class="text-[11px] text-base-content/40 px-1 pt-1.5 leading-snug">Hover an icon for the figure. RAM icon warns under {{ heapWarnKb() }} KB free.</p>
      </div>
    </details>
  `,
})
export class ControllerHealthComponent {
  protected store = inject(DashboardStore);

  // --- Device presence + health -------------------------------------------
  /** Last-known free / min-free heap (bytes), null if the controller never reported it. */
  private heapFree(controller: string): number | null { return this.store.row(controller, HEAP_FREE_SENSOR)?.reported ?? null; }
  private heapMin(controller: string): number | null { return this.store.row(controller, HEAP_MIN_SENSOR)?.reported ?? null; }

  /** One controller's health (offline / critical / warning / healthy). */
  private health(controller: string): HealthLevel {
    return controllerHealth({ online: this.store.presence(controller).online, heapFree: this.heapFree(controller) });
  }
  /** Site health = worst among ONLINE controllers; offline only when none are up,
   *  and at least a warning when some are dark (so a 1/2-online site never reads
   *  a flat "Offline" next to its "1/2 online" count). */
  protected siteHealth = computed<HealthLevel>(() => {
    const ctrls = this.store.spec().controllers;
    const online = ctrls.filter((c) => this.store.presence(c.controller).online);
    if (online.length === 0) return 'offline';
    const level = worstHealth(online.map((c) => this.health(c.controller)));
    return level === 'healthy' && online.length < ctrls.length ? 'warning' : level;
  });
  protected healthUi = computed(() => HEALTH_UI[this.siteHealth()]);
  protected healthDot(controller: string): string { return HEALTH_UI[this.health(controller)].dot; }

  /** Free heap as "94 KB · min 90" for the per-controller detail; — / offline when unknown. */
  protected heapText(controller: string): string {
    const free = this.heapFree(controller);
    if (free === null) return this.store.presence(controller).online ? '—' : 'offline';
    const kb = (b: number) => `${Math.round(b / 1000)} KB`;
    const min = this.heapMin(controller);
    return min !== null ? `${kb(free)} · min ${Math.round(min / 1000)}` : kb(free);
  }
  protected heapWarnKb(): number { return Math.round(HEAP_WARN_BYTES / 1000); }
  /** RAM tooltip: "Free RAM: 118 KB · min 100", presence-aware when unknown. */
  protected heapTip(controller: string): string {
    const free = this.heapFree(controller);
    if (free === null) return this.store.presence(controller).online ? 'Free RAM: unknown' : 'Offline';
    return `Free RAM: ${this.heapText(controller)}`;
  }
  /** Free heap below the warning floor — tints the RAM icon amber. */
  protected heapLow(controller: string): boolean {
    const free = this.heapFree(controller);
    return free !== null && free < HEAP_WARN_BYTES;
  }

  /** WiFi signal as "−55 dBm · strong", or '' when the controller never reported
   *  it (ethernet, older firmware, or not yet seen) so the row hides cleanly. */
  protected wifiText(controller: string): string {
    const dbm = this.store.row(controller, WIFI_SIGNAL_SENSOR)?.reported;
    if (dbm === undefined || !Number.isFinite(dbm)) return '';
    const quality = dbm >= -60 ? 'strong' : dbm >= -70 ? 'good' : dbm >= -80 ? 'fair' : 'weak';
    return `${Math.round(dbm)} dBm · ${quality}`;
  }
  /** WiFi in the weak band (< −80 dBm) — tints the signal icon amber. */
  protected wifiWeak(controller: string): boolean {
    const dbm = this.store.row(controller, WIFI_SIGNAL_SENSOR)?.reported;
    return dbm !== undefined && Number.isFinite(dbm) && dbm < -80;
  }

  /** Uptime as a coarse "3d 4h" / "5h 12m" / "8m" string, '' when unreported. */
  protected uptimeText(controller: string): string {
    const s = this.store.row(controller, UPTIME_SENSOR)?.reported;
    if (s === undefined || !Number.isFinite(s) || s < 0) return '';
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  /** SoC temperature as "48 °C", '' when unreported. */
  protected tempText(controller: string): string {
    const c = this.store.row(controller, TEMP_SENSOR)?.reported;
    if (c === undefined || !Number.isFinite(c)) return '';
    return `${Math.round(c)} °C`;
  }

  /** Why the controller last restarted, as a friendly label — '' when unreported.
   *  Firmware faults collapse to "Crash"; a brownout (power fault) reads "Power dip".
   *  These are different responsibilities (firmware vs site power); the raw token and
   *  the owning domain ride the tooltip (restartHint). */
  protected restartText(controller: string): string {
    const r = this.restartReason(controller);
    if (!r) return '';
    if (FIRMWARE_CRASH_REASONS.has(r)) return 'Crash';
    if (r === 'BROWNOUT') return 'Power dip';
    if (r === 'DEEPSLEEP') return 'Wake';
    if (r === 'POWERON' || r === 'EXT') return 'Power-on';
    return 'Restart'; // SW / UNKNOWN / SDIO
  }
  /** Firmware fault (panic / watchdog) — a controller-software problem. */
  protected restartIsCrash(controller: string): boolean {
    return FIRMWARE_CRASH_REASONS.has(this.restartReason(controller));
  }
  /** Power-supply fault (brownout) — a site power / wiring problem, not firmware. */
  protected restartIsBrownout(controller: string): boolean {
    return this.restartReason(controller) === 'BROWNOUT';
  }
  /** Tooltip naming the restart cause and who owns it (firmware vs site power). */
  protected restartHint(controller: string): string {
    const r = this.restartReason(controller);
    if (FIRMWARE_CRASH_REASONS.has(r)) return `Firmware crash (${r}) — check device logs`;
    if (r === 'BROWNOUT') return 'Brownout — supply voltage dipped; check power / wiring / pump inrush';
    return `Last restart: ${r}`;
  }
  /** Raw reset_reason token. */
  protected restartReason(controller: string): string {
    return this.store.row(controller, 'reset_reason')?.reported_text ?? '';
  }

  /** The controller's built-in web log console URL (local network only), '' when no IP. */
  protected deviceConsoleUrl(controller: string): string {
    const ip = this.store.row(controller, 'ip')?.reported_text;
    return ip ? `http://${ip}/` : '';
  }

  // --- Operational state (System chip + per-controller drill-down) ---------
  private systemMeaning(controller: string): StateMeaning {
    return describeState(SYSTEM_STATE_MEANINGS, this.store.row(controller, SYSTEM_STATE_SENSOR)?.reported_text ?? 'IDLE');
  }
  /** Per-controller operational state label (drill-down). */
  protected systemLabel(controller: string): string { return this.systemMeaning(controller).label; }
  /** Queue depth as text; '—' when never reported. */
  protected queueText(controller: string): string {
    const q = this.store.row(controller, 'queue_depth')?.reported;
    return q == null ? '—' : String(Math.round(q));
  }
  /** Last stop reason label; 'None' when never reported. */
  protected lastStopText(controller: string): string {
    const t = this.store.row(controller, STOP_REASON_SENSOR)?.reported_text;
    return t ? describeState(STOP_REASON_MEANINGS, t).label : 'None';
  }
  /** Any controller running with safety checks bypassed (a danger flag). */
  protected anyOverride = computed(() =>
    this.store.spec().controllers.some((c) => this.store.overrideOn(c.controller)),
  );
  /** Aggregate operational state for the header chip: the most significant state
   *  across ONLINE controllers (an offline controller's last state is stale).
   *  Null when nothing is online (the health pill already says "Offline"). */
  protected systemChip = computed<{ label: string; dot: string; chip: string } | null>(() => {
    const online = this.store.spec().controllers.filter((c) => this.store.presence(c.controller).online);
    if (online.length === 0) return null;
    let best: StateMeaning | null = null;
    for (const c of online) {
      const m = this.systemMeaning(c.controller);
      if (!best || STATE_RANK[m.kind] > STATE_RANK[best.kind]) best = m;
    }
    return best ? { label: best.label, ...STATE_CHIP[best.kind] } : null;
  });
}
