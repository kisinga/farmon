/**
 * Reconstruct a SiteTopology by replaying events from a snapshot forward.
 *
 * Algorithm:
 * 1. Find the most recent snapshot event at or before the target event.
 * 2. Use that snapshot as the starting topology.
 * 3. Replay every non-snapshot event after the snapshot up to (and including)
 *    the target event.
 */

import type { SiteTopology, TopologyEvent } from "@far-mon/core";

export type TopologyEventRecord = TopologyEvent & {
  id: number;
  siteId: string;
  timestamp: string;
};

export function reconstructTopology(
  events: TopologyEventRecord[],
  targetEventId: number,
): SiteTopology {
  // Sort ascending by id
  const sorted = [...events].sort((a, b) => a.id - b.id);

  // Find the most recent snapshot at or before target that carries a topology
  let snapshotIndex = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].id > targetEventId) break;
    if (sorted[i].eventType === "snapshot" && (sorted[i].payload as { topology?: SiteTopology }).topology) {
      snapshotIndex = i;
    }
  }

  let topology: SiteTopology;
  if (snapshotIndex === -1) {
    // No valid snapshot found — start from empty topology
    topology = {
      schema: 16,
      controllers: [],
      nodes: [],
      pipes: [],
      route_overrides: {},
      timing: {
        valve_travel_time: 15,
        flow_watchdog: 30,
        flow_confirm: 10,
        flow_threshold: 0.5,
        api_watchdog: 60,
        update_interval: 30,
      },
      automations: [],
      remoteImports: [],
    };
  } else {
    const snapshotPayload = sorted[snapshotIndex].payload as { topology: SiteTopology };
    topology = structuredClone(snapshotPayload.topology);
  }

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
function applyEvent(topology: SiteTopology, event: TopologyEvent): SiteTopology {
  let t = structuredClone(topology);

  switch (event.eventType) {
    case "node_added": {
      t.nodes = [...t.nodes, event.payload.node];
      break;
    }
    case "node_removed": {
      const { nodeId } = event.payload;
      t.nodes = t.nodes.filter((n) => n.id !== nodeId);
      // Also remove any pipes connected to this node
      t.pipes = t.pipes.filter(
        (pipe) => !pipe.from.startsWith(`${nodeId}:`) && !pipe.to.startsWith(`${nodeId}:`),
      );
      break;
    }
    case "node_moved": {
      const { nodeId, newPos } = event.payload;
      if (newPos) {
        t.nodes = t.nodes.map((n) =>
          n.id === nodeId ? { ...n, position: newPos } : n,
        );
      }
      break;
    }
    case "node_modified": {
      const { nodeId, newNode } = event.payload;
      t.nodes = t.nodes.map((n) => (n.id === nodeId ? newNode : n));
      break;
    }
    case "pipe_connected": {
      t.pipes = [...t.pipes, event.payload.pipe];
      break;
    }
    case "pipe_disconnected": {
      t.pipes = t.pipes.filter((pipe) => pipe.id !== event.payload.pipeId);
      break;
    }
    case "pipe_modified": {
      const { pipeId, newPipe } = event.payload;
      t.pipes = t.pipes.map((pipe) => (pipe.id === pipeId ? newPipe : pipe));
      break;
    }
    case "timing_changed": {
      const { key, new: newVal } = event.payload;
      t.timing = { ...t.timing, [key]: newVal };
      break;
    }
    case "route_override_set": {
      const { routeKey, new: newVal } = event.payload;
      t.route_overrides = { ...t.route_overrides, [routeKey]: newVal };
      break;
    }
    case "route_override_cleared": {
      const { routeKey } = event.payload;
      const overrides = { ...t.route_overrides };
      delete overrides[routeKey];
      t.route_overrides = overrides;
      break;
    }
    case "automation_created":
    case "automation_modified": {
      const auto = event.payload.automation;
      t.automations = [
        ...t.automations.filter((a) => a.id !== auto.id),
        auto,
      ];
      break;
    }
    case "automation_deleted": {
      t.automations = t.automations.filter((a) => a.id !== event.payload.automationId);
      break;
    }
    case "controller_added": {
      t.controllers = [...t.controllers, event.payload.controller];
      break;
    }
    case "controller_removed": {
      const ctrlId = event.payload.controllerId;
      t.controllers = t.controllers.filter((c) => c.id !== ctrlId);
      // Also remove nodes anchored to this controller
      t.nodes = t.nodes.filter((n) => n.anchorId !== ctrlId);
      break;
    }
    case "controller_modified": {
      const { controllerId, newController } = event.payload;
      t.controllers = t.controllers.map((c) => (c.id === controllerId ? newController : c));
      break;
    }
    case "remote_import_added": {
      const { controllerId, nodeId } = event.payload;
      t.remoteImports = [...(t.remoteImports ?? []), { controllerId, nodeId }];
      break;
    }
    case "remote_import_removed": {
      const { controllerId, nodeId } = event.payload;
      t.remoteImports = (t.remoteImports ?? []).filter(
        (ri) => !(ri.controllerId === controllerId && ri.nodeId === nodeId),
      );
      break;
    }
    case "snapshot": {
      // Replace entire topology (skip old marker snapshots without topology)
      const payload = event.payload as { topology?: SiteTopology };
      if (payload.topology) {
        t = payload.topology;
      }
      break;
    }
  }

  return t;
}
