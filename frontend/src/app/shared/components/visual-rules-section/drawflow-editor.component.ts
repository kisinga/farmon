import {
  Component, AfterViewInit, OnDestroy, ViewChild, ElementRef,
  input, output, effect, HostListener,
} from '@angular/core';
import Drawflow from 'drawflow';
import { DeviceField, DeviceControl, DeviceRuleRecord } from '../../../core/services/api.types';
import { VisualNodeData, SensorNodeData, CompareNodeData, LogicGateNodeData, ActionNodeData, TimeWindowNodeData } from './visual-rules.types';
import { nodeHtmlFor } from './node-templates';
import { deserializeRules, serializeRules, DrawflowData } from './graph-serializer';

@Component({
  selector: 'app-drawflow-editor',
  standalone: true,
  template: `
    <div class="relative w-full" style="height: calc(100vh - 340px); min-height: 350px;">
      <div class="absolute top-3 left-3 z-10 flex flex-wrap gap-1">
        <button class="btn btn-xs btn-outline btn-info" (click)="addSensorNode()">+ Sensor</button>
        <button class="btn btn-xs btn-outline btn-warning" (click)="addCompareNode()">+ Compare</button>
        <button class="btn btn-xs btn-outline btn-secondary" (click)="addLogicNode()">+ Logic</button>
        <button class="btn btn-xs btn-outline btn-success" (click)="addActionNode()">+ Action</button>
        <button class="btn btn-xs btn-outline btn-accent" (click)="addTimeWindowNode()">+ Time</button>
      </div>
      <div class="absolute top-3 right-3 z-10 flex gap-1">
        <button class="btn btn-xs btn-ghost" (click)="zoomIn()">+</button>
        <button class="btn btn-xs btn-ghost" (click)="zoomOut()">&minus;</button>
        <button class="btn btn-xs btn-ghost" (click)="zoomReset()">Fit</button>
      </div>
      <div #drawflowContainer class="drawflow-host w-full h-full rounded-xl border border-base-300 overflow-hidden"></div>
    </div>
  `,
  styles: [`
    :host ::ng-deep {
      /* ── Reset drawflow defaults that break dark mode ── */
      .drawflow-host .drawflow {
        background-color: var(--fallback-b2, oklch(var(--b2)));
        background-image:
          radial-gradient(circle, var(--fallback-bc, oklch(var(--bc) / 0.07)) 1px, transparent 1px);
        background-size: 20px 20px;
      }

      /* Nodes */
      .drawflow .drawflow-node {
        border-radius: 0.75rem;
        border: 1px solid var(--fallback-bc, oklch(var(--bc) / 0.15));
        background: var(--fallback-b1, oklch(var(--b1)));
        color: var(--fallback-bc, oklch(var(--bc)));
        min-width: 140px;
        padding: 0;
        box-shadow: 0 1px 4px var(--fallback-bc, oklch(var(--bc) / 0.1));
      }
      .drawflow .drawflow-node.selected {
        border-color: var(--fallback-p, oklch(var(--p)));
        box-shadow: 0 0 0 2px var(--fallback-p, oklch(var(--p) / 0.3));
      }
      .drawflow .drawflow-node:hover {
        box-shadow: 0 2px 8px var(--fallback-bc, oklch(var(--bc) / 0.15));
      }

      /* Ports */
      .drawflow .drawflow-node .input,
      .drawflow .drawflow-node .output {
        width: 12px; height: 12px;
        border: 2px solid var(--fallback-p, oklch(var(--p) / 0.5));
        background: var(--fallback-b1, oklch(var(--b1)));
      }
      .drawflow .drawflow-node .input:hover,
      .drawflow .drawflow-node .output:hover {
        background: var(--fallback-p, oklch(var(--p)));
      }

      /* Connections */
      .drawflow .connection .main-path {
        stroke: var(--fallback-p, oklch(var(--p)));
        stroke-width: 2px;
      }
      .drawflow .connection .main-path:hover {
        stroke-width: 3px;
      }

      /* Delete button on connections */
      .drawflow .drawflow-delete {
        background: var(--fallback-er, oklch(var(--er)));
        color: var(--fallback-erc, oklch(var(--erc)));
        border: none;
      }

      /* ── Node body styling ── */
      .node-body {
        padding: 0.5rem 0.75rem;
        font-size: 0.8rem;
        line-height: 1.3;
        color: var(--fallback-bc, oklch(var(--bc)));
      }
      .node-title {
        font-weight: 600;
        font-size: 0.65rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: 2px;
        color: var(--fallback-bc, oklch(var(--bc) / 0.5));
      }
      .node-label {
        font-weight: 500;
        font-size: 0.85rem;
      }
      .node-meta {
        font-size: 0.7rem;
        color: var(--fallback-bc, oklch(var(--bc) / 0.45));
        margin-top: 2px;
      }
      .node-tag {
        font-size: 0.6rem;
        padding: 0 4px;
        border-radius: 4px;
        background: var(--fallback-bc, oklch(var(--bc) / 0.08));
        vertical-align: middle;
      }
      .node-gate-label {
        font-size: 1rem;
        font-weight: 700;
        text-align: center;
      }
      .node-sensor  { border-left: 3px solid var(--fallback-in, oklch(var(--in))); }
      .node-compare { border-left: 3px solid var(--fallback-wa, oklch(var(--wa))); }
      .node-logic   { border-left: 3px solid var(--fallback-s, oklch(var(--s))); }
      .node-action  { border-left: 3px solid var(--fallback-su, oklch(var(--su))); }
      .node-time    { border-left: 3px solid var(--fallback-a, oklch(var(--a))); }
    }
  `],
})
export class DrawflowEditorComponent implements AfterViewInit, OnDestroy {
  @ViewChild('drawflowContainer', { static: true }) container!: ElementRef<HTMLElement>;

  fields = input<DeviceField[]>([]);
  controls = input<DeviceControl[]>([]);
  initialRules = input<DeviceRuleRecord[]>([]);

  nodeSelected = output<{ id: number; data: VisualNodeData } | null>();
  graphChanged = output<void>();

  private editor!: Drawflow;
  private nodeDataMap = new Map<number, VisualNodeData>();
  private selectedId: number | null = null;
  private nextX = 50;
  private nextY = 80;
  private initialized = false;

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    // Don't intercept when typing in form controls
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        if (this.selectedId != null) {
          e.preventDefault();
          this.removeNodeById(this.selectedId);
        }
        break;
      case 'Escape':
        if (this.selectedId != null) {
          e.preventDefault();
          this.selectedId = null;
          this.nodeSelected.emit(null);
        }
        break;
    }
  }

  constructor() {
    effect(() => {
      const rules = this.initialRules();
      if (this.initialized && rules) {
        this.importRules(rules);
      }
    });
  }

  ngAfterViewInit(): void {
    this.editor = new Drawflow(this.container.nativeElement);
    this.editor.reroute = true;
    this.editor.curvature = 0.4;
    this.editor.start();
    this.initialized = true;

    this.editor.on('connectionCreated', (conn: unknown) => {
      const c = conn as { output_id: string; input_id: string; output_class: string; input_class: string };
      if (!this.validateConnection(c)) {
        this.editor.removeSingleConnection(c.output_id, c.input_id, c.output_class, c.input_class);
        return;
      }
      this.graphChanged.emit();
    });

    this.editor.on('connectionRemoved', () => this.graphChanged.emit());
    this.editor.on('nodeRemoved', (id: unknown) => {
      const nid = Number(id);
      this.nodeDataMap.delete(nid);
      if (this.selectedId === nid) this.selectedId = null;
      this.graphChanged.emit();
      this.nodeSelected.emit(null);
    });
    this.editor.on('nodeSelected', (id: unknown) => {
      const nid = Number(id);
      this.selectedId = nid;
      const data = this.nodeDataMap.get(nid);
      if (data) this.nodeSelected.emit({ id: nid, data });
    });
    // Don't forward Drawflow's nodeUnselected — it fires when clicking the
    // properties panel, destroying it mid-interaction. Instead, deselect only
    // when clicking the canvas background directly.
    this.container.nativeElement.addEventListener('mousedown', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Only deselect if clicking the canvas background itself, not a node
      if (this.selectedId != null && target.classList.contains('drawflow')) {
        this.selectedId = null;
        this.nodeSelected.emit(null);
      }
    });
    this.editor.on('nodeMoved', () => this.graphChanged.emit());

    const rules = this.initialRules();
    if (rules.length) this.importRules(rules);
  }

  ngOnDestroy(): void {
    if (this.editor) this.editor.clear();
  }

  // ── Public API ──

  addSensorNode(): void {
    const f = this.fields();
    const data: SensorNodeData = {
      type: 'sensor',
      field_idx: f.length ? (f[0].field_idx ?? 0) : 0,
      label: f.length ? (f[0].display_name || f[0].field_key) : 'Sensor',
    };
    this.addNode(data, 0, 1);
  }

  addCompareNode(): void {
    const data: CompareNodeData = {
      type: 'compare', operator: '>', threshold: 0, is_primary: true, is_control: false,
    };
    this.addNode(data, 1, 1);
  }

  addLogicNode(): void {
    this.addNode({ type: 'logic_gate', logic: 'and' } as LogicGateNodeData, 4, 1);
  }

  addActionNode(): void {
    const c = this.controls();
    const data: ActionNodeData = {
      type: 'action',
      control_idx: c.length ? (c[0].control_idx ?? 0) : 0,
      action_state: 1, priority: 128, cooldown_seconds: 300,
      enabled: true, action_dur_x10s: 0,
      label: c.length ? (c[0].display_name || c[0].control_key) : 'Control',
    };
    this.addNode(data, 1, 0);
  }

  addTimeWindowNode(): void {
    this.addNode({ type: 'time_window', time_start: 6, time_end: 18 } as TimeWindowNodeData, 0, 1);
  }

  updateNodeData(id: number, data: VisualNodeData): void {
    this.nodeDataMap.set(id, data);
    const nodeEl = this.container.nativeElement.querySelector(`#node-${id} .drawflow_content_node`);
    if (nodeEl) nodeEl.innerHTML = nodeHtmlFor(data);
    const nodeStore = this.editor.drawflow.drawflow.Home.data as Record<string, Record<string, unknown>>;
    if (nodeStore[id]) nodeStore[id]['data'] = { ...data };
    this.graphChanged.emit();
  }

  exportRules(deviceEui: string): { rules: Partial<DeviceRuleRecord>[]; errors: string[] } {
    return serializeRules(this.editor.export() as DrawflowData, deviceEui, this.nodeDataMap);
  }

  importRules(rules: DeviceRuleRecord[]): void {
    this.editor.clear();
    this.nodeDataMap.clear();
    this.nextX = 50;
    this.nextY = 80;
    if (!rules.length) return;

    const { graphData, dataMap } = deserializeRules(rules, this.fields(), this.controls());
    this.editor.import(graphData);
    for (const [id, data] of dataMap.entries()) this.nodeDataMap.set(id, data);
  }

  removeNodeById(id: number): void {
    this.editor.removeNodeId(`node-${id}`);
  }

  zoomIn(): void { this.editor.zoom_in(); }
  zoomOut(): void { this.editor.zoom_out(); }
  zoomReset(): void { this.editor.zoom_reset(); }

  // ── Private ──

  private addNode(data: VisualNodeData, inputs: number, outputs: number): number {
    const pos = this.nextPosition();
    const id = this.editor.addNode(
      data.type, inputs, outputs, pos.x, pos.y, data.type, { ...data }, nodeHtmlFor(data),
    );
    this.nodeDataMap.set(id, data);
    this.graphChanged.emit();
    return id;
  }

  private nextPosition(): { x: number; y: number } {
    const pos = { x: this.nextX, y: this.nextY };
    this.nextY += 120;
    if (this.nextY > 600) { this.nextY = 80; this.nextX += 220; }
    return pos;
  }

  private validateConnection(conn: { output_id: string; input_id: string }): boolean {
    const src = this.nodeDataMap.get(Number(conn.output_id))?.type;
    const tgt = this.nodeDataMap.get(Number(conn.input_id))?.type;
    if (!src || !tgt) return false;
    if (src === 'sensor' && tgt === 'compare') return true;
    if (src === 'compare' && (tgt === 'logic_gate' || tgt === 'action')) return true;
    if (src === 'logic_gate' && tgt === 'action') return true;
    if (src === 'time_window' && tgt === 'action') return true;
    return false;
  }
}
