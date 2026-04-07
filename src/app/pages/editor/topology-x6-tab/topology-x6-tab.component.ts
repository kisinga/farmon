import { Component, inject, ElementRef, viewChild, afterNextRender, DestroyRef, computed, signal, effect, Injector } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import type { TopologyNode, PipeSegment } from '../../../core/models/topology.model';
import { NODE_REGISTRY, legendSvgFor, type NodeDescriptor } from '../../../core/models/entities.model';
import { X6Canvas, type Selection } from './x6-canvas';
import { TopologySidebarComponent } from '../shared/topology-sidebar.component';

@Component({
  selector: 'app-topology-x6-tab',
  standalone: true,
  imports: [TopologySidebarComponent],
  host: {
    '(document:keydown.escape)': 'closePopup()',
    '(document:keydown.control.z)': 'doUndo()',
    '(document:keydown.control.y)': 'doRedo()',
    '(document:keydown.meta.z)': 'doUndo()',
    '(document:keydown.meta.shift.z)': 'doRedo()',
    '(document:keydown.delete)': 'deleteSelected()',
    '(document:keydown.backspace)': 'deleteSelected()',
  },
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
        <ul tabindex="0" class="dropdown-content menu menu-xs bg-base-200 rounded-lg shadow-lg z-30 w-48 p-1">
          @for (group of groupedDescs; track group.label) {
            <li class="menu-title text-[9px] uppercase tracking-wider opacity-50 pt-2">{{ group.label }}</li>
            @for (desc of group.items; track desc.kind) {
              <li><a (click)="addNode(desc.kind)" [class.disabled]="desc.singleton && kindExists(desc.kind)">
                <span [innerHTML]="legendSvg(desc)"></span> {{ desc.label }}
                @if (desc.experimental) { <span class="badge badge-ghost badge-xs ml-auto">exp</span> }
              </a></li>
            }
          }
        </ul>
      </div>
      <div class="divider divider-horizontal mx-0 h-4"></div>
      <button class="btn btn-ghost btn-xs" title="Undo" (click)="doUndo()">&#x21A9;</button>
      <button class="btn btn-ghost btn-xs" title="Redo" (click)="doRedo()">&#x21AA;</button>
      <div class="divider divider-horizontal mx-0 h-4"></div>
      <button class="btn btn-ghost btn-xs" (click)="doZoomIn()">+</button>
      <button class="btn btn-ghost btn-xs" (click)="doZoomOut()">&minus;</button>
      <button class="btn btn-ghost btn-xs" (click)="doFit()">Fit</button>
    </div>

    <div class="flex flex-1 min-h-0 overflow-hidden">
      <!-- Canvas -->
      <div class="canvas-wrap flex-1 min-w-0 min-h-0">
        <div #x6canvas></div>
        <div class="legend">
          @for (desc of nodeDescs; track desc.kind) {
            <div class="legend-item">
              <span class="legend-icon" [innerHTML]="legendSvg(desc)"></span>
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
                <span [innerHTML]="legendSvg(desc)"></span> {{ desc.label }}
              </a></li>
            }
          </ul>
        </div>
      }

      <!-- Sidebar -->
      <aside class="sidebar w-64 border-l border-base-300/30 bg-base-100 overflow-y-auto shrink-0">
        <app-topology-sidebar
          [selection]="selection()"
          (deleteNode)="deleteNode($event)"
          (deletePipe)="deletePipe($event)"
          (updateField)="updateNodeField($event.nodeId, $event.field, $event.value)"
          (updateMaxRuntime)="updateMaxRuntime($event.key, $event.value)"
          (selectRoute)="onRouteSelected($event)"
          (selectNode)="onNodeSelected($event)"
        />
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
    :host ::ng-deep .x6-graph { cursor: grab; }
    :host ::ng-deep .x6-graph:active { cursor: grabbing; }
    .canvas-wrap { position: relative; overflow: hidden; min-height: 0; }
    .legend {
      position: absolute; bottom: 12px; left: 12px;
      display: grid; grid-template-columns: 20px 1fr;
      gap: 2px 8px; align-items: center;
      padding: 8px 12px; background: rgba(255,255,255,0.92);
      border: 1px solid #e2e8f0; border-radius: 6px;
      font-size: 10px; font-family: ui-monospace, monospace;
      color: #1e293b; pointer-events: none; z-index: 10;
    }
    .legend-item { display: contents; }
    .legend-icon { display: flex; justify-content: center; align-items: center; }
    .sidebar { font-size: 12px; }
    .node-popup-backdrop { position: fixed; inset: 0; z-index: 50; }
    .node-popup { position: fixed; z-index: 51; }
  `],
})
export class TopologyX6TabComponent {
  protected editor = inject(SystemEditorService);
  private sanitizer = inject(DomSanitizer);
  private injector = inject(Injector);
  private destroyRef = inject(DestroyRef);
  private canvasRef = viewChild.required<ElementRef<HTMLDivElement>>('x6canvas');

  private canvas: X6Canvas | null = null;
  private get c(): X6Canvas { return this.canvas!; }

  // Registry arrays for template iteration
  protected nodeDescs: NodeDescriptor[] = Array.from(NODE_REGISTRY.values());

  protected groupedDescs = (() => {
    const groups = new Map<string, NodeDescriptor[]>();
    for (const desc of this.nodeDescs) {
      const key = desc.group ?? desc.category ?? 'other';
      const list = groups.get(key) ?? [];
      list.push(desc);
      groups.set(key, list);
    }
    return [...groups.entries()].map(([label, items]) => ({ label, items }));
  })();

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

  constructor() {
    afterNextRender(() => {
      this.initCanvas();
      this.doInitialRender();
    });
  }

  private doInitialRender() {
    const t = this.editor.topology();
    if (t) {
      this.c.reset(t);
      return;
    }
    const stop = effect(() => {
      const t = this.editor.topology();
      if (t) {
        this.c.reset(t);
        queueMicrotask(() => stop.destroy());
      }
    }, { injector: this.injector });
    this.destroyRef.onDestroy(() => stop.destroy());
  }

  // --- Template helpers ---

  trustSvg(svg: string) {
    return this.sanitizer.bypassSecurityTrustHtml(svg);
  }

  legendSvg(desc: NodeDescriptor) {
    return this.trustSvg(legendSvgFor(desc));
  }

  kindExists(kind: string): boolean {
    const t = this.editor.topology();
    return t ? t.nodes.some(n => n.kind === kind) : false;
  }

  private initCanvas() {
    const canvasEl = this.canvasRef().nativeElement;
    const canvasWrap = canvasEl.parentElement!;

    this.canvas = new X6Canvas(canvasEl, {
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
        const t = this.editor.topology();
        if (t) this.c.highlight(sel, t);
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

    (document.activeElement as HTMLElement)?.blur();

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
  doUndo() { this.c.undo(); }
  doRedo() { this.c.redo(); }

  deleteSelected() {
    const sel = this.selection();
    if (!sel) return;
    if (sel.kind === 'node') {
      // Don't allow deleting singleton nodes via keyboard
      const t = this.editor.topology();
      if (t) {
        const node = t.nodes.find(n => n.id === sel.nodeId);
        if (node) {
          const desc = NODE_REGISTRY.get(node.kind);
          if (desc?.singleton) return;
        }
      }
      this.deleteNode(sel.nodeId);
    } else if (sel.kind === 'pipe') {
      this.deletePipe(sel.pipeId);
    }
  }

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
      if (node) Object.assign(node, { [field]: value });
    });
    // Push to X6 for live SVG update without full re-render
    this.c.render(this.editor.topology()!);
  }

  // --- Pipe editing ---

  deletePipe(pipeId: string) {
    this.editor.updateTopology(t => {
      t.pipes = t.pipes.filter(p => p.id !== pipeId);
    });
    this.selection.set(null);
    this.c.render(this.editor.topology()!);
  }

  // --- Route selection ---

  onRouteSelected(ev: { route: import('../shared/derive-routes').DerivedRoute; sharedNodeIds?: string[] }) {
    const sel: Selection = { kind: 'route', route: ev.route, sharedNodeIds: ev.sharedNodeIds };
    this.selection.set(sel);
    const t = this.editor.topology();
    if (t) this.c.highlight(sel, t);
  }

  onNodeSelected(nodeId: string) {
    const sel: Selection = { kind: 'node', nodeId };
    this.selection.set(sel);
    const t = this.editor.topology();
    if (t) this.c.highlight(sel, t);
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
