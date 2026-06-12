/**
 * @core — MajiFlow domain model facade.
 *
 * Single entry point for all domain types, schemas, graph algorithms,
 * entity registry, and utilities. Internal modules are well-separated
 * for future splitting if needed.
 */

// --- Types ---
export type {
  SiteTopology, TopologyNode, PipeSegment, RouteOverride,
  UartBus, NetworkConfig, NetworkTransport,
  TankNode, PumpNode, EndpointNode, ValveNode,
  FlowSensorNode, WaterSourceNode, FilterNode, DosingPumpNode, VfdNode,
  Port, Position, Controller, RemoteImport,
} from './topology.types';
export { effectiveTransport } from './topology.types';
export type { Manifest, ManifestNode, LocalManifestNode, ImportedManifestNode, Device, Timing } from './manifest.types';
export { type Route as ManifestRoute } from './manifest.types';
export type { BoardDef, DocSection, PinDef, PinCap, ExpanderDef, EthernetDef, ExpansionBoardDef, ExpansionBoardChannelDef, ExpansionBoardCatalog } from './board.types';
export { boardSupportedTransports } from './board.types';
export type { IoProviderDef, IoProviderInstanceConfig } from './topology.types';
export type { ValidationResult, RuleDiagnostic, Severity } from './validation.types';
export type { NodeDescriptor, FieldDef, EntityCodegen, EntityRule, RouteRule, CodegenContext, TypedDescriptor, EntityKind, HaEntityKey } from './entity-registry';
export type { ChannelUsage, ResolvedChannel, IoChannel, IoProviderDriver } from './io-provider.types';
export type { PinUsage } from './pin-collect';
export type { PinOverlayData } from './board-pin-overlays';
export type {
  SiteMetadata, SiteDeployment, StoredSiteTopology,
  SiteFullPayload, SiteSavePayload, SiteListEntry, TemplateListEntry,
} from './site.types';
export { HOSTING_DEVICE_CAP } from './site.types';


// --- Schemas ---
export { TopologySchema, RouteOverrideSchema, parseTopology, parsePortRef, portRef, migrateTopology, CURRENT_SCHEMA_VERSION, type Topology } from './topology-schema';
export { migrateToRemoteImports } from './topology-migrate';
export { TopologyEventSchema, parseTopologyEvent, type TopologyEvent, type TopologyEventType } from './topology-events';
export { GpioPin, ComponentId, COMPONENT_ID_POLICY, PortSchema, PositionSchema, DeviceSchema, TimingSchema, UartBusSchema, IoProviderDefSchema, IoProviderInstanceConfigSchema, NetworkConfigSchema, AnchorIdSchema, parseDurationMs, escXml } from './schemas';
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
export { calloutLabelsFor, layoutCallouts, buildCalloutMarkup, emitPinoutSvg } from './board-pinout-layout';
export type { ConnectorGeom, CalloutLabel, ViewBox, PlacedBox, PinoutPlacement, LayoutOptions } from './board-pinout-layout';
export { measureConnectors, svgViewBox } from './board-pinout-measure';
export { reservedPins, exposedPins, pinsWithCap, pinsWithCapability } from './board.types';
export { UI_COLORS } from './colors';
export { entityColor } from './entity-registry';
export { nodesByKind } from './manifest.types';
export { getNodesByKind, getNodeByKind } from './topology.types';

// --- YAML fragment utilities ---
export { indent, joinYamlItems, yamlString } from './yaml-fragment';

// --- Entity-name catalogs (firmware codegen SSOT for emitted entity names) ---
export {
  SYSTEM_ENTITY_NAMES, NETWORK_ENTITY_NAMES, BATTERY_ENTITY_NAMES,
  routeEntityNames,
} from './entity-names';
export type {
  SystemEntitySpec, SystemEntityKey, NetworkEntityKey, BatteryEntityKey,
} from './entity-names';

// --- Telemetry channels (shared by firmware codegen + dashboard chart spec) ---
export { collectTelemetryChannels } from './telemetry-channels';
export type { TelemetryChannel, TelemetryChannelKind } from './telemetry-channels';

// --- Device heap health (shared by firmware codegen + dashboard health pill) ---
export {
  HEAP_FREE_SENSOR, HEAP_MIN_SENSOR, HEAP_WARN_BYTES, HEAP_CRIT_BYTES,
  WIFI_SIGNAL_SENSOR, UPTIME_SENSOR, TEMP_SENSOR,
  HEALTH_SEVERITY, controllerHealth, worstHealth,
} from './health';
export type { HealthLevel } from './health';

// --- Dashboard chart spec (derived from the saved topology, in the browser) ---
export { buildDashboardSpec } from './dashboard-spec';
export type { DashboardSpec, DashboardWidget, WidgetKind, RouteControl, ControllerControls, ActuatorControl, SetpointControl, CalibrationControl } from './dashboard-spec';

// --- Command confirmation (desired→reported convergence; one shape, all controls) ---
export { confirmDescriptor, HOLD_GRACE_MS, HOLD_RECLAIM_MS, CLAIM_LEASE_FLOOR_S } from './command-confirm';
export type { ConfirmDescriptor, ConfirmObservation, CommandPhase } from './command-confirm';

// --- Runtime-tunable device numbers (config_set surface; firmware + UI + drift test) ---
export { collectTunableNumbers, routeVolumeEligible } from './tunable-numbers';
export {
  AUTOMATION_WIRE_MAGIC, AUTOMATION_HEADER_BYTES, AUTOMATION_RECORD_BYTES, MAX_AUTOMATIONS,
  routeSetVersion, serializeAutomationSet,
} from './automation-wire';
export type { WireAutomation, TriggerKind } from './automation-wire';
export { listAutomatableRoutes } from './automation-routes';
export type { AutomatableRoute, NewAutomationRow } from './automation-routes';
export type { TunableNumber, TunableScope, TunableTier, TunableField } from './tunable-numbers';

// --- Codegen IDs ---
export {
  pumpSwitchId, valveCoverId, valveOpenPinId, valveClosePinId, valveTravelTimeId,
  flowSensorId, flowTotalId, flowFaultCountId, flowFaultSensorId,
  pressureSensorId, pressureSensorRangeMinId, pressureSensorRangeMaxId,
  pressureSensorCalEmptyId, pressureSensorCalFullId, pressureSensorLevelId,
  waterSourcePressureId,
  dosingPumpSwitchId, filterInletPressureId, filterOutletPressureId, filterDeltaPressureId,
} from './codegen-ids';

// --- Runtime contract: deployment mode, MQTT topics, command vocabulary ---
export {
  MQTT_ROOT, telemetryTopic, commandTopic, automationsTopic, statusTopic, eventTopic, identityTopic,
  telemetrySensorId, SYSTEM_STATE_SENSOR, STOP_REASON_SENSOR, routeStateSensor, COMMAND_TTL_S,
  routeSourceMinNumber, routeDestMaxNumber, collectConfigSetpoints,
  COORD_MSG, COORD_TYPE,
} from './codegen-ids';
export type {
  DeploymentMode, CommandAction, CommandEnvelope, CoordMessage, TelemetryRole, ConfigSetpoint,
} from './codegen-ids';

// --- Runtime contract: state/fault/reason vocabulary + meanings ---
export {
  SYSTEM_STATE_TOKENS, FAULT_TOKENS, STOP_REASON_TOKENS, OUTCOME_TOKENS,
  SYSTEM_STATE_MEANINGS, FAULT_MEANINGS, STOP_REASON_MEANINGS, OUTCOME_MEANINGS,
  ROUTE_START_RESULTS, ROUTE_STOP_RESULTS, NODE_SET_RESULTS,
  describeState,
} from './codegen-ids';
export type {
  StateKind, StateMeaning,
  SystemStateToken, FaultToken, StopReasonToken, OutcomeToken, StateEvent,
} from './codegen-ids';

// --- Remote Proxy ---
export {
  udpSensorImport,
  udpSwitchProxy, udpSwitchProxyLeaseInterval,
  udpCoverProxy, udpCoverProxyLeaseInterval,
} from './remote-proxy';
export { deriveRemoteSourceRef } from './remote-source';

// --- I/O Providers ---
export { createBoardDriver } from './io-providers/board-driver';
export { buildResolveChannel, resolveComponentHeader } from './io-providers/resolve-channel';
export { createModbusControllerDriver } from './io-providers/modbus-controller-driver';
export { createProviderDriver, buildProviderDrivers, type ProviderDriverEntry } from './io-providers/provider-factory';
export { createExpansionBoardDriver } from './io-providers/expansion-board-driver';

// --- Documentation: the tiny pure pieces (vocabulary + drift guard) live in the
// main barrel; the heavy renderer + assembler (micromustache, lazy marked) are
// reachable ONLY via the `@core/docs` entry so they stay out of the initial
// bundle (imported dynamically by the doc-build path). ---
export {
  siteVars, boardVars, nodeVars, vocabFor,
  type DocScope, type SiteVarCtx, type NodeVarCtx,
} from './docs/vars';
export { extractSlots, unknownSlots } from './docs/validate';
export { parseFrontmatter, parseDocFile, type ParsedDoc } from './docs/frontmatter';

// --- Static ---
export { LOGO_SVG, LOGO_SVG_SMALL } from './static/logo';

// --- Units ---
export {
  PSI_PER_M, STANDARD_PSI, recommendSensorMaxPsi, deriveTankCalibration, tankCalibrationToPhysical,
} from './units';
export type { TankCalibration, TankPhysical } from './units';

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
export { detectCrossControllerTalk, type CrossControllerReport } from './cross-controller';
export { pipesFromSource, pipesToDestination, connectedPipes, downstreamNodes } from './graph/highlight';
export type { FlowConstraint, PresenceConstraint, OrderingConstraint } from './graph/constraints';
export { evaluateConstraints } from './graph/evaluate-constraints';
export { evaluateRouteRules } from './graph/evaluate-route-rules';
export { detectConflicts, type ConflictManifest, type RouteConflict, type SharedResource } from './graph/conflicts';

