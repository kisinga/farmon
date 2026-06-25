import { Injectable, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import type { UnsubscribeFunc } from 'pocketbase';
import { SYSTEM_STATE_TOKENS, routeStateSensor, routeLabel, findRoute, bucketReading, channelPriority, formatDurationS, formatLitres, type DashboardSpec, type DashboardWidget, type NodeRuntime, type RouteLive } from '@core';
import { RealtimeService } from '../../core/services/realtime.service';
import { AuthStore } from '../../core/services/auth.store';
import type { ShadowRow, StateEventRow, ControllerRow, CommandOutcomeRow, CommandLogRow, ConfigEventRow, ActivityItem, UsageRun } from '../../core/models/runtime';
import { resolveOfflineMs } from '../../core/models/alerts';
import { resolveInitiator, type InitiatorCtx } from './widgets/initiator';

/** Cap on retained command outcomes — only the in-flight command's id is ever
 *  read, so this just bounds the map against a long-open page (the device ring is
 *  4 deep, so far fewer are ever live at once). */
const MAX_TRACKED_OUTCOMES = 100;

/** The totals widget's default view span. The store preloads twice this on init (so the
 *  widget's "vs previous window" delta has its baseline), then the widget widens the
 *  fetch on demand from there. The activity FEED uses recentRuns (newest-N), not this. */
export const USAGE_SPAN_DEFAULT_HOURS = 24 * 7; // 7d
/** Ceiling for the run fetch — the aggregate-tier retention; a wider span returns empty. */
export const USAGE_WINDOW_MAX_HOURS = 24 * 30; // 30d

/** Floor between reconnect gap-fills. A proxy idle-timeout (Cloudflare cuts an idle
 *  SSE after ~60-100s) reconnects the stream on a loop; this coalesces any rapid
 *  double-fire so a flapping link can't restorm the fetch. */
const RESYNC_DEBOUNCE_MS = 15_000;

/** Site-wide telemetry timing the dashboard needs at runtime (from topology). */
export interface SiteTiming {
  /** Snapshot publish cadence (seconds); drives the command-lifecycle grace floor. */
  update_interval: number;
}

/**
 * DashboardStore — the customer dashboard's "current state": the chart spec, the
 * live shadow (last-known value per channel), and the recent transition log.
 * It seeds from the shadow + recent events, then subscribes for live updates.
 * Provided per dashboard page so it tears its subscriptions down on leave.
 *
 * Runtime state group — never imports the editor services.
 */
@Injectable()
export class DashboardStore implements OnDestroy {
  private realtime = inject(RealtimeService);
  private auth = inject(AuthStore);

  /** The site's co-owner ids, set at init() — the membership test behind the
   *  viewer-relative initiator resolution (you / co-owner / Support). An actor
   *  outside this set (and not the viewer) reads as "Support". */
  private owners = new Set<string>();
  /** Best-effort co-owner contact directory (id → name/email) for the activity
   *  feed's hover detail. May be partial/empty (the users read rule); `owners` —
   *  not this — decides membership, so a missing entry never mislabels a co-owner. */
  private people = new Map<string, { name?: string; email?: string }>();

  /** Live SSE stream state, surfaced for the global reconnect banner. */
  readonly connection = this.realtime.connection;

  readonly spec = signal<DashboardSpec>({ widgets: [], controllers: [] });
  /** Keyed by `${controller}/${sensor}` (== a widget's id). */
  readonly shadow = signal<Map<string, ShadowRow>>(new Map());
  readonly events = signal<StateEventRow[]>([]);
  /** Latest command result per `command_id` (the snapshot's re-asserted `outcomes`).
   *  The reliable refusal/queued/applied channel the lifecycle correlates against —
   *  events are derived now and carry no command_id. */
  readonly commandOutcomes = signal<Map<string, CommandOutcomeRow>>(new Map());
  /** Operator command audit, by record id (a command updates sent→done/failed in
   *  place), for the merged Activity timeline. */
  readonly commands = signal<Map<string, CommandLogRow>>(new Map());
  /** Configuration changes (automation create/edit/enable/disable/delete) — the
   *  Activity timeline's third source. Append-only; capped newest-first on update. */
  readonly configEvents = signal<ConfigEventRow[]>([]);
  /** Completed runs over the currently-loaded window from the `/usage` facade — the
   *  source for the timeframe-totals widget (it re-windows client-side). Loaded lazily:
   *  the default window on init, widened on demand via {@link loadRuns}. */
  readonly runs = signal<UsageRun[]>([]);
  /** Hours of run history currently loaded into {@link runs}. The totals widget reads
   *  this to know whether its delta's prior window is covered — the SSOT for "how much
   *  is loaded", replacing the widget's old hardcoded 30d assumption. 0 until first load. */
  readonly runsWindowHours = signal(0);
  /** Newest completed runs from the live `runs` collection — the Activity timeline's
   *  fourth source. Lean (newest-N) + live (subscribeRuns), so a finished run appears
   *  at once without the 30d over-fetch, and each carries its own duration + volume +
   *  initiator id (no fragile event<->run join). */
  readonly feedRuns = signal<UsageRun[]>([]);
  /** Presence rows keyed by controller id (== device_id). */
  readonly controllers = signal<Map<string, ControllerRow>>(new Map());
  /** Site-wide telemetry timing (from topology) — the command lifecycle derives a
   *  hold's grace from `update_interval`. Null until init sets it. */
  readonly timing = signal<SiteTiming | null>(null);
  /** Ticks every 15s so the freshness check (and "last seen Xm") re-evaluates. */
  readonly now = signal(Date.now());
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  /** Presence freshness window (ms) = the site's `offline_timeout_s`, the SAME
   *  threshold the alert bell + email sweep use, so the dashboard never disagrees
   *  with them. Resolved from the site record in init(); the default until then. */
  private offlineMs = resolveOfflineMs(null);

  private unsubs: UnsubscribeFunc[] = [];
  private clock = 0;
  private siteId = '';
  /** Widest run window already fetched (hours); a narrower request is served from cache. */
  private maxRunsHours = 0;
  /** Per-load token so a slow wide run fetch can't land on top of a newer one. */
  private runsReqSeq = 0;
  private lastResyncAt = 0;

  constructor() {
    // The SDK auto-reconnects after a dropped stream; when it does, re-pull the
    // shadow/events/controllers so the gap that opened while offline is filled.
    // Skip the first connect — init()'s own fetch already covered it.
    let prev = this.realtime.connection();
    effect(() => {
      const c = this.realtime.connection();
      if (c === 'connected' && prev === 'disconnected' && this.siteId) {
        void this.resync(this.siteId, true).catch(() => {});
      }
      prev = c;
    });
  }

  /** Pull the current shadow, recent transitions/commands/configs, presence, and
   *  runs (a 30d window for the totals widget + the newest-N for the feed) for a
   *  site. Runs on init and on every realtime reconnect to close the offline gap.
   *  The reads are independent, so they fire concurrently — one round-trip of
   *  latency (it adds up through the Cloudflare proxy). */
  private async resync(siteId: string, gap = false): Promise<void> {
    // A reconnect gap-fill only re-pulls LIVE state (the few seconds a dropped SSE
    // could have missed); a full sync (init) also pulls the slow/heavy bits. The
    // SSE gets cut on a ~60-100s proxy idle-timeout loop, so re-pulling the 30d
    // usage totals + config feed on every reconnect was the bulk of the churn.
    const now = Date.now();
    if (gap && now - this.lastResyncAt < RESYNC_DEBOUNCE_MS) return;
    this.lastResyncAt = now;

    const [{ rows, outcomes }, evts, ctrls, cmds, feedRuns] = await Promise.all([
      this.realtime.latest(siteId),
      this.realtime.recentEvents(siteId, 100),
      this.realtime.controllers(siteId),
      this.realtime.recentCommands(siteId, 100),
      // Newest-N for the feed's run rows (live-topped-up by subscribeRuns below).
      this.realtime.recentRuns(siteId, 100).catch(() => [] as UsageRun[]),
    ]);
    const map = new Map<string, ShadowRow>();
    for (const r of rows) map.set(`${r.controller}/${r.sensor}`, r);
    this.shadow.set(map);
    this.mergeOutcomes(outcomes);
    this.events.set(evts);
    this.controllers.set(new Map(ctrls.map((c) => [c.device_id, c])));
    this.commands.set(new Map(cmds.map((c) => [c.id, c])));
    this.feedRuns.set(feedRuns);

    // Slow-changing + heavy: the config-event feed and the 30d usage totals don't
    // move during a brief drop, so they ride init only, never a reconnect gap-fill.
    if (!gap) {
      // Preload only the default view window (plus the delta's prior window); the totals
      // widget widens this on demand. Runs concurrently with the config-event fetch.
      const [cfgs] = await Promise.all([
        this.realtime.recentConfigEvents(siteId, 100),
        this.loadRuns(USAGE_SPAN_DEFAULT_HOURS * 2),
      ]);
      this.configEvents.set(cfgs);
    }
  }

  /** Ensure at least `hours` of run history is loaded for the totals widget (capped at
   *  {@link USAGE_WINDOW_MAX_HOURS}). A request already covered by the loaded window is a
   *  no-op, so narrowing the span never refetches; widening fetches the full window and
   *  replaces {@link runs}. Best-effort: a failed fetch leaves the prior window in place.
   *  Writes signals only after the await, so it is safe to call from a reactive context. */
  async loadRuns(hours: number): Promise<void> {
    const capped = Math.min(Math.max(hours, 0), USAGE_WINDOW_MAX_HOURS);
    if (capped <= this.maxRunsHours) return; // already covered by a prior load
    const siteId = this.siteId;
    if (!siteId) return;
    const token = ++this.runsReqSeq;
    const to = new Date();
    const from = new Date(to.getTime() - capped * 3_600_000);
    const runs = await this.realtime.usage(siteId, from, to).then((r) => r.runs).catch(() => null);
    if (token !== this.runsReqSeq) return; // superseded by a wider/newer load
    if (runs) {
      this.runs.set(runs);
      this.maxRunsHours = capped;
      this.runsWindowHours.set(capped);
    }
  }

  async init(siteId: string, spec: DashboardSpec, timing?: SiteTiming, owners: string[] = [], people: { id: string; name?: string; email?: string }[] = []): Promise<void> {
    this.siteId = siteId;
    // Re-init (store reused for another site) must refetch runs, not trust a stale window.
    this.maxRunsHours = 0;
    this.runsWindowHours.set(0);
    this.spec.set(spec);
    this.timing.set(timing ?? null);
    this.owners = new Set(owners);
    this.people = new Map(people.map((p) => [p.id, { name: p.name, email: p.email }]));
    this.loading.set(true);
    this.error.set(null);
    try {
      // The presence-threshold read is independent of the shadow/events/presence
      // pull, so run it alongside resync rather than gating on it. Best-effort:
      // a failed threshold read just keeps the default window.
      const [offlineS] = await Promise.all([
        this.realtime.siteOfflineSeconds(siteId).catch(() => null),
        this.resync(siteId),
      ]);
      this.offlineMs = resolveOfflineMs(offlineS);

      this.unsubs.push(
        await this.realtime.subscribeShadow(siteId, (rows, outcomes) => {
          this.shadow.update((m) => {
            const n = new Map(m);
            for (const row of rows) n.set(`${row.controller}/${row.sensor}`, row);
            return n;
          });
          this.mergeOutcomes(outcomes);
        }),
      );
      this.unsubs.push(
        await this.realtime.subscribeEvents(siteId, (row) => {
          this.events.update((list) => [row, ...list].slice(0, 200));
        }),
      );
      this.unsubs.push(
        await this.realtime.subscribeCommands(siteId, (row) => {
          // A command arrives as `sent`, then its outcome reconciles it to
          // done/failed — upsert by id so the row updates in place.
          this.commands.update((m) => new Map(m).set(row.id, row));
        }),
      );
      this.unsubs.push(
        await this.realtime.subscribeControllers(siteId, (row) => {
          this.controllers.update((m) => new Map(m).set(row.device_id, row));
        }),
      );
      this.unsubs.push(
        await this.realtime.subscribeConfigEvents(siteId, (row) => {
          this.configEvents.update((list) => [row, ...list].slice(0, 200));
        }),
      );
      try {
        // A run record is created when the device ships it, so this fires exactly
        // when a completed run lands — live feed rows, no clock-skew join needed.
        // Guarded: if the runs subscription can't open, the feed simply isn't live
        // (recentRuns still backfills on resync) rather than failing the dashboard.
        this.unsubs.push(
          await this.realtime.subscribeRuns(siteId, (row) => {
            // Dedupe by run_id: a create landing during a resync round-trip is also
            // in the refetched list, so drop any prior copy before prepending.
            this.feedRuns.update((list) => [row, ...list.filter((r) => r.run_id !== row.run_id)].slice(0, 200));
          }),
        );
      } catch (err) {
        console.warn('[dashboard] runs subscription unavailable; feed runs refresh on resync only', err);
      }

      this.clock = window.setInterval(() => this.now.set(Date.now()), 15_000);
    } catch (err) {
      this.error.set(String(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** Live presence for a controller: server `online` AND a fresh `last_seen`,
   *  plus the parsed last-seen timestamp (0 when unknown) for the UI. The `online`
   *  flag (reliable now the broker flips it on disconnect) gives a fast offline on a
   *  real drop; the freshness window catches a connected-but-silent device and uses
   *  the same `offline_timeout_s` the alerts do, so the views never disagree. */
  presence(controller: string): { online: boolean; lastSeen: number } {
    const r = this.controllers().get(controller);
    if (!r) return { online: false, lastSeen: 0 };
    const seen = Date.parse(r.last_seen);
    const fresh = Number.isFinite(seen) && this.now() - seen < this.offlineMs;
    return { online: !!r.online && fresh, lastSeen: Number.isFinite(seen) ? seen : 0 };
  }

  /** The shadow row a widget reads (its id is `${controller}/${sensor}`). */
  rowFor(widget: DashboardWidget): ShadowRow | undefined {
    return widget.sensor ? this.shadow().get(widget.id) : undefined;
  }

  /** A shadow row by explicit controller + sensor (e.g. a flow widget's total). */
  row(controller: string, sensor?: string): ShadowRow | undefined {
    return sensor ? this.shadow().get(`${controller}/${sensor}`) : undefined;
  }

  /**
   * Live state per topology node, keyed by node id — the single node-centric
   * projection the live map consumes. Derived from the SAME channel enumeration
   * the widgets/actuators come from (carried on `spec.controllers[].channels`),
   * so there's no parallel node→sensor join: pick each node's primary channel
   * (`channelPriority`), bucket its shadow reading, and fold in presence
   * (an offline controller reads `unavailable`). Reactive to shadow + presence.
   */
  readonly nodeRuntime = computed<Map<string, NodeRuntime>>(() => {
    const out = new Map<string, NodeRuntime>();
    const best = new Map<string, number>(); // node id → priority of the channel chosen
    for (const c of this.spec().controllers) {
      const online = this.presence(c.controller).online;
      for (const ch of c.channels) {
        if (!ch.node) continue;
        const prio = channelPriority(ch.role);
        if (prio <= (best.get(ch.node) ?? -1)) continue;
        best.set(ch.node, prio);
        out.set(ch.node, bucketReading(ch, this.shadow().get(`${c.controller}/${ch.sensor}`), online));
      }
    }
    return out;
  });

  /** Route states that mean water is moving (matches the route card's `running`). */
  private static readonly ACTIVE_ROUTE_TOKENS = new Set(['PREPARING', 'RUNNING', 'STOPPING']);

  /**
   * The route overlay — every route's participants projected onto the map by its
   * live token: a RUNNING route's nodes/pipes light active (`nodes`/`pipes`); a
   * FAULTED route's light fault (`faultNodes`/`faultPipes`). One projection joining
   * each route's static path (`pathNodeIds`/`pipeIds`) with its live state, so the
   * map can render a whole route — nodes AND pipes — as one unit, instead of hoping
   * each node's own telemetry coincides (node channels carry no fault). A route is
   * only ever in one bucket (FAULT ∉ the active tokens). Reactive to route state.
   */
  readonly activePath = computed<{ nodes: Set<string>; pipes: Set<string>; faultNodes: Set<string>; faultPipes: Set<string> }>(() => {
    const nodes = new Set<string>();
    const pipes = new Set<string>();
    const faultNodes = new Set<string>();
    const faultPipes = new Set<string>();
    for (const c of this.spec().controllers) {
      for (const r of c.routes) {
        const token = this.routeState(c.controller, r.routeId)?.token ?? '';
        const [nset, pset] =
          DashboardStore.ACTIVE_ROUTE_TOKENS.has(token) ? [nodes, pipes]
          : token === 'FAULT' ? [faultNodes, faultPipes]
          : [null, null];
        if (!nset || !pset) continue;
        for (const n of r.pathNodeIds ?? []) nset.add(n);
        for (const p of r.pipeIds ?? []) pset.add(p);
      }
    }
    return { nodes, pipes, faultNodes, faultPipes };
  });

  /** Safety override reported state, read from the shadow (the device switch). */
  overrideOn(controller: string): boolean {
    const r = this.row(controller, 'safety_override');
    return !!r && r.reported >= 0.5;
  }

  /** The Activity feed for one controller, newest first: device state transitions
   *  and operator commands merged into one chronological list. Commands are the
   *  only trace of a manual valve/pump action (they make no route transition), and
   *  carry who initiated them. */
  activityFor(controller: string): ActivityItem[] {
    const routeName = (routeId: number) => this.routeName(controller, routeId);
    const ctx = this.viewerCtx();
    const items: ActivityItem[] = [];
    for (const e of this.events()) {
      // Route completions come from the runs ledger below (carrying their own
      // duration + volume); only controller-level transitions (route < 0) have no run
      // row to stand in for them, so keep just those here.
      if (e.controller === controller && e.route < 0) items.push(eventToActivity(e, routeName, ctx));
    }
    for (const c of this.commands().values()) {
      if (c.controller !== controller) continue;
      // Ownership rule: a route speaks through its (now-attributed) transitions, so
      // a SUCCESSFUL route_start/route_stop is already represented there — drop the
      // redundant command row. A failed/refused or still-in-flight one has no
      // transition to stand in for it, so it's kept. Node + system commands always
      // render (they have no transition of their own).
      const isRouteCmd = c.action === 'route_start' || c.action === 'route_stop';
      if (isRouteCmd && c.status === 'done') continue;
      items.push(commandToActivity(c, routeName, ctx));
    }
    for (const cfg of this.configEvents()) {
      if (cfg.controller === controller) items.push(configEventToActivity(cfg, ctx));
    }
    for (const r of this.feedRuns()) {
      if (r.controller === controller) items.push(runToActivity(r, routeName, ctx));
    }
    // Newest first, by parsed epoch — commands and transitions arrive as ISO strings
    // but with differing precision, so a raw string compare mis-orders them (and
    // would bury one source below the other, dropping it past the 100-item cap).
    return items.sort((a, b) => tsEpoch(b.ts) - tsEpoch(a.ts)).slice(0, 100);
  }

  /** The viewer-relative resolution context: the signed-in user's id + the site's
   *  owner set. One context for every "who did it" decision in the feed. */
  private viewerCtx(): InitiatorCtx {
    const me = this.auth.user();
    return { meId: me?.id ?? '', meEmail: me?.email, owners: this.owners, people: this.people };
  }

  /** A route's human identity ("Borehole → Tank") from the spec, harmonised with
   *  the route cards via the shared {@link routeLabel}. Falls back to "route N". */
  routeName(controller: string, routeId: number): string {
    return routeLabel(findRoute(this.spec(), controller, routeId), routeId);
  }

  /** A route's current state. The `token` comes from the self-healing telemetry
   *  shadow (`route_<id>_state`, re-asserted every interval) so a dropped one-shot
   *  transition event can never strand the card; the `reason`/`ts` ride the newest
   *  matching transition event (best-effort fault/stop detail). `events()` is
   *  newest-first; OUTCOME-only tokens (QUEUED/REFUSED/…) are skipped so a refusal
   *  never masquerades as a state. Undefined ⇒ neither source has anything yet. */
  routeState(controller: string, routeId: number): { token: string; reason: string; ts: string; origin?: string; initiator?: { label: string; support: boolean; title: string } } | undefined {
    const row = this.shadow().get(`${controller}/${routeStateSensor(routeId)}`);
    const token = row?.reported_text ?? '';
    const origin = row?.origin;
    // Resolve who's running it through the SAME rule as the activity feed, so the
    // card and the timeline never disagree (and a take-control run reads "Support").
    const initiator = row ? resolveInitiator({ origin, actorId: row.actorId, actorName: row.actorLabel }, this.viewerCtx()) : undefined;
    for (const e of this.events()) {
      if (e.controller !== controller || e.route !== routeId) continue;
      if (!SYSTEM_STATE_TOKENS.some((t) => t === e.to)) continue;
      return { token: token || e.to, reason: e.reason, ts: e.ts, origin, initiator };
    }
    return token ? { token, reason: '', ts: '', origin, initiator } : undefined;
  }

  /** The running route's live progress facts (the snapshot route `live` block), or
   *  undefined when not running / not reported. Drives the card-as-progress-bar. */
  routeLive(controller: string, routeId: number): RouteLive | undefined {
    return this.shadow().get(`${controller}/${routeStateSensor(routeId)}`)?.live;
  }

  /** The device's latest result for a dispatched command, by `command_id`, shaped
   *  for the lifecycle's `correlated` channel (`to` = the outcome token). Undefined
   *  until the controller re-asserts it in a snapshot. */
  commandOutcome(commandId: string): { to: string; reason: string } | undefined {
    const o = this.commandOutcomes().get(commandId);
    return o ? { to: o.result, reason: o.reason } : undefined;
  }

  /** Fold a snapshot's re-asserted outcomes into the by-id map (latest wins),
   *  capped to the most recent ids so a long-lived page (e.g. a held actuator
   *  re-asserting a fresh command_id every cycle) can't grow it unbounded —
   *  Map insertion order makes the oldest the first key. The lifecycle only ever
   *  reads the in-flight command's id, so evicting old ones is safe. */
  private mergeOutcomes(outcomes: CommandOutcomeRow[]): void {
    if (!outcomes.length) return;
    this.commandOutcomes.update((m) => {
      const n = new Map(m);
      for (const o of outcomes) n.set(o.command_id, o);
      while (n.size > MAX_TRACKED_OUTCOMES) n.delete(n.keys().next().value!);
      return n;
    });
  }

  ngOnDestroy(): void {
    for (const u of this.unsubs) void u();
    this.unsubs = [];
    if (this.clock) { clearInterval(this.clock); this.clock = 0; }
  }
}

/** Activity timestamp → epoch ms for the chronological merge sort; 0 when
 *  unparseable (sorts oldest). Both sources arrive as ISO strings but at differing
 *  precision, so a numeric key is the only safe way to interleave them. */
function tsEpoch(ts: string): number {
  const t = Date.parse(ts);
  return Number.isNaN(t) ? 0 : t;
}

/** A state transition → an Activity row (the badge token is the destination state;
 *  the widget colours it via the shared meanings). `routeName` resolves the route's
 *  human identity; `ctx` resolves the initiator (you / co-owner / Support) the same
 *  way as a command, so routes and nodes never disagree. */
function eventToActivity(e: StateEventRow, routeName: (routeId: number) => string, ctx: InitiatorCtx): ActivityItem {
  const who = resolveInitiator({ origin: e.origin, actorId: e.actorId, actorName: e.actorName }, ctx);
  return {
    ts: e.ts,
    kind: 'transition',
    token: e.to,
    label: e.route < 0 ? 'controller' : routeName(e.route),
    detail: e.reason || undefined,
    actor: who.label || undefined,
    origin: e.origin,
    bySupport: who.support,
    actorTitle: who.title || undefined,
  };
}

/** A completed run (from the durable usage ledger) → an Activity row. Unlike a
 *  transition it carries its OWN duration + delivered volume (the `metrics` suffix),
 *  so no fragile join to a transition is needed: the run record is the event. The
 *  badge is the fault (if any) else the stop reason; litres show only when metered;
 *  `actor_label` is the server-resolved initiator. Row time is the completion. */
function runToActivity(r: UsageRun, routeName: (routeId: number) => string, ctx: InitiatorCtx): ActivityItem {
  const litres = formatLitres(r.delivered_l);
  const duration = formatDurationS(r.duration_s);
  // Resolve who ran it through the SAME rule as transitions/commands (you /
  // co-owner / Support), now that the run carries the initiator id (actor_id).
  const who = resolveInitiator({ origin: r.origin, actorId: r.actor_id, actorName: r.actor_label }, ctx);
  return {
    ts: r.ended_at || r.started_at,
    kind: 'run',
    token: r.fault || r.stop_reason || '',
    label: routeName(r.route),
    metrics: litres ? `${duration} · ${litres}` : duration,
    actor: who.label || undefined,
    origin: r.origin,
    bySupport: who.support,
    actorTitle: who.title || undefined,
    ok: !r.fault,
  };
}

/** An operator command → an Activity row. The badge token is the reconciled
 *  outcome (APPLIED / the failure reason); the label names the action + target.
 *  The initiator is resolved through the SAME `ctx` rule as a transition. A still-
 *  `sent` command has no outcome badge yet — it fills in when the device reconciles. */
/** A configuration change → an Activity row. `token` is the change verb (a neutral
 *  badge — "Enabled" / "Edited" / …); the label names the automation; the initiator
 *  resolves through the SAME ctx rule as a command/transition. A config edit is an
 *  operator action, never a device failure, so `ok` is always true and there is no
 *  AUTOMATION origin (the actor is the human who edited it). */
function configEventToActivity(c: ConfigEventRow, ctx: InitiatorCtx): ActivityItem {
  const who = resolveInitiator({ actorId: c.actorId, actorName: c.actorName }, ctx);
  return {
    ts: c.ts,
    kind: 'config',
    token: c.change.charAt(0).toUpperCase() + c.change.slice(1),
    label: c.name ? `Automation: ${c.name}` : 'Automation',
    actor: who.label || undefined,
    bySupport: who.support,
    actorTitle: who.title || undefined,
    ok: true,
  };
}

function commandToActivity(c: CommandLogRow, routeName: (routeId: number) => string, ctx: InitiatorCtx): ActivityItem {
  const token = c.status === 'failed' ? (c.result || 'REFUSED') : c.status === 'done' ? 'APPLIED' : '';
  const who = resolveInitiator({ actorId: c.actorId, actorName: c.actorName }, ctx);
  return {
    ts: c.ts,
    kind: 'command',
    token,
    label: commandLabel(c, routeName),
    actor: who.label || undefined,
    bySupport: who.support,
    actorTitle: who.title || undefined,
    ok: c.status !== 'failed',
  };
}

/** Human action line for a command row. Routes are named via the shared resolver
 *  so the feed reads "Start Borehole → Tank", consistent with the route cards. */
function commandLabel(c: CommandLogRow, routeName: (routeId: number) => string): string {
  const route = () => routeName(c.routeId ?? -1);
  switch (c.action) {
    case 'node_set': return `${c.on ? 'Opened' : 'Closed'} ${prettyNode(c.nodeId)}`;
    case 'route_start': return `Start ${route()}`;
    case 'route_stop': return `Stop ${route()}`;
    case 'fault_reset': return `Reset ${route()} fault`;
    case 'safety_override': return `Safety override ${c.on ? 'on' : 'off'}`;
    case 'stop_all': return 'Stop all';
    case 'reset_faults': return 'Reset faults';
    case 'clear_queue': return 'Clear queue';
    default: return c.action;
  }
}

/** "valve1" → "Valve 1", "pump_a" → "Pump A". A light prettifier — the exact
 *  friendly name would need a topology lookup the timeline doesn't carry. */
function prettyNode(id?: string): string {
  if (!id) return 'actuator';
  return id
    .replace(/_/g, ' ')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}
