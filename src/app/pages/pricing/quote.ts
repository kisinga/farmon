/**
 * Client-side assessment document for the public assessment page.
 *
 * Reuses the site-documentation flow (`assembleSiteDoc`) rather than inventing a
 * PDF pipeline: the composed Easy Mode topology becomes a self-contained,
 * printable HTML document with the system diagram embedded; the visitor uses the
 * doc's own "Save as PDF" (browser print). No server storage, no new dependency.
 *
 * The scope summary is spliced in at this (app) layer so @core's assembler stays
 * commercial-positioning agnostic; everything else (topology, equipment, routes,
 * styling) is the documentation flow, so nothing is duplicated.
 */
import { renderTopologySvg, escXml, type SiteTopology } from '@core';
import type { Estimate } from './pricing.model';

export interface QuoteInput {
  /** Title for the document + the single controller's heading. */
  siteName: string;
  /** The composed design (no pins in estimation mode). */
  topology: SiteTopology;
  /** The on-page sizing result, rendered as an assessment scope section. */
  estimate: Estimate;
}

/** The app-owned assessment section, styled with the doc's own CSS classes. */
function assessmentSection(e: Estimate): string {
  const rows = e.lines.map(l =>
    `<tr><td>${escXml(l.label)}</td><td style="text-align:right">${l.qty}</td></tr>`,
  ).join('');
  return `<h2>Assessment scope</h2>
<div class="pills">
  <span class="pill">${e.controllers} controller${e.controllers > 1 ? 's' : ''}</span>
  <span class="pill">${escXml(e.pack.label)} service review</span>
  <span class="pill">Commercial scope after site review</span>
</div>
<h3>Likely deployment components</h3>
<table><thead><tr><th>Component</th><th style="text-align:right">Qty</th></tr></thead>
<tbody>${rows}</tbody></table>
<p style="color:var(--text-muted)">Assessment only. Final scope follows a site conversation or survey.</p>`;
}

/**
 * Build a printable assessment HTML document for a composed topology. Lazy-imports the
 * heavy `@core/docs` assembler so `marked` never weighs on the pricing bundle.
 */
export async function buildQuoteHtml(input: QuoteInput): Promise<string> {
  const { siteName, topology, estimate } = input;
  const svg = renderTopologySvg(topology);
  const cid = topology.controllers[0]?.id ?? 'controller1';

  // Give the single controller a friendly heading (the public estimate has no
  // site name) and feed the diagram to the per-controller slot: for a single
  // controller the assembler renders the diagram there, not in the overview.
  const topo: SiteTopology = {
    ...topology,
    controllers: topology.controllers.map((c, i) => (i === 0 ? { ...c, friendlyName: c.friendlyName || siteName } : c)),
  };

  const { assembleSiteDoc } = await import('@core/docs');
  const html = await assembleSiteDoc({
    siteName,
    topo,
    diagrams: { composite: svg, controllers: { [cid]: svg }, boardPinouts: {} },
    boards: {},
    docs: [],
  });

  // Splice the assessment section after the assembler's Overview heading. If the
  // assembler ever changes that markup, fall back to appending before </body> and
  // warn, never silently drop the context.
  const anchor = '<h2>Overview</h2>';
  const section = assessmentSection(estimate);
  if (html.includes(anchor)) return html.replace(anchor, `${section}\n${anchor}`);
  console.warn('Assessment: site-doc Overview anchor not found; appending scope section.');
  return html.includes('</body>') ? html.replace('</body>', `${section}\n</body>`) : html + section;
}

/** Open a generated document in a new tab for the visitor to print / save as PDF.
 *  Matches the deploy/dashboard site-doc pattern (Blob URL, revoked after a grace
 *  window) rather than the deprecated document.write. */
export function openQuote(html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
