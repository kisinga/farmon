/**
 * Framework-agnostic X6 topology canvas manager.
 * Owns Graph lifecycle. Knows nothing about Angular.
 * All entity-specific logic is driven by the NODE_REGISTRY.
 */
import { Graph, Shape } from '@antv/x6';
import { History } from '@antv/x6-plugin-history';
import { Snapline } from '@antv/x6-plugin-snapline';
import type { Node, Edge as X6Edge } from '@antv/x6';
import { NODE_REGISTRY } from '../../../core/models/entities.model';
import { UI_COLORS } from '../../../core/models/colors.model';
import type { SystemTopology, PipeSegment, TopologyNode } from '../../../core/models/topology.model';
import { svgDataUri } from './scada-shape';
import { buildNodeConfig, buildEdgeConfig, buildDragEdgeAttrs, MANHATTAN_ROUTER } from './x6-shapes';
import { findConnectedPipes, findPipesFromSource, findPipesToDestination } from '../shared/derive-routes';

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

// --- Helpers ---

interface NodeData { nodeId: string; kind: string; [k: string]: unknown }

function getNodeData(node: { getData: () => unknown }): NodeData | null {
  const d = node.getData() as Record<string, unknown> | undefined;
  if (d && typeof d['nodeId'] === 'string' && typeof d['kind'] === 'string') {
    return d as NodeData;
  }
  return null;
}

function extractNodeData(node: TopologyNode): Record<string, unknown> {
  // Pull out structural fields; the rest is entity data for renderSvg
  const { ports: _, position: __, ...data } = node;
  return data;
}

function stripPrefix(id: string, prefix: string): string | null {
  return id.startsWith(prefix) ? id.slice(prefix.length) : null;
}

// --- Inject flow animation CSS (once per document) ---

const FLOW_STYLE_ID = 'x6-flow-animation';
function ensureFlowStyles(): void {
  if (document.getElementById(FLOW_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = FLOW_STYLE_ID;
  style.textContent = `@keyframes x6-flow { to { stroke-dashoffset: -1000; } }`;
  document.head.appendChild(style);
}

// --- Canvas class ---

export class X6Canvas {
  private graph: Graph;
  private history: History;
  private events: CanvasEvents;

  private nodeIds = new Set<string>();
  private positionTimer: ReturnType<typeof setTimeout> | null = null;
  private rendering = false;
  private highlightedEdges = new Set<string>();

  constructor(container: HTMLElement, events: CanvasEvents) {
    this.events = events;
    ensureFlowStyles();

    this.graph = new Graph({
      container,
      width: 800,
      height: 600,
      grid: { visible: true, type: 'dot', args: [{ color: '#e2e8f0' }] },
      background: { color: '#fafbfc' },
      panning: { enabled: true, eventTypes: ['leftMouseDown'], modifiers: [] },
      mousewheel: { enabled: true, factor: 1.1, minScale: 0.2, maxScale: 3 },
      connecting: {
        allowBlank: false,
        allowMulti: false,
        allowLoop: false,
        allowNode: false,
        snap: { radius: 30 },
        router: MANHATTAN_ROUTER,
        connector: { name: 'rounded' },
        validateMagnet({ magnet }) {
          return magnet?.getAttribute('port-group')?.startsWith('outlet') ?? false;
        },
        validateConnection({ sourceCell, targetCell, targetMagnet }) {
          if (!sourceCell || !targetCell) return false;
          if (sourceCell.id === targetCell.id) return false;
          return targetMagnet?.getAttribute('port-group')?.startsWith('inlet') ?? false;
        },
        createEdge() {
          return new Shape.Edge(buildDragEdgeAttrs());
        },
      },
    });

    this.graph.use(new Snapline({ enabled: true }));

    this.history = new History({ enabled: true });
    this.graph.use(this.history);

    this.wireEvents();
  }

  // --- Public API ---

  /** Incrementally reconcile the graph with the topology. */
  render(topology: SystemTopology): void {
    this.rendering = true;
    this.nodeIds.clear();

    const desiredNodes = new Map<string, Node.Metadata>();
    const desiredEdges = new Map<string, X6Edge.Metadata>();

    for (const node of topology.nodes) {
      const cfg = this.toNodeConfig(node);
      if (cfg) {
        desiredNodes.set(String(cfg.id), cfg);
        this.nodeIds.add(node.id);
      }
    }

    for (const pipe of topology.pipes) {
      const cfg = this.toEdgeConfig(pipe);
      if (cfg) desiredEdges.set(String(cfg['id']), cfg);
    }

    this.graph.startBatch('render');

    // Remove stale cells
    for (const cell of this.graph.getCells()) {
      const id = String(cell.id);
      if (cell.isNode() && !desiredNodes.has(id)) cell.remove();
      if (cell.isEdge() && !desiredEdges.has(id)) cell.remove();
    }

    // Add or update nodes
    for (const [id, cfg] of desiredNodes) {
      const existing = this.graph.getCellById(id);
      if (existing?.isNode()) {
        const pos = existing.getPosition();
        if (cfg.x != null && cfg.y != null && (pos.x !== cfg.x || pos.y !== cfg.y)) {
          existing.setPosition(cfg.x, cfg.y);
        }
        // Update data and re-render SVG via imageUrl
        existing.setData(cfg.data, { overwrite: true });
        if (cfg['imageUrl']) {
          existing.setAttrByPath('image/xlinkHref', cfg['imageUrl']);
        }
      } else {
        this.graph.addNode(cfg);
      }
    }

    // Add new edges (edges are immutable once created)
    for (const [id, cfg] of desiredEdges) {
      if (!this.graph.getCellById(id)) this.graph.addEdge(cfg);
    }

    this.graph.stopBatch('render');
    this.rendering = false;
  }

  /** Full reset — used only for initial load. */
  reset(topology: SystemTopology): void {
    this.graph.clearCells();
    this.render(topology);
    this.fitContent();
  }

  /** Highlight routes through the selected entity. */
  highlight(selection: Selection | null, topology: SystemTopology): void {
    this.clearHighlights();
    if (!selection) return;

    if (selection.kind === 'pipe') {
      this.highlightEdge(selection.pipeId, UI_COLORS.selected, 3.5, 1);
      const connected = findConnectedPipes(selection.pipeId, topology);
      for (const pid of connected) {
        if (pid !== selection.pipeId) {
          this.highlightEdge(pid, UI_COLORS.selected, 2.5, 0.4, true);
        }
      }
    }

    if (selection.kind === 'node') {
      const node = topology.nodes.find(n => n.id === selection.nodeId);
      const desc = node ? NODE_REGISTRY.get(node.kind) : null;

      let pipeIds: string[];
      if (desc?.routeSource) {
        // Source node (tank, water_source): show all downstream paths
        pipeIds = findPipesFromSource(selection.nodeId, topology);
      } else if (desc?.role === 'terminal') {
        // Destination endpoint: show all upstream paths back to sources
        pipeIds = findPipesToDestination(selection.nodeId, topology);
      } else {
        // Passthrough node (valve, pump, sensor): show full connected route
        pipeIds = [];
        for (const pipe of topology.pipes) {
          const from = pipe.from.split(':')[0];
          const to = pipe.to.split(':')[0];
          if (from === selection.nodeId || to === selection.nodeId) {
            pipeIds.push(...findConnectedPipes(pipe.id, topology));
          }
        }
      }

      for (const pid of pipeIds) {
        this.highlightEdge(pid, UI_COLORS.selected, 2.5, 0.5, true);
      }
    }
  }

  undo(): void { this.history.undo(); }
  redo(): void { this.history.redo(); }
  zoomIn(): void { this.graph.zoom(0.2); }
  zoomOut(): void { this.graph.zoom(-0.2); }

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
    return {
      x: Math.round((-tx + area.width / 2) / sx),
      y: Math.round((-ty + area.height / 2) / sy),
    };
  }

  destroy(): void {
    if (this.positionTimer) clearTimeout(this.positionTimer);
    this.graph.dispose();
  }

  // --- Private: event wiring ---

  private wireEvents(): void {
    this.graph.on('node:click', ({ node }) => {
      const data = getNodeData(node);
      if (data) this.events.onSelected({ kind: 'node', nodeId: data.nodeId });
    });

    this.graph.on('edge:click', ({ edge }) => {
      const pipeId = stripPrefix(String(edge.id), 'pipe-');
      if (pipeId) this.events.onSelected({ kind: 'pipe', pipeId });
    });

    this.graph.on('blank:click', () => {
      this.events.onSelected(null);
    });

    this.graph.on('node:moved', () => {
      if (this.rendering) return;
      if (this.positionTimer) clearTimeout(this.positionTimer);
      this.positionTimer = setTimeout(() => this.persistNodePositions(), 300);
    });

    this.graph.on('edge:connected', ({ edge }) => {
      const src = edge.getSourceCellId();
      const srcPort = edge.getSourcePortId();
      const tgt = edge.getTargetCellId();
      const tgtPort = edge.getTargetPortId();
      edge.remove();
      if (!src || !tgt || !srcPort || !tgtPort) return;
      this.events.onPipeCreated(
        `${stripPrefix(src, 'node-') ?? src}:${srcPort}`,
        `${stripPrefix(tgt, 'node-') ?? tgt}:${tgtPort}`,
      );
    });

    this.graph.on('edge:removed', ({ edge }) => {
      if (this.rendering) return;
      if (stripPrefix(String(edge.id), 'pipe-')) return; // real pipe being deleted, not a drag edge
      const src = edge.getSourceCellId();
      const srcPort = edge.getSourcePortId();
      if (!src || !srcPort) return;
      const target = edge.getTargetPoint();
      if (!target) return;
      const clientPoint = this.graph.localToClient(target);
      this.events.onDanglingPipe(
        `${stripPrefix(src, 'node-') ?? src}:${srcPort}`,
        { x: Math.round(target.x), y: Math.round(target.y) },
        { x: Math.round(clientPoint.x), y: Math.round(clientPoint.y) },
      );
    });
  }

  // --- Private: config builders ---

  private toNodeConfig(node: TopologyNode): Node.Metadata | null {
    const desc = NODE_REGISTRY.get(node.kind);
    if (!desc) return null;
    const ports = node.ports.map(p => {
      const defPort = desc.defaultPorts.find(dp => dp.id === p.id);
      const group = p.direction === 'inlet' ? 'inlet' : 'outlet';
      if (defPort?.y != null) {
        const x = group === 'inlet' ? 0 : desc.size.width;
        return { id: p.id, group: `${group}-abs`, args: { x, y: defPort.y } };
      }
      return { id: p.id, group };
    });
    return buildNodeConfig(desc, node.id, extractNodeData(node), node.position.x, node.position.y, ports);
  }

  private toEdgeConfig(pipe: PipeSegment): X6Edge.Metadata | null {
    const [fromNode, fromPort] = pipe.from.split(':');
    const [toNode, toPort] = pipe.to.split(':');
    if (!fromNode || !fromPort || !toNode || !toPort) return null;
    if (!this.nodeIds.has(fromNode) || !this.nodeIds.has(toNode)) return null;
    return buildEdgeConfig(`pipe-${pipe.id}`, `node-${fromNode}`, fromPort, `node-${toNode}`, toPort);
  }

  private persistNodePositions(): void {
    const positions = new Map<string, { x: number; y: number }>();
    for (const node of this.graph.getNodes()) {
      const data = getNodeData(node);
      if (!data) continue;
      const pos = node.getPosition();
      positions.set(data.nodeId, { x: Math.round(pos.x), y: Math.round(pos.y) });
    }
    if (positions.size > 0) this.events.onNodesMoved(positions);
  }

  private highlightEdge(pipeId: string, color: string, width: number, opacity: number, animate = false): void {
    const edge = this.graph.getCellById(`pipe-${pipeId}`);
    if (!edge?.isEdge()) return;

    edge.setAttrs({
      line: {
        stroke: color, strokeWidth: width, strokeOpacity: opacity,
        ...(animate ? {
          strokeDasharray: 5,
          style: { animation: 'x6-flow 30s infinite linear' },
        } : {}),
      },
    });
    this.highlightedEdges.add(pipeId);
  }

  private clearHighlights(): void {
    for (const pid of this.highlightedEdges) {
      const edge = this.graph.getCellById(`pipe-${pid}`);
      if (edge?.isEdge()) {
        edge.setAttrs({
          line: {
            stroke: UI_COLORS.pipe,
            strokeWidth: 2.5,
            strokeOpacity: 1,
            strokeDasharray: 0,
            style: { animation: '' },
          },
        });
        edge.removeTools();
      }
    }
    this.highlightedEdges.clear();
  }
}
