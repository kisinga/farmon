import { Injectable } from '@angular/core';
import type { SiteTopology } from '@core';
import { TopologyRenderer } from '../../shared/canvas/topology-renderer';
import type { SiteDiagrams } from '../models/backend-api';

/**
 * Renders a site's documentation topology diagrams offscreen with the SAME X6
 * engine the editor canvas uses, so the diagrams can't drift from what the
 * designer saw. Admin-only: the rendered SVGs are cached on the site, and the
 * customer dashboard injects those strings — it never imports this service (and
 * so never loads X6).
 */
@Injectable({ providedIn: 'root' })
export class TopologyDiagramService {
  /** Composite site diagram (multi-controller only) + one diagram per controller. */
  async renderSiteDiagrams(topo: SiteTopology): Promise<SiteDiagrams> {
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
      }
      return { composite, controllers };
    } finally {
      renderer.destroy();
      container.remove();
    }
  }
}
