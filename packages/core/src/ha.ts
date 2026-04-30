/**
 * Home Assistant integration types and schemas.
 *
 * Shared by:
 *  - entity Zod schemas (optional `entityId` + `haActions` fields on topology nodes)
 *  - TopologyRenderer.exportHa() (meta sidecar shape)
 *  - farm-scada-card (runtime contract)
 *
 * SVG schema version bumped when the decorated SVG shape changes.
 */

import { z } from 'zod';
import { type InputPolicy, policyString } from './input-policy';

/** Version of the decorated SVG + meta sidecar contract. Bump on breaking changes. */
export const HA_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Input policies — single source of truth for HA entity_id and service shapes
// ---------------------------------------------------------------------------

export const HA_ENTITY_ID_POLICY: InputPolicy = {
  pattern: /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/,
  allow: /[a-z0-9_.]/g,
  lowercase: true,
  hint: 'Use lowercase letters, digits, underscores, and one dot — e.g. cover.rain_tank',
};

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
 * Keeping them optional means existing topologies parse unchanged.
 */
export const HaNodeFields = {
  entityId: policyString(HA_ENTITY_ID_POLICY).optional(),
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
  entityId?: string;
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
