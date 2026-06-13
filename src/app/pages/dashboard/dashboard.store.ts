import { Injectable, OnDestroy, effect, inject, signal } from '@angular/core';
import type { UnsubscribeFunc } from 'pocketbase';
import { SYSTEM_STATE_TOKENS, routeStateSensor, type DashboardSpec, type DashboardWidget } from '@core';
import { RealtimeService } from '../../core/services/realtime.service';
import type { ShadowRow, StateEventRow, ControllerRow, CommandOutcomeRow, CommandLogRow, ActivityItem } from '../../core/models/runtime';
import { resolveOfflineMs } from '../../core/models/alerts';

/** Cap on retained command outcomes — only the in-flight command's id is ever
 *  read, so this just bounds the map against a long-open page (the device ring is
 *  4 deep, so far fewer are ever live at once). */
const MAX_TRACKED_OUTCOMES = 100;

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
  /** Presence rows keyed by controller id (== device_id). */
  readonly controllers = signal<Map<string, ControllerRow>>(new Map());
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

  constructor() {
    // The SDK auto-reconnects after a dropped stream; when it does, re-pull the
    // shadow/events/controllers so the gap that opened while offline is filled.
    // Skip the first connect — init()'s own fetch already covered it.
    let prev = this.realtime.connection();
    effect(() => {
      const c = this.realtime.connection();
      if (c === 'connected' && prev === 'disconnected' && this.siteId) {
        void this.resync(this.siteId).catch(() => {});
      }
      prev = c;
    });
  }

  /** Pull the current shadow, recent transitions, and presence for a site. Runs
   *  on init and again on every realtime reconnect to close the offline gap. The
   *  three reads are independent, so they fire concurrently — one round-trip of
   *  latency instead of three (it adds up through the Cloudflare proxy). */
  private async resync(siteId: string): Promise<void> {
    const [{ rows, outcomes }, evts, ctrls, cmds] = await Promise.all([
      this.realtime.latest(siteId),
      this.realtime.recentEvents(siteId, 100),
      this.realtime.controllers(siteId),
      this.realtime.recentCommands(siteId, 100),
    ]);
    const map = new Map<string, ShadowRow>();
    for (const r of rows) map.set(`${r.controller}/${r.sensor}`, r);
    this.shadow.set(map);
    this.mergeOutcomes(outcomes);
    this.events.set(evts);
    this.controllers.set(new Map(ctrls.map((c) => [c.device_id, c])));
    this.commands.set(new Map(cmds.map((c) => [c.id, c])));
  }

  async init(siteId: string, spec: DashboardSpec): Promise<void> {
    this.siteId = siteId;
    this.spec.set(spec);
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
    const items: ActivityItem[] = [];
    for (const e of this.events()) {
      if (e.controller === controller) items.push(eventToActivity(e));
    }
    for (const c of this.commands().values()) {
      if (c.controller === controller) items.push(commandToActivity(c));
    }
    return items.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)).slice(0, 100);
  }

  /** A route's current state. The `token` comes from the self-healing telemetry
   *  shadow (`route_<id>_state`, re-asserted every interval) so a dropped one-shot
   *  transition event can never strand the card; the `reason`/`ts` ride the newest
   *  matching transition event (best-effort fault/stop detail). `events()` is
   *  newest-first; OUTCOME-only tokens (QUEUED/REFUSED/…) are skipped so a refusal
   *  never masquerades as a state. Undefined ⇒ neither source has anything yet. */
  routeState(controller: string, routeId: number): { token: string; reason: string; ts: string; origin?: string; actorLabel?: string } | undefined {
    const row = this.shadow().get(`${controller}/${routeStateSensor(routeId)}`);
    const token = row?.reported_text ?? '';
    const origin = row?.origin;
    const actorLabel = row?.actorLabel;
    for (const e of this.events()) {
      if (e.controller !== controller || e.route !== routeId) continue;
      if (!SYSTEM_STATE_TOKENS.some((t) => t === e.to)) continue;
      return { token: token || e.to, reason: e.reason, ts: e.ts, origin, actorLabel };
    }
    return token ? { token, reason: '', ts: '', origin, actorLabel } : undefined;
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

/** A state transition → an Activity row (the badge token is the destination state;
 *  the widget colours it via the shared meanings). */
function eventToActivity(e: StateEventRow): ActivityItem {
  return {
    ts: e.ts,
    kind: 'transition',
    token: e.to,
    label: e.route < 0 ? 'controller' : `route ${e.route}`,
    detail: e.reason || undefined,
  };
}

/** An operator command → an Activity row. The badge token is the reconciled
 *  outcome (APPLIED / the failure reason); the label names the action + target;
 *  `actor`/`bySupport` carry the initiator. A still-`sent` command has no outcome
 *  badge yet — it fills in when the device echo reconciles it. */
function commandToActivity(c: CommandLogRow): ActivityItem {
  const token = c.status === 'failed' ? (c.result || 'REFUSED') : c.status === 'done' ? 'APPLIED' : '';
  return {
    ts: c.ts,
    kind: 'command',
    token,
    label: commandLabel(c),
    actor: c.actor,
    bySupport: c.bySupport,
    ok: c.status !== 'failed',
  };
}

/** Human action line for a command row. */
function commandLabel(c: CommandLogRow): string {
  switch (c.action) {
    case 'node_set': return `${c.on ? 'Opened' : 'Closed'} ${prettyNode(c.nodeId)}`;
    case 'route_start': return `Start route ${c.routeId}`;
    case 'route_stop': return `Stop route ${c.routeId}`;
    case 'fault_reset': return `Reset route ${c.routeId} fault`;
    case 'safety_override': return `Safety override ${c.on ? 'on' : 'off'}`;
    case 'config_set': return `Set ${c.configKey ?? 'value'}`;
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
