/**
 * Entity registry — single source of truth for node descriptors.
 * Each entity self-registers by calling NODE_REGISTRY.set().
 */

import type { PinCap } from './board.types';

// ---------------------------------------------------------------------------
// Field definition (drives sidebar forms)
// ---------------------------------------------------------------------------

export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'pin';
  placeholder?: string;
  /** Pin capability required for this field, e.g. 'adc'. Filters pin selection and drives validation. */
  pinCap?: PinCap;
}

// ---------------------------------------------------------------------------
// Node descriptor
// ---------------------------------------------------------------------------

export interface NodeDescriptor {
  kind: string;
  label: string;
  color: string;
  size: { width: number; height: number };
  singleton?: boolean;
  role: 'terminal' | 'passthrough';
  routeSource?: boolean;
  /** Category for grouping in add-node menu. */
  category?: 'source' | 'actuator' | 'sensor' | 'destination';
  /** URL to installation/usage docs for this entity type. */
  helpUrl?: string;
  defaultPorts: Array<{ id: string; label: string; direction: 'inlet' | 'outlet' }>;
  defaultData: (index: number) => Record<string, any>;
  /** Returns a raw SVG string for the canvas element. Receives full node data. */
  renderSvg: (data: Record<string, any>) => string;
  /** Small static SVG for legend and add-node menu. */
  legendSvg: string;
  sidebarFields: FieldDef[];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const NODE_REGISTRY = new Map<string, NodeDescriptor>();
