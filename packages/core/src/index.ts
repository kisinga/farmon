/**
 * @far-mon/core — MajiFlow domain model facade.
 *
 * Single entry point for all domain types, schemas, graph algorithms,
 * entity registry, and utilities. Internal modules are well-separated
 * for future splitting if needed.
 */

// --- Types ---
export type {
  SiteTopology, TopologyNode, PipeSegment, RouteOverride,
  Automation, AutomationTrigger, UartBus, NetworkConfig, NetworkTransport,
  TankNode, PumpNode, EndpointNode, ValveNode,
  FlowSensorNode, WaterSourceNode, FilterNode, DosingPumpNode, VfdNode,
  Port, Position, Controller, RemoteImport,
} from './topology.types';
export { effectiveTransport } from './topology.types';
export type { Manifest, ManifestNode, LocalManifestNode, ImportedManifestNode, ManifestAutomation, Device, Timing } from './manifest.types';
export { type Route as ManifestRoute } from './manifest.types';
export type { BoardDef, PinDef, PinCap, ExpanderDef, EthernetDef, ExpansionBoardDef, ExpansionBoardChannelDef, ExpansionBoardCatalog } from './board.types';
export { boardSupportedTransports } from './board.types';
export type { IoProviderDef, IoProviderInstanceConfig } from './topology.types';
export type { ValidationResult, RuleDiagnostic, Severity } from './validation.types';
export type { NodeDescriptor, FieldDef, EntityCodegen, EntityRule, RouteRule, CodegenContext, TypedDescriptor, EntityKind, HaEntityKey } from './entity-registry';
export type { ChannelUsage, ResolvedChannel, IoChannel, IoProviderDriver } from './io-provider.types';
export type { PinUsage } from './pin-collect';
export type { PinOverlayData } from './board-pin-overlays';
export type {
  SiteMetadata, StoredSiteTopology,
  SiteFullPayload, SiteSavePayload, SiteListEntry, TemplateListEntry,
} from './site.types';


// --- Schemas ---
export { TopologySchema, RouteOverrideSchema, parseTopology, parsePortRef, portRef, migrateTopology, CURRENT_SCHEMA_VERSION, type Topology } from './topology-schema';
export { TopologyEventSchema, parseTopologyEvent, type TopologyEvent, type TopologyEventType } from './topology-events';
export { GpioPin, ComponentId, COMPONENT_ID_POLICY, PortSchema, PositionSchema, DeviceSchema, TimingSchema, AutomationSchema, AutomationTriggerSchema, UartBusSchema, IoProviderDefSchema, IoProviderInstanceConfigSchema, NetworkConfigSchema, AnchorIdSchema, parseDurationMs, escXml } from './schemas';
export { BoardDefSchema, ExpansionBoardDefSchema, parseBoardDef, parseExpansionBoardDef } from './board-schema';
export { parseSiteImport, type ParsedSiteImport } from './site-schema';
export { type InputPolicy, policyString } from './input-policy';

// --- Registry ---
export { NODE_REGISTRY, ALL_DESCRIPTORS, REGISTRY_RULES, legendSvgFor, nodesWithFlag, getTypedDescriptor, allNodes, localNodesWithFlag, importedNodesWithFlag, importedNodesByKind } from './entity-registry';

// --- Slug / naming ---
export { slug } from './slug';

// --- Conversion & utilities ---
export { topologyToManifestForController } from './topology-to-manifest';
export { collectPins, isFieldVisible } from './pin-collect';
export { computePinOverlays } from './board-pin-overlays';
export { reservedPins, exposedPins, pinsWithCap, pinsWithCapability } from './board.types';
export { UI_COLORS } from './colors';
export { entityColor } from './entity-registry';
export { nodesByKind } from './manifest.types';
export { getNodesByKind, getNodeByKind } from './topology.types';

// --- YAML fragment utilities ---
export { indent, joinYamlItems } from './yaml-fragment';

// --- Home Assistant integration ---
export {
  HA_SCHEMA_VERSION, HA_SERVICE_POLICY, HaActionSpecSchema, HaNodeFields,
  defaultStateBucket, isValidBindExpr, parseFlowPredicate,
  deriveHaEntityId, esphomeServicePrefix,
  SYSTEM_ENTITY_NAMES, NETWORK_ENTITY_NAMES, BATTERY_ENTITY_NAMES,
  routeEntityNames,
  systemHaEntityIds, networkHaEntityIds, batteryHaEntityIds,
  automationHaEntityId, routeAutomationAlias,
} from './ha';
export type {
  HaActionSpec, StateBucket, HaSlotSpec, HaMetaNode, HaMetaPipe, HaMeta, ParsedFlowPredicate,
  SystemEntitySpec, SystemEntityKey, NetworkEntityKey, BatteryEntityKey,
  SystemHaEntityIds, NetworkHaEntityIds, BatteryHaEntityIds,
} from './ha';
export { buildHaMeta } from './ha-meta';
export type { BuildHaMetaOptions } from './ha-meta';

// --- Codegen IDs ---
export {
  pumpSwitchId, valveCoverId, valveOpenPinId, valveClosePinId, valveTravelTimeId,
  flowSensorId, flowTotalId, flowFaultCountId, flowFaultSensorId,
  pressureSensorId, pressureSensorRangeMinId, pressureSensorRangeMaxId,
  pressureSensorCalEmptyId, pressureSensorCalFullId, pressureSensorLevelId,
  waterSourcePressureId,
  dosingPumpSwitchId, filterInletPressureId, filterOutletPressureId, filterDeltaPressureId,
} from './codegen-ids';

// --- Remote Proxy ---
export { homeassistantSensorImport, homeassistantBinarySensorProxy, homeassistantTextSensorProxy, templateSwitchProxy, templateCoverProxy } from './remote-proxy';
export { deriveRemoteHaEntityId } from './remote-ha-entity';

// --- I/O Providers ---
export { createBoardDriver } from './io-providers/board-driver';
export { buildResolveChannel, resolveComponentHeader } from './io-providers/resolve-channel';
export { createModbusControllerDriver } from './io-providers/modbus-controller-driver';
export { createProviderDriver, buildProviderDrivers, type ProviderDriverEntry } from './io-providers/provider-factory';
export { createExpansionBoardDriver } from './io-providers/expansion-board-driver';

// --- Static ---
export { LOGO_SVG, LOGO_SVG_SMALL } from './static/logo';

// --- Units ---
export {
  PSI_PER_M, STANDARD_PSI, recommendSensorMaxPsi, deriveTankCalibration,
} from './units';
export type { TankCalibration } from './units';

// --- Pressure sensor shared helpers ---
export {
  PressureSensorConfigSchema,
  emitPressureSensorYaml,
  emitPressureCalNumbers,
  pressureSensorHaNames,
  getPressureSensorIds,
  evaluatePressureSensorUndersized,
  evaluatePressureSensorElevatedLowResolution,
} from './pressure-sensor-shared';
export type { PressureSensorConfig, PressureSensorCodegenIds, PressureSensorHaNames, PressureValidationIssue } from './pressure-sensor-shared';

// --- Graph ---
export { buildGraph, type TopologyGraph, type NodeAttrs, type EdgeAttrs } from './graph/topology-graph';
export { activeGraph, isNodeActive } from './graph/active-graph';
export { deriveRoutes, parseRouteKey, controllerClaimsSegment, type Route } from './graph/routes';
export { findRouteAutomationSensor, type RouteAutomationSensor } from './tank-level';
export { pipesFromSource, pipesToDestination, connectedPipes, downstreamNodes } from './graph/highlight';
export type { FlowConstraint, PresenceConstraint, OrderingConstraint } from './graph/constraints';
export { evaluateConstraints } from './graph/evaluate-constraints';
export { evaluateRouteRules } from './graph/evaluate-route-rules';
export { detectConflicts, type ConflictManifest, type RouteConflict, type SharedResource } from './graph/conflicts';
export { evaluateEscalations } from './graph/evaluate-escalations';

// --- Quotation & BOM ---
export type {
  ComponentDefinition, ParameterDef,
  ProductLine, ProductVariant, QuoteDefaults,
  Quotation, QuotationInput, QuotationLineItem, QuotationDiagnostic,
  ManifestLineItem, SiteManifest,
  CatalogBundle,
} from './quotation';
export {
  COMPONENT_REGISTRY, DEFAULT_LINES, DEFAULT_DEFAULTS, DEFAULT_CATALOG,
  resolveQuoteLineItem,
  buildBaseInfrastructure, buildTopologyComponents,
  buildQuotation, buildQuotationFromTopology,
  renderQuotationHtml, renderTechnicalBomHtml,
} from './quotation';

