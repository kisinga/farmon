/**
 * @far-mon/core — MajiFlow domain model facade.
 *
 * Single entry point for all domain types, schemas, graph algorithms,
 * entity registry, and utilities. Internal modules are well-separated
 * for future splitting if needed.
 */

// --- Entity side-effect registration (populates NODE_REGISTRY) ---
import './entities/index.js';

// --- Types ---
export type {
  SystemTopology, TopologyNode, PipeSegment, RouteOverride,
  Automation, AutomationTrigger,
  TankNode, PumpNode, EndpointNode, ValveNode,
  FlowSensorNode, WaterSourceNode, PressureSensorNode, FilterNode, DosingPumpNode,
  Port, Position,
} from './topology.types';
export type { Manifest, ManifestNode, ManifestAutomation, Device, Timing } from './manifest.types';
export { type Route as ManifestRoute } from './manifest.types';
export type { BoardDef, PinDef, PinCap } from './board.types';
export type { ValidationResult, RuleDiagnostic, Severity } from './validation.types';
export type { NodeDescriptor, FieldDef, EntityCodegen, EntityRule } from './entity-registry';
export type { PinUsage } from './pin-collect';
export type { PinOverlayData } from './board-pin-overlays';

// --- Schemas ---
export { TopologySchema, parseTopology, parsePortRef, portRef, type Topology } from './topology-schema';
export { GpioPin, ComponentId, PortSchema, PositionSchema, DeviceSchema, TimingSchema, AutomationSchema } from './schemas';

// --- Registry ---
export { NODE_REGISTRY, legendSvgFor } from './entity-registry';

// --- Conversion & utilities ---
export { topologyToManifest } from './topology-to-manifest';
export { collectPins } from './pin-collect';
export { computePinOverlays } from './board-pin-overlays';
export { reservedPins, exposedPins, pinsWithCap } from './board.types';
export { entityColor, UI_COLORS } from './colors';
export { nodesByKind } from './manifest.types';
export { getNodesByKind, getNodeByKind } from './topology.types';

// --- Static ---
export { LOGO_SVG, LOGO_SVG_SMALL } from './static/logo';

// --- Graph ---
export { buildGraph, type TopologyGraph, type NodeAttrs, type EdgeAttrs } from './graph/topology-graph';
export { activeGraph } from './graph/active-graph';
export { deriveRoutes, type Route } from './graph/routes';
export { pipesFromSource, pipesToDestination, connectedPipes, downstreamNodes } from './graph/highlight';
export type { FlowConstraint, PresenceConstraint, OrderingConstraint } from './graph/constraints';
export { evaluateConstraints } from './graph/evaluate-constraints';
export { detectConflicts, type ConflictManifest, type RouteConflict, type SharedResource } from './graph/conflicts';
export { evaluateEscalations } from './graph/evaluate-escalations';

// --- Generators ---
export { generateTopologySvg } from './generators/topology-svg';
