import * as fs from 'node:fs';
import * as path from 'node:path';
import Handlebars from 'handlebars';
import { nodesByKind, nodesWithFlag, NODE_REGISTRY, legendSvgFor, LOGO_SVG_SMALL, type Manifest, type PinOverlayData } from '@far-mon/core';

const TEMPLATES_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'core', 'src', 'templates');

export interface GenerationInfo {
  version: string;
  createdAt: string;
}

export interface DocOptions {
  generation?: GenerationInfo;
  boardSvg?: string;
  pinOverlays?: PinOverlayData[];
}

// Load templates from disk and compile once
const hbs = Handlebars.create();
hbs.registerHelper('eq', function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
  return a === b ? options.fn(this) : options.inverse(this);
});

const templateSrc = fs.readFileSync(path.join(TEMPLATES_DIR, 'documentation.hbs'), 'utf-8');
const DOCUMENTATION_CSS = fs.readFileSync(path.join(TEMPLATES_DIR, 'documentation.css'), 'utf-8');
const compiledTemplate = hbs.compile(templateSrc);

export function generateDocumentation(m: Manifest, topologySvg: string, opts?: DocOptions): string {
  const tanks = nodesByKind(m.nodes, 'tank');
  const levelSensors = nodesWithFlag(m.nodes, 'isLevelSensor');
  const pumps = nodesByKind(m.nodes, 'pump');
  const flowSensors = nodesByKind(m.nodes, 'flow_sensor');
  const valves = nodesByKind(m.nodes, 'valve');
  const pressureSensors = nodesByKind(m.nodes, 'pressure_sensor');

  const usedKinds = [...new Set(m.nodes.map(n => n.kind))];
  const legendItems = usedKinds
    .map(kind => {
      const desc = NODE_REGISTRY.get(kind);
      if (!desc) return null;
      return { svg: legendSvgFor(desc), label: desc.label };
    })
    .filter(Boolean);

  const routes = m.routes.map(r => ({
    name: r.name,
    needsPump: r.needs_pump,
    sourceMin: r.source_min_pct > 0 ? `${r.source_min_pct}%` : '\u2014',
    destMax: r.dest_max_pct > 0 ? `${r.dest_max_pct}%` : '\u2014',
    runtime: r.max_runtime_seconds >= 3600
      ? `${(r.max_runtime_seconds / 3600).toFixed(1)}h`
      : `${Math.round(r.max_runtime_seconds / 60)}m`,
    runtimeLevelOk: r.runtime_level_ok,
  }));

  const automations = m.automations
    .filter(a => a.name && a.enabled)
    .map(a => ({
      name: a.name,
      trigger: a.trigger.type === 'time' ? `Daily at ${a.trigger.at}` : 'Level trigger',
      days: a.days_of_week.length === 7 ? 'Every day' : a.days_of_week.join(', '),
      routeName: a.route_name,
    }));

  const componentPills = [
    tanks.length > 0 ? { label: `${tanks.length} tank${tanks.length > 1 ? 's' : ''}` } : null,
    pumps.length > 0 ? { label: `${pumps.length} pump${pumps.length > 1 ? 's' : ''}` } : null,
    valves.length > 0 ? { label: `${valves.length} valve${valves.length > 1 ? 's' : ''}` } : null,
    flowSensors.length > 0 ? { label: `${flowSensors.length} flow sensor${flowSensors.length > 1 ? 's' : ''}` } : null,
    { label: `${m.routes.length} route${m.routes.length !== 1 ? 's' : ''}` },
  ].filter(Boolean);

  let boardPinoutSection = '';
  if (opts?.boardSvg && opts?.pinOverlays?.length) {
    const pinJson = JSON.stringify(opts.pinOverlays);
    boardPinoutSection = `
<h2>Board Pinout</h2>
<div class="diagram" style="text-align:center;">
  <div class="board-pinout" id="board-pinout">${opts.boardSvg}</div>
</div>
<script>
(function(){
  function render(){
    var c=document.getElementById('board-pinout');
    if(!c)return;
    var svg=c.querySelector('svg');
    if(!svg)return;
    var cr=c.getBoundingClientRect();
    var pins=${pinJson};
    for(var i=0;i<pins.length;i++){
      var p=pins[i];
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

  return compiledTemplate({
    css: DOCUMENTATION_CSS,
    logoSvg: LOGO_SVG_SMALL,
    logoSvgSmall: LOGO_SVG_SMALL.replace('width="36" height="36"', 'width="18" height="18"'),
    deviceName: m.device.friendly_name,
    componentPills,
    topologySvg,
    legendItems,
    boardPinoutSection,
    routes,
    automations,
    hasAutomations: automations.length > 0,
    routeEntities: m.routes.map((r, i) => ({ index: i, name: r.name })),
    tankCalEntities: levelSensors.map(t => ({ id: t['id'], name: t['name'] })),
    timing: m.timing,
    hasMultipleLevelTanks: levelSensors.length >= 2,
    hasFlowSensors: flowSensors.length > 0,
    hasValves: valves.length > 0,
    hasTanks: tanks.length > 0,
    hasPressureSensors: pressureSensors.length > 0,
    board: m.device.board,
    genDate: opts?.generation?.createdAt?.split('T')[0] ?? new Date().toISOString().split('T')[0],
    genVersion: opts?.generation?.version ?? '',
    hasVersion: !!opts?.generation?.version,
  });
}
