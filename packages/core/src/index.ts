/**
 * @far-mon/core — MajiFlow domain model facade.
 *
 * Single entry point for all domain types, schemas, graph algorithms,
 * entity registry, and utilities. Internal modules are well-separated
 * for future splitting if needed.
 */

// --- Types ---
export type {
  SystemTopology, TopologyNode, PipeSegment, RouteOverride,
  Automation, AutomationTrigger, UartBus, NetworkConfig, NetworkTransport,
  TankNode, PumpNode, EndpointNode, ValveNode,
  FlowSensorNode, WaterSourceNode, PressureSensorNode, LevelSensorNode, FilterNode, DosingPumpNode, VfdNode, InterconnectNode,
  Port, Position,
} from './topology.types';
export { effectiveTransport } from './topology.types';
export type { Manifest, ManifestNode, ManifestAutomation, Device, Timing, TankLevelSource } from './manifest.types';
export { type Route as ManifestRoute } from './manifest.types';
export type { BoardDef, PinDef, PinCap, ExpanderDef, EthernetDef } from './board.types';
export { boardSupportedTransports } from './board.types';
export type { IoProviderDef } from './topology.types';
export type { ValidationResult, RuleDiagnostic, Severity } from './validation.types';
export type { NodeDescriptor, FieldDef, EntityCodegen, EntityRule, CodegenContext, TypedDescriptor, EntityKind } from './entity-registry';
export type { ChannelUsage, ResolvedChannel, IoChannel, IoProviderDriver } from './io-provider.types';
export type { PinUsage } from './pin-collect';
export type { PinOverlayData } from './board-pin-overlays';
export type {
  SiteMetadata, LinkData, StoredTopology, SystemPayload,
  SiteFullPayload, SiteSavePayload, SiteListEntry, TemplateListEntry,
} from './site.types';
export type { BoundaryPort } from './graph/boundary-ports';

// --- Schemas ---
export { TopologySchema, RouteOverrideSchema, parseTopology, parsePortRef, portRef, type Topology } from './topology-schema';
export { GpioPin, ComponentId, COMPONENT_ID_POLICY, PortSchema, PositionSchema, DeviceSchema, TimingSchema, AutomationSchema, AutomationTriggerSchema, UartBusSchema, IoProviderDefSchema, NetworkConfigSchema, parseDurationMs, escXml } from './schemas';
export { type InputPolicy, policyString } from './input-policy';

// --- Registry ---
export { NODE_REGISTRY, ALL_DESCRIPTORS, REGISTRY_RULES, legendSvgFor, nodesWithFlag, getTypedDescriptor } from './entity-registry';

// --- Slug / naming ---
export { slug } from './slug';

// --- Conversion & utilities ---
export { topologyToManifest } from './topology-to-manifest';
export { collectPins } from './pin-collect';
export { computePinOverlays } from './board-pin-overlays';
export { reservedPins, exposedPins, pinsWithCap } from './board.types';
export { entityColor, UI_COLORS } from './colors';
export { nodesByKind } from './manifest.types';
export { getNodesByKind, getNodeByKind } from './topology.types';

// --- YAML fragment utilities ---
export { indent, joinYamlItems } from './yaml-fragment';

// --- Home Assistant integration ---
export {
  HA_SCHEMA_VERSION, HA_SERVICE_POLICY, HaActionSpecSchema, HaNodeFields,
  defaultStateBucket, isValidBindExpr, parseFlowPredicate,
  deriveHaEntityId, esphomeServicePrefix,
  SYSTEM_ENTITY_NAMES, ESPHOME_SERVICES, routeEntityNames, systemHaEntityIds,
  automationHaEntityId, routeAutomationAlias,
  systemCapabilities,
} from './ha';
export type {
  HaActionSpec, StateBucket, HaSlotSpec, HaMetaNode, HaMetaPipe, HaMeta, ParsedFlowPredicate,
  SystemEntitySpec, SystemEntityKey, SystemHaEntityIds, EsphomeServiceName,
  SystemCapabilities,
} from './ha';
export { buildHaMeta } from './ha-meta';
export type { BuildHaMetaOptions } from './ha-meta';

// --- Codegen IDs ---
export {
  pumpSwitchId, valveCoverId, valveOpenPinId, valveClosePinId, valveTravelMsId,
  flowSensorId, flowTotalId, flowFaultCountId, flowFaultSensorId,
  levelSensorLevelId, levelSensorRawVoltageId, levelSensorCalEmptyId, levelSensorCalFullId,
  pressureSensorId, pressureSensorRangeMinId, pressureSensorRangeMaxId,
  pressureSensorCalEmptyId, pressureSensorCalFullId, pressureSensorLevelId,
  waterSourcePressureId,
  dosingPumpSwitchId, filterInletPressureId, filterOutletPressureId, filterDeltaPressureId,
} from './codegen-ids';

// --- I/O Providers ---
export { createBoardDriver } from './io-providers/board-driver';
export { buildResolveChannel, resolveComponentHeader } from './io-providers/resolve-channel';
export { createModbusControllerDriver } from './io-providers/modbus-controller-driver';
export { createProviderDriver } from './io-providers/provider-factory';

// --- Static ---
export { LOGO_SVG, LOGO_SVG_SMALL } from './static/logo';

// --- Graph ---
export { buildGraph, type TopologyGraph, type NodeAttrs, type EdgeAttrs } from './graph/topology-graph';
export { activeGraph, isNodeActive } from './graph/active-graph';
export { deriveRoutes, type Route } from './graph/routes';
export { pipesFromSource, pipesToDestination, connectedPipes, downstreamNodes } from './graph/highlight';
export type { FlowConstraint, PresenceConstraint, OrderingConstraint } from './graph/constraints';
export { evaluateConstraints } from './graph/evaluate-constraints';
export { detectConflicts, type ConflictManifest, type RouteConflict, type SharedResource } from './graph/conflicts';
export { evaluateEscalations } from './graph/evaluate-escalations';
export { boundaryPorts } from './graph/boundary-ports';
export { buildCompositeGraph, type CompositeInput } from './graph/composite-graph';

// --- Topology enrichment (interconnect labels) ---
export { enrichPerSystemInterconnects, enrichCompositeInterconnects, type InterconnectContext } from './enrich-interconnects';
