/**
 * Route domain read-model — a typed, immutable lens over the topology.
 *
 * `SiteModel.fromTopology` is the one place the app hydrates routes and their
 * capabilities. It is a pure projection of the topology graph (the SSOT): the
 * firmware manifest is a *separate* projection of the same graph, so the app no
 * longer reads firmware-shaped, index-bound, destination-overloaded fields.
 *
 * The model never filters or reorders routes relative to `deriveRoutes`:
 * `runnable`/`trackable` are tags consumers read, not derivation filters. (The
 * firmware route id is the positional index into the route table; reordering or
 * dropping would silently repoint the runs ledger, automations, and conflict
 * masks. The order-invariance test guards this.)
 *
 * Identity is the stable route `key` and the endpoint node id, never the index.
 */
import type { SiteTopology, TopologyNode, TankNode } from './topology.types';
import { buildGraph } from './graph/topology-graph';
import { deriveRoutes, type Route } from './graph/routes';
import { routeCapabilities, type RouteCapabilities, type NodeLookup } from './route-capabilities';

/**
 * A delivery endpoint (the recipient water arrives at) — the last node of a route's
 * path. The most durable attribution anchor we have (a route key changes if its
 * valves change; an endpoint node id does not), so usage rolls up on this.
 */
export class Endpoint {
  constructor(readonly node: TopologyNode) {}
  get id(): string { return this.node.id; }
  get name(): string { return this.node.name; }
  get kind(): TopologyNode['kind'] { return this.node.kind; }
  get isTank(): boolean { return this.node.kind === 'tank'; }
  /** Tank traits, present only when the endpoint is a tank. */
  get tank(): TankNode | undefined { return this.isTank ? (this.node as TankNode) : undefined; }
  get capacityL(): number | undefined { return this.tank?.capacity_l; }
  get levelMonitored(): boolean { return !!this.tank?.level_monitored; }
  get hasFloatValve(): boolean { return !!this.tank?.float_valve; }
}

/** One route with its resolved endpoint and capabilities. Behavior lives here so
 *  every consumer asks the same object the same question. */
export class RouteModel {
  constructor(
    readonly route: Route,
    readonly source: TopologyNode,
    readonly endpoint: Endpoint,
    readonly caps: RouteCapabilities,
  ) {}

  /** Stable identity. */
  get key(): string { return this.route.key; }
  /** Human label, derived from node names (source > endpoint). */
  get name(): string { return `${this.source.name} > ${this.endpoint.name}`; }

  get runnable(): boolean { return this.caps.runnable; }
  get trackable(): boolean { return this.caps.trackable; }
  get runKind(): RouteCapabilities['runKind'] { return this.caps.runKind; }
  get metered(): boolean { return this.caps.metered; }
  get targets(): RouteCapabilities['targets'] { return this.caps.targets; }
  get stallDisposition(): RouteCapabilities['stallDisposition'] { return this.caps.stallDisposition; }
  get canStopOnFull(): boolean { return this.caps.canStopOnFull; }
  /** Usage/billing attribution key. */
  get usageEndpointId(): string { return this.endpoint.id; }
}

/** The site's route read-model: every derived route, in derivation order, with
 *  capabilities. Endpoints are deduplicated across the routes that feed them. */
export class SiteModel {
  constructor(readonly routes: readonly RouteModel[]) {}

  routeByKey(key: string): RouteModel | undefined {
    return this.routes.find((r) => r.key === key);
  }

  /** Distinct endpoints across all routes, keyed by node id. */
  get endpoints(): Endpoint[] {
    const seen = new Map<string, Endpoint>();
    for (const r of this.routes) if (!seen.has(r.endpoint.id)) seen.set(r.endpoint.id, r.endpoint);
    return [...seen.values()];
  }

  /** Hydrate the model from a topology. Order matches `deriveRoutes` exactly. */
  static fromTopology(topology: SiteTopology): SiteModel {
    const graph = buildGraph(topology.nodes, topology.pipes);
    const routes = deriveRoutes(graph);

    const byId = new Map(topology.nodes.map((n) => [n.id, n]));
    const lookup: NodeLookup = (id) => byId.get(id);

    const models = routes.map((route) => {
      const caps = routeCapabilities(route, lookup, routes);
      const sourceNode = byId.get(route.source);
      const endpointNode = byId.get(route.destination);
      // Both endpoints come from graph nodes, which are built from topology.nodes,
      // so they always resolve; guard defensively rather than assert.
      if (!sourceNode || !endpointNode) {
        throw new Error(`route ${route.key} references a missing node`);
      }
      return new RouteModel(route, sourceNode, new Endpoint(endpointNode), caps);
    });

    return new SiteModel(models);
  }
}
