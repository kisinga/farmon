/**
 * Type mirrors of the @far-mon/core `HaMeta` shape and the SVG schema contract.
 *
 * Kept deliberately duplicated (not imported from `@far-mon/core`) so the
 * card ships as a single standalone JS bundle with no build-time dependency
 * on the editor repo. The `schemaVersion` field guards against drift.
 */

export const SUPPORTED_SCHEMA_VERSION = 1;

export type StateBucket = 'on' | 'off' | 'unavailable' | 'fault' | 'unknown';

export interface HaActionSpec {
  id: string;
  label: string;
  service?: string;
  data?: Record<string, unknown>;
  confirm?: boolean;
}

export interface HaMetaNode {
  entityId?: string;
  kind: string;
  binds?: Record<string, string>;
  actions?: HaActionSpec[];
}

export interface HaMetaPipe {
  fromEntity?: string;
  toEntity?: string;
  flowWhen?: string;
}

export interface HaMeta {
  schemaVersion: number;
  generatedAt: string;
  viewBox: [number, number, number, number];
  labelTiers: { primary: number; secondary: number };
  nodes: Record<string, HaMetaNode>;
  pipes: Record<string, HaMetaPipe>;
}

// ---------------------------------------------------------------------------
// Card config (HA YAML shape)
// ---------------------------------------------------------------------------

export interface FarmScadaCardConfig {
  type: 'custom:farm-scada-card';
  source: string;
  meta: string;
  title?: string;
  /** Height in px or CSS length (default: auto from SVG aspect ratio). */
  height?: number | string;
  /** Override viewBox (for dashboard-level crops). */
  viewbox?: [number, number, number, number];
  /** Override actions per entity id. */
  actions_override?: Record<string, HaActionSpec[]>;
  /** Global action list applied to any node lacking per-node actions. */
  default_actions?: HaActionSpec[];
}
