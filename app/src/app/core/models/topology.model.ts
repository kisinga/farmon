/**
 * Frontend topology types — mirrors the Zod schema in electron/lib/topology.ts.
 * These are plain interfaces (no Zod dependency in the renderer process).
 */

export interface Port {
  id: string;
  label: string;
  direction: 'inlet' | 'outlet';
}

export interface Position {
  x: number;
  y: number;
}

export interface TankNode {
  kind: 'tank';
  id: string;
  name: string;
  level_pin: string;
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

export type TopologyNode = TankNode | PumpNode | EndpointNode;

export interface ValveComponent {
  kind: 'valve';
  id: string;
  name: string;
  open_pin: string;
  close_pin: string;
}

export interface FlowComponent {
  kind: 'flow_sensor';
  id: string;
  name: string;
  pin: string;
  flow_cal: number;
}

export type InlineComponent = ValveComponent | FlowComponent;

export interface PipeSegment {
  id: string;
  from: string;  // "nodeId:portId"
  to: string;    // "nodeId:portId"
  components: InlineComponent[];
}

export interface RouteOverride {
  name?: string;
  max_runtime_seconds?: number;
}

export interface SystemTopology {
  schema: 3;
  device: {
    name: string;
    friendly_name: string;
    board: string;
    directory?: string;
  };
  nodes: TopologyNode[];
  pipes: PipeSegment[];
  route_overrides: Record<string, RouteOverride>;
  timing: Record<string, string | number>;
}

// --- Helpers ---

/** Extract all tanks from topology nodes. */
export function getTanks(t: SystemTopology): TankNode[] {
  return t.nodes.filter((n): n is TankNode => n.kind === 'tank');
}

/** Extract the pump node. */
export function getPump(t: SystemTopology): PumpNode | undefined {
  return t.nodes.find((n): n is PumpNode => n.kind === 'pump');
}

/** Extract all endpoints. */
export function getEndpoints(t: SystemTopology): EndpointNode[] {
  return t.nodes.filter((n): n is EndpointNode => n.kind === 'endpoint');
}

/** Extract all valves from all pipes. */
export function getValves(t: SystemTopology): ValveComponent[] {
  const seen = new Set<string>();
  const valves: ValveComponent[] = [];
  for (const pipe of t.pipes) {
    for (const c of pipe.components) {
      if (c.kind === 'valve' && !seen.has(c.id)) {
        seen.add(c.id);
        valves.push(c);
      }
    }
  }
  return valves;
}

/** Extract all flow sensors from all pipes. */
export function getFlowSensors(t: SystemTopology): FlowComponent[] {
  const seen = new Set<string>();
  const flows: FlowComponent[] = [];
  for (const pipe of t.pipes) {
    for (const c of pipe.components) {
      if (c.kind === 'flow_sensor' && !seen.has(c.id)) {
        seen.add(c.id);
        flows.push(c);
      }
    }
  }
  return flows;
}
