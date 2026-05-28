/**
 * HTML quotation rendering.
 *
 * Template literals, zero dependencies. Produces a self-contained HTML string
 * with inline CSS suitable for browser print-to-PDF.
 */

import type { Quotation, QuotationLineItem } from './types';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatCurrency(n: number, currency: string): string {
  const formatted = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === 'USD' ? `$${formatted}` : `${formatted} ${currency}`;
}

function renderLineItems(items: QuotationLineItem[], showPricing: boolean): string {
  if (items.length === 0) return '<p>None</p>';

  const priceCols = showPricing
    ? `<th class="num">Unit Price</th><th class="num">Line Total</th>`
    : '';

  const rows = items
    .map((item) => {
      const specTags = Object.entries(item.specs)
        .map(([k, v]) => `<span class="tag">${k}: ${v}</span>`)
        .join(' ');

      const priceCells = showPricing
        ? `<td class="num">${formatCurrency(item.unitPrice, item.currency)}</td><td class="num">${formatCurrency(item.lineTotal, item.currency)}</td>`
        : '';

      const help = item.selectionHelp
        ? `<div class="selection-help">${escapeHtml(item.selectionHelp)}</div>`
        : '';

      const notes = item.notes
        ? `<div class="notes">${escapeHtml(item.notes)}</div>`
        : '';

      return `
        <tr>
          <td>
            <div class="item-name">${escapeHtml(item.name)}</div>
            <div class="item-meta">
              <span class="manufacturer">${escapeHtml(item.manufacturer)}</span>
              ${specTags}
            </div>
            ${help}${notes}
          </td>
          <td class="num">${item.quantity}</td>
          ${priceCells}
        </tr>
      `;
    })
    .join('');

  return `
    <table class="bom-table">
      <thead>
        <tr>
          <th>Item</th>
          <th class="num">Qty</th>
          ${priceCols}
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderStyles(): string {
  return `
    <style>
      :root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
      body { max-width: 900px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.5; }
      .header { border-bottom: 2px solid #0d7377; padding-bottom: 16px; margin-bottom: 24px; }
      .header h1 { margin: 0 0 8px; font-size: 24px; color: #0d7377; }
      .meta { color: #666; font-size: 14px; }
      .meta span { margin-right: 16px; }
      h2 { font-size: 18px; margin-top: 28px; margin-bottom: 12px; color: #0d7377; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px; }
      .bom-table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
      .bom-table th { text-align: left; padding: 10px 8px; background: #f6f8fa; border-bottom: 2px solid #d0d7de; font-weight: 600; }
      .bom-table td { padding: 10px 8px; border-bottom: 1px solid #e8edf2; vertical-align: top; }
      .bom-table .num { text-align: right; white-space: nowrap; }
      .item-name { font-weight: 600; }
      .item-meta { color: #555; font-size: 12px; margin-top: 2px; }
      .tag { display: inline-block; background: #eef2f7; padding: 1px 6px; border-radius: 4px; margin-right: 4px; font-size: 11px; }
      .manufacturer { font-weight: 500; color: #0d7377; margin-right: 8px; }
      .selection-help { color: #555; font-size: 12px; margin-top: 4px; font-style: italic; }
      .notes { color: #777; font-size: 12px; margin-top: 4px; }
      .totals { margin-top: 16px; text-align: right; font-size: 16px; }
      .totals .subtotal { font-weight: 700; font-size: 18px; }
      .totals .approx { color: #666; font-size: 14px; margin-top: 6px; }
      .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #888; text-align: center; }
      @media print {
        body { margin: 0; padding: 20px; }
        .footer { page-break-inside: avoid; }
        h2 { page-break-after: avoid; }
        tr { page-break-inside: avoid; }
      }
    </style>
  `;
}

export function renderQuotationHtml(
  q: Quotation,
  opts: { showPricing: boolean; exchangeRate?: number },
): string {
  const customerBlock = q.customerName
    ? `<div class="meta"><span>Customer: ${escapeHtml(q.customerName)}</span></div>`
    : '';

  const siteBlock = q.siteName
    ? `<div class="meta"><span>Site: ${escapeHtml(q.siteName)}</span></div>`
    : '';

  const totals = opts.showPricing
    ? `<div class="totals">
         <span class="subtotal">Subtotal: ${formatCurrency(q.subtotal, q.currency)}</span>
         ${opts.exchangeRate ? `<div class="approx">Approximate KES total: KSh ${formatCurrency(Math.round(q.subtotal * opts.exchangeRate * 100) / 100, 'KES')}</div>` : ''}
       </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Quotation ${q.quoteId}</title>
  ${renderStyles()}
</head>
<body>
  <div class="header">
    <h1>MajiFlow Quotation</h1>
    <div class="meta">
      <span>Quote ID: ${q.quoteId}</span>
      <span>Date: ${formatDate(q.generatedAt)}</span>
    </div>
    ${customerBlock}${siteBlock}
  </div>

  <h2>Base Infrastructure</h2>
  ${renderLineItems(q.baseInfrastructure, opts.showPricing)}

  <h2>System Components</h2>
  ${renderLineItems(q.systemComponents, opts.showPricing)}

  ${totals}

  <div class="footer">
    Generated by MajiFlow · ${formatDate(q.generatedAt)}<br>
    Prices are estimates and subject to supplier availability.
  </div>
</body>
</html>`;
}

export function renderTechnicalBomHtml(q: Quotation): string {
  return renderQuotationHtml(q, { showPricing: false });
}
