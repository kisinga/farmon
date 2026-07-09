import { Injectable, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import type { RecordModel, UnsubscribeFunc } from 'pocketbase';
import { FAULT_MEANINGS, STOP_REASON_MEANINGS, OUTCOME_MEANINGS } from '@core';
import { RealtimeService } from './realtime.service';
import { BackendService } from './backend.service';
import { AuthStore } from './auth.store';
import type { ControllerRow, ShadowRow, StateEventRow, CommandOutcomeRow } from '../models/runtime';
import {
  type AlertSeverity,
  type DerivedAlert,
  type NotificationPrefs,
  DEFAULT_NOTIFICATION_PREFS,
  prefKeyFor,
  resolveOfflineMs,
} from '../models/alerts';

/** Per-site alert config, read from the `sites` collection with safe defaults
 *  when the fields are unset (older sites, or before the threshold editor). */
interface SiteAlertCfg {
  name: string;
  lowPct: number;
  highPct: number | null;
  offlineMs: number;
}
const DEFAULT_LOW_PCT = 20;
/** Hysteresis margin (percentage points) so a level hovering on the threshold
 *  doesn't flap the alert on and off. */
const TANK_MARGIN = 5;
/** A command-failure transition is shown for this long after it happened. */
const COMMAND_FAIL_WINDOW_MS = 10 * 60_000;
/** Transition `to`/`reason` tokens that mean an operator command did not land. */
const FAIL_OUTCOMES = new Set(['REFUSED', 'REJECTED', 'STALE']);

const ACK_STORAGE_KEY = 'majiflow.alerts.acked';
const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * AlertsStore — the in-app notification center, derived entirely in the browser.
 *
 * It subscribes (cross-site, scoped by PocketBase view rules) to the same data
 * the dashboard streams — controller presence, transition events, tank-level
 * shadows — and computes the set of currently-active alerts against each site's
 * thresholds. Nothing is written server-side; acknowledgement is local. The
 * server's email sweep re-derives the same conditions independently, only to
 * cover the case where no tab is open.
 *
 * Root-scoped so the navbar bell works on every page. Starts when a user signs
 * in and tears its subscriptions down on sign-out.
 */
@Injectable({ providedIn: 'root' })
export class AlertsStore implements OnDestroy {
  private realtime = inject(RealtimeService);
  private backend = inject(BackendService);
  private auth = inject(AuthStore);

  // --- Inputs (live) ---
  private controllers = signal<Map<string, ControllerRow>>(new Map());
  private events = signal<StateEventRow[]>([]);
  private levels = signal<Map<string, ShadowRow>>(new Map());
  /** Failed-command outcomes (the snapshot's re-asserted `outcomes[]`), keyed by
   *  command_id with the client first-seen time — outcomes carry no server ts and
   *  re-assert every interval, so first-seen anchors the display window. */
  private commandFails = signal<Map<string, { row: CommandOutcomeRow; firstSeen: number }>>(new Map());
  private siteCfg = signal<Map<string, SiteAlertCfg>>(new Map());
  private now = signal(Date.now());

  // --- Derived outputs ---
  private _active = signal<DerivedAlert[]>([]);
  readonly prefs = signal<NotificationPrefs>({ user: '', ...DEFAULT_NOTIFICATION_PREFS });
  private acked = signal<Set<string>>(loadAcked());

  /** Active alerts the user wants to see (type enabled + not acknowledged),
   *  severity- then recency-sorted. The badge counts these. */
  readonly visible = computed<DerivedAlert[]>(() => {
    const prefs = this.prefs();
    const acked = this.acked();
    return this._active()
      .filter((a) => prefs[prefKeyFor(a.type)] && !acked.has(a.key))
      .sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] || y.ts - x.ts);
  });
  readonly unreadCount = computed(() => this.visible().length);

  private unsubs: UnsubscribeFunc[] = [];
  private clock = 0;
  private started = false;
  // Hysteresis latches: a key stays alarming until it clears past the margin.
  private lowLatched = new Set<string>();
  private highLatched = new Set<string>();

  constructor() {
    // Start/stop with the auth session.
    effect(() => {
      const user = this.auth.user();
      if (user && !this.started) void this.start();
      else if (!user && this.started) this.stop();
    });
    // Recompute whenever any input (or the 30s clock) changes.
    effect(() => this.recompute());
  }

  private async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      await this.loadSiteCfg();
      await this.loadPrefs();

      const ctrls = await this.realtime.allControllers();
      this.controllers.set(new Map(ctrls.map((c) => [c.device_id, c])));
      this.events.set(await this.realtime.recentEventsAll(200));
      const { levels, outcomes } = await this.realtime.levelShadows();
      this.levels.set(new Map(levels.map((r) => [`${r.controller}/${r.sensor}`, r])));
      this.mergeOutcomes(outcomes);

      this.unsubs.push(
        await this.realtime.subscribeAllControllers((row) =>
          this.controllers.update((m) => new Map(m).set(row.device_id, row)),
        ),
        await this.realtime.subscribeAllEvents((row) =>
          this.events.update((l) => [row, ...l].slice(0, 200)),
        ),
        await this.realtime.subscribeLevelShadows((rows, outcomes) => {
          this.levels.update((m) => {
            const n = new Map(m);
            for (const row of rows) n.set(`${row.controller}/${row.sensor}`, row);
            return n;
          });
          this.mergeOutcomes(outcomes);
        }),
        await this.backend.pb.collection('sites').subscribe('*', (e) => this.applySite(e.record)),
      );

      this.clock = window.setInterval(() => this.now.set(Date.now()), 30_000);
    } catch {
      // A failed start (e.g. offline at sign-in) leaves the bell empty; the next
      // sign-in or reconnect retries. Never block the app on it.
      this.started = false;
    }
  }

  private stop(): void {
    for (const u of this.unsubs) void u();
    this.unsubs = [];
    if (this.clock) { clearInterval(this.clock); this.clock = 0; }
    this.controllers.set(new Map());
    this.events.set([]);
    this.levels.set(new Map());
    this.commandFails.set(new Map());
    this.siteCfg.set(new Map());
    this.lowLatched.clear();
    this.highLatched.clear();
    this.started = false;
  }

  /** Fold a snapshot's re-asserted outcomes into the failed-command map. First-seen
   *  is preserved across re-asserts (it anchors the display window); entries past
   *  the window are pruned so the map can't grow unbounded over a long session. */
  private mergeOutcomes(outcomes: CommandOutcomeRow[]): void {
    const now = Date.now();
    this.commandFails.update((m) => {
      const n = new Map(m);
      for (const [id, v] of n) if (now - v.firstSeen >= COMMAND_FAIL_WINDOW_MS) n.delete(id);
      for (const row of outcomes) {
        if (!FAIL_OUTCOMES.has(row.result) && !FAIL_OUTCOMES.has(row.reason)) continue;
        if (!n.has(row.command_id)) n.set(row.command_id, { row, firstSeen: now });
      }
      return n;
    });
  }

  private async loadSiteCfg(): Promise<void> {
    const rows = await this.backend.pb.collection('sites').getFullList({ requestKey: 'alerts:sites' });
    const map = new Map<string, SiteAlertCfg>();
    for (const r of rows) map.set(r['id'], toSiteCfg(r));
    this.siteCfg.set(map);
  }

  private applySite(r: RecordModel): void {
    this.siteCfg.update((m) => new Map(m).set(r['id'], toSiteCfg(r)));
  }

  private async loadPrefs(): Promise<void> {
    const user = this.auth.user();
    if (!user) return;
    try {
      const rec = await this.backend.pb
        .collection('notification_prefs')
        .getFirstListItem(this.backend.pb.filter('user = {:u}', { u: user.id }), { requestKey: 'alerts:prefs' });
      this.prefs.set(toPrefs(rec, user.id));
    } catch {
      // No prefs row yet (or the collection isn't deployed) — default to all-on.
      this.prefs.set({ user: user.id, ...DEFAULT_NOTIFICATION_PREFS });
    }
  }

  /** Mark one alert acknowledged. It stays hidden until the condition clears;
   *  if it recurs, a fresh key re-notifies. */
  ack(key: string): void {
    this.acked.update((s) => new Set(s).add(key));
    saveAcked(this.acked());
  }

  ackAll(): void {
    const next = new Set(this.acked());
    for (const a of this.visible()) next.add(a.key);
    this.acked.set(next);
    saveAcked(next);
  }

  // --- Detection ---------------------------------------------------------------

  private recompute(): void {
    const now = this.now();
    const controllers = this.controllers();
    const cfg = this.siteCfg();
    const out: DerivedAlert[] = [];

    const cfgFor = (siteId: string): SiteAlertCfg =>
      cfg.get(siteId) ?? { name: 'Site', lowPct: DEFAULT_LOW_PCT, highPct: null, offlineMs: resolveOfflineMs(null) };

    // 1) Device offline — staleness only. The `online` flag is NOT consulted: it
    //    flips false on any brief broker drop (a fast reconnect re-sets it), so
    //    alerting on it would fire on every transient blip. last_seen aging past the
    //    site timeout is the naturally-debounced signal; a never-seen device (NaN)
    //    can't be stale, so it's correctly not an incident (no commissioning spam).
    for (const c of controllers.values()) {
      if (!c.active) continue;
      const sc = cfgFor(c.site);
      const seen = Date.parse(c.last_seen);
      const stale = Number.isFinite(seen) && now - seen > sc.offlineMs;
      if (stale) {
        out.push({
          key: `device_offline:${c.device_id}`,
          type: 'device_offline',
          severity: 'critical',
          site: c.site,
          siteName: sc.name,
          controller: c.device_id,
          title: 'Controller offline',
          message: `${c.device_id} — last seen ${ago(seen, now)}`,
          ts: seen,
        });
      }
    }

    // 2) Faults — ride the (derived) transition stream; latest-wins per route.
    const seenRoute = new Set<string>();
    for (const e of this.events()) {
      const routeKey = `${e.controller}:${e.route}`;
      if (seenRoute.has(routeKey) || e.to !== 'FAULT') continue;
      seenRoute.add(routeKey);
      const sc = cfgFor(controllers.get(e.controller)?.site ?? '');
      const ets = Date.parse(e.ts);
      out.push({
        key: `fault:${routeKey}`,
        type: 'fault',
        severity: 'critical',
        site: controllers.get(e.controller)?.site ?? '',
        siteName: sc.name,
        controller: e.controller,
        title: e.route < 0 ? 'Controller fault' : `Route ${e.route} fault`,
        message: `${e.controller} — ${reasonText(e.reason)}`,
        ts: Number.isFinite(ets) ? ets : now,
      });
    }

    // 3) Run transitions — latest-wins per route, shown when the user opts in.
    const seenStartRoute = new Set<string>();
    const seenStopRoute = new Set<string>();
    for (const e of this.events()) {
      const routeKey = `${e.controller}:${e.route}`;
      const sc = cfgFor(controllers.get(e.controller)?.site ?? '');
      const ets = Date.parse(e.ts);
      const ts = Number.isFinite(ets) ? ets : now;
      if (e.to === 'RUNNING' && e.from !== 'RUNNING' && !seenStartRoute.has(routeKey)) {
        seenStartRoute.add(routeKey);
        out.push({
          key: `run_start:${routeKey}`,
          type: 'run_start',
          severity: 'info',
          site: controllers.get(e.controller)?.site ?? '',
          siteName: sc.name,
          controller: e.controller,
          title: e.route < 0 ? 'Controller started' : `Route ${e.route} started`,
          message: `${e.controller} — started running`,
          ts,
        });
      }
      if (
        e.from === 'RUNNING' &&
        (e.to === 'IDLE' || e.to === 'STOPPING') &&
        !seenStopRoute.has(routeKey)
      ) {
        seenStopRoute.add(routeKey);
        out.push({
          key: `run_stop:${routeKey}`,
          type: 'run_stop',
          severity: 'info',
          site: controllers.get(e.controller)?.site ?? '',
          siteName: sc.name,
          controller: e.controller,
          title: e.route < 0 ? 'Controller stopped' : `Route ${e.route} stopped`,
          message: `${e.controller} — stopped (${reasonText(e.reason || e.to)})`,
          ts,
        });
      }
    }

    // 4) Command failures — from the snapshot's re-asserted command outcomes (the
    //    reliable channel; derived events carry no command_id). Windowed from the
    //    client first-seen time so a stale ring entry doesn't linger forever.
    for (const { row, firstSeen } of this.commandFails().values()) {
      if (now - firstSeen >= COMMAND_FAIL_WINDOW_MS) continue;
      if (!FAIL_OUTCOMES.has(row.result) && !FAIL_OUTCOMES.has(row.reason)) continue;
      const sc = cfgFor(controllers.get(row.controller)?.site ?? '');
      out.push({
        key: `command_failed:${row.controller}:${row.command_id}`,
        type: 'command_failed',
        severity: 'warning',
        site: controllers.get(row.controller)?.site ?? '',
        siteName: sc.name,
        controller: row.controller,
        title: 'Command did not apply',
        message: `${row.controller} — ${reasonText(row.reason || row.result)}`,
        ts: firstSeen,
      });
    }

    // 4) Tank thresholds — latched with hysteresis so a level on the line is steady.
    const liveKeys = new Set<string>();
    for (const row of this.levels().values()) {
      if (!row.sensor.endsWith('_level')) continue;
      liveKeys.add(`${row.controller}/${row.sensor}`);
      const siteId = controllers.get(row.controller)?.site ?? '';
      const sc = cfgFor(siteId);
      const v = row.reported;
      const key = `${row.controller}/${row.sensor}`;
      const lts = Date.parse(row.ts);
      const ts = Number.isFinite(lts) ? lts : now;

      // low
      if (this.lowLatched.has(key) ? v < sc.lowPct + TANK_MARGIN : v <= sc.lowPct) {
        this.lowLatched.add(key);
        out.push({
          key: `tank_low:${key}`,
          type: 'tank_low',
          severity: 'warning',
          site: siteId,
          siteName: sc.name,
          controller: row.controller,
          title: 'Tank low',
          message: `${tankName(row.sensor)} at ${Math.round(v)}% (low ${sc.lowPct}%)`,
          ts,
          sensor: row.sensor,
        });
      } else {
        this.lowLatched.delete(key);
      }

      // high (only when a high threshold is configured)
      if (sc.highPct != null) {
        if (this.highLatched.has(key) ? v > sc.highPct - TANK_MARGIN : v >= sc.highPct) {
          this.highLatched.add(key);
          out.push({
            key: `tank_high:${key}`,
            type: 'tank_high',
            severity: 'info',
            site: siteId,
            siteName: sc.name,
            controller: row.controller,
            title: 'Tank full',
            message: `${tankName(row.sensor)} at ${Math.round(v)}% (high ${sc.highPct}%)`,
            ts,
            sensor: row.sensor,
          });
        } else {
          this.highLatched.delete(key);
        }
      }
    }

    // Drop latch state for level channels that have disappeared (controller
    // removed), so the sets can't grow without bound across the session.
    for (const k of this.lowLatched) if (!liveKeys.has(k)) this.lowLatched.delete(k);
    for (const k of this.highLatched) if (!liveKeys.has(k)) this.highLatched.delete(k);

    this._active.set(out);
    this.pruneAcked(out);
  }

  /** Drop ack entries whose condition has cleared, so a recurrence re-notifies. */
  private pruneAcked(active: DerivedAlert[]): void {
    const live = new Set(active.map((a) => a.key));
    const acked = this.acked();
    let changed = false;
    const next = new Set<string>();
    for (const k of acked) {
      if (live.has(k)) next.add(k);
      else changed = true;
    }
    if (changed) {
      this.acked.set(next);
      saveAcked(next);
    }
  }

  ngOnDestroy(): void {
    this.stop();
  }
}

// --- mappers / helpers ---------------------------------------------------------

function toSiteCfg(r: RecordModel): SiteAlertCfg {
  const low = Number(r['tank_low_pct']);
  const high = Number(r['tank_high_pct']);
  return {
    name: (r['name'] || r['friendlyName'] || 'Site') as string,
    lowPct: Number.isFinite(low) && low > 0 ? low : DEFAULT_LOW_PCT,
    highPct: Number.isFinite(high) && high > 0 ? high : null,
    offlineMs: resolveOfflineMs(r['offline_timeout_s'] as number),
  };
}

function toPrefs(r: RecordModel, userId: string): NotificationPrefs {
  return {
    user: userId,
    // Opt-in: offline and run transitions only when explicitly enabled.
    alert_device_offline: r['alert_device_offline'] === true,
    alert_fault: r['alert_fault'] !== false,
    alert_tank: r['alert_tank'] !== false,
    alert_run_start: r['alert_run_start'] === true,
    alert_run_stop: r['alert_run_stop'] === true,
    alert_command_failed: r['alert_command_failed'] !== false,
    channel_whatsapp: r['channel_whatsapp'] === true,
    whatsapp_chat_id: (r['whatsapp_chat_id'] ?? '') as string,
    whatsapp_country_code: (r['whatsapp_country_code'] ?? DEFAULT_NOTIFICATION_PREFS.whatsapp_country_code) as string,
    channel_email: r['channel_email'] === true,
  };
}

/** A FAULT/STOP/OUTCOME token → a human label, via the core meanings. */
function reasonText(token: string): string {
  if (!token) return 'Unknown';
  return (
    (FAULT_MEANINGS as Record<string, { label: string }>)[token]?.label ??
    (STOP_REASON_MEANINGS as Record<string, { label: string }>)[token]?.label ??
    (OUTCOME_MEANINGS as Record<string, { label: string }>)[token]?.label ??
    token
  );
}

/** "main_tank_level" → "Main Tank". */
function tankName(sensor: string): string {
  return sensor
    .replace(/_level$/, '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function ago(ts: number, now: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return 'unknown';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function loadAcked(): Set<string> {
  try {
    const raw = localStorage.getItem(ACK_STORAGE_KEY);
    return raw ? new Set<string>(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveAcked(s: Set<string>): void {
  try {
    localStorage.setItem(ACK_STORAGE_KEY, JSON.stringify([...s]));
  } catch {
    // storage unavailable (private mode) — acks just won't persist.
  }
}
