/**
 * Home Assistant integration types and schemas.
 *
 * Shared by:
 *  - entity Zod schemas (optional `haActions` field on topology nodes)
 *  - TopologyRenderer.exportHa() (meta sidecar shape)
 *  - farm-scada-card (runtime contract)
 *
 * SVG schema version bumped when the decorated SVG shape changes.
 */

import { z } from 'zod';
import { type InputPolicy, policyString } from './input-policy';
import { slug } from './slug';

/**
 * Canonical HA entity_id for a node. Mirrors what HA actually creates from
 * an ESPHome device: when `friendly_name:` is set (always, in our generator),
 * HA derives the entity_id prefix from `friendly_name`, not from `name`.
 *
 *   `<haDomain>.<slug(device.friendly_name)>_<slug(nodeName)>`
 *
 * Single source of truth shared by:
 *  - SCADA meta sidecar (ha-meta.ts)
 *  - dashboard / automations / site-dashboard generators
 *  - sidebar read-only display
 *
 * For ESPHome service calls (`esphome.<name>_stop_all`) — which use the mDNS
 * `name:` field — use `esphomeServicePrefix(device)` instead.
 */
export function deriveHaEntityId(
  domain: string,
  device: { friendly_name: string },
  nodeName: string,
): string {
  return `${domain}.${slug(device.friendly_name)}_${slug(nodeName)}`;
}

/**
 * Prefix for ESPHome's HA-exposed services (`esphome.<prefix>_stop_all`, etc.).
 * Bound to the ESPHome `name:` field (mDNS hostname / API node identifier),
 * which is independent of `friendly_name`.
 */
export function esphomeServicePrefix(device: { name: string }): string {
  return slug(device.name);
}

// ---------------------------------------------------------------------------
// System entity catalog — single source of truth for non-per-node entities.
//
// Every system entity the firmware emits (System State, route start/stop
// buttons, device health, etc.) is declared here exactly once. Both sides
// read from this catalog:
//
//  - Firmware emit (sensors.ts, control.ts, board-package.ts, networking.ts)
//    reads `name` for the YAML `name: "..."` literal.
//  - HA reference (dashboard.ts, site-dashboard.ts, automations.ts,
//    ha-meta.ts) reads pre-resolved entity_ids via `systemHaEntityIds()`.
//
// Per-node entities (one set per pump / valve / level sensor / etc.) are
// declared on each entity descriptor instead — see
// `EntityCodegen.haEntityIds` in entity-registry.ts.
// ---------------------------------------------------------------------------

export interface SystemEntitySpec {
  /** HA domain that the firmware platform produces (sensor, switch, button, etc.). */
  domain: string;
  /** The literal `name:` value emitted into ESPHome YAML. */
  name: string;
}

/**
 * Fixed system entities — emitted unconditionally or gated only by board
 * capability (battery presence, wifi vs ethernet). Per-route entities are
 * defined separately via `routeEntityNames()`.
 */
export const SYSTEM_ENTITY_NAMES = {
  // text_sensor (sensors.ts) — surface as `sensor.*` in HA
  systemState:        { domain: 'sensor', name: 'System State' },
  systemFault:        { domain: 'sensor', name: 'System Fault' },
  lastStopReason:     { domain: 'sensor', name: 'Last Stop Reason' },
  activeRoutes:       { domain: 'sensor', name: 'Active Routes' },
  routeQueue:         { domain: 'sensor', name: 'Route Queue' },

  // sensor / binary_sensor (sensors.ts)
  combinedTankLevel:  { domain: 'sensor',        name: 'Combined Tank Level' },
  waterCritical:      { domain: 'binary_sensor', name: 'Water Critical' },

  // number (sensors.ts safety blocks)
  flowWatchdogMs:     { domain: 'number', name: 'Flow Watchdog (ms)' },
  flowConfirmMs:      { domain: 'number', name: 'Flow Confirm (ms)' },
  apiWatchdogMs:      { domain: 'number', name: 'API Watchdog (ms)' },

  // switch (control.ts)
  safetyOverride:     { domain: 'switch', name: 'Safety Override' },

  // device health (board-package.ts)
  batteryVoltage:     { domain: 'sensor', name: 'Battery Voltage' },
  batteryPercent:     { domain: 'sensor', name: 'Battery Percent' },
  uptime:             { domain: 'sensor', name: 'Uptime' },
  esp32Temperature:   { domain: 'sensor', name: 'ESP32 Temperature' },
  vextControl:        { domain: 'switch', name: 'Vext Control' },
  onboardLed:         { domain: 'light',  name: 'Onboard LED' },

  // networking (networking.ts) — text_sensor surfaces as `sensor.*` in HA
  wifiSignal:         { domain: 'sensor', name: 'WiFi Signal' },
  ipAddress:          { domain: 'sensor', name: 'IP Address' },
  connectedSsid:      { domain: 'sensor', name: 'Connected SSID' },
  macAddress:         { domain: 'sensor', name: 'MAC Address' },
  transportSupported: { domain: 'sensor', name: 'Transport (supported)' },
  transportActive:    { domain: 'sensor', name: 'Transport (active)' },
} as const satisfies Record<string, SystemEntitySpec>;

export type SystemEntityKey = keyof typeof SYSTEM_ENTITY_NAMES;

/** Names of the per-route entities the firmware emits (one set per route). */
export function routeEntityNames(route: { name: string }): {
  status: SystemEntitySpec;
  start: SystemEntitySpec;
  stop: SystemEntitySpec;
  maxRuntime: SystemEntitySpec;
} {
  return {
    status:     { domain: 'sensor', name: `Route: ${route.name}` },
    start:      { domain: 'button', name: `Start: ${route.name}` },
    stop:       { domain: 'button', name: `Stop: ${route.name}` },
    maxRuntime: { domain: 'number', name: `Route: ${route.name} Max Runtime (s)` },
  };
}

/** ESPHome services exposed via `esphome.<esphomeServicePrefix(device)>_<name>`. */
export const ESPHOME_SERVICES = ['stop_all', 'fault_reset_all', 'queue_clear'] as const;
export type EsphomeServiceName = typeof ESPHOME_SERVICES[number];

/**
 * Pre-resolve every system entity_id for a device. Generators consuming HA
 * references should use these values directly and never call
 * `deriveHaEntityId` themselves for system entities.
 */
export interface SystemHaEntityIds extends Record<SystemEntityKey, string> {
  routes: Array<{ status: string; start: string; stop: string; maxRuntime: string }>;
}

export function systemHaEntityIds(
  device: { friendly_name: string },
  routes: { name: string }[],
): SystemHaEntityIds {
  const fixed = Object.fromEntries(
    (Object.entries(SYSTEM_ENTITY_NAMES) as [SystemEntityKey, SystemEntitySpec][])
      .map(([key, spec]) => [key, deriveHaEntityId(spec.domain, device, spec.name)]),
  ) as Record<SystemEntityKey, string>;

  return {
    ...fixed,
    routes: routes.map(r => {
      const n = routeEntityNames(r);
      return {
        status:     deriveHaEntityId(n.status.domain,     device, n.status.name),
        start:      deriveHaEntityId(n.start.domain,      device, n.start.name),
        stop:       deriveHaEntityId(n.stop.domain,       device, n.stop.name),
        maxRuntime: deriveHaEntityId(n.maxRuntime.domain, device, n.maxRuntime.name),
      };
    }),
  };
}

/** Version of the decorated SVG + meta sidecar contract. Bump on breaking changes. */
export const HA_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Input policy for HA service references (e.g. `cover.open_cover`).
// Entity IDs are no longer user-input — they're derived via deriveHaEntityId().
// ---------------------------------------------------------------------------

export const HA_SERVICE_POLICY: InputPolicy = {
  pattern: /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/,
  allow: /[a-z0-9_.]/g,
  lowercase: true,
  hint: 'Use lowercase letters, digits, underscores, and one dot — e.g. cover.open_cover',
};

// ---------------------------------------------------------------------------
// HaActionSpec — per-node action entry (menu item in the card)
// ---------------------------------------------------------------------------

/**
 * A single action available on a node's context menu.
 *
 *  - `id: 'more-info'` is special: the card dispatches `hass-more-info` instead
 *    of calling a service. No `service` required.
 *  - All other actions require a `service` and call `hass.callService()`.
 */
export const HaActionSpecSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  service: policyString(HA_SERVICE_POLICY).optional(),
  data: z.record(z.unknown()).optional(),
  confirm: z.boolean().optional(),
});

export type HaActionSpec = z.infer<typeof HaActionSpecSchema>;

// ---------------------------------------------------------------------------
// HA extension fields — spread into every entity's Zod schema
// ---------------------------------------------------------------------------

/**
 * Fields every entity schema spreads in to allow optional HA mapping.
 * `entityId` is intentionally absent — it's derived from name+device+haDomain
 * via deriveHaEntityId(), not user-input.
 */
export const HaNodeFields = {
  haActions: z.array(HaActionSpecSchema).optional(),
} as const;

// ---------------------------------------------------------------------------
// State buckets — card maps hass state values onto these CSS classes
// ---------------------------------------------------------------------------

export type StateBucket = 'on' | 'off' | 'unavailable' | 'fault' | 'unknown';

/** Default mapping from hass state → bucket. Descriptors may override. */
export function defaultStateBucket(state: string | undefined): StateBucket {
  if (state == null) return 'unknown';
  const s = state.toLowerCase();
  if (s === 'unavailable') return 'unavailable';
  if (s === 'unknown' || s === 'none') return 'unknown';
  if (s === 'on' || s === 'open' || s === 'opening' || s === 'home' || s === 'active' || s === 'heat' || s === 'cool') return 'on';
  if (s === 'off' || s === 'closed' || s === 'closing' || s === 'away' || s === 'idle' || s === 'standby') return 'off';
  if (s === 'problem' || s === 'fault' || s === 'error') return 'fault';
  // Numeric states (sensors) are always "on" if they parse as a finite number.
  const n = Number(s);
  if (Number.isFinite(n)) return 'on';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Meta sidecar shape (emitted by TopologyRenderer.exportHa, consumed by card)
// ---------------------------------------------------------------------------

export interface HaSlotSpec {
  /** X position inside the node's local SVG coords (from top-left of node). */
  x: number;
  /** Y position inside the node's local SVG coords. */
  y: number;
  /** SVG text-anchor. Defaults to 'middle'. */
  textAnchor?: 'start' | 'middle' | 'end';
  /** CSS class(es) to apply. Typically 'label-primary' or 'label-secondary'. */
  cls?: string;
}

export interface HaMetaNode {
  entityId: string;
  kind: string;
  /** Map of slot name → bind expression (e.g. 'state', 'attributes.level|format:percent'). */
  binds?: Record<string, string>;
  /** Resolved action list (per-node override ∪ descriptor defaults). */
  actions?: HaActionSpec[];
}

export interface HaMetaPipe {
  fromEntity?: string;
  toEntity?: string;
  /** Predicate evaluated by the card: "fromEntity.state == <value>". */
  flowWhen?: string;
}

export interface HaMeta {
  schemaVersion: number;
  /** When the export was produced. Used by card as cache-buster. */
  generatedAt: string;
  /** Viewport of the SVG, mirrored here so card can configure crops without parsing SVG. */
  viewBox: [number, number, number, number];
  /** Container-query breakpoints (px) for showing primary/secondary labels. */
  labelTiers: { primary: number; secondary: number };
  nodes: Record<string, HaMetaNode>;
  pipes: Record<string, HaMetaPipe>;
}

// ---------------------------------------------------------------------------
// Bind expression grammar — frozen for v1
// ---------------------------------------------------------------------------

export const BIND_EXPR_RE = /^(state|attributes\.[a-zA-Z0-9_.]+)(\|format:[a-zA-Z0-9_:]+)?$/;

/** Validate a bind expression string at export time. */
export function isValidBindExpr(expr: string): boolean {
  return BIND_EXPR_RE.test(expr);
}

// ---------------------------------------------------------------------------
// Flow-predicate grammar — frozen for v1: only `fromEntity.state == <value>`
// ---------------------------------------------------------------------------

export const FLOW_PRED_RE = /^fromEntity\.state\s*==\s*'([^']+)'$/;

export interface ParsedFlowPredicate {
  expected: string;
}

export function parseFlowPredicate(expr: string): ParsedFlowPredicate | null {
  const m = FLOW_PRED_RE.exec(expr);
  if (!m) return null;
  return { expected: m[1] };
}
