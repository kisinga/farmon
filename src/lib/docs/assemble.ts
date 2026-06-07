/**
 * Per-site documentation assembler.
 *
 * Composes one self-contained HTML document from:
 *   - computed site facts (counts, controllers, routes, per-controller pin tables)
 *   - cached topology diagrams (rendered once at commit by the same X6 engine as
 *     the editor — injected here as strings, so no renderer runs at view time)
 *   - board reference docs (carried in each board's `def.documentation`)
 *   - node-type + narrative docs (the `docs` collection)
 *
 * Every authored body is markdown with `{{slot}}` placeholders, filled with live
 * values from the same `@core` data the firmware ships ({@link renderDoc}). The
 * assembler authors no prose itself — it only lays out and fills.
 */
import type { SiteTopology, TopologyNode } from '../topology.types';
import { getNodesByKind } from '../topology.types';
import type { BoardDef } from '../board.types';
import { buildGraph } from '../graph/topology-graph';
import { deriveRoutes } from '../graph/routes';
import { collectPins } from '../pin-collect';
import { escXml } from '../schemas';
import { LOGO_SVG_SMALL } from '../static/logo';
import { siteVars, boardVars, nodeVars, type SiteVarCtx } from './vars';
import { renderDoc } from './render';
import { DOC_CSS } from './styles';

/** A `docs`-collection row, narrowed to what the assembler needs. */
export interface DocRecord {
  /** The single key. For category==='node' it IS the node kind (e.g. 'valve'). */
  slug: string;
  title: string;
  category: 'narrative' | 'node' | 'wiring' | 'glossary';
  order: number;
  body: string;
}

export interface SiteDocInput {
  siteName: string;
  topo: SiteTopology;
  /** Cached SVGs: topology (composite + per controllerId) and per-controller board pinouts. Empty strings are fine. */
  diagrams: { composite: string; controllers: Record<string, string>; boardPinouts?: Record<string, string> };
  /** Board defs keyed by model, for every board the site uses. */
  boards: Record<string, BoardDef>;
  /** All `docs` rows (node + narrative). Board reference docs come from the board def. */
  docs: DocRecord[];
}

/** Stable display order for the per-kind documentation sections. */
const KIND_ORDER: TopologyNode['kind'][] = [
  'water_source', 'tank', 'pump', 'vfd', 'valve', 'flow_sensor', 'filter', 'dosing_pump', 'endpoint',
];

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? '' : 's'}`;
}

export async function assembleSiteDoc(input: SiteDocInput): Promise<string> {
  const { siteName, topo, diagrams, boards, docs } = input;

  const routes = deriveRoutes(buildGraph(topo.nodes, topo.pipes));
  const siteCtx: SiteVarCtx = { siteName, topo, routeCount: routes.length };
  const sv = siteVars(siteCtx);

  const nameOf = new Map(topo.nodes.map(n => [n.id, n.name || n.id]));
  const single = topo.controllers.length === 1;

  const counts = {
    tank: getNodesByKind(topo, 'tank').length,
    pump: getNodesByKind(topo, 'pump').length,
    valve: getNodesByKind(topo, 'valve').length,
    flow_sensor: getNodesByKind(topo, 'flow_sensor').length,
  };
  const pills = [
    plural(topo.controllers.length, 'controller'),
    counts.tank ? plural(counts.tank, 'tank') : '',
    counts.pump ? plural(counts.pump, 'pump') : '',
    counts.valve ? plural(counts.valve, 'valve') : '',
    counts.flow_sensor ? plural(counts.flow_sensor, 'flow sensor') : '',
    plural(routes.length, 'route'),
  ].filter(Boolean).map(l => `<span class="pill">${escXml(l)}</span>`).join('');

  // --- Overview --------------------------------------------------------------
  const overview: string[] = ['<h2>Overview</h2>'];
  if (!single && diagrams.composite) {
    overview.push(`<h3>Site Topology</h3><div class="diagram topology">${diagrams.composite}</div>`);
  }
  if (!single) {
    const rows = topo.controllers.map(c => {
      const cn = topo.nodes.filter(n => n.anchorId === c.id);
      const byKind = (k: TopologyNode['kind']) => cn.filter(n => n.kind === k).length;
      return `<tr><td><strong>${escXml(c.friendlyName ?? c.id)}</strong></td><td><code>${escXml(c.board)}</code></td>`
        + `<td>${byKind('tank')}</td><td>${byKind('pump')}</td><td>${byKind('valve')}</td></tr>`;
    }).join('');
    overview.push(
      '<h3>Controllers</h3><table><thead><tr><th>Controller</th><th>Board</th><th>Tanks</th><th>Pumps</th><th>Valves</th></tr></thead>'
      + `<tbody>${rows}</tbody></table>`,
    );
  }
  if (routes.length) {
    const rows = routes.map(r => {
      const name = `${nameOf.get(r.source) ?? r.source} → ${nameOf.get(r.destination) ?? r.destination}`;
      const badge = r.crossesPump
        ? '<span class="badge badge-pump">Pumped</span>'
        : '<span class="badge badge-gravity">Gravity</span>';
      return `<tr><td>${escXml(name)}</td><td>${badge}</td></tr>`;
    }).join('');
    overview.push(`<h3>Routes</h3><table><thead><tr><th>Route</th><th>Type</th></tr></thead><tbody>${rows}</tbody></table>`);
  }

  // --- Per-controller: diagram + pin table + board reference docs -------------
  const controllerSections: string[] = [];
  for (const c of topo.controllers) {
    const board = boards[c.board];
    const cn = topo.nodes.filter(n => n.anchorId === c.id);
    const parts: string[] = [`<h2>${escXml(c.friendlyName ?? c.id)}</h2>`];

    const diagram = diagrams.controllers[c.id];
    if (diagram) parts.push(`<div class="diagram topology">${diagram}</div>`);

    const pinout = diagrams.boardPinouts?.[c.id];
    if (pinout) parts.push(`<h3>Board Pinout</h3><div class="diagram pinout">${pinout}</div>`);

    const pins = collectPins(cn);
    if (pins.length) {
      const rows = pins.map(p =>
        `<tr><td><code>${escXml(p.pin)}</code></td><td>${escXml(p.nodeName)}</td>`
        + `<td>${escXml(p.typeLabel)}</td><td>${escXml(p.fieldLabel)}</td>`
        + `<td>${p.polarity ? `<code>${escXml(p.polarity)}</code>` : '—'}</td></tr>`,
      ).join('');
      parts.push(
        '<h3>Pin Connections</h3><table><thead><tr><th>Pin</th><th>Entity</th><th>Type</th><th>Field</th><th>Polarity</th></tr></thead>'
        + `<tbody>${rows}</tbody></table>`,
      );
    }

    if (board?.documentation?.length) {
      const boardScope = { ...sv, ...boardVars(board) };
      parts.push('<h3>Board Reference</h3>');
      for (const sec of board.documentation) {
        parts.push(`<h4>${escXml(sec.title)}</h4>`, await renderDoc(sec.body, boardScope));
      }
    }
    controllerSections.push(parts.join(''));
  }

  // --- Node-type docs (one per kind present; node docs are keyed by kind=slug) -
  const presentKinds = new Set(topo.nodes.map(n => n.kind));
  const nodeDocs = new Map(docs.filter(d => d.category === 'node').map(d => [d.slug, d]));
  // KIND_ORDER fixes display order; any present kind missing from it still renders
  // (appended) so a newly-registered kind is never silently dropped.
  const orderedKinds = [...KIND_ORDER, ...[...presentKinds].filter(k => !KIND_ORDER.includes(k))];
  const nodeSections: string[] = [];
  for (const kind of orderedKinds) {
    if (!presentKinds.has(kind)) continue;
    const doc = nodeDocs.get(kind);
    if (!doc) continue;
    const scope = { ...sv, ...nodeVars({ kind, topo }) };
    nodeSections.push(`<h2>${escXml(doc.title)}</h2>`, await renderDoc(doc.body, scope));
  }

  // --- Narrative docs (operation, safety, wiring, glossary) -------------------
  const narrative = docs
    .filter(d => d.category !== 'node')
    .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  const narrativeSections: string[] = [];
  for (const doc of narrative) {
    narrativeSections.push(`<h2>${escXml(doc.title)}</h2>`, await renderDoc(doc.body, sv));
  }

  const today = new Date().toISOString().split('T')[0];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>MajiFlow — ${escXml(siteName)} — Site Documentation</title>
<style>${DOC_CSS}</style>
</head>
<body>
<button class="print-button" type="button" onclick="window.print()" title="Use the print dialog's Save as PDF destination">Save as PDF</button>
<div class="doc-header">
  <div class="logo">${LOGO_SVG_SMALL}</div>
  <div>
    <h1>MajiFlow</h1>
    <div class="subtitle">${escXml(single ? (topo.controllers[0]?.friendlyName ?? siteName) : siteName)} — Site Documentation</div>
    <div class="pills">${pills}</div>
  </div>
</div>
${overview.join('\n')}
${controllerSections.join('\n')}
${nodeSections.join('\n')}
${narrativeSections.join('\n')}
<div class="footer">
  <div class="brand">${LOGO_SVG_SMALL} MajiFlow</div>
  <div>${escXml(siteName)} · ${escXml(plural(topo.controllers.length, 'controller'))} · Generated ${today}</div>
</div>
</body>
</html>`;
}
