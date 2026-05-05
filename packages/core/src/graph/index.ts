// Graph substrate
export { buildGraph, type TopologyGraph, type NodeAttrs, type EdgeAttrs } from './topology-graph';
export { activeGraph } from './active-graph';

// Route derivation
export { deriveRoutes, parseRouteKey, type Route } from './routes';

// Highlighting
export { pipesFromSource, pipesToDestination, connectedPipes, downstreamNodes } from './highlight';

// Constraints
export type { FlowConstraint, PresenceConstraint, OrderingConstraint } from './constraints';
export { evaluateConstraints } from './evaluate-constraints';

// Conflicts
export { detectConflicts, type ConflictManifest, type RouteConflict, type SharedResource } from './conflicts';

// Escalation
export { evaluateEscalations } from './evaluate-escalations';
