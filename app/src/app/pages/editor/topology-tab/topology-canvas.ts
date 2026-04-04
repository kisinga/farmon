/**
 * Framework-agnostic JointJS topology canvas manager.
 * Owns Graph + Paper lifecycle. Knows nothing about Angular.
 * All entity-specific logic is driven by registries.
 */
import * as joint from 'jointjs';
import { NODE_REGISTRY, INLINE_REGISTRY } from '../../../core/models/entities.model';
import { UI_COLORS } from '../../../core/models/colors.model';
import type { SystemTopology, PipeSegment, TopologyNode } from '../../../core/models/topology.model';
import {
  createNodeElement,
  createInlineElement,
  createPipeSubLink,
  createDragLink,
} from './symbols';

// --- Types ---

export type Selection =
  | { kind: 'node'; nodeId: string }
  | { kind: 'pipe'; pipeId: string }
  | { kind: 'component'; componentId: string; pipeId: string };

export interface CanvasEvents {
  onNodesMoved(positions: Map<string, { x: number; y: number }>): void;
  onPipeCreated(from: string, to: string): void;
  onPipeDeleted(pipeId: string): void;
  onSelected(selection: Selection | null): void;
}

// --- Canvas class ---

export class TopologyCanvas {
  private graph: joint.dia.Graph;
  private paper: joint.dia.Paper;
  private events: CanvasEvents;

  private nodeCenters = new Map<string, { x: number; y: number }>();
  private compLabels = new Map<string, string>();
  private compToPipe = new Map<string, string>();

  private isPanning = false;
  private panStart = { x: 0, y: 0 };
  private positionTimer: ReturnType<typeof setTimeout> | null = null;
  private rendering = false;
  private selectedPipeId: string | null = null;

  constructor(container: HTMLElement, events: CanvasEvents) {
    this.events = events;
    this.graph = new joint.dia.Graph();

    this.paper = new joint.dia.Paper({
      el: container,
      model: this.graph,
      width: 800,
      height: 600,
      gridSize: 10,
      drawGrid: { name: 'dot', args: { color: '#e2e8f0' } },
      background: { color: '#fafbfc' },
      interactive: { elementMove: true, addLinkFromMagnet: true },
      linkPinning: false,
      snapLinks: { radius: 30 },
      markAvailable: true,
      multiLinks: false,
      defaultLink: () => createDragLink(),
      defaultRouter: { name: 'manhattan' },
      defaultConnector: { name: 'rounded' },
      validateMagnet: (_view: any, magnet: SVGElement) =>
        magnet.getAttribute('port-group') === 'outlet',
      validateConnection: (cellViewS: any, _mS: any, cellViewT: any, magnetT: any) => {
        if (cellViewS.model.id === cellViewT.model.id) return false;
        if (magnetT?.getAttribute('port-group') !== 'inlet') return false;
        const srcId = String(cellViewS.model.id);
        const tgtId = String(cellViewT.model.id);
        return srcId.startsWith('node-') && tgtId.startsWith('node-');
      },
    } as any);

    this.wireEvents();
  }

  // --- Public API ---

  render(topology: SystemTopology): void {
    const hasContent = this.graph.getCells().length > 0;
    const viewport = hasContent ? this.saveViewport() : null;

    if (this.positionTimer) {
      clearTimeout(this.positionTimer);
      this.positionTimer = null;
    }

    this.rendering = true;
    this.graph.clear();
    this.nodeCenters.clear();
    this.compLabels.clear();

    this.buildCompLabels(topology);

    for (const node of topology.nodes) {
      const el = this.buildNodeElement(node);
      if (el) {
        this.graph.addCell(el);
        const desc = NODE_REGISTRY.get(node.kind);
        if (desc) {
          this.nodeCenters.set(node.id, {
            x: node.position.x + desc.size.width / 2,
            y: node.position.y + desc.size.height / 2,
          });
        }
      }
    }

    for (const pipe of topology.pipes) {
      const cells = this.buildPipeCells(pipe);
      this.graph.addCells(cells);
    }

    this.rendering = false;

    if (viewport) {
      this.restoreViewport(viewport);
    } else {
      setTimeout(() => this.fitContent(), 50);
    }
  }

  addPipeCells(pipe: PipeSegment, topology: SystemTopology): void {
    this.rendering = true;
    this.buildCompLabels(topology);
    const cells = this.buildPipeCells(pipe);
    this.graph.addCells(cells);
    this.rendering = false;
  }

  removePipeCells(pipeId: string, componentIds: string[]): void {
    const toRemove: joint.dia.Cell[] = [];
    for (const cell of this.graph.getCells()) {
      const id = String(cell.id);
      if (id.startsWith(`pipe-${pipeId}`)) toRemove.push(cell);
    }
    for (const compId of componentIds) {
      const cell = this.graph.getCell(`comp-${compId}` as any);
      if (cell) toRemove.push(cell);
    }
    if (toRemove.length > 0) {
      this.graph.removeCells(toRemove);
    }
  }

  highlight(selection: Selection | null): void {
    if (this.selectedPipeId) {
      for (const link of this.graph.getLinks()) {
        const id = String(link.id);
        if (id.startsWith(`pipe-${this.selectedPipeId}`)) {
          link.attr('line/stroke', UI_COLORS.pipe);
          link.attr('line/strokeWidth', 2.5);
        }
      }
    }

    this.selectedPipeId = selection?.kind === 'pipe' ? selection.pipeId : null;

    if (this.selectedPipeId) {
      for (const link of this.graph.getLinks()) {
        const id = String(link.id);
        if (id.startsWith(`pipe-${this.selectedPipeId}`)) {
          link.attr('line/stroke', UI_COLORS.selected);
          link.attr('line/strokeWidth', 3.5);
        }
      }
    }
  }

  zoomIn(): void {
    const s = this.paper.scale();
    this.paper.scale(s.sx * 1.2, s.sy * 1.2);
  }

  zoomOut(): void {
    const s = this.paper.scale();
    this.paper.scale(s.sx / 1.2, s.sy / 1.2);
  }

  fitContent(): void {
    this.paper.scaleContentToFit({ padding: 40, maxScale: 1.5, minScale: 0.3 });
  }

  resize(w: number, h: number): void {
    if (w > 0 && h > 0) this.paper.setDimensions(w, h);
  }

  destroy(): void {
    if (this.positionTimer) clearTimeout(this.positionTimer);
    (this.paper as any).remove();
  }

  // --- Private: event wiring ---

  private wireEvents(): void {
    this.paper.on('blank:pointerdown', (evt: any) => {
      this.isPanning = true;
      this.panStart = { x: evt.clientX, y: evt.clientY };
      this.events.onSelected(null);
    });
    this.paper.on('blank:pointermove', (evt: any) => {
      if (!this.isPanning) return;
      const tx = this.paper.translate();
      this.paper.translate(
        tx.tx + (evt.clientX - this.panStart.x),
        tx.ty + (evt.clientY - this.panStart.y),
      );
      this.panStart = { x: evt.clientX, y: evt.clientY };
    });
    this.paper.on('blank:pointerup', () => {
      this.isPanning = false;
    });

    const handleZoom = (_evt: any, x: number, y: number, delta: number) => {
      const s = this.paper.scale();
      const factor = delta > 0 ? 1.1 : 1 / 1.1;
      const newScale = Math.min(3, Math.max(0.2, s.sx * factor));
      this.paper.scale(newScale, newScale, x, y);
    };
    this.paper.on('blank:mousewheel', handleZoom);
    this.paper.on('cell:mousewheel', (_cellView: any, evt: any, x: number, y: number, delta: number) => {
      handleZoom(evt, x, y, delta);
    });

    (this.graph as any).on('change:position', (_el: any) => {
      if (this.rendering) return;
      if (this.positionTimer) clearTimeout(this.positionTimer);
      this.positionTimer = setTimeout(() => this.persistNodePositions(), 300);
    });

    this.paper.on('link:connect', (linkView: any) => {
      const link = linkView.model;
      const src = link.source();
      const tgt = link.target();
      link.remove();
      if (!src?.id || !tgt?.id || !src.port || !tgt.port) return;
      const from = `${String(src.id).replace('node-', '')}:${src.port}`;
      const to = `${String(tgt.id).replace('node-', '')}:${tgt.port}`;
      this.events.onPipeCreated(from, to);
    });

    this.paper.on('element:pointerclick', (elementView: any) => {
      const data = elementView.model?.attributes?.data as
        { nodeId?: string; componentId?: string; kind?: string } | undefined;
      if (data?.nodeId) {
        this.events.onSelected({ kind: 'node', nodeId: data.nodeId });
      } else if (data?.componentId) {
        const pipeId = this.findPipeForComponent(data.componentId);
        if (pipeId) {
          this.events.onSelected({ kind: 'component', componentId: data.componentId, pipeId });
        }
      }
    });

    this.paper.on('link:pointerclick', (linkView: any) => {
      const pipeId = this.extractPipeId(String(linkView.model.id));
      if (pipeId) {
        this.events.onSelected({ kind: 'pipe', pipeId });
      }
    });

    this.paper.on('link:mouseenter', (linkView: any) => {
      const pipeId = this.extractPipeId(String(linkView.model.id));
      if (!pipeId) return;
      const toolsView = new joint.dia.ToolsView({
        tools: [new (joint as any).linkTools.Remove({
          distance: '50%',
          action: () => this.events.onPipeDeleted(pipeId),
        })],
      });
      linkView.addTools(toolsView);
    });
    this.paper.on('link:mouseleave', (linkView: any) => {
      linkView.removeTools();
    });
  }

  // --- Private: rendering helpers ---

  private buildNodeElement(node: TopologyNode): joint.dia.Element | null {
    const desc = NODE_REGISTRY.get(node.kind);
    if (!desc) return null;

    const ports = node.ports.map((p) => ({
      id: p.id,
      group: p.direction === 'inlet' ? 'inlet' : 'outlet',
    }));

    const name = 'name' in node ? (node as any).name : node.id;
    return createNodeElement(desc, node.id, name, node.position.x, node.position.y, ports);
  }

  private buildPipeCells(pipe: PipeSegment): joint.dia.Cell[] {
    const [fromNode, fromPort] = pipe.from.split(':');
    const [toNode, toPort] = pipe.to.split(':');
    const comps = pipe.components;

    if (comps.length === 0) {
      return [
        createPipeSubLink(`pipe-${pipe.id}`, `node-${fromNode}`, fromPort, `node-${toNode}`, toPort),
      ];
    }

    const srcCenter = this.nodeCenters.get(fromNode);
    const tgtCenter = this.nodeCenters.get(toNode);
    if (!srcCenter || !tgtCenter) return [];

    const cells: joint.dia.Cell[] = [];

    for (let i = 0; i < comps.length; i++) {
      const fraction = (i + 1) / (comps.length + 1);
      const cx = srcCenter.x + (tgtCenter.x - srcCenter.x) * fraction;
      const cy = srcCenter.y + (tgtCenter.y - srcCenter.y) * fraction;
      const comp = comps[i];
      const label = this.compLabels.get(comp.id) ?? comp.id;

      const desc = INLINE_REGISTRY.get(comp.kind);
      if (desc) {
        const halfW = desc.size.width / 2;
        const halfH = desc.size.height / 2;
        cells.push(createInlineElement(desc, comp.id, label, cx - halfW, cy - halfH));
      }
    }

    const chain: Array<{ elId: string; portOut: string; portIn: string }> = [];
    chain.push({ elId: `node-${fromNode}`, portOut: fromPort, portIn: '' });
    for (const comp of comps) {
      chain.push({ elId: `comp-${comp.id}`, portOut: 'outlet', portIn: 'inlet' });
    }
    chain.push({ elId: `node-${toNode}`, portOut: '', portIn: toPort });

    for (let i = 0; i < chain.length - 1; i++) {
      const src = chain[i];
      const tgt = chain[i + 1];
      const router: 'manhattan' | 'normal' =
        (i === 0 || i === chain.length - 2) ? 'manhattan' : 'normal';
      cells.push(
        createPipeSubLink(`pipe-${pipe.id}-seg-${i}`, src.elId, src.portOut, tgt.elId, tgt.portIn, router),
      );
    }

    return cells;
  }

  private buildCompLabels(topology: SystemTopology): void {
    this.compLabels.clear();
    this.compToPipe.clear();
    const counters = new Map<string, number>();
    for (const pipe of topology.pipes) {
      for (const comp of pipe.components) {
        this.compToPipe.set(comp.id, pipe.id);
        const desc = INLINE_REGISTRY.get(comp.kind);
        if (desc) {
          const n = (counters.get(comp.kind) ?? 0) + 1;
          counters.set(comp.kind, n);
          this.compLabels.set(comp.id, `${desc.labelPrefix}${n}`);
        }
      }
    }
  }

  private persistNodePositions(): void {
    const positions = new Map<string, { x: number; y: number }>();

    for (const el of this.graph.getElements()) {
      const data = (el as any).attributes?.data as { nodeId?: string; kind?: string } | undefined;
      if (!data?.nodeId) continue;
      const pos = el.position();
      positions.set(data.nodeId, { x: Math.round(pos.x), y: Math.round(pos.y) });

      const desc = data.kind ? NODE_REGISTRY.get(data.kind) : undefined;
      if (desc) {
        this.nodeCenters.set(data.nodeId, {
          x: pos.x + desc.size.width / 2,
          y: pos.y + desc.size.height / 2,
        });
      }
    }

    if (positions.size > 0) {
      this.events.onNodesMoved(positions);
    }
  }

  private findPipeForComponent(componentId: string): string | null {
    return this.compToPipe.get(componentId) ?? null;
  }

  private extractPipeId(cellId: string): string | null {
    const match = cellId.match(/^pipe-(.+?)(-seg-\d+)?$/);
    return match ? match[1] : null;
  }

  private saveViewport() {
    const s = this.paper.scale();
    const t = this.paper.translate();
    return { sx: s.sx, sy: s.sy, tx: t.tx, ty: t.ty };
  }

  private restoreViewport(vp: { sx: number; sy: number; tx: number; ty: number }) {
    this.paper.scale(vp.sx, vp.sy);
    this.paper.translate(vp.tx, vp.ty);
  }
}
