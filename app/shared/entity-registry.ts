/**
 * Entity registry — single source of truth for node and inline component descriptors.
 * Each entity self-registers by calling NODE_REGISTRY.set() or INLINE_REGISTRY.set().
 */

// ---------------------------------------------------------------------------
// Field definition (drives sidebar forms)
// ---------------------------------------------------------------------------

export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'pin';
  placeholder?: string;
  /** Pin capability to validate against board, e.g. 'adc'. Drives badge in sidebar. */
  pinCap?: string;
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
  defaultPorts: Array<{ id: string; label: string; direction: 'inlet' | 'outlet' }>;
  defaultData: (index: number) => Record<string, any>;
  /** Returns a raw SVG string for the canvas element. */
  renderSvg: (name: string) => string;
  /** Small static SVG for legend and add-node menu. */
  legendSvg: string;
  sidebarFields: FieldDef[];
}

// ---------------------------------------------------------------------------
// Inline component descriptor
// ---------------------------------------------------------------------------

export interface InlineComponentDescriptor {
  kind: string;
  label: string;
  labelPrefix: string;
  color: string;
  size: { width: number; height: number };
  defaultData: (index: number) => Record<string, any>;
  renderSvg: (shortLabel: string) => string;
  legendSvg: string;
  sidebarFields: FieldDef[];
}

// ---------------------------------------------------------------------------
// Registries
// ---------------------------------------------------------------------------

export const NODE_REGISTRY = new Map<string, NodeDescriptor>();
export const INLINE_REGISTRY = new Map<string, InlineComponentDescriptor>();
