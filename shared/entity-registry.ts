/**
 * Entity registry — single source of truth for node descriptors.
 * Each entity self-registers by calling NODE_REGISTRY.set().
 *
 * Every entity is fully self-describing: UI (renderSvg, sidebarFields),
 * schema (Zod), codegen (ESPHome YAML templates), and validation rules
 * are all co-located in a single entity file.
 */

import type { z } from 'zod';
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
// Codegen — ESPHome YAML/C++ fragment generators per entity kind
// ---------------------------------------------------------------------------

export interface EntityCodegen {
  /** YAML fragment for sensors.yaml (ADC, pulse counter, template sensors). */
  sensors?: (node: Record<string, any>, index: number) => string;
  /** YAML fragment for hardware.yaml (switches, covers, relays). */
  hardware?: (node: Record<string, any>, index: number) => string;
  /** Substitution lines for device.yaml. */
  substitutions?: (node: Record<string, any>) => string[];
  /** Dashboard card YAML fragment. */
  dashboard?: (node: Record<string, any>, deviceName: string) => string;
  /** Additional globals for control.yaml. */
  globals?: (node: Record<string, any>) => string;
}

// ---------------------------------------------------------------------------
// Validation — per-entity topology rules
// ---------------------------------------------------------------------------

export interface EntityRule {
  id: string;
  severity: 'error' | 'warning';
  /** Evaluate this rule against nodes of this kind. */
  evaluate: (
    kindNodes: Record<string, any>[],
    allNodes: Record<string, any>[],
  ) => Array<{ message: string; target?: string }>;
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
  category?: 'source' | 'actuator' | 'sensor' | 'destination' | 'infrastructure';
  /** UI grouping key (e.g. 'pump' groups relay pump + dosing pump). Falls back to category. */
  group?: string;
  /** When true, shows experimental badge and marks codegen output. */
  experimental?: boolean;
  /** URL to installation/usage docs for this entity type. */
  helpUrl?: string;
  defaultPorts: Array<{ id: string; label: string; direction: 'inlet' | 'outlet'; y?: number }>;
  defaultData: (index: number) => Record<string, any>;
  /** Returns a raw SVG string for the canvas element. Receives full node data. */
  renderSvg: (data: Record<string, any>) => string;
  /** Small static SVG for legend and add-node menu. */
  legendSvg: string;
  sidebarFields: FieldDef[];

  /** Zod schema for this node kind. Source of truth for the TypeScript type. */
  schema: z.ZodTypeAny;

  /** Codegen templates — only consumed by electron generators. */
  codegen?: EntityCodegen;

  /** Per-entity validation rules — only consumed by electron rule runner. */
  rules?: EntityRule[];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const NODE_REGISTRY = new Map<string, NodeDescriptor>();
