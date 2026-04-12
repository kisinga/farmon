import * as fs from 'node:fs';
import * as path from 'node:path';
import Handlebars from 'handlebars';
import { nodesByKind, type Manifest, type LinkData, type Route, LOGO_SVG_SMALL } from '@far-mon/core';

const TEMPLATES_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'core', 'src', 'templates');

// Boundary colors — same cycle as canvas boundary-renderer
const BOUNDARY_COLORS = ['#0284C7', '#059669', '#D97706', '#DC2626', '#7C3AED', '#DB2777'];

export interface SiteDocSystem {
  systemId: string;
  friendlyName: string;
  board: string;
  deviceName: string;
  manifest: Manifest;
}

export interface SiteDocOptions {
  genDate?: string;
}

// Load and compile templates once
const hbs = Handlebars.create();
hbs.registerHelper('eq', function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
  return a === b ? options.fn(this) : options.inverse(this);
});
hbs.registerHelper('unless', Handlebars.helpers['unless']); // passthrough

const siteTemplateSrc = fs.readFileSync(path.join(TEMPLATES_DIR, 'site-documentation.hbs'), 'utf-8');
const DOCUMENTATION_CSS = fs.readFileSync(path.join(TEMPLATES_DIR, 'documentation.css'), 'utf-8');
const compiledSiteTemplate = hbs.compile(siteTemplateSrc);

export function generateSiteDocumentation(
  siteName: string,
  systems: SiteDocSystem[],
  links: LinkData[],
  compositeTopologySvg: string,
  compositeRoutes: Route[],
  opts?: SiteDocOptions,
): string {
  // System name/color maps
  const systemColor = new Map<string, string>();
  const systemFriendly = new Map<string, string>();
  systems.forEach((s, i) => {
    systemColor.set(s.systemId, BOUNDARY_COLORS[i % BOUNDARY_COLORS.length]);
    systemFriendly.set(s.systemId, s.friendlyName);
  });

  // Aggregate component counts
  let totalTanks = 0, totalPumps = 0, totalValves = 0, totalFlowSensors = 0;
  for (const s of systems) {
    totalTanks += nodesByKind(s.manifest.nodes, 'tank').length;
    totalPumps += nodesByKind(s.manifest.nodes, 'pump').length;
    totalValves += nodesByKind(s.manifest.nodes, 'valve').length;
    totalFlowSensors += nodesByKind(s.manifest.nodes, 'flow_sensor').length;
  }

  const componentPills = [
    totalTanks > 0 ? { label: `${totalTanks} tank${totalTanks > 1 ? 's' : ''}` } : null,
    totalPumps > 0 ? { label: `${totalPumps} pump${totalPumps > 1 ? 's' : ''}` } : null,
    totalValves > 0 ? { label: `${totalValves} valve${totalValves > 1 ? 's' : ''}` } : null,
    totalFlowSensors > 0 ? { label: `${totalFlowSensors} flow sensor${totalFlowSensors > 1 ? 's' : ''}` } : null,
    { label: `${compositeRoutes.length} route${compositeRoutes.length !== 1 ? 's' : ''}` },
  ].filter(Boolean);

  // Systems overview table data
  const systemsTable = systems.map(s => ({
    friendlyName: s.friendlyName,
    board: s.board,
    deviceName: s.deviceName,
    tankCount: nodesByKind(s.manifest.nodes, 'tank').length,
    pumpCount: nodesByKind(s.manifest.nodes, 'pump').length,
    valveCount: nodesByKind(s.manifest.nodes, 'valve').length,
    routeCount: s.manifest.routes.length,
  }));

  // Links table data
  const linksTable = links.map(l => ({
    fromSystemName: systemFriendly.get(l.fromSystem) ?? l.fromSystem,
    fromNode: l.fromNode,
    toSystemName: systemFriendly.get(l.toSystem) ?? l.toSystem,
    toNode: l.toNode,
  }));

  // Routes grouped by source system
  const routesBySystem = new Map<string, Array<{
    name: string; needsPump: boolean; sourceMin: string; destMax: string;
    runtime: string; crossSystem: boolean;
  }>>();

  for (const route of compositeRoutes) {
    if (!route.valid) continue;
    const srcSystem = route.source.split('/')[0];
    const destSystem = route.destination.split('/')[0];
    const srcNode = route.source.split('/').slice(1).join('/');
    const destNode = route.destination.split('/').slice(1).join('/');

    const entry = {
      name: `${srcNode} > ${destNode}`,
      needsPump: route.crossesPump,
      sourceMin: '\u2014',
      destMax: '\u2014',
      runtime: '30m',
      crossSystem: srcSystem !== destSystem,
    };

    const arr = routesBySystem.get(srcSystem) ?? [];
    arr.push(entry);
    routesBySystem.set(srcSystem, arr);
  }

  const routeGroups = systems
    .filter(s => routesBySystem.has(s.systemId))
    .map(s => ({
      friendlyName: s.friendlyName,
      color: systemColor.get(s.systemId) ?? '#666',
      routes: routesBySystem.get(s.systemId)!,
      singleRoute: routesBySystem.get(s.systemId)!.length === 1,
    }));

  // Automations grouped by system
  const automationGroups = systems
    .filter(s => s.manifest.automations.some(a => a.name && a.enabled))
    .map(s => ({
      friendlyName: s.friendlyName,
      color: systemColor.get(s.systemId) ?? '#666',
      automations: s.manifest.automations
        .filter(a => a.name && a.enabled)
        .map(a => ({
          name: a.name,
          trigger: a.trigger.type === 'time' ? `Daily at ${a.trigger.at}` : 'Level trigger',
          days: a.days_of_week.length === 7 ? 'Every day' : a.days_of_week.join(', '),
          routeName: a.route_name,
        })),
    }));

  return compiledSiteTemplate({
    css: DOCUMENTATION_CSS,
    logoSvg: LOGO_SVG_SMALL,
    logoSvgSmall: LOGO_SVG_SMALL.replace('width="36" height="36"', 'width="18" height="18"'),
    siteName,
    systemCount: systems.length,
    singleSystem: systems.length === 1,
    componentPills,
    compositeTopologySvg,
    systems: systemsTable,
    hasLinks: links.length > 0,
    links: linksTable,
    routeGroups,
    hasAutomations: automationGroups.length > 0,
    automationGroups,
    genDate: opts?.genDate ?? new Date().toISOString().split('T')[0],
  });
}
