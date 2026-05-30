import * as fs from 'node:fs';
import * as path from 'node:path';
import { nodesByKind, nodesWithFlag, allNodes, type Manifest, type NetworkTransport, type Route, type PinOverlayData, LOGO_SVG_SMALL } from '@far-mon/core';
import { TEMPLATES_DIR, PARTIALS_DIR, compileFile } from '../../../packages/core/src/templates/hbs.js';

// Boundary colors — same cycle as canvas boundary-renderer
const BOUNDARY_COLORS = ['#0284C7', '#059669', '#D97706', '#DC2626', '#7C3AED', '#DB2777'];

/**
 * Stable display order for board concerns in the Advanced section. Files
 * present in `partials/boards/<model>/` but absent from this list still
 * appear, alphabetically after the listed entries. Order is install-time
 * priority: how to reach it → how to power it → how it's wired → limits.
 */
const CONCERN_ORDER: string[] = [
  'network',
  'power',
  'pin-architecture',
  'peripherals',
  'capacity',
  'adc-range',
  'digital-inputs',
  'self-test',
];

const CONCERN_LABELS: Record<string, string> = {
  'network':           'Network & Recovery',
  'power':             'Power Requirements',
  'pin-architecture':  'Pin Architecture',
  'peripherals':       'On-Board Peripherals',
  'capacity':          'Maximum Capacity',
  'adc-range':         'ADC Voltage Range',
  'digital-inputs':    'Digital Inputs',
  'self-test':         'Bench Self-Test',
};

function concernLabel(concern: string): string {
  return CONCERN_LABELS[concern] ?? concern.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

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
  /**
   * Per-device WiFi creds embedded in this controller's recovery doc so
   * field installers see the literal SoftAP credentials for THIS device
   * (the SoftAP password reuses wifi_password — see networking.ts).
   * Only set for wifi-transport devices; ethernet has no AP fallback.
   */
  wifiSsid?: string;
  wifiPassword?: string;
  /** Static IP if `manual_ip` is configured for this device. */
  staticIp?: string;
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
    const allSiteNodes = allNodes(s.manifest);
    totalTanks += nodesByKind(allSiteNodes, 'tank').length;
    totalPumps += nodesByKind(allSiteNodes, 'pump').length;
    totalValves += nodesByKind(allSiteNodes, 'valve').length;
    totalFlowSensors += nodesByKind(allSiteNodes, 'flow_sensor').length;
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
    tankCount: nodesByKind(allNodes(s.manifest), 'tank').length,
    pumpCount: nodesByKind(allNodes(s.manifest), 'pump').length,
    valveCount: nodesByKind(allNodes(s.manifest), 'valve').length,
    routeCount: s.manifest.routes.length,
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
    const tanks = nodesByKind(allNodes(s.manifest), 'tank');
    const levelSensors = nodesWithFlag(allNodes(s.manifest), 'isLevelSensor');

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

    // Anchors used by the per-controller cross-references into Device Reference.
    const boardSlug = s.board.replace(/_/g, '-');
    const boardAnchor = `device-${boardSlug}`;
    const networkAnchor = `${boardAnchor}-network`;
    const pinAnchor = `${boardAnchor}-pin-architecture`;

    // Resolved transport is provided by the IPC layer (see SiteDocSystem.activeTransport).
    // Wifi devices get the literal AP creds + static-IP (if any) inline, so a
    // field installer reading the printed doc has every recovery fact for THIS
    // device without cross-referencing secrets.yaml.
    // Per-device "Active connection" line. The dashboard only serves at
    // the STA / ethernet IP — never at 192.168.4.1 (esphome/issues#4333).
    // The fallback AP is documented as a credential-recovery hatch, not
    // a control surface, so we surface its SSID + password but do not
    // imply the dashboard lives there.
    let activeConnection = '';
    if (s.activeTransport === 'wifi') {
      const apSsid = `${s.friendlyName} Fallback`;
      const ipPart = s.staticIp
        ? `static IP \`${s.staticIp}\` (dashboard at \`http://${s.staticIp}/\`)`
        : 'DHCP (dashboard at the IP your router assigns)';
      const parts = [
        `Active connection: WiFi (SSID \`${s.wifiSsid ?? '—'}\`)`,
        ipPart,
        `Recovery: pair with this device at [improv-wifi.com](https://www.improv-wifi.com/) (BLE or USB) to rotate credentials, or join the fallback AP \`${apSsid}\` (password = WiFi password \`${s.wifiPassword ?? '—'}\`) and use the OS captive-portal popup.`,
      ];
      activeConnection = parts.join(' · ');
    } else if (s.activeTransport === 'ethernet') {
      const ipPart = s.staticIp
        ? `static IP \`${s.staticIp}\` (dashboard at \`http://${s.staticIp}/\`)`
        : 'DHCP (dashboard at the IP your router assigns)';
      activeConnection = `Active connection: Ethernet · ${ipPart} · No on-device recovery if the cable drops — replug or direct-connect to a laptop.`;
    }

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
      // Per-route inline pressure sensors on the path. Resolved from
      // manifest's `inline_pressure_sensors` IDs to human-readable names.
      // Empty rows are filtered so the doc only shows routes that actually
      // touch a sensor — keeps the section cheap when no sensors are inline.
      routePathSensors: s.manifest.routes
        .map(r => ({
          name: r.name,
          sensors: (r.inline_pressure_sensors ?? [])
            .map(id => {
              const node = allNodes(s.manifest).find(n => n.id === id);
              return node ? String(node.name ?? id) : id;
            })
            .join(', '),
        }))
        .filter(e => e.sensors.length > 0),
      hasRoutePathSensors: s.manifest.routes.some(r => (r.inline_pressure_sensors ?? []).length > 0),
      tankCalEntities: levelSensors.map(t => ({ id: t['id'], name: t['name'] })),
      activeConnection,
      networkAnchor,
      pinAnchor,
    };
  });

  // Device Reference chapter: per-board grouped reference content.
  // For each unique board model used in the site, list every
  // `partials/boards/<model>/<concern>.hbs` as a sub-section. Boards without
  // a partials directory silently drop out.
  //
  // Dedup is keyed on the normalized kebab-case slug — three controllers
  // using the same physical board produce ONE per-board section, even if
  // their stored board ids mix casing (`kc868_a16` vs `kc868-a16`).
  const seenSlugs = new Set<string>();
  const deviceReference = systems.flatMap(s => {
    const slug = s.board.replace(/_/g, '-');
    if (seenSlugs.has(slug)) return [];
    seenSlugs.add(slug);
    const dir = path.join(PARTIALS_DIR, 'boards', slug);
    if (!fs.existsSync(dir)) return [];
    const concerns = fs.readdirSync(dir)
      .filter(name => name.endsWith('.hbs'))
      .map(name => name.replace(/\.hbs$/, ''))
      .sort((a, b) => CONCERN_ORDER.indexOf(a) - CONCERN_ORDER.indexOf(b));
    return [{
      boardSlug: slug,
      boardLabel: s.boardLabel ?? slug,
      anchor: `device-${slug}`,
      concerns: concerns.map(concern => ({
        concern,
        concernLabel: concernLabel(concern),
        partial: `boards/${slug}/${concern}`,
        anchor: `device-${slug}-${concern}`,
      })),
    }];
  });

  // Aggregate flags for installation guidelines
  let hasFlowSensors = false, hasValves = false, hasTanks = false;
  for (const s of systems) {
    if (nodesByKind(allNodes(s.manifest), 'flow_sensor').length > 0) hasFlowSensors = true;
    if (nodesByKind(allNodes(s.manifest), 'valve').length > 0) hasValves = true;
    if (nodesByKind(allNodes(s.manifest), 'tank').length > 0) hasTanks = true;
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
    routeGroups,
    hasAutomations: automationGroups.length > 0,
    automationGroups,
    controllerDetails,
    deviceReference,
    hasDeviceReference: deviceReference.length > 0,
    hasFlowSensors,
    hasValves,
    hasTanks,
    genDate: opts?.genDate ?? new Date().toISOString().split('T')[0],
  });
}
