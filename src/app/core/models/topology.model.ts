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

/**
 * Minimal topology shape needed by the X6 canvas and SVG renderers.
 * Both `SiteTopology` (schema 16) and `SystemTopology` (deprecated compat)
 * satisfy this interface, so callers don't need casts.
 */
export interface RenderableTopology {
  nodes: TopologyNode[];
  pipes: PipeSegment[];
  device?: { friendly_name: string };
}

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
