/**
 * Shared topology types — the single source of truth for both
 * Electron (validated via Zod) and Angular (used as-is).
 *
 * No runtime dependencies. Pure interfaces and helper functions.
 */

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export interface Port {
  id: string;
  label: string;
  direction: 'inlet' | 'outlet';
}

// ---------------------------------------------------------------------------
// Position
// ---------------------------------------------------------------------------

export interface Position {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export interface TankNode {
  kind: 'tank';
  id: string;
  name: string;
  level_pin?: string;
  ports: Port[];
  position: Position;
}

export interface PumpNode {
  kind: 'pump';
  id: string;
  pin: string;
  ports: Port[];
  position: Position;
}

export interface EndpointNode {
  kind: 'endpoint';
  id: string;
  name: string;
  ports: Port[];
  position: Position;
}

export interface ValveNode {
  kind: 'valve';
  id: string;
  name: string;
  open_pin: string;
  close_pin: string;
  ports: Port[];
  position: Position;
}

export interface FlowSensorNode {
  kind: 'flow_sensor';
  id: string;
  name: string;
  pin: string;
  flow_cal: number;
  ports: Port[];
  position: Position;
}

export interface WaterSourceNode {
  kind: 'water_source';
  id: string;
  name: string;
  pressure_pin?: string;
  ports: Port[];
  position: Position;
}

export type TopologyNode = TankNode | PumpNode | EndpointNode | ValveNode | FlowSensorNode | WaterSourceNode;

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
  name?: string;
  max_runtime_seconds?: number;
}

// ---------------------------------------------------------------------------
// Topology (top-level document)
// ---------------------------------------------------------------------------

export interface SystemTopology {
  schema: 5;
  device: {
    name: string;
    friendly_name: string;
    board: string;
    directory?: string;
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
