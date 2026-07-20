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
import { topologyToManifestForController } from '../topology-to-manifest';
import { boardInputPins, resolveButtonAssignments } from '../local-buttons';
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

/** One registered controller, narrowed to what the warranty's covered-devices table shows. */
export interface SiteDocDevice {
  deviceId: string;
  board: string;
  firmware: string;
  online: boolean;
  /** ISO of last contact, or '' if it has never connected. */
  lastSeen: string;
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
  /** Site record id. Present for a real per-site handover; omitted for the public quote
   *  (which has no site), so the Site details section renders only when this is set. */
  siteId?: string;
  /** Commissioning start (ISO), stamped at first live connect; '' until then. */
  commenceDate?: string;
  /** Registered controllers for this site, for the warranty's covered-devices table. */
  devices?: SiteDocDevice[];
}

/** Stable display order for the per-kind documentation sections. */
const KIND_ORDER: TopologyNode['kind'][] = [
  'water_source', 'tank', 'pump', 'vfd', 'valve', 'flow_sensor', 'filter', 'dosing_pump', 'endpoint',
];

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? '' : 's'}`;
}

/** Standard limited-warranty term. One owner of the number the {{warranty_expiry}}
 *  slot and the Site details table both read. Enterprise deals ride separate terms. */
const WARRANTY_MONTHS = 12;

const isoDate = (iso: string): string => iso.split('T')[0];

/** commenceDate + WARRANTY_MONTHS as YYYY-MM-DD; '' if commenceDate is empty or unparseable. */
function warrantyExpiryOf(commenceDate: string): string {
  const d = new Date(commenceDate);
  if (isNaN(d.getTime())) return '';
  d.setMonth(d.getMonth() + WARRANTY_MONTHS);
  return isoDate(d.toISOString());
}

export async function assembleSiteDoc(input: SiteDocInput): Promise<string> {
  const { siteName, topo, diagrams, boards, docs } = input;
  const siteId = input.siteId ?? '';
  const devices = input.devices ?? [];
  const commenceDate = input.commenceDate ?? '';

  // Warranty facts, computed once and shared by the Site details table and the
  // {{commission_date}} / {{warranty_expiry}} slots so the two can never disagree.
  // warrantyExpiryOf returns '' for an empty or unparseable commence date — that one
  // check drives both displays, so a bad date degrades instead of throwing.
  const expiry = warrantyExpiryOf(commenceDate);
  const commissionDisplay = expiry ? isoDate(commenceDate) : 'Not yet commissioned';
  const warrantyExpiry = expiry || 'Begins at commissioning';

  const routes = deriveRoutes(buildGraph(topo.nodes, topo.pipes));
  const siteCtx: SiteVarCtx = {
    siteName, topo, routeCount: routes.length,
    commissionDate: commissionDisplay, warrantyExpiry,
  };
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

  // --- Site details (handover identity + warranty) ---------------------------
  // Only for a real site; the public quote passes no siteId and skips this, which
  // also keeps the <h2>Overview</h2> anchor that quote.ts splices its price into.
  const siteDetails: string[] = [];
  if (siteId) {
    const idRows = [
      `<tr><th>Site name</th><td>${escXml(siteName)}</td></tr>`,
      `<tr><th>Site ID</th><td><code>${escXml(siteId)}</code></td></tr>`,
      `<tr><th>Commissioned</th><td>${escXml(commissionDisplay)}</td></tr>`,
      `<tr><th>Warranty</th><td>${WARRANTY_MONTHS} months from commissioning · expires ${escXml(warrantyExpiry)}</td></tr>`,
    ].join('');
    siteDetails.push(`<h2>Site details</h2><table><tbody>${idRows}</tbody></table>`);
    if (devices.length) {
      const dRows = devices.map(d => {
        const status = d.online ? 'Online' : d.lastSeen ? `Last seen ${isoDate(d.lastSeen)}` : 'Not yet connected';
        return `<tr><td><code>${escXml(d.deviceId)}</code></td><td><code>${escXml(d.board)}</code></td>`
          + `<td>${escXml(d.firmware || 'pending')}</td><td>${escXml(status)}</td></tr>`;
      }).join('');
      siteDetails.push(
        '<h3>Controllers covered</h3><table><thead><tr><th>Device ID</th><th>Board</th><th>Firmware</th><th>Status</th></tr></thead>'
        + `<tbody>${dRows}</tbody></table>`,
      );
    } else {
      siteDetails.push('<p>No controllers registered yet. They appear here once the site is deployed.</p>');
    }
  }

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

    // Panel buttons — the physical inputs an operator can press, resolved with
    // the same rule the firmware codegen uses (explicit local.buttons, else the
    // default auto-assign). Only on boards with input expanders.
    if (board) {
      const inputPins = boardInputPins(board);
      if (inputPins.length) {
        const manifest = topologyToManifestForController(topo, c.id);
        const assignments = resolveButtonAssignments(manifest.routes, inputPins, c.local);
        if (assignments.length) {
          // Row order follows the physical inputs (IN1, IN2, ...) — "Button N"
          // must match the panel layout, not the mapping's declaration order.
          const inputOrder = new Map(inputPins.map((p, i) => [p, i]));
          const sorted = [...assignments]
            .sort((a, b) => (inputOrder.get(a.input) ?? 0) - (inputOrder.get(b.input) ?? 0));
          const rows = sorted.map((a, i) => {
            const action = a.action === 'stop_all' ? 'Stop All' : `Start / stop ${escXml(a.routeName)}`;
            return `<tr><td>Button ${i + 1}</td><td><code>${escXml(a.input)}</code></td><td>${action}</td></tr>`;
          }).join('');
          parts.push(
            '<h3>Panel Buttons</h3><table><thead><tr><th>Button</th><th>Input</th><th>Action</th></tr></thead>'
            + `<tbody>${rows}</tbody></table>`,
          );
        }
      }
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
${siteDetails.join('\n')}
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
