import { Injectable } from '@angular/core';
import type { SiteTopology } from '@core';
import {
  collectPins, calloutLabelsFor, layoutCallouts, emitPinoutSvg,
  measureConnectors, svgViewBox,
} from '@core';
import { TopologyRenderer } from '../../shared/canvas/topology-renderer';
import type { SiteDiagrams, BoardBundle } from '../models/backend-api';

/**
 * Renders a site's documentation diagrams offscreen so they can be cached on the
 * site and injected as strings by the customer dashboard (which never imports this
 * service, and so never loads X6 or measures geometry at view time). Admin-only.
 *
 * Two kinds of diagram:
 *   - Topology flow diagrams (composite + per-controller), via the SAME X6 engine
 *     the editor canvas uses, so they can't drift from what the designer saw.
 *   - Per-controller board pinouts: the physical board SVG with connected-pin
 *     callout labels baked in (see {@link emitPinoutSvg}).
 */
@Injectable({ providedIn: 'root' })
export class TopologyDiagramService {
  /** Composite site diagram (multi-controller only), per-controller topology diagrams, and board pinouts. */
  async renderSiteDiagrams(topo: SiteTopology, boards: Record<string, BoardBundle> = {}): Promise<SiteDiagrams> {
    const container = document.createElement('div');
    // In the DOM but visually hidden, with real dimensions — `visibility:hidden`
    // (not `display:none`) keeps layout so X6's getBBox/viewBox measurement works.
    container.style.cssText =
      'position:absolute;left:-99999px;top:0;width:1200px;height:1200px;visibility:hidden;pointer-events:none;';
    document.body.appendChild(container);
    const renderer = new TopologyRenderer(container);
    try {
      let composite = '';
      if (topo.controllers.length > 1) {
        try { composite = await renderer.export({ nodes: topo.nodes, pipes: topo.pipes }); }
        catch { /* keep going — a missing composite is better than no doc */ }
      }

      const controllers: Record<string, string> = {};
      const boardPinouts: Record<string, string> = {};
      for (const c of topo.controllers) {
        const nodes = topo.nodes.filter((n) => n.anchorId === c.id);
        if (nodes.length === 0) continue;
        const ids = new Set(nodes.map((n) => n.id));
        const pipes = topo.pipes.filter(
          (p) => ids.has(p.from.split(':')[0]) && ids.has(p.to.split(':')[0]),
        );
        // Isolate per-controller so one bad topology doesn't drop every diagram.
        try {
          controllers[c.id] = await renderer.export({
            nodes, pipes, device: { friendly_name: c.friendlyName ?? c.id },
          });
        } catch { /* skip this controller's diagram */ }

        try {
          const pinout = this.renderBoardPinout(boards[c.board], nodes, container);
          if (pinout) boardPinouts[c.id] = pinout;
        } catch { /* skip this controller's pinout */ }
      }
      return { composite, controllers, boardPinouts };
    } finally {
      renderer.destroy();
      container.remove();
    }
  }

  /**
   * Bake the board SVG with connected-pin callouts into a string. Returns '' when
   * the board has no SVG or no pins are connected (the doc's text pin table still
   * lists everything). Measures connector geometry from a throwaway render inside
   * the supplied (laid-out, hidden) container.
   */
  private renderBoardPinout(bundle: BoardBundle | undefined, nodes: SiteTopology['nodes'], container: HTMLElement): string {
    if (!bundle?.svg.includes('<svg')) return '';
    const labels = calloutLabelsFor(bundle.def, collectPins(nodes));
    if (!labels.length) return '';

    const host = document.createElement('div');
    host.style.cssText = 'width:1000px;height:1000px;';
    container.appendChild(host);
    try {
      host.innerHTML = bundle.svg;
      const svg = host.querySelector('svg');
      if (!svg) return '';
      const geoms = measureConnectors(svg, labels.map((l) => l.connector));
      if (!geoms.length) return '';
      const placement = layoutCallouts(geoms, labels, svgViewBox(svg));
      return emitPinoutSvg(bundle.svg, placement);
    } finally {
      host.remove();
    }
  }
}
