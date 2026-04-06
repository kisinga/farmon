/**
 * Framework-agnostic X6 topology canvas manager.
 * Owns Graph lifecycle. Knows nothing about Angular.
 * All entity-specific logic is driven by the NODE_REGISTRY.
 */
import { Graph, Shape } from '@antv/x6';
import { NODE_REGISTRY } from '../../../core/models/entities.model';
import { UI_COLORS } from '../../../core/models/colors.model';
import type { Node, Edge as X6Edge } from '@antv/x6';
import type { SystemTopology, PipeSegment, TopologyNode } from '../../../core/models/topology.model';
import { buildNodeConfig, buildEdgeConfig, buildDragEdgeAttrs } from './x6-shapes';

// --- Types (shared contract with JointJS canvas) ---

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

export class X6Canvas {
  private graph: Graph;
  private events: CanvasEvents;

  private nodeIds = new Set<string>();
  private positionTimer: ReturnType<typeof setTimeout> | null = null;
  private rendering = false;
  private selectedPipeId: string | null = null;

  constructor(container: HTMLElement, events: CanvasEvents) {
    this.events = events;

    this.graph = new Graph({
      container,
      width: 800,
      height: 600,
      grid: {
        visible: true,
        type: 'dot',
        args: [{ color: '#e2e8f0' }],
      },
      background: { color: '#fafbfc' },
      panning: {
        enabled: true,
        eventTypes: ['leftMouseDown'],
        modifiers: [],
      },
      mousewheel: {
        enabled: true,
        factor: 1.1,
        minScale: 0.2,
        maxScale: 3,
      },
      connecting: {
        allowBlank: false,
        allowMulti: false,
        allowLoop: false,
        allowNode: false,
        snap: { radius: 30 },
        router: {
          name: 'manhattan',
          args: {
            step: 10,
            padding: { top: 20, right: 20, bottom: 20, left: 20 },
            excludeTerminals: ['source', 'target'],
            startDirections: ['right'],
            endDirections: ['left'],
          },
        },
        connector: { name: 'rounded' },
        validateMagnet({ magnet }) {
          return magnet?.getAttribute('port-group') === 'outlet';
        },
        validateConnection({ sourceCell, targetCell, targetMagnet }) {
          if (!sourceCell || !targetCell) return false;
          if (sourceCell.id === targetCell.id) return false;
          return targetMagnet?.getAttribute('port-group') === 'inlet';
        },
        createEdge() {
          return new Shape.Edge(buildDragEdgeAttrs());
        },
      },
    });

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
    this.nodeIds.clear();

    const nodes: Node.Metadata[] = [];
    const edges: X6Edge.Metadata[] = [];

    for (const node of topology.nodes) {
      const cfg = this.buildNodeConfig(node);
      if (cfg) {
        nodes.push(cfg as Node.Metadata);
        this.nodeIds.add(node.id);
      }
    }

    for (const pipe of topology.pipes) {
      const cfg = this.buildPipeConfig(pipe);
      if (cfg) edges.push(cfg as X6Edge.Metadata);
    }

    this.graph.fromJSON({ nodes, edges });
    this.rendering = false;

    if (viewport) {
      this.restoreViewport(viewport);
    } else {
      this.fitContent();
    }
  }

  highlight(selection: Selection | null): void {
    // Reset previous selection
    if (this.selectedPipeId) {
      const prevEdge = this.graph.getCellById(`pipe-${this.selectedPipeId}`);
      if (prevEdge?.isEdge()) {
        prevEdge.setAttrs({ line: { stroke: UI_COLORS.pipe, strokeWidth: 2.5 } });
        prevEdge.removeTools();
      }
    }

    this.selectedPipeId = selection?.kind === 'pipe' ? selection.pipeId : null;

    // Highlight selected pipe and show delete tool
    if (this.selectedPipeId) {
      const edge = this.graph.getCellById(`pipe-${this.selectedPipeId}`);
      if (edge?.isEdge()) {
        edge.setAttrs({ line: { stroke: UI_COLORS.selected, strokeWidth: 3.5 } });
        edge.addTools([
          {
            name: 'button',
            args: {
              distance: '50%',
              markup: [
                {
                  tagName: 'circle',
                  attrs: { r: 8, fill: '#f44336', cursor: 'pointer' },
                },
                {
                  tagName: 'text',
                  attrs: {
                    fill: '#fff',
                    fontSize: 12,
                    fontWeight: 'bold',
                    textAnchor: 'middle',
                    dominantBaseline: 'central',
                  },
                  textContent: '\u00d7',
                },
              ],
              onClick: () => this.events.onPipeDeleted(this.selectedPipeId!),
            },
          },
        ]);
      }
    }
  }

  zoomIn(): void {
    this.graph.zoom(0.2);
  }

  zoomOut(): void {
    this.graph.zoom(-0.2);
  }

  fitContent(): void {
    this.graph.zoomToFit({ padding: 40, maxScale: 1.5, minScale: 0.3 });
  }

  resize(w: number, h: number): void {
    if (w > 0 && h > 0) this.graph.resize(w, h);
  }

  getViewportCenter(): { x: number; y: number } {
    const { sx, sy } = this.graph.scale();
    const { tx, ty } = this.graph.translate();
    const area = this.graph.getGraphArea();
    const cx = (-tx + area.width / 2) / sx;
    const cy = (-ty + area.height / 2) / sy;
    return { x: Math.round(cx), y: Math.round(cy) };
  }

  destroy(): void {
    if (this.positionTimer) clearTimeout(this.positionTimer);
    this.graph.dispose();
  }

  // --- Private: event wiring ---

  private wireEvents(): void {
    // Node click → select
    this.graph.on('node:click', ({ node }) => {
      const data = node.getData() as { nodeId?: string } | undefined;
      if (data?.nodeId) {
        this.events.onSelected({ kind: 'node', nodeId: data.nodeId });
      }
    });

    // Edge click → select
    this.graph.on('edge:click', ({ edge }) => {
      const pipeId = this.extractPipeId(edge.id);
      if (pipeId) {
        this.events.onSelected({ kind: 'pipe', pipeId });
      }
    });

    // Blank click → deselect
    this.graph.on('blank:click', () => {
      this.events.onSelected(null);
    });

    // Node moved → debounced position persistence
    this.graph.on('node:moved', () => {
      if (this.rendering) return;
      if (this.positionTimer) clearTimeout(this.positionTimer);
      this.positionTimer = setTimeout(() => this.persistNodePositions(), 300);
    });

    // Successful connection
    this.graph.on('edge:connected', ({ edge }) => {
      const src = edge.getSourceCellId();
      const srcPort = edge.getSourcePortId();
      const tgt = edge.getTargetCellId();
      const tgtPort = edge.getTargetPortId();

      // Remove the drag edge — we'll add the real pipe via render()
      edge.remove();

      if (!src || !tgt || !srcPort || !tgtPort) return;
      const from = `${src.replace('node-', '')}:${srcPort}`;
      const to = `${tgt.replace('node-', '')}:${tgtPort}`;
      this.events.onPipeCreated(from, to);
    });

    // Dangling pipe detection: edge removed without successful connection
    // X6 fires edge:removed when a drag edge is dropped on blank space
    this.graph.on('edge:removed', ({ edge }) => {
      if (this.rendering) return;
      // Only handle drag edges (no pipe- prefix)
      if (this.extractPipeId(edge.id)) return;

      const src = edge.getSourceCellId();
      const srcPort = edge.getSourcePortId();
      if (!src || !srcPort) return;

      const from = `${src.replace('node-', '')}:${srcPort}`;

      // Get the last known position of the edge target
      const target = edge.getTargetPoint();
      if (!target) return;

      const clientPoint = this.graph.localToClient(target);
      this.events.onDanglingPipe(
        from,
        { x: Math.round(target.x), y: Math.round(target.y) },
        { x: Math.round(clientPoint.x), y: Math.round(clientPoint.y) },
      );
    });
  }

  // --- Private: rendering helpers ---

  private buildNodeConfig(node: TopologyNode): Node.Metadata | null {
    const desc = NODE_REGISTRY.get(node.kind);
    if (!desc) {
      console.warn(`[x6-canvas] unknown node kind "${node.kind}" for node "${node.id}"`);
      return null;
    }

    const ports = node.ports.map((p) => ({
      id: p.id,
      group: p.direction === 'inlet' ? 'inlet' : 'outlet',
    }));

    const name = 'name' in node ? (node as any).name : node.id;
    return buildNodeConfig(desc, node.id, name, node.position.x, node.position.y, ports) as Node.Metadata;
  }

  private buildPipeConfig(pipe: PipeSegment): X6Edge.Metadata | null {
    const [fromNode, fromPort] = pipe.from.split(':');
    const [toNode, toPort] = pipe.to.split(':');

    if (!fromNode || !fromPort || !toNode || !toPort) {
      console.warn(`[x6-canvas] pipe "${pipe.id}" has malformed endpoints`);
      return null;
    }
    if (!this.nodeIds.has(fromNode)) {
      console.warn(`[x6-canvas] pipe "${pipe.id}" references missing node "${fromNode}"`);
      return null;
    }
    if (!this.nodeIds.has(toNode)) {
      console.warn(`[x6-canvas] pipe "${pipe.id}" references missing node "${toNode}"`);
      return null;
    }

    return buildEdgeConfig(`pipe-${pipe.id}`, `node-${fromNode}`, fromPort, `node-${toNode}`, toPort) as X6Edge.Metadata;
  }

  private persistNodePositions(): void {
    const positions = new Map<string, { x: number; y: number }>();
    for (const node of this.graph.getNodes()) {
      const data = node.getData() as { nodeId?: string } | undefined;
      if (!data?.nodeId) continue;
      const pos = node.getPosition();
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
    const { sx, sy } = this.graph.scale();
    const { tx, ty } = this.graph.translate();
    return { sx, sy, tx, ty };
  }

  private restoreViewport(vp: { sx: number; sy: number; tx: number; ty: number }) {
    this.graph.scale(vp.sx, vp.sy);
    this.graph.translate(vp.tx, vp.ty);
  }
}
