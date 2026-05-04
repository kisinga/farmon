import { stringify } from "yaml";
import type { Manifest, ManifestNode } from "../schema.js";
import { nodesByKind, nodesWithFlag, slug, esphomeServicePrefix } from "../schema.js";
import { NODE_REGISTRY, systemHaEntityIds, networkHaEntityIds, type BoardDef } from '@far-mon/core';
import {
  buildStatusSection,
  buildWaterSection,
  buildRouteControlSection,
  buildConfigurationView,
  buildManualView,
} from "./dashboard.js";

function n(node: ManifestNode, key: string): string {
  return String(node[key] ?? '');
}

function haIds(node: ManifestNode, device: { friendly_name: string }): Record<string, string | undefined> {
  return NODE_REGISTRY.get(node.kind)?.codegen?.haEntityIds?.(node, device) ?? {};
}

export interface SiteDashboardSystem {
  systemId: string;
  friendlyName: string;
  manifest: Manifest;
  /** Board definition — used to gate wifi/battery dashboard references. */
  board: BoardDef;
}

/**
 * Generate a single merged HA dashboard for the entire site.
 *
 * Tab 1: "Overview" — controller states, all tank levels, all flow sensors,
 *         quick-action stop-all per controller, device health.
 * Tab 2+: One tab per controller with full detail (status, water, routes,
 *          hardware, settings) using the composable section builders.
 */
export function generateSiteDashboard(
  siteName: string,
  systems: SiteDashboardSystem[],
): string {
  const views: unknown[] = [];

  // -----------------------------------------------------------------------
  // Tab 1: Site Overview
  // -----------------------------------------------------------------------
  const overviewSections: unknown[] = [];

  // Controllers glance — state + active routes per system
  const statusEntities: Array<{ entity: string; name: string }> = [];
  for (const s of systems) {
    const sys = systemHaEntityIds(s.manifest.device, s.manifest.routes);
    statusEntities.push(
      { entity: sys.systemState, name: s.friendlyName },
      { entity: sys.activeRoutes, name: `${s.friendlyName} Routes` },
    );
  }
  overviewSections.push({
    type: "grid",
    cards: [{
      type: "entities", title: "Controllers", entities: statusEntities,
      state_color: true, show_header_toggle: false, grid_options: { columns: "full" },
    }],
    column_span: 1,
  });

  // All tank levels across site
  const tankGauges: unknown[] = [];
  for (const s of systems) {
    const ls = nodesWithFlag(s.manifest.nodes, 'isLevelSensor');
    for (const t of ls) {
      tankGauges.push({
        type: "gauge",
        entity: haIds(t, s.manifest.device).level!,
        name: systems.length > 1 ? `${n(t, 'name')} (${s.friendlyName})` : n(t, 'name'),
        min: 0, max: 100, severity: { red: 0, yellow: 25, green: 50 }, needle: true,
      });
    }
  }
  if (tankGauges.length > 0) {
    overviewSections.push({
      type: "grid",
      cards: [
        { type: "heading", heading: "Water Levels", heading_style: "title" },
        { type: "horizontal-stack", cards: tankGauges, grid_options: { columns: "full", rows: "auto" } },
      ],
      column_span: 1,
    });
  }

  // Flow sensors glance
  const flowEntities: Array<{ entity: string; name: string }> = [];
  for (const s of systems) {
    for (const f of nodesByKind(s.manifest.nodes, 'flow_sensor')) {
      const label = n(f, 'name').replace(" Water Flow", "").replace(" Flow", "");
      flowEntities.push({
        entity: haIds(f, s.manifest.device).flow!,
        name: systems.length > 1 ? `${label} (${s.friendlyName})` : label,
      });
    }
  }
  if (flowEntities.length > 0) {
    overviewSections.push({
      type: "grid",
      cards: [{
        type: "glance", title: "Flow Sensors", show_state: true,
        entities: flowEntities, grid_options: { columns: "full" },
      }],
      column_span: 1,
    });
  }

  // Quick actions — stop-all per controller
  const actionCards: unknown[] = [];
  for (const s of systems) {
    const servicePrefix = esphomeServicePrefix(s.manifest.device);
    actionCards.push({
      show_name: true, show_icon: true, type: "button",
      name: `Stop All — ${s.friendlyName}`, icon: "mdi:stop-circle",
      tap_action: { action: "call-service", service: `esphome.${servicePrefix}_stop_all` },
      show_state: false, color: "red",
    });
  }
  if (actionCards.length > 0) {
    overviewSections.push({
      type: "grid",
      cards: [
        { type: "heading", heading: "Quick Actions", heading_style: "title" },
        { type: "horizontal-stack", cards: actionCards, grid_options: { columns: "full" } },
      ],
      column_span: 1,
    });
  }

  // Device health
  const healthEntities: Array<{ entity: string; name: string }> = [];
  for (const s of systems) {
    const sys = systemHaEntityIds(s.manifest.device, s.manifest.routes);
    const net = networkHaEntityIds(s.manifest.device, s.manifest.device.network, s.board);
    if (net) healthEntities.push({ entity: net.wifiSignal, name: `${s.friendlyName} WiFi` });
    healthEntities.push({ entity: sys.uptime, name: `${s.friendlyName} Uptime` });
  }
  overviewSections.push({
    type: "grid",
    cards: [{
      type: "glance", title: "Device Health", show_state: true,
      entities: healthEntities, grid_options: { columns: "full" },
    }],
    column_span: 1,
  });

  views.push({
    title: "Overview",
    icon: "mdi:home-flood",
    type: "sections",
    subview: false,
    sections: overviewSections,
    badges: [],
    cards: [],
  });

  // -----------------------------------------------------------------------
  // Tab 2+: Per-controller detail tabs
  // -----------------------------------------------------------------------
  for (const s of systems) {
    const routeControl = buildRouteControlSection(s.manifest) as { sections: unknown[] };

    views.push({
      title: s.friendlyName,
      icon: "mdi:water-pump",
      type: "sections",
      subview: false,
      sections: [
        buildStatusSection(s.manifest),
        buildWaterSection(s.manifest),
        ...routeControl.sections,
      ],
      badges: [],
      cards: [],
    });

    // Configuration as a subview for this controller
    views.push({
      ...(buildConfigurationView(s.manifest, s.board) as Record<string, unknown>),
      title: `${s.friendlyName} Configuration`,
      path: `configuration-${slug(s.systemId)}`,
      subview: true,
    });

    // Manual control as a subview for this controller
    views.push({
      ...(buildManualView(s.manifest) as Record<string, unknown>),
      title: `${s.friendlyName} Manual`,
      path: `manual-${slug(s.systemId)}`,
      subview: true,
    });
  }

  const dashboard = { title: siteName, views };

  return stringify(dashboard, {
    indent: 2,
    lineWidth: 0,
    defaultStringType: "PLAIN",
    defaultKeyType: "PLAIN",
  });
}
