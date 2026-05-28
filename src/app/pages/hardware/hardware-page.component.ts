import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  buildQuotationFromTopology,
  renderQuotationHtml,
  renderTechnicalBomHtml,
  resolveQuoteLineItem,
  COMPONENT_REGISTRY,
  type ProductLine,
  type QuotationLineItem,
  type QuoteDefaults,
} from '@far-mon/core';
import type { SiteTopology } from '@far-mon/core';
import { ElectronService } from '../../core/services/electron.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import type { ManifestRow, ProductLineRow, QuoteDefaultsRow } from '../../core/models/electron-api';

interface EditableLineItem extends QuotationLineItem {
  _key: string;
}

@Component({
  selector: 'app-hardware-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  host: { class: 'flex-1 overflow-auto bg-base-100' },
  template: `
    <div class="max-w-5xl mx-auto p-6 space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold">Hardware Manifest</h1>
          <p class="text-sm text-base-content/50">{{ siteName() }}</p>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-sm btn-ghost" (click)="generateDoc(false)">Technical BOM</button>
          <button class="btn btn-sm btn-primary" (click)="generateDoc(true)">Generate Quotation</button>
          <button class="btn btn-sm btn-secondary" (click)="saveManifest()">Save Manifest</button>
        </div>
      </div>

      @if (error()) {
        <div class="alert alert-error">{{ error() }}</div>
      }

      <!-- Component Parameters -->
      @if (paramComponents().length > 0) {
        <div class="card bg-base-200">
          <div class="card-body p-4">
            <h2 class="card-title text-base">Component Parameters</h2>
            <p class="text-xs text-base-content/50 mb-3">Change specifications to update prices dynamically.</p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              @for (comp of paramComponents(); track comp.id) {
                <div class="bg-base-100 rounded-lg p-3">
                  <div class="font-medium text-sm mb-2">{{ comp.name }}</div>
                  <div class="space-y-2">
                    @for (param of comp.parameters; track param.name) {
                      @if (param.type === 'select') {
                        <div>
                          <label class="label"><span class="label-text text-xs">{{ param.label }}</span></label>
                          <select class="select select-sm select-bordered w-full"
                            [ngModel]="componentParams()[comp.id]?.[param.name] ?? comp.defaultParams[param.name]"
                            (ngModelChange)="updateParam(comp.id, param.name, $event)">
                            @for (opt of param.options; track opt) {
                              <option [value]="opt">{{ opt }}</option>
                            }
                          </select>
                        </div>
                      }
                    }
                  </div>
                </div>
              }
            </div>
          </div>
        </div>
      }

      <!-- Base Infrastructure -->
      <div class="card bg-base-200">
        <div class="card-body p-4">
          <h2 class="card-title text-base">Base Infrastructure</h2>
          @if (baseItems().length === 0) {
            <p class="text-sm text-base-content/40">Loading...</p>
          } @else {
            <table class="table table-sm">
              <thead>
                <tr><th>Item</th><th class="w-20 text-right">Qty</th><th class="w-32 text-right">Unit Price</th><th class="w-32 text-right">Line Total</th><th></th></tr>
              </thead>
              <tbody>
                @for (item of baseItems(); track item._key) {
                  <tr>
                    <td>
                      <div class="font-medium text-sm">{{ item.name }}</div>
                      <div class="text-xs text-base-content/50">{{ item.manufacturer }}</div>
                      @if (item.selectionHelp) {
                        <div class="text-xs text-base-content/40 italic">{{ item.selectionHelp }}</div>
                      }
                      @if (item.notes) {
                        <div class="text-xs text-base-content/40">{{ item.notes }}</div>
                      }
                    </td>
                    <td class="text-right">
                      <input type="number" min="0" class="input input-xs input-bordered w-16 text-right" [ngModel]="item.quantity" (ngModelChange)="updateQty(item._key, $event)" />
                    </td>
                    <td class="text-right font-mono text-sm">{{ item.unitPrice.toFixed(2) }}</td>
                    <td class="text-right font-mono text-sm font-medium">{{ item.lineTotal.toFixed(2) }}</td>
                    <td class="w-8">
                      @if (item.manufacturerId === 'relay-30a-module') {
                        <span class="badge badge-ghost badge-xs">conditional</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      </div>

      <!-- System Components -->
      <div class="card bg-base-200">
        <div class="card-body p-4">
          <h2 class="card-title text-base">System Components</h2>
          @if (topologyItems().length === 0) {
            <p class="text-sm text-base-content/40">No valves or sensors in topology.</p>
          } @else {
            <table class="table table-sm">
              <thead>
                <tr><th>Item</th><th class="w-20 text-right">Qty</th><th class="w-32 text-right">Unit Price</th><th class="w-32 text-right">Line Total</th><th></th></tr>
              </thead>
              <tbody>
                @for (item of topologyItems(); track item._key) {
                  <tr>
                    <td>
                      <div class="font-medium text-sm">{{ item.name }}</div>
                      <div class="text-xs text-base-content/50">{{ item.manufacturer }}</div>
                      <div class="flex flex-wrap gap-1 mt-0.5">
                        @for (spec of item.specs | keyvalue; track spec.key) {
                          <span class="badge badge-ghost badge-xs">{{ spec.key }}: {{ spec.value }}</span>
                        }
                      </div>
                      @if (item.selectionHelp) {
                        <div class="text-xs text-base-content/40 italic mt-0.5">{{ item.selectionHelp }}</div>
                      }
                    </td>
                    <td class="text-right">
                      <input type="number" min="0" class="input input-xs input-bordered w-16 text-right" [ngModel]="item.quantity" (ngModelChange)="updateQty(item._key, $event)" />
                    </td>
                    <td class="text-right font-mono text-sm">{{ item.unitPrice.toFixed(2) }}</td>
                    <td class="text-right font-mono text-sm font-medium">{{ item.lineTotal.toFixed(2) }}</td>
                    <td class="w-8">
                      <button class="btn btn-ghost btn-xs" (click)="swapCatalogItem(item._key)">Swap</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      </div>

      <!-- Totals -->
      <div class="flex justify-end">
        <div class="text-right space-y-1">
          <div class="text-sm text-base-content/60">Subtotal</div>
          <div class="text-2xl font-bold font-mono">KSh {{ subtotal().toFixed(2) }}</div>
        </div>
      </div>

      <!-- Manifest History -->
      @if (history().length > 0) {
        <div class="card bg-base-200">
          <div class="card-body p-4">
            <h2 class="card-title text-base">Manifest History</h2>
            <div class="overflow-x-auto">
              <table class="table table-sm">
                <thead>
                  <tr><th>Version</th><th>Type</th><th>Date</th><th>Items</th><th></th></tr>
                </thead>
                <tbody>
                  @for (m of history(); track m.id) {
                    <tr>
                      <td class="font-mono text-xs">v{{ m.manifest_version }}</td>
                      <td><span class="badge badge-xs badge-ghost">{{ m.manifest_type }}</span></td>
                      <td class="text-xs">{{ m.created_at | date:'short' }}</td>
                      <td class="text-xs">{{ parseItems(m.items).length }} items</td>
                      <td>
                        <button class="btn btn-ghost btn-xs" (click)="loadManifest(m)">Load</button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      }
    </div>

    <!-- Swap catalog item modal -->
    @if (swappingKey()) {
      <dialog class="modal modal-open" style="position: fixed;">
        <div class="modal-box max-w-md">
          <h3 class="font-bold text-lg mb-4">Select Alternative</h3>
          <div class="space-y-1 max-h-60 overflow-auto">
            @for (alt of swapAlternatives(); track alt.id) {
              <button class="btn btn-ghost btn-sm w-full justify-start gap-2 font-normal" (click)="confirmSwap(alt.id)">
                <span class="font-medium">{{ alt.name }}</span>
                <span class="text-xs text-base-content/40">{{ alt.manufacturer }}</span>
                <span class="text-xs text-base-content/40 font-mono">{{ '$' + firstActiveUnitCost(alt).toFixed(2) }}</span>
                @if (alt.selectionHelp) {
                  <span class="text-xs text-base-content/40 italic">— {{ alt.selectionHelp }}</span>
                }
              </button>
            }
          </div>
          <div class="modal-action">
            <button class="btn btn-ghost" (click)="swappingKey.set(null)">Cancel</button>
          </div>
        </div>
        <div class="modal-backdrop" (click)="swappingKey.set(null)"></div>
      </dialog>
    }
  `,
})
export class HardwarePageComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private electron = inject(ElectronService);
  private workspace = inject(WorkspaceService);

  protected siteId = signal('');
  protected siteName = signal('');
  protected topology = signal<SiteTopology | null>(null);
  protected lines = signal<ProductLine[]>([]);
  protected defaults = signal<QuoteDefaults[]>([]);
  protected lineItems = signal<EditableLineItem[]>([]);
  protected history = signal<ManifestRow[]>([]);
  protected error = signal('');
  protected swappingKey = signal<string | null>(null);
  /** Per-component parameter overrides. Key = componentId. */
  protected componentParams = signal<Record<string, Record<string, string>>>({});

  protected baseItems = computed(() => this.lineItems().filter((i) => i._key.startsWith('base-')));
  protected topologyItems = computed(() => this.lineItems().filter((i) => i._key.startsWith('topo-')));

  protected subtotal = computed(() =>
    Math.round(this.lineItems().reduce((s, i) => s + i.lineTotal, 0) * 100) / 100,
  );

  protected swapAlternatives = computed(() => {
    const key = this.swappingKey();
    if (!key) return [];
    const item = this.lineItems().find((i) => i._key === key);
    if (!item) return [];
    return this.lines().filter(
      (c) => c.isActive && c.componentId === this.inferComponentId(item.manufacturerId),
    );
  });

  /** Component types that have parameters and are present in the current quotation. */
  protected paramComponents = computed(() => {
    const items = this.lineItems();
    const needed = new Set<string>();
    for (const item of items) {
      const compId = this.inferComponentId(item.manufacturerId);
      const comp = COMPONENT_REGISTRY[compId];
      if (comp && comp.parameters.length > 0) {
        needed.add(compId);
      }
    }
    return Array.from(needed).map((id) => COMPONENT_REGISTRY[id]).filter(Boolean);
  });

  async ngOnInit() {
    const name = this.route.snapshot.paramMap.get('name');
    if (!name) return;
    this.siteId.set(name);

    // Load site data
    const full = await this.electron.siteLoad(name);
    this.siteName.set(full.site.friendlyName);
    if (full.topology) {
      this.topology.set(full.topology as SiteTopology);
    }

    // Load catalog lines, defaults, and history in parallel
    const [lineRows, defaultRows, historyRows] = await Promise.all([
      this.electron.catalogActive(),
      this.electron.quoteDefaultsGet(),
      this.electron.manifestList(name),
    ]);

    this.lines.set(lineRows.map((r) => this.mapRowToProductLine(r)));
    this.defaults.set(defaultRows.map((r) => ({
      componentId: r.component_id,
      manufacturerId: r.manufacturer_id,
      params: JSON.parse(r.params || '{}'),
    })));

    this.history.set(historyRows);

    // Initialize componentParams from DB defaults, falling back to registry defaults
    const initialParams: Record<string, Record<string, string>> = {};
    for (const comp of Object.values(COMPONENT_REGISTRY)) {
      const dbDefault = this.defaults().find((d) => d.componentId === comp.id);
      if (dbDefault && Object.keys(dbDefault.params).length > 0) {
        initialParams[comp.id] = dbDefault.params;
      } else if (Object.keys(comp.defaultParams).length > 0) {
        initialParams[comp.id] = { ...comp.defaultParams };
      }
    }
    this.componentParams.set(initialParams);

    // Build initial line items from topology
    this.rebuildFromTopology();
  }

  private inferComponentId(manufacturerId: string): string {
    const item = this.lines().find((c) => c.id === manufacturerId);
    return item?.componentId ?? '';
  }

  private rebuildFromTopology() {
    const topo = this.topology();
    if (!topo) return;

    const bundle = {
      registry: COMPONENT_REGISTRY,
      lines: this.lines(),
      defaults: this.defaults(),
    };

    const quotation = buildQuotationFromTopology(topo, bundle, {
      siteName: this.siteName(),
      componentParams: this.componentParams(),
    });

    const editable: EditableLineItem[] = [
      ...quotation.baseInfrastructure.map((i, idx) => ({ ...i, _key: `base-${idx}` })),
      ...quotation.systemComponents.map((i, idx) => ({ ...i, _key: `topo-${idx}` })),
    ];
    this.lineItems.set(editable);
  }

  /**
   * Refresh prices and specs for all line items after params change.
   * Preserves quantities and manufacturer swaps — only re-resolves variants.
   * Hard limit: if a swapped manufacturer no longer has a matching variant,
   * the item keeps its old specs/price until manually swapped again.
   */
  private refreshPrices() {
    const bundle = {
      registry: COMPONENT_REGISTRY,
      lines: this.lines(),
      defaults: this.defaults(),
    };
    const params = this.componentParams();

    this.lineItems.update((items) =>
      items.map((item) => {
        const compId = this.inferComponentId(item.manufacturerId);
        const paramOverrides = params[compId] ?? {};
        const resolved = resolveQuoteLineItem(compId, paramOverrides, bundle);
        if (!resolved) return item;
        const unitPrice = Math.round(resolved.variant.unitCost * 1.3 * 100) / 100;
        return {
          ...item,
          specs: { ...resolved.line.baseSpecs, ...resolved.variant.params },
          unitCost: resolved.variant.unitCost,
          unitPrice,
          lineTotal: Math.round(unitPrice * item.quantity * 100) / 100,
        };
      }),
    );
  }

  protected updateQty(key: string, qty: number) {
    this.lineItems.update((items) =>
      items.map((i) => {
        if (i._key !== key) return i;
        const q = Math.max(0, qty);
        return { ...i, quantity: q, lineTotal: Math.round(i.unitPrice * q * 100) / 100 };
      }),
    );
  }

  protected firstActiveUnitCost(line: ProductLine): number {
    return line.variants.find((v) => v.isActive)?.unitCost ?? 0;
  }

  protected updateParam(componentId: string, paramName: string, value: string) {
    this.componentParams.update((params) => ({
      ...params,
      [componentId]: { ...params[componentId], [paramName]: value },
    }));
    this.refreshPrices();
  }

  protected swapCatalogItem(key: string) {
    this.swappingKey.set(key);
  }

  protected confirmSwap(manufacturerId: string) {
    const key = this.swappingKey();
    if (!key) return;
    const line = this.lines().find((c) => c.id === manufacturerId);
    if (!line) return;

    const compId = line.componentId;
    const paramOverrides = this.componentParams()[compId] ?? {};
    const bundle = {
      registry: COMPONENT_REGISTRY,
      lines: this.lines(),
      defaults: this.defaults(),
    };
    const resolved = resolveQuoteLineItem(compId, paramOverrides, bundle);
    if (!resolved) {
      this.error.set(`No variant found for ${line.name} with params ${JSON.stringify(paramOverrides)}`);
      this.swappingKey.set(null);
      return;
    }

    this.lineItems.update((items) =>
      items.map((i) => {
        if (i._key !== key) return i;
        const unitPrice = Math.round(resolved.variant.unitCost * 1.3 * 100) / 100;
        return {
          ...i,
          manufacturerId: line.id,
          name: line.name,
          manufacturer: line.manufacturer,
          specs: { ...line.baseSpecs, ...resolved.variant.params },
          description: line.description,
          unitCost: resolved.variant.unitCost,
          currency: resolved.variant.currency,
          unitPrice,
          lineTotal: Math.round(unitPrice * i.quantity * 100) / 100,
          selectionHelp: line.selectionHelp,
        };
      }),
    );
    this.swappingKey.set(null);
  }

  protected async saveManifest() {
    try {
      const items = this.lineItems().map((i) => ({
        manufacturerId: i.manufacturerId,
        params: Object.fromEntries(
          Object.entries(i.specs).filter(([k]) => COMPONENT_REGISTRY[this.inferComponentId(i.manufacturerId)]?.parameters.some((p) => p.name === k))
        ),
        quantity: i.quantity,
        unitPriceAtTime: i.unitPrice,
        notes: i.notes,
      }));
      await this.electron.manifestSave(this.siteId(), {
        manifest_type: 'quote',
        items,
      });
      this.history.set(await this.electron.manifestList(this.siteId()));
    } catch (e) {
      this.error.set(String(e));
    }
  }

  protected generateDoc(showPricing: boolean) {
    const quotation = {
      quoteId: 'MANUAL-' + Date.now(),
      generatedAt: new Date().toISOString(),
      siteName: this.siteName(),
      baseInfrastructure: this.baseItems(),
      systemComponents: this.topologyItems(),
      subtotal: this.subtotal(),
      currency: 'USD',
    };
    const html = showPricing
      ? renderQuotationHtml(quotation, { showPricing: true, exchangeRate: 130 })
      : renderTechnicalBomHtml(quotation);
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      setTimeout(() => win.print(), 300);
    }
  }

  private mapRowToProductLine(r: ProductLineRow): ProductLine {
    return {
      id: r.id,
      componentId: r.component_id,
      manufacturer: r.manufacturer,
      name: r.name,
      manufacturerPartNumber: r.manufacturer_pn ?? undefined,
      description: r.description ?? '',
      selectionHelp: r.selection_help ?? undefined,
      reliabilityScore: r.reliability_score ?? undefined,
      baseSpecs: JSON.parse(r.base_specs || '{}'),
      variants: JSON.parse(r.variants || '[]'),
      isActive: r.is_active === 1,
      isUserDefined: r.is_user_defined === 1,
    };
  }

  protected parseItems(itemsJson: string): Array<unknown> {
    try { return JSON.parse(itemsJson); } catch { return []; }
  }

  protected loadManifest(m: ManifestRow) {
    // Future: pre-fill line items from saved manifest
    this.error.set('Loading historical manifests not yet implemented.');
  }
}
