/**
 * Re-exports from shared topology types.
 * All types and helpers now live in shared/topology.types.ts.
 */
export {
  type Port,
  type Position,
  type TankNode,
  type PumpNode,
  type EndpointNode,
  type ValveNode,
  type FlowSensorNode,
  type WaterSourceNode,
  type TopologyNode,
  type PipeSegment,
  type RouteOverride,
  type SystemTopology,
  getNodesByKind,
  getNodeByKind,
} from '../../../../shared/topology.types';
