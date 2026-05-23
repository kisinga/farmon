/**
 * Re-exports from @far-mon/core.
 */
import type {
  TopologyNode,
  PipeSegment,
  RouteOverride,
  Automation,
  UartBus,
  IoProviderDef,
  NetworkConfig,
} from '@far-mon/core';

export type {
  Port,
  Position,
  TankNode,
  PumpNode,
  EndpointNode,
  ValveNode,
  FlowSensorNode,
  WaterSourceNode,
  PressureSensorNode,
  FilterNode,
  DosingPumpNode,
  TopologyNode,
  PipeSegment,
  RouteOverride,
  Automation,
  AutomationTrigger,
  SiteTopology,
  SystemTopology,
  Controller,
  NetworkConfig,
  UartBus,
  IoProviderDef,
} from '@far-mon/core';
export { getNodesByKind, getNodeByKind } from '@far-mon/core';
