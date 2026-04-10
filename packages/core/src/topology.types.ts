/**
 * Shared topology types — the single source of truth for both
 * Electron (validated via Zod) and Angular (used as-is).
 *
 * Individual node types are defined and exported from their entity files
 * in shared/entities/. The TopologyNode union is assembled here.
 */

// Re-export types from schemas
export type { Port, Position } from './schemas';

// Re-export individual node types from entity files
export type { TankNode } from './entities/tank';
export type { PumpNode } from './entities/pump';
export type { EndpointNode } from './entities/endpoint';
export type { ValveNode } from './entities/valve';
export type { FlowSensorNode } from './entities/flow-sensor';
export type { WaterSourceNode } from './entities/water-source';
export type { PressureSensorNode } from './entities/pressure-sensor';
export type { FilterNode } from './entities/filter';
export type { DosingPumpNode } from './entities/dosing-pump';

import type { TankNode } from './entities/tank';
import type { PumpNode } from './entities/pump';
import type { EndpointNode } from './entities/endpoint';
import type { ValveNode } from './entities/valve';
import type { FlowSensorNode } from './entities/flow-sensor';
import type { WaterSourceNode } from './entities/water-source';
import type { PressureSensorNode } from './entities/pressure-sensor';
import type { FilterNode } from './entities/filter';
import type { DosingPumpNode } from './entities/dosing-pump';
import type { VfdNode } from './entities/vfd';

// ---------------------------------------------------------------------------
// Node union
// ---------------------------------------------------------------------------

export type TopologyNode =
  | TankNode
  | PumpNode
  | EndpointNode
  | ValveNode
  | FlowSensorNode
  | WaterSourceNode
  | PressureSensorNode
  | FilterNode
  | DosingPumpNode
  | VfdNode;

// ---------------------------------------------------------------------------
// Pipes
// ---------------------------------------------------------------------------

export interface PipeSegment {
  id: string;
  from: string; // "nodeId:portId"
  to: string;   // "nodeId:portId"
}

// ---------------------------------------------------------------------------
// Route overrides
// ---------------------------------------------------------------------------

export interface RouteOverride {
  max_runtime_seconds?: number;
  /** Firmware rejects start (and stops run if sensor is pump-rated) when source below this %. */
  source_min_level?: number;
  /** Firmware rejects start (and stops run if sensor is pump-rated) when dest above this %. */
  dest_max_level?: number;
}

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

export interface AutomationTrigger {
  type: 'time' | 'level';
  at?: string;            // HH:MM (for type: time)
  node?: string;          // topology node ID (for type: level) — resolved to HA entity at codegen
  entity?: string;        // raw HA entity ID (for type: level) — fallback for external sensors
  below?: number;
  above?: number;
  for_minutes?: number;   // hold duration in minutes before trigger fires
}

export interface Automation {
  id: string;
  name: string;
  route: string;          // route key e.g. "tank1>tank2"
  trigger: AutomationTrigger;
  days_of_week: ('MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN')[];
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Topology (top-level document)
// ---------------------------------------------------------------------------

export interface UartBus {
  id: string;
  tx_pin: string;
  rx_pin: string;
  de_pin?: string;
  baud_rate: number;
}

export interface SystemTopology {
  schema: 8;
  device: {
    name: string;
    friendly_name: string;
    board: string;
    directory?: string;
    uart_buses?: UartBus[];
  };
  nodes: TopologyNode[];
  pipes: PipeSegment[];
  route_overrides: Record<string, RouteOverride>;
  timing: {
    valve_travel_time: string;
    flow_watchdog_seconds: number;
    flow_confirm_seconds: number;
    api_watchdog_seconds: number;
    update_interval: string;
  };
  automations: Automation[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getNodesByKind<K extends TopologyNode['kind']>(
  t: SystemTopology, kind: K,
): Extract<TopologyNode, { kind: K }>[] {
  return t.nodes.filter((n): n is Extract<TopologyNode, { kind: K }> => n.kind === kind);
}

export function getNodeByKind<K extends TopologyNode['kind']>(
  t: SystemTopology, kind: K,
): Extract<TopologyNode, { kind: K }> | undefined {
  return t.nodes.find((n): n is Extract<TopologyNode, { kind: K }> => n.kind === kind);
}
