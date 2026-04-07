import type { DerivedRoute } from './derive-routes';

export type Selection =
  | { kind: 'node'; nodeId: string }
  | { kind: 'pipe'; pipeId: string }
  | { kind: 'route'; route: DerivedRoute; sharedNodeIds?: string[] };
