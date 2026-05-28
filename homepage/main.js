/**
 * MajiFlow Quick Quote — Vanilla JS
 *
 * Imports the shared quotation module from @far-mon/core.
 * For GH Pages: ensure quotation.esm.js is copied alongside this file.
 */

import { buildQuotation, renderQuotationHtml, DEFAULT_CATALOG, COMPONENT_REGISTRY } from './quotation.esm.js';

const form = document.getElementById('quoteForm');
const result = document.getElementById('result');
const btnPrint = document.getElementById('btnPrint');
const btnEmail = document.getElementById('btnEmail');
const btnReset = document.getElementById('btnReset');
const paramSections = document.getElementById('paramSections');
const livePreview = document.getElementById('livePreview');
const btnPreview = document.getElementById('btnPreview');
const previewSection = document.getElementById('previewSection');

let lastQuotation = null;
let loadedCatalog = null;

async function loadCatalog() {
  if (loadedCatalog) return loadedCatalog;
  try {
    const res = await fetch('./catalog.json');
    if (!res.ok) throw new Error('catalog.json not found');
    const json = await res.json();
    if (json.registry && Array.isArray(json.lines) && Array.isArray(json.defaults)) {
      loadedCatalog = json;
      return loadedCatalog;
    }
    throw new Error('Invalid catalog.json shape');
  } catch {
    loadedCatalog = DEFAULT_CATALOG;
    return loadedCatalog;
  }
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Dynamic parameter selectors (DOM API — no template-string HTML injection)
// ---------------------------------------------------------------------------

function renderParamSections() {
  paramSections.innerHTML = '';
  const comps = Object.values(COMPONENT_REGISTRY).filter((c) => c.parameters.length > 0);

  if (comps.length === 0) {
    const p = document.createElement('p');
    p.className = 'text-muted';
    p.textContent = 'No configurable parameters for this catalog.';
    paramSections.appendChild(p);
    return;
  }

  for (const comp of comps) {
    const section = document.createElement('div');
    section.className = 'param-section';

    const heading = document.createElement('h4');
    heading.textContent = comp.name;
    section.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'param-grid';

    for (const param of comp.parameters) {
      const field = document.createElement('div');
      field.className = 'field';

      const label = document.createElement('label');
      label.htmlFor = `param-${comp.id}-${param.name}`;
      label.textContent = param.label;
      field.appendChild(label);

      if (param.type === 'select') {
        const select = document.createElement('select');
        select.id = `param-${comp.id}-${param.name}`;
        select.name = `param-${comp.id}-${param.name}`;
        select.className = 'select select-sm select-bordered w-full';
        select.dataset.component = comp.id;
        select.dataset.param = param.name;

        for (const opt of param.options) {
          const option = document.createElement('option');
          option.value = opt;
          option.textContent = opt;
          select.appendChild(option);
        }
        field.appendChild(select);
      } else if (param.type === 'number') {
        const input = document.createElement('input');
        input.type = 'number';
        input.id = `param-${comp.id}-${param.name}`;
        input.name = `param-${comp.id}-${param.name}`;
        input.className = 'input input-sm input-bordered w-full';
        input.dataset.component = comp.id;
        input.dataset.param = param.name;
        if (param.min !== undefined) input.min = String(param.min);
        if (param.max !== undefined) input.max = String(param.max);
        input.value = String(param.min ?? 0);
        field.appendChild(input);
      }

      grid.appendChild(field);
    }

    section.appendChild(grid);
    paramSections.appendChild(section);
  }
}

function gatherComponentParams() {
  const params = {};
  const controls = paramSections.querySelectorAll('[data-component]');
  for (const el of controls) {
    const compId = el.dataset.component;
    const paramName = el.dataset.param;
    if (!params[compId]) params[compId] = {};
    params[compId][paramName] = el.value;
  }
  return params;
}

// ---------------------------------------------------------------------------
// Live preview
// ---------------------------------------------------------------------------

function renderTable(items) {
  const table = document.createElement('table');
  table.className = 'preview-table';

  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Item</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Total</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const item of items) {
    const tr = document.createElement('tr');

    const nameCell = document.createElement('td');
    const nameDiv = document.createElement('div');
    nameDiv.style.fontWeight = '600';
    nameDiv.textContent = item.name;
    nameCell.appendChild(nameDiv);

    const mfrDiv = document.createElement('div');
    mfrDiv.style.fontSize = '12px';
    mfrDiv.style.color = 'var(--text-secondary)';
    mfrDiv.textContent = item.manufacturer;
    nameCell.appendChild(mfrDiv);

    if (item.specs && Object.keys(item.specs).length > 0) {
      const specDiv = document.createElement('div');
      specDiv.style.marginTop = '2px';
      for (const [k, v] of Object.entries(item.specs)) {
        const tag = document.createElement('span');
        tag.className = 'spec-tag';
        tag.textContent = `${k}: ${v}`;
        specDiv.appendChild(tag);
      }
      nameCell.appendChild(specDiv);
    }

    const qtyCell = document.createElement('td');
    qtyCell.className = 'num';
    qtyCell.textContent = String(item.quantity);

    const unitCell = document.createElement('td');
    unitCell.className = 'num';
    unitCell.textContent = `$${item.unitPrice.toFixed(2)}`;

    const totalCell = document.createElement('td');
    totalCell.className = 'num';
    totalCell.textContent = `$${item.lineTotal.toFixed(2)}`;

    tr.appendChild(nameCell);
    tr.appendChild(qtyCell);
    tr.appendChild(unitCell);
    tr.appendChild(totalCell);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  return table;
}

function renderPreview(quotation) {
  livePreview.innerHTML = '';

  if (!quotation || (quotation.baseInfrastructure.length === 0 && quotation.systemComponents.length === 0)) {
    const p = document.createElement('p');
    p.className = 'text-muted';
    p.textContent = 'Fill in your details and click Preview to see the estimate.';
    livePreview.appendChild(p);
    livePreview.classList.add('empty');
    return;
  }

  livePreview.classList.remove('empty');

  if (quotation.baseInfrastructure.length > 0) {
    const heading = document.createElement('div');
    heading.className = 'preview-heading';
    heading.textContent = 'Base Infrastructure';
    livePreview.appendChild(heading);
    livePreview.appendChild(renderTable(quotation.baseInfrastructure));
  }

  if (quotation.systemComponents.length > 0) {
    const heading = document.createElement('div');
    heading.className = 'preview-heading';
    heading.textContent = 'System Components';
    livePreview.appendChild(heading);
    livePreview.appendChild(renderTable(quotation.systemComponents));
  }

  const totalDiv = document.createElement('div');
  totalDiv.className = 'preview-total';
  totalDiv.textContent = `Subtotal: $${quotation.subtotal.toFixed(2)} ${quotation.currency}`;
  livePreview.appendChild(totalDiv);
}

async function updatePreview(opts = {}) {
  const catalog = await loadCatalog();
  const fd = new FormData(form);

  const componentParams = gatherComponentParams();

  const input = {
    numTanks: parseInt(fd.get('numTanks'), 10) || 0,
    numPumps: parseInt(fd.get('numPumps'), 10) || 0,
    hasVfd: fd.get('hasVfd') === 'on',
    numValveZones: parseInt(fd.get('numValveZones'), 10) || 0,
    maxPipeDiameter: 'DN20',
    numFlowSensors: parseInt(fd.get('numFlowSensors'), 10) || 0,
    componentParams: Object.keys(componentParams).length > 0 ? componentParams : undefined,
  };

  const quotation = buildQuotation(input, catalog, {
    cableLengthMeters: parseInt(fd.get('cableLengthMeters'), 10) || 50,
    customerName: fd.get('customerName') || undefined,
    ...opts,
  });
  return quotation;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

renderParamSections();

// Initial empty preview
renderPreview(null);

// Preview button: validate contact details, then show preview
btnPreview.addEventListener('click', async () => {
  const required = ['customerName', 'customerEmail', 'customerPhone', 'consent'];
  for (const id of required) {
    const el = document.getElementById(id);
    if (!el || !el.checkValidity()) {
      el?.reportValidity();
      return;
    }
  }

  const quotation = await updatePreview();
  renderPreview(quotation);
  previewSection.classList.remove('hidden');
  previewSection.scrollIntoView({ behavior: 'smooth' });
});

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const quotation = await updatePreview();
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
    currency: lastQuotation.currency,
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
  previewSection.classList.add('hidden');
  lastQuotation = null;
  renderParamSections();
  renderPreview(null);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
