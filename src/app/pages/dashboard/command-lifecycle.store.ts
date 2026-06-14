import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  confirmDescriptor, HOLD_RECLAIM_MS, graceFloorMs,
  type CommandAction, type CommandPhase, type ConfirmDescriptor, type ConfirmObservation,
  type RouteControl, type ActuatorControl, type SetpointControl,
} from '@core';
import { BackendService } from '../../core/services/backend.service';
import { DashboardStore } from './dashboard.store';

/** Reconcile + re-assert tick. */
const RECONCILE_TICK_MS = 3_000;
/** How long a resolved overlay lingers before it's dropped (so the result is seen). */
const LINGER_OK_MS = 1_200;
const LINGER_ERR_MS = 4_000;

/** Everything needed to build a command's descriptor + wire args, by action. */
export interface CommandCtx {
  route?: RouteControl;
  actuator?: ActuatorControl;
  setpoint?: SetpointControl;
  /** Generic config_set target (any tunable number id); preferred over `setpoint`. */
  configKey?: string;
  on?: boolean;
  value?: number;
  /** Derived sustained-claim grace (ms); computed in dispatch from the site's
   *  telemetry update_interval. Absent ⇒ confirmDescriptor falls back to HOLD_GRACE_MS. */
  graceMs?: number;
}

/** A dispatched command tracked through its lifecycle. */
interface LifecycleEntry {
  seq: number;
  key: string;
  controller: string;
  descriptor: ConfirmDescriptor;
  /** undefined while the POST is in flight (instant pending feedback). */
  commandId?: string;
  issuedAt: number;
  /** Set for a synthetic result (failed POST / auto-released block) — short-circuits classify. */
  forcedPhase?: CommandPhase;
  forcedReason?: string;
  /** When the entry first reached a terminal phase — drives linger GC. */
  terminalAt?: number;
}

/** A held actuator claim: a persistent desired:on that the tick re-asserts and
 *  auto-releases on divergence. */
interface SustainedDesire {
  key: string;
  controller: string;
  nodeId: string;
  descriptor: ConfirmDescriptor;
  /** Grace clock anchor (set at claim registration, not the click). */
  claimedAt: number;
  lastReclaimAt: number;
  /** Latest re-assert's command_id, for refusal-reason correlation. */
  lastCommandId?: string;
}

/**
 * CommandLifecycleStore — the single command machine. Every operator command is a
 * desired-state push; this store tracks it by `command_id`, derives a phase
 * (`pending`/`confirmed`/`refused`/`expired`) from the live shadow + transition log
 * (read off DashboardStore — no second subscription), and owns the held-actuator
 * dead-man lease (re-assert + auto-release on divergence). Replaces the per-control
 * `busy`/`manualHeld`/`heartbeats`/`reconcile`/setpoint-save machines.
 *
 * Provided per dashboard page so its tick + holds tear down on leave — and that
 * teardown IS the actuator fail-safe (stop re-asserting → the device lease lapses).
 */
@Injectable()
export class CommandLifecycleStore implements OnDestroy {
  private backend = inject(BackendService);
  private dash = inject(DashboardStore);
  private siteId = inject(ActivatedRoute).snapshot.paramMap.get('name') ?? '';

  /** Keyed by monotonic seq (a command may not have a command_id yet). */
  private entries = signal<Map<number, LifecycleEntry>>(new Map());
  /** Held claims, keyed by entity key. */
  private sustainedClaims = signal<Map<string, SustainedDesire>>(new Map());
  private seq = 0;
  private tickTimer = window.setInterval(() => this.tick(), RECONCILE_TICK_MS);

  // --- Public surface the cards/component read --------------------------------

  /** The active lifecycle phase for an entity key, or null when idle (no in-flight
   *  command and no lingering result). The control then renders its own state. */
  phaseFor(key: string): { phase: CommandPhase; reason: string } | null {
    let best: LifecycleEntry | undefined;
    for (const e of this.entries().values()) {
      if (e.key === key && (!best || e.seq > best.seq)) best = e;
    }
    if (!best) return null;
    const r = this.classify(best);
    return { phase: r.phase, reason: r.reason ?? '' };
  }

  /** True while a command for this key is in flight (disable re-clicks). */
  isBusy(key: string): boolean {
    return this.phaseFor(key)?.phase === 'pending';
  }

  /** A held (sustained) claim exists for this key. */
  isHeld(key: string): boolean {
    return this.sustainedClaims().has(key);
  }

  /**
   * Dispatch a command and track it. Adds a pending entry synchronously (instant
   * feedback), then publishes; a `node_set { on:true }` registers a sustained claim,
   * a `node_set { on:false }` releases one. Returns false if the POST was rejected.
   */
  async dispatch(key: string, controller: string, action: CommandAction, ctx: CommandCtx = {}): Promise<boolean> {
    // Grace is derived from the controller's snapshot cadence so a held claim is never
    // judged blocked before the device's next periodic snapshot could re-confirm it.
    const graceMs = graceFloorMs(this.dash.timing()?.update_interval);
    const descriptor = confirmDescriptor(action, { ...ctx, graceMs });
    // Release: drop the held desire up front so its re-assert stops immediately.
    if (action === 'node_set' && ctx.on === false) this.dropSustained(key);

    const entry: LifecycleEntry = { seq: ++this.seq, key, controller, descriptor, issuedAt: Date.now() };
    this.put(entry);
    try {
      const commandId = await this.backend.sendCommand(this.siteId, controller, action, this.wireArgs(action, ctx));
      entry.commandId = commandId;
      this.put({ ...entry });
      if (descriptor.sustained && ctx.actuator) {
        this.addSustained(key, controller, ctx.actuator.id, descriptor, commandId);
      }
      return true;
    } catch (err) {
      this.put({ ...entry, forcedPhase: 'refused', forcedReason: String(err), terminalAt: Date.now() });
      return false;
    }
  }

  /** Toggle a held actuator claim: release if held, else claim (and heartbeat). */
  toggleClaim(key: string, controller: string, actuator: ActuatorControl): Promise<boolean> {
    const on = !this.isHeld(key);
    return this.dispatch(key, controller, 'node_set', { actuator, on });
  }

  ngOnDestroy(): void {
    // Stop the tick → held claims stop re-asserting → the device lease lapses and
    // each held actuator fail-safe stops/closes. This is the actuator safety net.
    clearInterval(this.tickTimer);
    this.sustainedClaims.set(new Map());
    this.entries.set(new Map());
  }

  // --- Internals --------------------------------------------------------------

  private put(e: LifecycleEntry): void {
    this.entries.update((m) => new Map(m).set(e.seq, e));
  }

  private addSustained(key: string, controller: string, nodeId: string, descriptor: ConfirmDescriptor, commandId: string): void {
    const now = Date.now();
    const d: SustainedDesire = { key, controller, nodeId, descriptor, claimedAt: now, lastReclaimAt: now, lastCommandId: commandId };
    this.sustainedClaims.update((m) => new Map(m).set(key, d));
  }

  private dropSustained(key: string): void {
    this.sustainedClaims.update((m) => {
      if (!m.has(key)) return m;
      const n = new Map(m);
      n.delete(key);
      return n;
    });
  }

  /** Drop every lifecycle entry for a key (used on auto-release so the synthetic
   *  refused result is the only entry, not a duplicate of the claim's own entry). */
  private dropEntriesForKey(key: string): void {
    this.entries.update((m) => {
      let changed = false;
      const n = new Map(m);
      for (const [seq, e] of m) if (e.key === key) { n.delete(seq); changed = true; }
      return changed ? n : m;
    });
  }

  /** A synthetic, lingering result entry (failed POST / auto-released block). */
  private forced(key: string, phase: CommandPhase, reason: string): void {
    this.put({
      seq: ++this.seq, key, controller: '', descriptor: confirmDescriptor('clear_queue'),
      issuedAt: Date.now(), forcedPhase: phase, forcedReason: reason, terminalAt: Date.now(),
    });
  }

  /** Live observation for a descriptor, anchored at `since` (issue/claim time). The
   *  refusal/queued/applied channel reads the device's re-asserted command outcome
   *  (by command_id) off the snapshot shadow — derived state_events carry no
   *  command_id and a refusal makes no transition, so the outcome is the only
   *  reliable, self-healing source. */
  private observe(controller: string, descriptor: ConfirmDescriptor, since: number, commandId?: string): ConfirmObservation {
    const row = descriptor.sensor ? this.dash.row(controller, descriptor.sensor) : undefined;
    return {
      reported: row?.reported,
      reportedText: row?.reported_text,
      correlated: commandId ? this.dash.commandOutcome(commandId) : undefined,
      ageMs: Date.now() - since,
      online: this.dash.presence(controller).online,
    };
  }

  private classify(e: LifecycleEntry): { phase: CommandPhase; reason?: string } {
    if (e.forcedPhase) return { phase: e.forcedPhase, reason: e.forcedReason };
    if (!e.commandId) return { phase: 'pending' }; // POST in flight
    return e.descriptor.classify(this.observe(e.controller, e.descriptor, e.issuedAt, e.commandId));
  }

  /** Build the `sendCommand` wire args from the action + ctx. */
  private wireArgs(action: CommandAction, ctx: CommandCtx): { routeId?: number; nodeId?: string; on?: boolean; key?: string; value?: number } {
    switch (action) {
      case 'route_start':
      case 'route_stop':
      case 'fault_reset':
        return { routeId: ctx.route?.routeId };
      case 'node_set':
        return { nodeId: ctx.actuator?.id, on: ctx.on };
      case 'safety_override':
        return { on: ctx.on };
      case 'config_set':
        return { key: ctx.configKey ?? ctx.setpoint?.key, value: ctx.value };
      default:
        return {};
    }
  }

  private tick(): void {
    const now = Date.now();

    // Held claims: re-assert on cadence, auto-release on a state-based block.
    for (const d of this.sustainedClaims().values()) {
      const { phase, reason } = d.descriptor.classify(
        this.observe(d.controller, d.descriptor, d.claimedAt, d.lastCommandId),
      );
      if (phase === 'refused') {
        // Online + past-grace + not running ⇒ a safety guard blocked it. Drop the
        // hold, tell the device to release (clears its latch), surface why.
        this.dropSustained(d.key);
        this.dropEntriesForKey(d.key);
        void this.backend.sendCommand(this.siteId, d.controller, 'node_set', { nodeId: d.nodeId, on: false }).catch(() => {});
        this.forced(d.key, 'refused', reason ?? '');
        continue;
      }
      // Re-assert regardless of presence (a failed offline send is harmless and we
      // re-claim on reconnect); only the divergence JUDGEMENT above is online-gated.
      if (now - d.lastReclaimAt >= HOLD_RECLAIM_MS) {
        d.lastReclaimAt = now;
        void this.backend.sendCommand(this.siteId, d.controller, 'node_set', { nodeId: d.nodeId, on: true })
          .then((id) => { d.lastCommandId = id; })
          .catch(() => {});
      }
    }

    // Lifecycle entries: GC terminal ones once their linger elapses.
    const drop: number[] = [];
    for (const e of this.entries().values()) {
      const { phase } = this.classify(e);
      if (phase === 'pending') { e.terminalAt = undefined; continue; }
      if (e.terminalAt == null) e.terminalAt = now;
      const linger = phase === 'refused' || phase === 'expired' ? LINGER_ERR_MS : LINGER_OK_MS;
      if (now - e.terminalAt > linger) drop.push(e.seq);
    }
    if (drop.length) {
      this.entries.update((m) => {
        const n = new Map(m);
        for (const s of drop) n.delete(s);
        return n;
      });
    }
  }
}
