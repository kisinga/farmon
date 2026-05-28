/**
 * MajiFlow Quick Quote — Vanilla JS
 *
 * Imports the shared quotation module from @far-mon/core.
 * For GH Pages: ensure quotation.esm.js is copied alongside this file.
 */

import { buildQuotation, renderQuotationHtml, DEFAULT_CATALOG } from './quotation.esm.js';

const form = document.getElementById('quoteForm');
const result = document.getElementById('result');
const btnPrint = document.getElementById('btnPrint');
const btnEmail = document.getElementById('btnEmail');
const btnReset = document.getElementById('btnReset');

let lastQuotation = null;

form.addEventListener('submit', (e) => {
  e.preventDefault();

  const fd = new FormData(form);

  const input = {
    numTanks: parseInt(fd.get('numTanks'), 10) || 0,
    numPumps: parseInt(fd.get('numPumps'), 10) || 0,
    hasVfd: fd.get('hasVfd') === 'on',
    numValveZones: parseInt(fd.get('numValveZones'), 10) || 0,
    maxPipeDiameter: fd.get('pipeDiameter'),
    numFlowSensors: parseInt(fd.get('numFlowSensors'), 10) || 0,
    customerName: fd.get('customerName'),
    customerEmail: fd.get('customerEmail'),
    customerPhone: fd.get('customerPhone'),
    consentGiven: fd.get('consent') === 'on',
  };

  const quotation = buildQuotation(input, DEFAULT_CATALOG, {
    customerName: input.customerName || undefined,
  });

  lastQuotation = quotation;

  // Show result card
  form.classList.add('hidden');
  result.classList.remove('hidden');
  result.scrollIntoView({ behavior: 'smooth' });
});

btnPrint.addEventListener('click', () => {
  if (!lastQuotation) return;
  const html = renderQuotationHtml(lastQuotation, { showPricing: true });
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 300);
  }
});

btnEmail.addEventListener('click', async () => {
  if (!lastQuotation) return;

  const url = window.APPS_SCRIPT_URL;
  if (!url || url.includes('YOUR_SCRIPT_ID')) {
    alert('Google Apps Script URL is not configured. Please see README.md for setup instructions.');
    return;
  }

  const payload = {
    customerName: lastQuotation.customerName || '',
    customerEmail: document.getElementById('customerEmail').value,
    customerPhone: document.getElementById('customerPhone').value,
    quoteId: lastQuotation.quoteId,
    subtotal: lastQuotation.subtotal,
    currency: 'KES',
    items: [
      ...lastQuotation.baseInfrastructure.map((i) => ({
        name: i.name,
        manufacturer: i.manufacturer,
        qty: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
      })),
      ...lastQuotation.systemComponents.map((i) => ({
        name: i.name,
        manufacturer: i.manufacturer,
        qty: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
      })),
    ],
  };

  try {
    btnEmail.textContent = 'Sending...';
    btnEmail.disabled = true;

    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    alert('Your quotation has been sent. We will contact you shortly.');
  } catch (err) {
    console.error(err);
    alert('Failed to send. Please download the PDF and email it directly.');
  } finally {
    btnEmail.textContent = 'Send me a copy';
    btnEmail.disabled = false;
  }
});

btnReset.addEventListener('click', () => {
  form.reset();
  form.classList.remove('hidden');
  result.classList.add('hidden');
  lastQuotation = null;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
