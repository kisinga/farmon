// Graph substrate
export { buildGraph, type TopologyGraph, type NodeAttrs, type EdgeAttrs } from './topology-graph';
export { activeGraph } from './active-graph';

// Route derivation
export { deriveRoutes, parseRouteKey, controllerClaimsSegment, type Route } from './routes';

// Highlighting
export { pipesFromSource, pipesToDestination, connectedPipes, downstreamNodes } from './highlight';

// Constraints & route rules
export type { FlowConstraint, PresenceConstraint, OrderingConstraint } from './constraints';
export { evaluateConstraints } from './evaluate-constraints';
export { evaluateRouteRules } from './evaluate-route-rules';

// Conflicts
export { detectConflicts, type ConflictManifest, type RouteConflict, type SharedResource } from './conflicts';

// Escalation
