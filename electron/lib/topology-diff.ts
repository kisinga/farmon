import type { SiteTopology, TopologyNode, PipeSegment, Automation, RouteOverride, TopologyEvent } from "@far-mon/core";

// ---------------------------------------------------------------------------
// Diff engine
// ---------------------------------------------------------------------------

export function diffTopology(
  oldTopo: SiteTopology | null,
  newTopo: SiteTopology,
): TopologyEvent[] {
  const events: TopologyEvent[] = [];

  // First save — record a snapshot instead of individual events
  if (!oldTopo) {
    events.push({
      actor: "user",
      eventType: "snapshot",
      payload: { topology: newTopo },
    });
    return events;
  }

  // Site rename
  if (oldTopo.schema !== newTopo.schema) {
    // Schema version changes are migrations, not user events
  }

  // Controllers
  const oldControllers = new Map((oldTopo.controllers ?? []).map((c) => [c.id, c]));
  const newControllers = new Map((newTopo.controllers ?? []).map((c) => [c.id, c]));

  for (const ctrl of newTopo.controllers ?? []) {
    if (!oldControllers.has(ctrl.id)) {
      events.push({
        actor: "user",
        eventType: "controller_added",
        payload: { controller: ctrl },
      });
    }
  }

  for (const [id, ctrl] of oldControllers) {
    if (!newControllers.has(id)) {
      events.push({
        actor: "user",
        eventType: "controller_removed",
        payload: { controllerId: id, controllerSnapshot: ctrl },
      });
    }
  }

  // Detect controller field changes
  for (const ctrl of newTopo.controllers ?? []) {
    const oldCtrl = oldControllers.get(ctrl.id);
    if (oldCtrl && JSON.stringify(oldCtrl) !== JSON.stringify(ctrl)) {
      events.push({
        actor: "user",
        eventType: "controller_modified",
        payload: { controllerId: ctrl.id, oldController: oldCtrl, newController: ctrl },
      });
    }
  }

  // Nodes
  const oldNodes = new Map((oldTopo.nodes ?? []).map((n) => [n.id, n]));
  const newNodes = new Map((newTopo.nodes ?? []).map((n) => [n.id, n]));

  for (const node of newTopo.nodes ?? []) {
    if (!oldNodes.has(node.id)) {
      events.push({
        actor: "user",
        eventType: "node_added",
        payload: { node },
      });
    } else {
      const oldNode = oldNodes.get(node.id)!;
      if (
        oldNode.position?.x !== node.position?.x ||
        oldNode.position?.y !== node.position?.y
      ) {
        events.push({
          actor: "user",
          eventType: "node_moved",
          payload: {
            nodeId: node.id,
            oldPos: oldNode.position,
            newPos: node.position,
          },
        });
      }
      // Detect any other field changes on the node
      const oldNodeJson = JSON.stringify({ ...oldNode, position: undefined });
      const newNodeJson = JSON.stringify({ ...node, position: undefined });
      if (oldNodeJson !== newNodeJson) {
        events.push({
          actor: "user",
          eventType: "node_modified",
          payload: { nodeId: node.id, oldNode, newNode: node },
        });
      }
    }
  }

  for (const [id, node] of oldNodes) {
    if (!newNodes.has(id)) {
      events.push({
        actor: "user",
        eventType: "node_removed",
        payload: { nodeId: id, nodeSnapshot: node },
      });
    }
  }

  // Pipes
  const oldPipes = new Map((oldTopo.pipes ?? []).map((p) => [p.id, p]));
  const newPipes = new Map((newTopo.pipes ?? []).map((p) => [p.id, p]));

  for (const pipe of newTopo.pipes ?? []) {
    if (!oldPipes.has(pipe.id)) {
      events.push({
        actor: "user",
        eventType: "pipe_connected",
        payload: { pipe },
      });
    }
  }

  for (const [id, pipe] of oldPipes) {
    if (!newPipes.has(id)) {
      events.push({
        actor: "user",
        eventType: "pipe_disconnected",
        payload: { pipeId: id, pipeSnapshot: pipe },
      });
    }
  }

  // Detect pipe field changes
  for (const pipe of newTopo.pipes ?? []) {
    const oldPipe = oldPipes.get(pipe.id);
    if (oldPipe && JSON.stringify(oldPipe) !== JSON.stringify(pipe)) {
      events.push({
        actor: "user",
        eventType: "pipe_modified",
        payload: { pipeId: pipe.id, oldPipe, newPipe: pipe },
      });
    }
  }

  // Timing
  const timingKeys = new Set([
    ...Object.keys(oldTopo.timing ?? {}),
    ...Object.keys(newTopo.timing ?? {}),
  ]) as Set<string>;
  for (const key of timingKeys) {
    const oldVal = (oldTopo.timing as Record<string, number> | undefined)?.[key];
    const newVal = (newTopo.timing as Record<string, number> | undefined)?.[key];
    if (oldVal !== newVal) {
      events.push({
        actor: "user",
        eventType: "timing_changed",
        payload: { key, old: oldVal, new: newVal },
      });
    }
  }

  // Route overrides
  const oldOverrides = oldTopo.route_overrides ?? {};
  const newOverrides = newTopo.route_overrides ?? {};
  const overrideKeys = new Set([
    ...Object.keys(oldOverrides),
    ...Object.keys(newOverrides),
  ]);

  for (const key of overrideKeys) {
    const oldVal = oldOverrides[key];
    const newVal = newOverrides[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      if (newVal === undefined) {
        events.push({
          actor: "user",
          eventType: "route_override_cleared",
          payload: { routeKey: key, old: oldVal },
        });
      } else {
        events.push({
          actor: "user",
          eventType: "route_override_set",
          payload: { routeKey: key, old: oldVal, new: newVal },
        });
      }
    }
  }

  // Automations
  const oldAutos = new Map((oldTopo.automations ?? []).map((a) => [a.id, a]));
  const newAutos = new Map((newTopo.automations ?? []).map((a) => [a.id, a]));

  for (const auto of newTopo.automations ?? []) {
    if (!oldAutos.has(auto.id)) {
      events.push({
        actor: "user",
        eventType: "automation_created",
        payload: { automation: auto },
      });
    } else if (JSON.stringify(oldAutos.get(auto.id)) !== JSON.stringify(auto)) {
      events.push({
        actor: "user",
        eventType: "automation_modified",
        payload: { automation: auto },
      });
    }
  }

  for (const [id, auto] of oldAutos) {
    if (!newAutos.has(id)) {
      events.push({
        actor: "user",
        eventType: "automation_deleted",
        payload: { automationId: id, automationSnapshot: auto },
      });
    }
  }

  return events;
}
