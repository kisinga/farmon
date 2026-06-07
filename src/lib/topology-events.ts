/**
 * Typed event schemas for the topology event log.
 *
 * Every event payload is validated with Zod on read from the DB.
 * Composed from existing topology schemas — no new validation logic.
 */

import { z } from 'zod';
import {
  TopologySchema,
  TopologyNodeSchema,
  ControllerSchema,
  PipeSegmentSchema,
  RouteOverrideSchema,
  RemoteImportSchema,
  migrateTopology,
} from './topology-schema';
import { AutomationSchema, PositionSchema } from './schemas';

// ---------------------------------------------------------------------------
// Event type literals
// ---------------------------------------------------------------------------

export type TopologyEventType =
  | 'snapshot'
  | 'node_added'
  | 'node_removed'
  | 'node_moved'
  | 'node_modified'
  | 'pipe_connected'
  | 'pipe_disconnected'
  | 'pipe_modified'
  | 'timing_changed'
  | 'route_override_set'
  | 'route_override_cleared'
  | 'automation_created'
  | 'automation_deleted'
  | 'automation_modified'
  | 'controller_added'
  | 'controller_removed'
  | 'controller_modified'
  | 'remote_import_added'
  | 'remote_import_removed'
  | 'site_renamed';

// ---------------------------------------------------------------------------
// Payload schemas — one per event type
// ---------------------------------------------------------------------------

/**
 * Permissive node schema for event parsing.
 *
 * Old events may reference removed node kinds (e.g. `level_sensor`,
 * `pressure_sensor`) or fields that no longer exist. We accept any object
 * with `kind` and `id` here; the topology is migrated to the current schema
 * after event replay, which rewrites / removes legacy nodes.
 */
const EventTopologyNodeSchema = z.record(z.unknown()).and(z.object({
  kind: z.string(),
  id: z.string(),
}));

const SnapshotPayloadSchema = z.object({
  topology: TopologySchema.optional(), // optional for backward compat with old marker snapshots
  source: z.string().optional(), // e.g. 'site-import'
});

const NodeAddedPayloadSchema = z.object({
  node: EventTopologyNodeSchema,
});

const NodeRemovedPayloadSchema = z.object({
  nodeId: z.string().min(1),
  nodeSnapshot: EventTopologyNodeSchema.optional(),
});

const NodeMovedPayloadSchema = z.object({
  nodeId: z.string().min(1),
  oldPos: PositionSchema.optional(),
  newPos: PositionSchema.optional(),
});

const NodeModifiedPayloadSchema = z.object({
  nodeId: z.string().min(1),
  oldNode: EventTopologyNodeSchema,
  newNode: EventTopologyNodeSchema,
});

const PipeConnectedPayloadSchema = z.object({
  pipe: PipeSegmentSchema,
});

const PipeDisconnectedPayloadSchema = z.object({
  pipeId: z.string().min(1),
  pipeSnapshot: PipeSegmentSchema.optional(),
});

const PipeModifiedPayloadSchema = z.object({
  pipeId: z.string().min(1),
  oldPipe: PipeSegmentSchema,
  newPipe: PipeSegmentSchema,
});

const TimingChangedPayloadSchema = z.object({
  key: z.string().min(1),
  old: z.number().optional(),
  new: z.number().optional(),
});

const RouteOverrideSetPayloadSchema = z.object({
  routeKey: z.string().min(1),
  old: RouteOverrideSchema.optional(),
  new: RouteOverrideSchema,
});

const RouteOverrideClearedPayloadSchema = z.object({
  routeKey: z.string().min(1),
  old: RouteOverrideSchema.optional(),
});

const AutomationCreatedPayloadSchema = z.object({
  automation: AutomationSchema,
});

const AutomationModifiedPayloadSchema = z.object({
  automation: AutomationSchema,
});

const AutomationDeletedPayloadSchema = z.object({
  automationId: z.string().min(1),
  automationSnapshot: AutomationSchema.optional(),
});

const ControllerAddedPayloadSchema = z.object({
  controller: ControllerSchema,
});

const ControllerRemovedPayloadSchema = z.object({
  controllerId: z.string().min(1),
  controllerSnapshot: ControllerSchema.optional(),
});

const ControllerModifiedPayloadSchema = z.object({
  controllerId: z.string().min(1),
  oldController: ControllerSchema,
  newController: ControllerSchema,
});

const RemoteImportAddedPayloadSchema = z.object({
  controllerId: z.string().min(1),
  nodeId: z.string().min(1),
});

const RemoteImportRemovedPayloadSchema = z.object({
  controllerId: z.string().min(1),
  nodeId: z.string().min(1),
});

const SiteRenamedPayloadSchema = z.object({
  oldName: z.string(),
  newName: z.string(),
});

// ---------------------------------------------------------------------------
// Discriminated union — validates the full event shape
// ---------------------------------------------------------------------------

const BaseTopologyEventSchema = z.discriminatedUnion('eventType', [
  z.object({ eventType: z.literal('snapshot'), payload: SnapshotPayloadSchema }),
  z.object({ eventType: z.literal('node_added'), payload: NodeAddedPayloadSchema }),
  z.object({ eventType: z.literal('node_removed'), payload: NodeRemovedPayloadSchema }),
  z.object({ eventType: z.literal('node_moved'), payload: NodeMovedPayloadSchema }),
  z.object({ eventType: z.literal('node_modified'), payload: NodeModifiedPayloadSchema }),
  z.object({ eventType: z.literal('pipe_connected'), payload: PipeConnectedPayloadSchema }),
  z.object({ eventType: z.literal('pipe_disconnected'), payload: PipeDisconnectedPayloadSchema }),
  z.object({ eventType: z.literal('pipe_modified'), payload: PipeModifiedPayloadSchema }),
  z.object({ eventType: z.literal('timing_changed'), payload: TimingChangedPayloadSchema }),
  z.object({ eventType: z.literal('route_override_set'), payload: RouteOverrideSetPayloadSchema }),
  z.object({ eventType: z.literal('route_override_cleared'), payload: RouteOverrideClearedPayloadSchema }),
  z.object({ eventType: z.literal('automation_created'), payload: AutomationCreatedPayloadSchema }),
  z.object({ eventType: z.literal('automation_modified'), payload: AutomationModifiedPayloadSchema }),
  z.object({ eventType: z.literal('automation_deleted'), payload: AutomationDeletedPayloadSchema }),
  z.object({ eventType: z.literal('controller_added'), payload: ControllerAddedPayloadSchema }),
  z.object({ eventType: z.literal('controller_removed'), payload: ControllerRemovedPayloadSchema }),
  z.object({ eventType: z.literal('controller_modified'), payload: ControllerModifiedPayloadSchema }),
  z.object({ eventType: z.literal('remote_import_added'), payload: RemoteImportAddedPayloadSchema }),
  z.object({ eventType: z.literal('remote_import_removed'), payload: RemoteImportRemovedPayloadSchema }),
  z.object({ eventType: z.literal('site_renamed'), payload: SiteRenamedPayloadSchema }),
]);

export const TopologyEventSchema = BaseTopologyEventSchema.and(z.object({
  actor: z.string().default('user'),
}));

export type TopologyEvent = z.infer<typeof TopologyEventSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Validate a raw parsed event (e.g. from JSON.parse).
 *
 * Snapshot topologies are pre-migrated so old schema versions and removed
 * node kinds don't fail validation. Individual node events use a permissive
 * node schema for the same reason.
 */
export function parseTopologyEvent(raw: unknown): TopologyEvent {
  let data = raw;
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const payload = r['payload'] as Record<string, unknown> | undefined;
    if (r['eventType'] === 'snapshot' && payload && payload['topology']) {
      data = {
        ...r,
        payload: {
          ...payload,
          topology: migrateTopology(payload['topology']),
        },
      };
    }
  }
  return TopologyEventSchema.parse(data);
}

/** Coerce a TopologyDiffEvent (legacy shape) into a TopologyEvent. */
export function coerceTopologyEvent(ev: { eventType: string; payload: unknown }): TopologyEvent {
  return parseTopologyEvent(ev);
}
