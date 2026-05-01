import * as fs from 'node:fs';
import * as path from 'node:path';
import { nodesByKind, nodesWithFlag, type Manifest, type LinkData, type NetworkTransport, type Route, type PinOverlayData, LOGO_SVG_SMALL } from '@far-mon/core';
import { TEMPLATES_DIR, PARTIALS_DIR, compileFile } from '../../../packages/core/src/templates/hbs.js';

// Boundary colors — same cycle as canvas boundary-renderer
const BOUNDARY_COLORS = ['#0284C7', '#059669', '#D97706', '#DC2626', '#7C3AED', '#DB2777'];

export interface PinTableRow {
  /** Silkscreen connector label (e.g. "J3-7"), if known. */
  connector?: string;
  /** Pin reference as stored on the node (e.g. "GPIO4", "OUT1", "mux1:CH3"). */
  pin: string;
  /** User-facing entity name (e.g. "Tank 1 outlet"). */
  entity: string;
  /** Entity-kind label (e.g. "Valve"). */
  typeLabel: string;
  /** Field label (e.g. "Open Pin"). */
  fieldLabel: string;
  /** Capabilities of this pin (e.g. ["digital", "pwm"]), if known. */
  caps?: string;
  /** Relay polarity label for this pin (e.g. "Active-low"), if the entity declares one. */
  polarity?: string;
}

export interface SiteDocSystem {
  systemId: string;
  friendlyName: string;
  /** Board model id, kebab-case (matches the board directory and partial path). */
  board: string;
  /** Human-readable label for the board (e.g. "KC868-A16"). Falls back to `board` if absent. */
  boardLabel?: string;
  /**
   * Resolved network transport this controller is using. Computed once at the
   * IPC boundary from `effectiveTransport(network, boardSupportedTransports(board))`
   * — the doc generator never re-derives it.
   */
  activeTransport?: NetworkTransport;
  deviceName: string;
  manifest: Manifest;
  boardSvg?: string;
  pinOverlays?: PinOverlayData[];
  /** Tabular pin connection list — installation-facing companion to the pinout SVG. */
  pinTable?: PinTableRow[];
  /** SVG of this system's topology (rendered with per-system overlays). */
  topologySvg?: string;
}

export interface SiteDocOptions {
  genDate?: string;
}

// Template + CSS — compiled lazily, cached by hbs.ts
const DOCUMENTATION_CSS = fs.readFileSync(path.join(TEMPLATES_DIR, 'documentation.css'), 'utf-8');
const compiledSiteTemplate = compileFile(path.join(TEMPLATES_DIR, 'site-documentation.hbs'));

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

  // Per-controller detail sections
  const controllerDetails = systems.map((s, i) => {
    const tanks = nodesByKind(s.manifest.nodes, 'tank');
    const levelSensors = nodesWithFlag(s.manifest.nodes, 'isLevelSensor');

    let boardPinoutSection = '';
    if (s.boardSvg && s.pinOverlays?.length) {
      const pinJson = JSON.stringify(s.pinOverlays);
      boardPinoutSection = `
<h3>Board Pinout</h3>
<div class="diagram" style="text-align:center;">
  <div class="board-pinout" id="board-pinout-${i}">${s.boardSvg}</div>
</div>
<script>
(function(){
  function render(){
    var c=document.getElementById('board-pinout-${i}');
    if(!c)return;
    var svg=c.querySelector('svg');
    if(!svg)return;
    var cr=c.getBoundingClientRect();
    var pins=${pinJson};
    for(var j=0;j<pins.length;j++){
      var p=pins[j];
      var el=svg.querySelector('[id*="'+p.connector+'"]');
      if(!el)continue;
      var r=el.getBoundingClientRect();
      var d=document.createElement('div');
      d.className='pin-label';
      d.style.left=(r.left-cr.left+r.width/2)+'px';
      d.style.top=(r.top-cr.top+r.height/2)+'px';
      d.style.backgroundColor=p.color;
      d.title=p.tooltip;
      d.textContent=p.label;
      c.appendChild(d);
    }
  }
  if(document.readyState==='complete')requestAnimationFrame(function(){requestAnimationFrame(render)});
  else window.addEventListener('load',function(){requestAnimationFrame(function(){requestAnimationFrame(render)})});
})();
</script>`;
    }

    // Resolved transport is provided by the IPC layer (see SiteDocSystem.activeTransport).
    const activeConnection = s.activeTransport === 'wifi'
      ? `Active connection: WiFi · Fallback: ${s.friendlyName} Fallback at 192.168.4.1 (password = WiFi password).`
      : s.activeTransport === 'ethernet'
        ? 'Active connection: Ethernet · No on-device recovery if the cable drops — see Advanced for options.'
        : '';

    return {
      friendlyName: s.friendlyName,
      board: s.board,
      deviceName: s.deviceName,
      color: systemColor.get(s.systemId) ?? '#666',
      boardPinoutSection,
      pinTable: s.pinTable ?? [],
      hasPinTable: (s.pinTable?.length ?? 0) > 0,
      topologySvg: s.topologySvg ?? '',
      timing: s.manifest.timing,
      routeEntities: s.manifest.routes.map((r, ri) => ({ index: ri, name: r.name })),
      tankCalEntities: levelSensors.map(t => ({ id: t['id'], name: t['name'] })),
      activeConnection,
    };
  });

  // Device Reference: one entry per unique board model used in the site.
  // Boards without a `boards/<model>/network.hbs` partial gracefully drop out.
  const seen = new Set<string>();
  const deviceReferences = systems.flatMap(s => {
    if (seen.has(s.board)) return [];
    seen.add(s.board);
    const partial = `boards/${s.board}/network`;
    const partialPath = path.join(PARTIALS_DIR, `${partial}.hbs`);
    if (!fs.existsSync(partialPath)) return [];
    return [{
      board: s.board,
      boardLabel: s.boardLabel ?? s.board,
      partial,
    }];
  });

  // Aggregate flags for installation guidelines
  let hasFlowSensors = false, hasValves = false, hasTanks = false;
  for (const s of systems) {
    if (nodesByKind(s.manifest.nodes, 'flow_sensor').length > 0) hasFlowSensors = true;
    if (nodesByKind(s.manifest.nodes, 'valve').length > 0) hasValves = true;
    if (nodesByKind(s.manifest.nodes, 'tank').length > 0) hasTanks = true;
  }

  const singleSystem = systems.length === 1;
  const docSubtitle = singleSystem
    ? `${systems[0].friendlyName} — Documentation`
    : `${siteName} — Site Documentation`;

  return compiledSiteTemplate({
    css: DOCUMENTATION_CSS,
    logoSvg: LOGO_SVG_SMALL,
    logoSvgSmall: LOGO_SVG_SMALL.replace('width="36" height="36"', 'width="18" height="18"'),
    siteName,
    docSubtitle,
    systemCount: systems.length,
    singleSystem,
    componentPills,
    compositeTopologySvg,
    systems: systemsTable,
    hasLinks: links.length > 0,
    links: linksTable,
    routeGroups,
    hasAutomations: automationGroups.length > 0,
    automationGroups,
    controllerDetails,
    deviceReferences,
    hasDeviceReferences: deviceReferences.length > 0,
    hasFlowSensors,
    hasValves,
    hasTanks,
    genDate: opts?.genDate ?? new Date().toISOString().split('T')[0],
  });
}
