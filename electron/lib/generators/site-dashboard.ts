import { stringify } from "yaml";
import type { Manifest } from "../schema.js";
import { slug } from "../schema.js";
import type { BoardDef } from '@far-mon/core';
import {
  buildStatusSection,
  buildWaterSection,
  buildRouteControlSection,
  buildConfigurationView,
  buildManualView,
  type HaView,
} from "./dashboard.js";

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
 * One controller emits three tabs (detail, configuration, manual). With N
 * controllers the dashboard has 3N tabs. The detail tab already surfaces
 * status, device health, water levels, flow, and Stop-All; Configuration
 * carries calibration — so no separate site-overview tab is needed.
 */
export function generateSiteDashboard(
  siteName: string,
  systems: SiteDashboardSystem[],
): string {
  const views: HaView[] = [];

  for (const s of systems) {
    const routeControl = buildRouteControlSection(s.manifest);

    views.push({
      title: s.friendlyName,
      icon: "mdi:water-pump",
      type: "sections",
      subview: false,
      sections: [
        buildStatusSection(s.manifest, s.board),
        buildWaterSection(s.manifest),
        ...routeControl.sections,
      ],
      badges: [],
      cards: [],
    });

    views.push({
      ...buildConfigurationView(s.manifest),
      title: `${s.friendlyName} Configuration`,
      path: `configuration-${slug(s.systemId)}`,
    });

    views.push({
      ...buildManualView(s.manifest),
      title: `${s.friendlyName} Manual`,
      path: `manual-${slug(s.systemId)}`,
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
