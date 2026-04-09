/**
 * Flow constraint types — declared on entity descriptors,
 * evaluated per-route by the constraint evaluator.
 */

/** A required entity kind must exist upstream/downstream of the declaring entity. */
export interface PresenceConstraint {
  type: 'presence';
  id: string;
  description: string;
  requiredKind: string;
  position: 'upstream' | 'downstream' | 'anywhere';
  baseSeverity: 'error' | 'warning';
}

/** On a route segment relative to the declaring entity, kindA must appear before kindB. */
export interface OrderingConstraint {
  type: 'ordering';
  id: string;
  description: string;
  segment: 'upstream' | 'downstream';
  firstKind: string;
  secondKind: string;
  baseSeverity: 'error' | 'warning';
}

export type FlowConstraint = PresenceConstraint | OrderingConstraint;
