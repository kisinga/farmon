/**
 * Client-side quote document for the public pricing page.
 *
 * Reuses the site-documentation flow (`assembleSiteDoc`) rather than inventing a
 * PDF pipeline: the composed Easy Mode topology becomes a self-contained,
 * printable HTML document with the system diagram embedded; the visitor uses the
 * doc's own "Save as PDF" (browser print). No server storage, no new dependency.
 *
 * The price is spliced in at this (app) layer so @core's assembler stays
 * price-agnostic; everything else (topology, equipment, routes, styling) is the
 * documentation flow, so nothing is duplicated.
 */
import { renderTopologySvg, escXml, type SiteTopology } from '@core';
import { kes, type Estimate } from './pricing.model';

export interface QuoteInput {
  /** Title for the document + the single controller's heading. */
  siteName: string;
  /** The composed design (no pins in estimation mode). */
  topology: SiteTopology;
  /** The on-page estimate, rendered as the quote's price section. */
  estimate: Estimate;
}

/** The app-owned price section, styled with the doc's own CSS classes. */
function priceSection(e: Estimate): string {
  const rows = e.lines.map(l =>
    `<tr><td>${escXml(l.label)}${l.qty > 1 ? ` <span style="color:var(--text-muted)">× ${l.qty}</span>` : ''}</td>`
    + `<td style="text-align:right">${escXml(kes(l.total))}</td></tr>`,
  ).join('');
  const pack = e.pack.fromMonthly != null ? `from ${kes(e.pack.fromMonthly)} / mo` : 'on request';
  return `<h2>Quote</h2>
<div class="pills">
  <span class="pill">${escXml(kes(e.monthly))} / month · ${escXml(e.tier)} plan</span>
  <span class="pill">${e.controllers} controller${e.controllers > 1 ? 's' : ''}</span>
  <span class="pill">${escXml(e.pack.label)} pack · ${escXml(pack)}</span>
</div>
<h3>One-time kit</h3>
<table><thead><tr><th>Item</th><th style="text-align:right">Price</th></tr></thead>
<tbody>${rows}<tr><td><strong>Total one-time</strong></td><td style="text-align:right"><strong>${escXml(kes(e.oneTime))}</strong></td></tr></tbody></table>
<p style="color:var(--text-muted)">An estimate, not a final quote. The real price depends on a site survey, pipe sizes, and install. Prices in KES.</p>`;
}

/**
 * Build a printable quote HTML document for a composed topology. Lazy-imports the
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

  // Splice the price section after the assembler's Overview heading. If the
  // assembler ever changes that markup, fall back to appending before </body> and
  // warn, never silently drop the price.
  const anchor = '<h2>Overview</h2>';
  const section = priceSection(estimate);
  if (html.includes(anchor)) return html.replace(anchor, `${section}\n${anchor}`);
  console.warn('Quote: site-doc Overview anchor not found; appending price section.');
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
