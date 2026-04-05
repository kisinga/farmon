/**
 * Framework-agnostic JointJS topology canvas manager.
 * Owns Graph + Paper lifecycle. Knows nothing about Angular.
 * All entity-specific logic is driven by the NODE_REGISTRY.
 */
import * as joint from '@joint/core';
import { NODE_REGISTRY } from '../../../core/models/entities.model';
import { UI_COLORS } from '../../../core/models/colors.model';
import type { SystemTopology, PipeSegment, TopologyNode } from '../../../core/models/topology.model';
import { createNodeElement, createPipeLink, createDragLink } from './symbols';

// --- Types ---

export type Selection =
  | { kind: 'node'; nodeId: string }
  | { kind: 'pipe'; pipeId: string };

export interface CanvasEvents {
  onNodesMoved(positions: Map<string, { x: number; y: number }>): void;
  onPipeCreated(from: string, to: string): void;
  onPipeDeleted(pipeId: string): void;
  onSelected(selection: Selection | null): void;
  onDanglingPipe(from: string, graphPos: { x: number; y: number }, clientPos: { x: number; y: number }): void;
}

// --- Canvas class ---

export class TopologyCanvas {
  private graph: joint.dia.Graph;
  private paper: joint.dia.Paper;
  private events: CanvasEvents;

  private nodeIds = new Set<string>();
  private isPanning = false;
  private panStart = { x: 0, y: 0 };
  private positionTimer: ReturnType<typeof setTimeout> | null = null;
  private rendering = false;
  private selectedPipeId: string | null = null;
  private dragSource: { from: string; clientX: number; clientY: number } | null = null;

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
      defaultRouter: { name: 'rightAngle', args: { margin: 20 } },
      defaultConnector: { name: 'rounded' },
      defaultConnectionPoint: { name: 'anchor' },
      validateMagnet: (_view: any, magnet: SVGElement) =>
        magnet.getAttribute('port-group') === 'outlet',
      validateConnection: (cellViewS: any, _mS: any, cellViewT: any, magnetT: any) => {
        if (cellViewS.model.id === cellViewT.model.id) return false;
        return magnetT?.getAttribute('port-group') === 'inlet';
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
    (this.paper as any).freeze();
    this.nodeIds.clear();

    // Build ALL cells before touching the graph
    const allCells: joint.dia.Cell[] = [];

    for (const node of topology.nodes) {
      const el = this.buildNodeElement(node);
      if (el) {
        allCells.push(el);
        this.nodeIds.add(node.id);
      }
    }

    for (const pipe of topology.pipes) {
      const link = this.buildPipeLink(pipe);
      if (link) allCells.push(link);
    }

    // Atomic replace + synchronous view creation
    this.graph.resetCells(allCells);
    this.rendering = false;
    (this.paper as any).unfreeze();
    (this.paper as any).updateViews();

    if (viewport) {
      this.restoreViewport(viewport);
    } else {
      this.fitContent();
    }
  }

  highlight(selection: Selection | null): void {
    // Reset previous selection
    if (this.selectedPipeId) {
      for (const link of this.graph.getLinks()) {
        if (String(link.id) === `pipe-${this.selectedPipeId}`) {
          link.attr('line/stroke', UI_COLORS.pipe);
          link.attr('line/strokeWidth', 2.5);
          const view = this.paper.findViewByModel(link);
          if (view) (view as any).removeTools();
        }
      }
    }

    this.selectedPipeId = selection?.kind === 'pipe' ? selection.pipeId : null;

    // Highlight selected pipe and show delete tool
    if (this.selectedPipeId) {
      for (const link of this.graph.getLinks()) {
        if (String(link.id) === `pipe-${this.selectedPipeId}`) {
          link.attr('line/stroke', UI_COLORS.selected);
          link.attr('line/strokeWidth', 3.5);
          const view = this.paper.findViewByModel(link);
          if (view) {
            const toolsView = new joint.dia.ToolsView({
              tools: [new (joint as any).linkTools.Remove({
                distance: '50%',
                action: () => this.events.onPipeDeleted(this.selectedPipeId!),
              })],
            });
            (view as any).addTools(toolsView);
          }
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

  getViewportCenter(): { x: number; y: number } {
    const s = this.paper.scale();
    const t = this.paper.translate();
    const el = (this.paper as any).el as HTMLElement;
    const cx = (el.clientWidth / 2 - t.tx) / s.sx;
    const cy = (el.clientHeight / 2 - t.ty) / s.sy;
    return { x: Math.round(cx), y: Math.round(cy) };
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
      const t = this.paper.translate();
      const factor = delta > 0 ? 1.1 : 1 / 1.1;
      const newScale = Math.min(3, Math.max(0.2, s.sx * factor));
      const dx = x * (1 - newScale / s.sx);
      const dy = y * (1 - newScale / s.sy);
      this.paper.scale(newScale, newScale);
      this.paper.translate(t.tx + dx, t.ty + dy);
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

    // Track mouse position during link drag for dangling pipe detection
    this.paper.on('link:pointermove', (linkView: any, evt: any) => {
      const link = linkView.model;
      if (this.extractPipeId(String(link.id))) return;
      const src = link.source();
      if (src?.id && src.port) {
        this.dragSource = {
          from: `${String(src.id).replace('node-', '')}:${src.port}`,
          clientX: evt.clientX,
          clientY: evt.clientY,
        };
      }
    });

    this.paper.on('link:connect', (linkView: any) => {
      this.dragSource = null; // Clear before remove to prevent popup
      const link = linkView.model;
      const src = link.source();
      const tgt = link.target();
      link.remove();
      if (!src?.id || !tgt?.id || !src.port || !tgt.port) return;
      const from = `${String(src.id).replace('node-', '')}:${src.port}`;
      const to = `${String(tgt.id).replace('node-', '')}:${tgt.port}`;
      this.events.onPipeCreated(from, to);
    });

    // Detect failed connection: drag link removed without link:connect
    (this.graph as any).on('remove', (cell: any) => {
      if (!cell.isLink() || this.rendering) return;
      if (this.extractPipeId(String(cell.id))) return; // A pipe being deleted, not a drag link
      if (!this.dragSource) return; // Already handled by link:connect
      const info = this.dragSource;
      this.dragSource = null;
      const localPoint = this.paper.clientToLocalPoint(info.clientX, info.clientY);
      this.events.onDanglingPipe(
        info.from,
        { x: Math.round(localPoint.x), y: Math.round(localPoint.y) },
        { x: info.clientX, y: info.clientY },
      );
    });

    this.paper.on('element:pointerclick', (elementView: any) => {
      const data = elementView.model?.attributes?.data as { nodeId?: string } | undefined;
      if (data?.nodeId) {
        this.events.onSelected({ kind: 'node', nodeId: data.nodeId });
      }
    });

    this.paper.on('link:pointerclick', (linkView: any) => {
      const pipeId = this.extractPipeId(String(linkView.model.id));
      if (pipeId) {
        this.events.onSelected({ kind: 'pipe', pipeId });
      }
    });
  }

  // --- Private: rendering helpers ---

  private buildNodeElement(node: TopologyNode): joint.dia.Element | null {
    const desc = NODE_REGISTRY.get(node.kind);
    if (!desc) {
      console.warn(`[topology-canvas] unknown node kind "${node.kind}" for node "${node.id}"`);
      return null;
    }

    const ports = node.ports.map((p) => ({
      id: p.id,
      group: p.direction === 'inlet' ? 'inlet' : 'outlet',
    }));

    const name = 'name' in node ? (node as any).name : node.id;
    return createNodeElement(desc, node.id, name, node.position.x, node.position.y, ports);
  }

  private buildPipeLink(pipe: PipeSegment): joint.dia.Cell | null {
    const [fromNode, fromPort] = pipe.from.split(':');
    const [toNode, toPort] = pipe.to.split(':');

    if (!fromNode || !fromPort || !toNode || !toPort) {
      console.warn(`[topology-canvas] pipe "${pipe.id}" has malformed endpoints`);
      return null;
    }
    if (!this.nodeIds.has(fromNode)) {
      console.warn(`[topology-canvas] pipe "${pipe.id}" references missing node "${fromNode}"`);
      return null;
    }
    if (!this.nodeIds.has(toNode)) {
      console.warn(`[topology-canvas] pipe "${pipe.id}" references missing node "${toNode}"`);
      return null;
    }

    return createPipeLink(`pipe-${pipe.id}`, `node-${fromNode}`, fromPort, `node-${toNode}`, toPort);
  }

  private persistNodePositions(): void {
    const positions = new Map<string, { x: number; y: number }>();
    for (const el of this.graph.getElements()) {
      const data = (el as any).attributes?.data as { nodeId?: string } | undefined;
      if (!data?.nodeId) continue;
      const pos = el.position();
      positions.set(data.nodeId, { x: Math.round(pos.x), y: Math.round(pos.y) });
    }
    if (positions.size > 0) {
      this.events.onNodesMoved(positions);
    }
  }

  private extractPipeId(cellId: string): string | null {
    const match = cellId.match(/^pipe-(.+)$/);
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
