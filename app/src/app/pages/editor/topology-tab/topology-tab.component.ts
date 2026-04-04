import { Component, inject, ElementRef, viewChild, afterNextRender, DestroyRef } from '@angular/core';
import * as joint from 'jointjs';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import type { TopologyNode, PipeSegment, InlineComponent } from '../../../core/models/topology.model';
import {
  createTankElement,
  createPumpElement,
  createEndpointElement,
  createValveElement,
  createFlowSensorElement,
  createPipeSubLink,
  COLORS,
} from './symbols';

/** Half-sizes for centering calculations */
const NODE_HALF: Record<string, { dx: number; dy: number }> = {
  tank: { dx: 60, dy: 35 },
  pump: { dx: 30, dy: 30 },
  endpoint: { dx: 60, dy: 25 },
};

const COMP_HALF = { dx: 25, dy: 14 };

@Component({
  selector: 'app-topology-tab',
  standalone: true,
  template: `
    <div class="flex items-center justify-between px-4 py-2 border-b border-base-300/30 bg-base-200/30">
      <div class="flex items-center gap-3">
        <h2 class="text-sm font-semibold text-base-content/70">System Topology</h2>
        <span class="badge badge-ghost badge-xs">Read-only</span>
      </div>
      <div class="flex gap-1">
        <button class="btn btn-ghost btn-xs" (click)="zoomIn()">+</button>
        <button class="btn btn-ghost btn-xs" (click)="zoomOut()">&minus;</button>
        <button class="btn btn-ghost btn-xs" (click)="fitContent()">Fit</button>
      </div>
    </div>
    <div class="canvas-wrap">
      <div #canvas></div>
      <div class="legend">
        <div class="legend-item">
          <span class="swatch" [style.background]="colors.tank"></span>
          <span>Tank</span>
        </div>
        <div class="legend-item">
          <span class="swatch swatch-circle" [style.background]="colors.pump"></span>
          <span>Pump</span>
        </div>
        <div class="legend-item">
          <span class="swatch swatch-dashed" [style.border-color]="colors.endpoint"></span>
          <span>Endpoint</span>
        </div>
        <div class="legend-item">
          <span class="swatch" [style.background]="colors.valve"></span>
          <span>Valve</span>
        </div>
        <div class="legend-item">
          <span class="swatch" [style.background]="colors.flow"></span>
          <span>Flow Sensor</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }
    :host ::ng-deep .joint-paper {
      border: none !important;
    }
    .canvas-wrap {
      position: relative;
      flex: 1;
      min-height: 0;
    }
    .legend {
      position: absolute;
      bottom: 12px;
      left: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px 10px;
      background: rgba(255,255,255,0.92);
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 10px;
      font-family: ui-monospace, monospace;
      color: #1e293b;
      pointer-events: none;
      z-index: 10;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .swatch {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 2px;
      flex-shrink: 0;
    }
    .swatch-circle {
      border-radius: 50%;
    }
    .swatch-dashed {
      background: transparent;
      border: 2px dashed;
      border-radius: 2px;
    }
  `],
})
export class TopologyTabComponent {
  private editor = inject(SystemEditorService);
  private hostRef = inject(ElementRef<HTMLElement>);
  private destroyRef = inject(DestroyRef);
  private canvasRef = viewChild.required<ElementRef<HTMLDivElement>>('canvas');

  private graph!: joint.dia.Graph;
  private paper!: joint.dia.Paper;

  /** Node center positions for auto-placing inline components */
  private nodeCenters = new Map<string, { x: number; y: number }>();

  /** Short labels for inline components */
  private compLabels = new Map<string, string>();

  /** Expose COLORS for template */
  colors = COLORS;

  constructor() {
    afterNextRender(() => this.init());
  }

  private init() {
    const canvas = this.canvasRef().nativeElement;
    const host = this.hostRef.nativeElement;

    this.graph = new joint.dia.Graph();
    this.paper = new joint.dia.Paper({
      el: canvas,
      model: this.graph,
      width: 800,
      height: 600,
      gridSize: 10,
      drawGrid: { name: 'dot', args: { color: '#e2e8f0' } },
      background: { color: '#fafbfc' },
      interactive: false,
      defaultRouter: { name: 'manhattan' },
      defaultConnector: { name: 'rounded' },
    });

    const syncSize = () => {
      const toolbar = host.firstElementChild as HTMLElement;
      const w = host.clientWidth;
      const h = host.clientHeight - (toolbar?.offsetHeight ?? 0);
      if (w > 0 && h > 0) {
        this.paper.setDimensions(w, h);
      }
    };

    const observer = new ResizeObserver(() => syncSize());
    observer.observe(host);
    this.destroyRef.onDestroy(() => observer.disconnect());

    syncSize();
    this.render();
  }

  private render() {
    const t = this.editor.topology();
    if (!t) return;

    this.graph.clear();
    this.nodeCenters.clear();
    this.compLabels.clear();

    // Build short-label indices (V1, V2... F1, F2...)
    let valveIdx = 0;
    let flowIdx = 0;
    for (const pipe of t.pipes) {
      for (const comp of pipe.components) {
        if (comp.kind === 'valve') {
          this.compLabels.set(comp.id, `V${++valveIdx}`);
        } else {
          this.compLabels.set(comp.id, `F${++flowIdx}`);
        }
      }
    }

    // Create nodes and record centers
    for (const node of t.nodes) {
      const el = this.createNode(node);
      if (el) {
        this.graph.addCell(el);
        const half = NODE_HALF[node.kind];
        this.nodeCenters.set(node.id, {
          x: node.position.x + half.dx,
          y: node.position.y + half.dy,
        });
      }
    }

    // Create pipe elements (inline components + sub-links)
    for (const pipe of t.pipes) {
      const cells = this.createPipeElements(pipe);
      this.graph.addCells(cells);
    }

    setTimeout(() => this.fitContent(), 50);
  }

  private createNode(node: TopologyNode): joint.dia.Element | null {
    const ports = node.ports.map((p) => ({
      id: p.id,
      group: p.direction === 'inlet' ? 'inlet' : 'outlet',
    }));
    switch (node.kind) {
      case 'tank':
        return createTankElement(node.id, node.name, node.position.x, node.position.y, ports);
      case 'pump':
        return createPumpElement(node.id, node.position.x, node.position.y);
      case 'endpoint':
        return createEndpointElement(node.id, node.name, node.position.x, node.position.y, ports);
    }
  }

  private createPipeElements(pipe: PipeSegment): joint.dia.Cell[] {
    const [fromNode, fromPort] = pipe.from.split(':');
    const [toNode, toPort] = pipe.to.split(':');
    const comps = pipe.components;

    // No inline components — single direct link
    if (comps.length === 0) {
      return [
        createPipeSubLink(
          `pipe-${pipe.id}`,
          `node-${fromNode}`, fromPort,
          `node-${toNode}`, toPort,
        ),
      ];
    }

    // Get source/target centers for position interpolation
    const srcCenter = this.nodeCenters.get(fromNode);
    const tgtCenter = this.nodeCenters.get(toNode);
    if (!srcCenter || !tgtCenter) return [];

    const cells: joint.dia.Cell[] = [];

    // Create inline component elements at interpolated positions
    for (let i = 0; i < comps.length; i++) {
      const fraction = (i + 1) / (comps.length + 1);
      const cx = srcCenter.x + (tgtCenter.x - srcCenter.x) * fraction;
      const cy = srcCenter.y + (tgtCenter.y - srcCenter.y) * fraction;
      const comp = comps[i];
      const label = this.compLabels.get(comp.id) ?? comp.id;

      if (comp.kind === 'valve') {
        cells.push(createValveElement(comp.id, label, cx - COMP_HALF.dx, cy - COMP_HALF.dy));
      } else {
        cells.push(createFlowSensorElement(comp.id, label, cx - COMP_HALF.dx, cy - COMP_HALF.dy));
      }
    }

    // Create chain of sub-links: source → comp[0] → comp[1] → ... → target
    const chain: Array<{ elId: string; portOut: string; portIn: string }> = [];

    // Source node
    chain.push({ elId: `node-${fromNode}`, portOut: fromPort, portIn: '' });
    // Inline components
    for (const comp of comps) {
      chain.push({ elId: `comp-${comp.id}`, portOut: 'outlet', portIn: 'inlet' });
    }
    // Target node
    chain.push({ elId: `node-${toNode}`, portOut: '', portIn: toPort });

    for (let i = 0; i < chain.length - 1; i++) {
      const src = chain[i];
      const tgt = chain[i + 1];
      // First and last links use manhattan; middle links between components use normal
      const router: 'manhattan' | 'normal' =
        (i === 0 || i === chain.length - 2) ? 'manhattan' : 'normal';
      cells.push(
        createPipeSubLink(
          `pipe-${pipe.id}-seg-${i}`,
          src.elId, src.portOut,
          tgt.elId, tgt.portIn,
          router,
        ),
      );
    }

    return cells;
  }

  zoomIn() {
    const s = this.paper.scale();
    this.paper.scale(s.sx * 1.2, s.sy * 1.2);
  }

  zoomOut() {
    const s = this.paper.scale();
    this.paper.scale(s.sx / 1.2, s.sy / 1.2);
  }

  fitContent() {
    this.paper.scaleContentToFit({ padding: 40, maxScale: 1.5, minScale: 0.3 });
  }
}
