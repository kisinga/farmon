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
 * `SiteTopology` satisfies this interface, so callers don't need casts.
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
  FilterNode,
  DosingPumpNode,
  TopologyNode,
  PipeSegment,
  RouteOverride,
  Automation,
  AutomationTrigger,
  SiteTopology,
  Controller,
  NetworkConfig,
  UartBus,
  IoProviderDef,
} from '@far-mon/core';
export { getNodesByKind, getNodeByKind } from '@far-mon/core';
