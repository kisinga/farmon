import { Component, inject, ElementRef, viewChild, afterNextRender, DestroyRef, computed, signal, effect, Injector } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import { WorkspaceService } from '../../../core/services/workspace.service';
import type { SystemTopology, TopologyNode } from '../../../core/models/topology.model';
import { NODE_REGISTRY, legendSvgFor, type NodeDescriptor } from '../../../core/models/entities.model';
import { X6Canvas, type Selection } from './x6-canvas';
import { svgDataUri } from './scada-shape';
import { TopologySidebarComponent } from '../shared/topology-sidebar.component';
import { buildGraph, activeGraph, downstreamNodes } from '@far-mon/core';

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
    '(document:keydown.delete)': 'deleteSelected($event)',
    '(document:keydown.backspace)': 'deleteSelected($event)',
  },
  template: `
    <!-- Toolbar -->
    <div class="flex items-center gap-2 px-4 py-2 border-b border-base-300/30 bg-base-200/30">
      <h2 class="text-sm font-semibold text-base-content/70">Design</h2>
      <div class="flex-1"></div>
      @if (!editor.readonly()) {
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
      }
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
    :host-context(.preview) .sidebar input,
    :host-context(.preview) .sidebar select,
    :host-context(.preview) .sidebar .toggle,
    :host-context(.preview) .sidebar button.btn-error,
    :host-context(.preview) .sidebar button[title="Delete"] {
      pointer-events: none;
      opacity: 0.5;
    }
    .node-popup-backdrop { position: fixed; inset: 0; z-index: 50; }
    .node-popup { position: fixed; z-index: 51; }
  `],
})
export class TopologyX6TabComponent {
  protected editor = inject(SystemEditorService);
  private workspace = inject(WorkspaceService);
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

  /** Render and capture PNG snapshot for documentation. */
  private renderAndSnapshot(topology: SystemTopology) {
    this.c.render(topology);
    this.renderInterconnectLabels();
    // Defer snapshot to next frame so X6 finishes layout
    requestAnimationFrame(() => this.c.exportSvg().then(svg => this.editor.setCanvasSvg(svg)).catch(e => console.error('[MajiFlow] SVG export failed:', e)));
  }

  private doInitialRender() {
    const t = this.editor.topology();
    if (t) {
      this.c.reset(t);
      this.renderInterconnectLabels();
      requestAnimationFrame(() => this.c.exportSvg().then(svg => this.editor.setCanvasSvg(svg)).catch(e => console.error('[MajiFlow] SVG export failed:', e)));
      return;
    }
    const stop = effect(() => {
      const t = this.editor.topology();
      if (t) {
        this.c.reset(t);
        this.renderInterconnectLabels();
        requestAnimationFrame(() => this.c.exportSvg().then(svg => this.editor.setCanvasSvg(svg)).catch(e => console.error('[MajiFlow] SVG export failed:', e)));
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
        const pipeId = this.editor.nextPipeId();
        this.editor.updateTopology(t => {
          t.pipes.push({ id: pipeId, from, to });
        });
        this.renderAndSnapshot(this.editor.topology()!);
      },
      onPipeDeleted: (pipeId) => {
        this.editor.updateTopology(t => {
          t.pipes = t.pipes.filter(p => p.id !== pipeId);
        });
        this.selection.set(null);
        this.renderAndSnapshot(this.editor.topology()!);
      },
      onSelected: (sel) => {
        this.selection.set(sel);
        const t = this.editor.topology();
        if (t) this.c.highlight(sel, activeGraph(buildGraph(t.nodes, t.pipes)));
      },
      onDanglingPipe: (from, graphPos, clientPos) => {
        this.nodePopup.set({ from, graphPos, clientPos });
      },
    });

    if (this.editor.readonly()) {
      this.canvas.setReadonly(true);
    }

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

    // Generate site-wide unique ID before the topology update
    const id = desc.singleton ? kind : this.editor.nextNodeId(kind);

    this.editor.updateTopology(t => {
      const n = t.nodes.filter(n => n.kind === kind).length + 1;
      t.nodes.push({
        kind,
        id,
        ...desc.defaultData(n),
        ports: desc.defaultPorts.map(p => ({ ...p })),
        position: { x: center.x - desc.size.width / 2, y: center.y - desc.size.height / 2 },
      } as TopologyNode);
    });
    this.renderAndSnapshot(this.editor.topology()!);
  }

  doZoomIn() { this.c.zoomIn(); }
  doZoomOut() { this.c.zoomOut(); }
  doFit() { this.c.fitContent(); }
  doUndo() { this.c.undo(); }
  doRedo() { this.c.redo(); }

  deleteSelected(e?: Event) {
    if (e) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return;
    }
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
      for (const key of Object.keys(t.route_overrides ?? {})) {
        if (key.includes(nodeId)) delete t.route_overrides[key];
      }
    });
    this.selection.set(null);
    this.renderAndSnapshot(this.editor.topology()!);
  }

  updateNodeField(nodeId: string, field: string, value: any) {
    this.editor.updateTopology(t => {
      const node = t.nodes.find(n => n.id === nodeId);
      if (node) Object.assign(node, { [field]: value });

      // Cascade disabled state to all downstream nodes
      if (field === 'disabled') {
        const g = buildGraph(t.nodes, t.pipes);
        const dsIds = downstreamNodes(g, nodeId);
        for (const dsId of dsIds) {
          const dn = t.nodes.find(n => n.id === dsId);
          if (dn) Object.assign(dn, { disabled: value });
        }
      }
    });
    // Push to X6 for live SVG update without full re-render
    this.renderAndSnapshot(this.editor.topology()!);
  }


  // --- Pipe editing ---

  deletePipe(pipeId: string) {
    this.editor.updateTopology(t => {
      t.pipes = t.pipes.filter(p => p.id !== pipeId);
    });
    this.selection.set(null);
    this.renderAndSnapshot(this.editor.topology()!);
  }

  // --- Route selection ---

  onRouteSelected(ev: { route: import('../shared/derive-routes').DerivedRoute; sharedNodeIds?: string[] }) {
    const sel: Selection = { kind: 'route', route: ev.route, sharedNodeIds: ev.sharedNodeIds };
    this.selection.set(sel);
    const t = this.editor.topology();
    if (t) this.c.highlight(sel, activeGraph(buildGraph(t.nodes, t.pipes)));
  }

  onNodeSelected(nodeId: string) {
    const sel: Selection = { kind: 'node', nodeId };
    this.selection.set(sel);
    const t = this.editor.topology();
    if (t) this.c.highlight(sel, activeGraph(buildGraph(t.nodes, t.pipes)));
  }

  // --- Route overrides ---

  updateMaxRuntime(key: string, value: number) {
    this.editor.updateTopology(t => {
      if (t.route_overrides?.[key]) t.route_overrides[key].max_runtime_seconds = value;
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

    // Generate site-wide unique IDs before the topology update
    const id = desc.singleton ? kind : this.editor.nextNodeId(kind);
    const pipeId = this.editor.nextPipeId();

    this.editor.updateTopology(t => {
      const n = t.nodes.filter(n => n.kind === kind).length + 1;
      t.nodes.push({
        kind,
        id,
        ...desc.defaultData(n),
        ports: desc.defaultPorts.map(p => ({ ...p })),
        position: popup.graphPos,
      } as TopologyNode);

      const inletPort = desc.defaultPorts.find(p => p.direction === 'inlet');
      if (inletPort) {
        t.pipes.push({ id: pipeId, from: popup.from, to: `${id}:${inletPort.id}` });
      }
    });
    this.renderAndSnapshot(this.editor.topology()!);
  }

  closePopup() {
    this.nodePopup.set(null);
  }

  // --- Interconnect connection labels ---

  /**
   * Inject _connectionLabel into interconnect node data so renderSvg shows the
   * connected system name inside the node SVG itself.
   * Same pattern as compositeTopology uses for the site canvas.
   */
  private renderInterconnectLabels() {
    const systemId = this.workspace.activeSystemId();
    const links = this.workspace.links();
    const systems = this.workspace.systems();
    const topology = this.editor.topology();
    if (!systemId || !topology) return;

    // Build nodeId → connection info map
    const connMap = new Map<string, { label: string; dir: 'out' | 'in' }>();
    for (const link of links) {
      if (link.fromSystem === systemId) {
        const remoteName = systems.get(link.toSystem)?.topology.device.friendly_name ?? link.toSystem;
        connMap.set(link.fromNode, { label: remoteName, dir: 'out' });
      }
      if (link.toSystem === systemId) {
        const remoteName = systems.get(link.fromSystem)?.topology.device.friendly_name ?? link.fromSystem;
        connMap.set(link.toNode, { label: remoteName, dir: 'in' });
      }
    }

    if (connMap.size === 0) return;

    const graph = this.c.graphInstance;

    // Remove old ghost edges
    for (const cell of [...graph.getCells()]) {
      if (String(cell.id).startsWith('interconnect-ghost-')) cell.remove();
    }

    // Find nodes connected to interconnects via pipes
    // interconnectOutlets: interconnect outlet → node inlet (outgoing interconnect feeds into a node)
    // interconnectInlets: node outlet → interconnect inlet (node feeds into incoming interconnect)
    const nodesFromInterconnect = new Map<string, { interconnectId: string; dir: 'out' | 'in' }>();
    for (const pipe of topology.pipes) {
      const [fromNode] = pipe.from.split(':');
      const [toNode] = pipe.to.split(':');
      const fromConn = connMap.get(fromNode);
      const toConn = connMap.get(toNode);
      // Outgoing interconnect's outlet connects to a downstream node's inlet
      if (fromConn?.dir === 'out') {
        nodesFromInterconnect.set(toNode, { interconnectId: fromNode, dir: 'in' });
      }
      // A node's outlet connects to incoming interconnect's inlet
      if (toConn?.dir === 'in') {
        nodesFromInterconnect.set(fromNode, { interconnectId: toNode, dir: 'out' });
      }
    }

    // Re-render interconnect nodes with connection data + add ghost edges
    for (const node of topology.nodes) {
      if (node.kind !== 'interconnect') continue;
      const conn = connMap.get(node.id);
      if (!conn) continue;

      const cell = graph.getCellById(`node-${node.id}`);
      if (!cell?.isNode()) continue;

      // Update SVG with connection label
      const enriched = { ...node, _connectionLabel: conn.label, _connectionDir: conn.dir };
      cell.setAttrByPath('image/xlinkHref', svgDataUri('interconnect', enriched));
      cell.resize(cell.getSize().width, 66);

      // Ghost edge on outlet side for outgoing interconnects
      if (conn.dir === 'out') {
        this.addGhostEdge(graph, cell, 'out', node.id);
      }
      // Ghost edge on inlet side for incoming interconnects
      if (conn.dir === 'in') {
        this.addGhostEdge(graph, cell, 'in', node.id);
      }
    }

    // Add ghost edges on nodes connected to interconnects
    for (const [nodeId, { interconnectId, dir }] of nodesFromInterconnect) {
      const cell = graph.getCellById(`node-${nodeId}`);
      if (!cell?.isNode()) continue;
      this.addGhostEdge(graph, cell, dir, `${nodeId}-from-${interconnectId}`);
    }
  }

  private addGhostEdge(graph: any, cell: any, side: 'in' | 'out', idSuffix: string) {
    const pos = cell.getPosition();
    const size = cell.getSize();
    const midY = pos.y + Math.min(size.height, 50) / 2; // use base height for port alignment

    if (side === 'out') {
      const startX = pos.x + size.width + 8;
      graph.addEdge({
        id: `interconnect-ghost-out-${idSuffix}`,
        source: { x: startX, y: midY },
        target: { x: startX + 60, y: midY },
        attrs: {
          line: { stroke: '#8b5cf6', strokeWidth: 2.5, strokeDasharray: '6,4', strokeOpacity: 0.4, targetMarker: null, sourceMarker: null },
        },
      });
    } else {
      const endX = pos.x - 8;
      graph.addEdge({
        id: `interconnect-ghost-in-${idSuffix}`,
        source: { x: endX - 60, y: midY },
        target: { x: endX, y: midY },
        attrs: {
          line: { stroke: '#0891b2', strokeWidth: 2.5, strokeDasharray: '6,4', strokeOpacity: 0.4, targetMarker: null, sourceMarker: null },
        },
      });
    }
  }
}
