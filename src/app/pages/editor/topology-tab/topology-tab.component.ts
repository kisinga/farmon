import { Component, inject, ElementRef, viewChild, afterNextRender, DestroyRef, computed, signal, effect, Injector } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import type { TopologyNode, PipeSegment } from '../../../core/models/topology.model';
import { NODE_REGISTRY, type NodeDescriptor } from '../../../core/models/entities.model';
import { TopologyCanvas, type Selection } from './topology-canvas';
import { deriveRoutes } from './derive-routes';

@Component({
  selector: 'app-topology-tab',
  standalone: true,
  imports: [FormsModule],
  host: { '(document:keydown.escape)': 'closePopup()' },
  template: `
    <!-- Toolbar -->
    <div class="flex items-center gap-2 px-4 py-2 border-b border-base-300/30 bg-base-200/30">
      <h2 class="text-sm font-semibold text-base-content/70">Design</h2>
      <div class="flex-1"></div>
      <div class="dropdown dropdown-end">
        <div tabindex="0" role="button" class="btn btn-ghost btn-xs gap-1">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Node
        </div>
        <ul tabindex="0" class="dropdown-content menu menu-xs bg-base-200 rounded-lg shadow-lg z-30 w-40 p-1">
          @for (desc of nodeDescs; track desc.kind) {
            <li><a (click)="addNode(desc.kind)" [class.disabled]="desc.singleton && kindExists(desc.kind)">
              <span [innerHTML]="trustSvg(desc.legendSvg)"></span> {{ desc.label }}
            </a></li>
          }
        </ul>
      </div>
      <div class="divider divider-horizontal mx-0 h-4"></div>
      <button class="btn btn-ghost btn-xs" (click)="doZoomIn()">+</button>
      <button class="btn btn-ghost btn-xs" (click)="doZoomOut()">&minus;</button>
      <button class="btn btn-ghost btn-xs" (click)="doFit()">Fit</button>
    </div>

    <div class="flex flex-1 min-h-0 overflow-hidden">
      <!-- Canvas -->
      <div class="canvas-wrap flex-1 min-w-0">
        <div #canvas></div>
        <div class="legend">
          @for (desc of nodeDescs; track desc.kind) {
            <div class="legend-item">
              <span class="legend-swatch" [class.legend-circle]="desc.kind === 'pump'" [class.legend-dashed]="desc.kind === 'endpoint'" [style.border-color]="desc.color"></span>
              <span>{{ desc.label }}</span>
            </div>
          }
        </div>
      </div>

      <!-- Node selector popup (shown when pipe dropped on empty space) -->
      @if (nodePopup(); as popup) {
        <div class="node-popup-backdrop" (click)="closePopup()"></div>
        <div class="node-popup" [style.left.px]="popup.clientPos.x" [style.top.px]="popup.clientPos.y">
          <ul class="menu menu-xs bg-base-200 rounded-lg shadow-lg w-40 p-1">
            @for (desc of popupDescs(); track desc.kind) {
              <li><a (click)="selectPopupNode(desc.kind)">
                <span [innerHTML]="trustSvg(desc.legendSvg)"></span> {{ desc.label }}
              </a></li>
            }
          </ul>
        </div>
      }

      <!-- Sidebar -->
      <aside class="sidebar w-64 border-l border-base-300/30 bg-base-100 overflow-y-auto shrink-0">

        <!-- Node properties (data-driven) -->
        @if (selectedNodeData(); as sn) {
          <div class="sidebar-section">
            <h3 class="sidebar-title">{{ sn.desc.label }}</h3>
            <div class="sidebar-fields">
              @for (field of sn.desc.sidebarFields; track field.key) {
                <label class="sidebar-label">{{ field.label }}</label>
                @if (field.type === 'pin') {
                  <div class="flex items-center gap-2">
                    <input class="input input-xs input-bordered flex-1 font-mono"
                      [ngModel]="$any(sn.node)[field.key]"
                      (ngModelChange)="updateNodeField(sn.node.id, field.key, $event)"
                      [placeholder]="field.placeholder ?? ''" />
                    @if (field.pinCap === 'adc') {
                      @if (editor.adcPins().has($any(sn.node)[field.key])) {
                        <span class="badge badge-success badge-xs">ADC</span>
                      } @else if ($any(sn.node)[field.key]) {
                        <span class="badge badge-error badge-xs">No ADC</span>
                      }
                    }
                  </div>
                } @else if (field.type === 'number') {
                  <input type="number" class="input input-xs input-bordered w-full font-mono"
                    [ngModel]="$any(sn.node)[field.key]"
                    (ngModelChange)="updateNodeField(sn.node.id, field.key, +$event)" min="0" />
                } @else {
                  <input class="input input-xs input-bordered w-full font-mono"
                    [ngModel]="$any(sn.node)[field.key]"
                    (ngModelChange)="updateNodeField(sn.node.id, field.key, $event)" />
                }
              }
            </div>
            @if (!sn.desc.singleton) {
              <button class="btn btn-error btn-xs mt-3 w-full" (click)="deleteNode(sn.node.id)">Delete {{ sn.desc.label }}</button>
            }
          </div>
        }

        <!-- Pipe properties -->
        @if (selectedPipeData(); as pipeData) {
          <div class="sidebar-section">
            <h3 class="sidebar-title">Pipe</h3>
            <div class="text-xs font-mono text-base-content/60 mb-2">{{ pipeData.pipe.from }} &rarr; {{ pipeData.pipe.to }}</div>
            <button class="btn btn-error btn-xs w-full" (click)="deletePipe(pipeData.pipe.id)">Delete Pipe</button>
          </div>
        }

        <!-- Routes (default view when nothing selected) -->
        @if (!selection()) {
          <div class="sidebar-section">
            <h3 class="sidebar-title">Derived Routes</h3>
            @if (derivedRoutes().length === 0) {
              <div class="text-base-content/40 text-center py-4 text-xs">No routes derived yet.<br>Connect nodes with pipes.</div>
            } @else {
              @for (route of derivedRoutes(); track route.key) {
                <div class="flex items-center justify-between py-1.5 border-b border-base-300/20">
                  <span class="font-mono text-xs">{{ route.key }}</span>
                  <span class="badge badge-xs" [class.badge-success]="route.valid" [class.badge-ghost]="!route.valid">
                    {{ route.valid ? 'Valid' : 'Incomplete' }}
                  </span>
                </div>
              }
            }
          </div>

          <div class="sidebar-section">
            <h3 class="sidebar-title">Route Overrides</h3>
            @if (overrideEntries().length === 0) {
              <div class="text-base-content/40 text-center py-4 text-xs">No overrides defined.</div>
            } @else {
              @for (entry of overrideEntries(); track entry.key) {
                <div class="card bg-base-200/40 mb-2">
                  <div class="card-body p-2 gap-1">
                    <span class="font-mono font-semibold text-xs">{{ entry.override.name ?? entry.key }}</span>
                    <div class="flex items-center gap-2">
                      <label class="text-[10px] text-base-content/50">Max Runtime</label>
                      <input type="number" class="input input-xs input-bordered w-20 font-mono"
                        [ngModel]="entry.override.max_runtime_seconds ?? 1800"
                        (ngModelChange)="updateMaxRuntime(entry.key, $event)" min="0" step="60" />
                      <span class="text-[10px] text-base-content/50">s</span>
                    </div>
                  </div>
                </div>
              }
            }
          </div>
        }
      </aside>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }
    :host ::ng-deep .joint-paper { border: none !important; cursor: grab; }
    :host ::ng-deep .joint-paper:active { cursor: grabbing; }
    .canvas-wrap { position: relative; }
    .legend {
      position: absolute; bottom: 12px; left: 12px;
      display: flex; flex-direction: column; gap: 4px;
      padding: 8px 10px; background: rgba(255,255,255,0.92);
      border: 1px solid #e2e8f0; border-radius: 6px;
      font-size: 10px; font-family: ui-monospace, monospace;
      color: #1e293b; pointer-events: none; z-index: 10;
    }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .legend-swatch {
      display: inline-block; width: 16px; height: 12px;
      border: 2.5px solid; border-radius: 2px; background: #f8fafc;
    }
    .legend-swatch.legend-circle { border-radius: 50%; width: 14px; height: 14px; }
    .legend-swatch.legend-dashed { border-style: dashed; border-width: 2px; border-radius: 4px; }
    .sidebar { font-size: 12px; }
    .sidebar-section { padding: 12px; border-bottom: 1px solid oklch(var(--b3) / 0.3); }
    .sidebar-title {
      font-size: 10px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.05em; color: oklch(var(--bc) / 0.5); margin-bottom: 8px;
    }
    .sidebar-fields { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: center; }
    .sidebar-label { font-size: 10px; color: oklch(var(--bc) / 0.5); white-space: nowrap; }
    .node-popup-backdrop { position: fixed; inset: 0; z-index: 50; }
    .node-popup { position: fixed; z-index: 51; }
  `],
})
export class TopologyTabComponent {
  protected editor = inject(SystemEditorService);
  private sanitizer = inject(DomSanitizer);
  private injector = inject(Injector);
  private destroyRef = inject(DestroyRef);
  private canvasRef = viewChild.required<ElementRef<HTMLDivElement>>('canvas');

  private canvas: TopologyCanvas | null = null;
  private get c(): TopologyCanvas { return this.canvas!; }

  // Registry arrays for template iteration
  protected nodeDescs: NodeDescriptor[] = Array.from(NODE_REGISTRY.values());

  // --- Selection state ---
  protected selection = signal<Selection | null>(null);

  // --- Node popup state (pipe dropped on empty space) ---
  protected nodePopup = signal<{
    from: string;
    graphPos: { x: number; y: number };
    clientPos: { x: number; y: number };
  } | null>(null);

  protected popupDescs = computed(() => {
    if (!this.nodePopup()) return [];
    return this.nodeDescs.filter(desc => {
      if (desc.singleton && this.kindExists(desc.kind)) return false;
      return desc.defaultPorts.some(p => p.direction === 'inlet');
    });
  });

  protected selectedNodeData = computed(() => {
    const sel = this.selection();
    const t = this.editor.topology();
    if (!sel || sel.kind !== 'node' || !t) return null;
    const node = t.nodes.find(n => n.id === sel.nodeId);
    if (!node) return null;
    const desc = NODE_REGISTRY.get(node.kind);
    return desc ? { node, desc } : null;
  });

  protected selectedPipeData = computed(() => {
    const sel = this.selection();
    const t = this.editor.topology();
    if (!sel || sel.kind !== 'pipe' || !t) return null;
    const pipe = t.pipes.find(p => p.id === sel.pipeId);
    return pipe ? { pipe } : null;
  });

  protected derivedRoutes = computed(() => {
    const t = this.editor.topology();
    return t ? deriveRoutes(t) : [];
  });

  protected overrideEntries = computed(() => {
    const t = this.editor.topology();
    if (!t) return [];
    return Object.entries(t.route_overrides).map(([key, override]) => ({ key, override }));
  });

  constructor() {
    afterNextRender(() => {
      this.initCanvas();
      this.doInitialRender();
    });
  }

  private doInitialRender() {
    const t = this.editor.topology();
    if (t) {
      this.c.render(t);
      return;
    }
    const stop = effect(() => {
      const t = this.editor.topology();
      if (t) {
        this.c.render(t);
        queueMicrotask(() => stop.destroy());
      }
    }, { injector: this.injector });
    this.destroyRef.onDestroy(() => stop.destroy());
  }

  // --- Template helpers ---

  trustSvg(svg: string) {
    return this.sanitizer.bypassSecurityTrustHtml(svg);
  }

  kindExists(kind: string): boolean {
    const t = this.editor.topology();
    return t ? t.nodes.some(n => n.kind === kind) : false;
  }

  private initCanvas() {
    const canvasEl = this.canvasRef().nativeElement;
    const canvasWrap = canvasEl.parentElement!;

    this.canvas = new TopologyCanvas(canvasEl, {
      onNodesMoved: (positions) => {
        this.editor.updateTopology(t => {
          for (const node of t.nodes) {
            const pos = positions.get(node.id);
            if (pos) node.position = pos;
          }
        });
      },
      onPipeCreated: (from, to) => {
        this.editor.updateTopology(t => {
          t.pipes.push({ id: this.nextPipeId(t), from, to });
        });
        this.c.render(this.editor.topology()!);
      },
      onPipeDeleted: (pipeId) => {
        this.editor.updateTopology(t => {
          t.pipes = t.pipes.filter(p => p.id !== pipeId);
        });
        this.selection.set(null);
        this.c.render(this.editor.topology()!);
      },
      onSelected: (sel) => {
        this.selection.set(sel);
        this.c.highlight(sel);
      },
      onDanglingPipe: (from, graphPos, clientPos) => {
        this.nodePopup.set({ from, graphPos, clientPos });
      },
    });

    this.destroyRef.onDestroy(() => this.c.destroy());

    const syncSize = () => {
      const w = canvasWrap.clientWidth;
      const h = canvasWrap.clientHeight;
      this.c.resize(w, h);
    };

    const observer = new ResizeObserver(() => syncSize());
    observer.observe(canvasWrap);
    this.destroyRef.onDestroy(() => observer.disconnect());

    syncSize();
  }

  // --- Toolbar actions ---

  addNode(kind: string) {
    const desc = NODE_REGISTRY.get(kind);
    if (!desc) return;
    if (desc.singleton && this.kindExists(kind)) return;

    const center = this.c.getViewportCenter();

    this.editor.updateTopology(t => {
      const existing = t.nodes.filter(n => n.kind === kind).length;
      const n = existing + 1;
      const id = desc.singleton ? kind : `${kind}${n}`;
      t.nodes.push({
        kind,
        id,
        ...desc.defaultData(n),
        ports: desc.defaultPorts.map(p => ({ ...p })),
        position: { x: center.x - desc.size.width / 2, y: center.y - desc.size.height / 2 },
      } as TopologyNode);
    });
    this.c.render(this.editor.topology()!);
  }

  doZoomIn() { this.c.zoomIn(); }
  doZoomOut() { this.c.zoomOut(); }
  doFit() { this.c.fitContent(); }

  // --- Node editing ---

  deleteNode(nodeId: string) {
    this.editor.updateTopology(t => {
      t.nodes = t.nodes.filter(n => n.id !== nodeId);
      t.pipes = t.pipes.filter(p => {
        const fn = p.from.split(':')[0];
        const tn = p.to.split(':')[0];
        return fn !== nodeId && tn !== nodeId;
      });
      for (const key of Object.keys(t.route_overrides)) {
        if (key.includes(nodeId)) delete t.route_overrides[key];
      }
    });
    this.selection.set(null);
    this.c.render(this.editor.topology()!);
  }

  updateNodeField(nodeId: string, field: string, value: any) {
    this.editor.updateTopology(t => {
      const node = t.nodes.find(n => n.id === nodeId);
      if (node) (node as any)[field] = value;
    });
  }

  // --- Pipe editing ---

  deletePipe(pipeId: string) {
    this.editor.updateTopology(t => {
      t.pipes = t.pipes.filter(p => p.id !== pipeId);
    });
    this.selection.set(null);
    this.c.render(this.editor.topology()!);
  }

  // --- Route overrides ---

  updateMaxRuntime(key: string, value: number) {
    this.editor.updateTopology(t => {
      if (t.route_overrides[key]) t.route_overrides[key].max_runtime_seconds = value;
    });
  }

  // --- Node popup ---

  selectPopupNode(kind: string) {
    const popup = this.nodePopup();
    if (!popup) return;
    this.nodePopup.set(null);

    const desc = NODE_REGISTRY.get(kind);
    if (!desc) return;
    if (desc.singleton && this.kindExists(kind)) return;

    this.editor.updateTopology(t => {
      const existing = t.nodes.filter(n => n.kind === kind).length;
      const n = existing + 1;
      const id = desc.singleton ? kind : `${kind}${n}`;
      t.nodes.push({
        kind,
        id,
        ...desc.defaultData(n),
        ports: desc.defaultPorts.map(p => ({ ...p })),
        position: popup.graphPos,
      } as TopologyNode);

      const inletPort = desc.defaultPorts.find(p => p.direction === 'inlet');
      if (inletPort) {
        t.pipes.push({ id: this.nextPipeId(t), from: popup.from, to: `${id}:${inletPort.id}` });
      }
    });
    this.c.render(this.editor.topology()!);
  }

  closePopup() {
    this.nodePopup.set(null);
  }

  // --- Helpers ---

  private nextPipeId(t: { pipes: PipeSegment[] }): string {
    const nums = t.pipes
      .map(p => p.id.match(/^pipe(\d+)$/))
      .filter(Boolean)
      .map(m => parseInt(m![1], 10));
    return `pipe${Math.max(0, ...nums) + 1}`;
  }
}
