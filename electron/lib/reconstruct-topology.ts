import type { SiteTopology } from "@far-mon/core";
import type { TopologyEventRow } from "../db.js";

/**
 * Reconstruct a SiteTopology by replaying events from a snapshot forward.
 *
 * Algorithm:
 * 1. Find the most recent snapshot event at or before the target event.
 * 2. Parse that snapshot as the starting topology.
 * 3. Replay every non-snapshot event after the snapshot up to (and including)
 *    the target event.
 */
export function reconstructTopology(
  events: TopologyEventRow[],
  targetEventId: number,
): SiteTopology {
  // Sort ascending by id
  const sorted = [...events].sort((a, b) => a.id - b.id);

  // Find the most recent snapshot at or before target
  let snapshotIndex = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].id > targetEventId) break;
    if (sorted[i].eventType === "snapshot") {
      snapshotIndex = i;
    }
  }

  if (snapshotIndex === -1) {
    throw new Error(
      `No snapshot found before event ${targetEventId}. Cannot reconstruct.`,
    );
  }

  // Parse snapshot
  const snapshotEvent = sorted[snapshotIndex];
  const snapshotPayload = JSON.parse(snapshotEvent.payload) as {
    topology: SiteTopology;
  };
  let topology = structuredClone(snapshotPayload.topology);

  // Replay events after snapshot up to target
  for (let i = snapshotIndex + 1; i < sorted.length; i++) {
    const ev = sorted[i];
    if (ev.id > targetEventId) break;
    topology = applyEvent(topology, ev);
  }

  return topology;
}

/**
 * Apply a single event to a topology. Returns a new topology object.
 */
function applyEvent(topology: SiteTopology, event: TopologyEventRow): SiteTopology {
  let t = structuredClone(topology);
  const payload = JSON.parse(event.payload);

  switch (event.eventType) {
    case "node_added": {
      const node = payload.node as SiteTopology["nodes"][number];
      t.nodes = [...t.nodes, node];
      break;
    }
    case "node_removed": {
      const nodeId = payload.nodeId as string;
      t.nodes = t.nodes.filter((n) => n.id !== nodeId);
      // Also remove any pipes connected to this node
      t.pipes = t.pipes.filter(
        (p) => !p.from.startsWith(`${nodeId}:`) && !p.to.startsWith(`${nodeId}:`),
      );
      break;
    }
    case "node_moved": {
      const nodeId = payload.nodeId as string;
      const newPos = payload.newPos as { x: number; y: number };
      t.nodes = t.nodes.map((n) =>
        n.id === nodeId ? { ...n, position: newPos } : n,
      );
      break;
    }
    case "node_modified": {
      const nodeId = payload.nodeId as string;
      const newNode = payload.newNode as SiteTopology["nodes"][number];
      t.nodes = t.nodes.map((n) => (n.id === nodeId ? newNode : n));
      break;
    }
    case "pipe_connected": {
      const pipe = payload.pipe as PipeSegment;
      t.pipes = [...t.pipes, pipe];
      break;
    }
    case "pipe_disconnected": {
      const pipeId = payload.pipeId as string;
      t.pipes = t.pipes.filter((p) => p.id !== pipeId);
      break;
    }
    case "pipe_modified": {
      const pipeId = payload.pipeId as string;
      const newPipe = payload.newPipe as PipeSegment;
      t.pipes = t.pipes.map((p) => (p.id === pipeId ? newPipe : p));
      break;
    }
    case "timing_changed": {
      const key = payload.key as string;
      const newVal = payload.new as number;
      t.timing = { ...t.timing, [key]: newVal };
      break;
    }
    case "route_override_set": {
      const routeKey = payload.routeKey as string;
      const newVal = payload.new as Record<string, unknown>;
      t.route_overrides = { ...t.route_overrides, [routeKey]: newVal };
      break;
    }
    case "route_override_cleared": {
      const routeKey = payload.routeKey as string;
      const overrides = { ...t.route_overrides };
      delete overrides[routeKey];
      t.route_overrides = overrides;
      break;
    }
    case "automation_created":
    case "automation_modified": {
      const auto = payload.automation as SiteTopology["automations"][number];
      t.automations = [
        ...t.automations.filter((a) => a.id !== auto.id),
        auto,
      ];
      break;
    }
    case "automation_deleted": {
      const autoId = payload.automationId as string;
      t.automations = t.automations.filter((a) => a.id !== autoId);
      break;
    }
    case "controller_added": {
      const ctrl = payload.controller as SiteTopology["controllers"][number];
      t.controllers = [...t.controllers, ctrl];
      break;
    }
    case "controller_removed": {
      const ctrlId = payload.controllerId as string;
      t.controllers = t.controllers.filter((c) => c.id !== ctrlId);
      // Also remove nodes anchored to this controller
      t.nodes = t.nodes.filter((n) => (n as any).anchorId !== ctrlId);
      break;
    }
    case "controller_modified": {
      const ctrlId = payload.controllerId as string;
      const newCtrl = payload.newController as SiteTopology["controllers"][number];
      t.controllers = t.controllers.map((c) => (c.id === ctrlId ? newCtrl : c));
      break;
    }
    case "snapshot": {
      // Replace entire topology
      t = payload.topology as SiteTopology;
      break;
    }
  }

  return t;
}

// Internal type for pipe segments
type PipeSegment = SiteTopology["pipes"][number];
