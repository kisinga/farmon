import {
  Component, AfterViewInit, OnDestroy, ViewChild, ElementRef,
  input, output, signal, effect,
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
    <div class="relative w-full" style="height: calc(100vh - 260px); min-height: 400px;">
      <!-- Toolbar -->
      <div class="absolute top-3 left-3 z-10 flex flex-wrap gap-1">
        <button class="btn btn-xs btn-soft btn-info" (click)="addSensorNode()">+ Sensor</button>
        <button class="btn btn-xs btn-soft btn-warning" (click)="addCompareNode()">+ Compare</button>
        <button class="btn btn-xs btn-soft btn-secondary" (click)="addLogicNode()">+ Logic</button>
        <button class="btn btn-xs btn-soft btn-success" (click)="addActionNode()">+ Action</button>
        <button class="btn btn-xs btn-soft btn-accent" (click)="addTimeWindowNode()">+ Time Window</button>
      </div>
      <div class="absolute top-3 right-3 z-10 flex gap-1">
        <button class="btn btn-xs btn-ghost" (click)="zoomIn()">+</button>
        <button class="btn btn-xs btn-ghost" (click)="zoomOut()">&minus;</button>
        <button class="btn btn-xs btn-ghost" (click)="zoomReset()">Reset</button>
      </div>
      <!-- Canvas -->
      <div #drawflowContainer class="w-full h-full rounded-xl border border-base-300 overflow-hidden bg-base-200/30"></div>
    </div>
  `,
  styles: [`
    :host ::ng-deep {
      /* ── Base drawflow overrides ── */
      .drawflow { background: transparent; }
      .drawflow .drawflow-node {
        border-radius: 0.75rem;
        border: 1px solid oklch(var(--bc) / 0.15);
        background: oklch(var(--b1));
        min-width: 140px;
        padding: 0;
        box-shadow: 0 1px 3px oklch(var(--bc) / 0.08);
      }
      .drawflow .drawflow-node.selected {
        border-color: oklch(var(--p));
        box-shadow: 0 0 0 2px oklch(var(--p) / 0.25);
      }
      .drawflow .drawflow-node .input,
      .drawflow .drawflow-node .output {
        width: 12px; height: 12px;
        border: 2px solid oklch(var(--bc) / 0.3);
        background: oklch(var(--b1));
      }
      .drawflow .connection .main-path {
        stroke: oklch(var(--p));
        stroke-width: 2px;
      }

      /* ── Custom node styling ── */
      .node-body {
        padding: 0.5rem 0.75rem;
        font-size: 0.8rem;
        line-height: 1.3;
      }
      .node-title {
        font-weight: 600;
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        margin-bottom: 2px;
        opacity: 0.6;
      }
      .node-label {
        font-weight: 500;
        font-size: 0.85rem;
      }
      .node-meta {
        font-size: 0.7rem;
        opacity: 0.5;
        margin-top: 2px;
      }
      .node-tag {
        font-size: 0.6rem;
        padding: 0 4px;
        border-radius: 4px;
        background: oklch(var(--bc) / 0.08);
        vertical-align: middle;
      }
      .node-gate-label {
        font-size: 1rem;
        font-weight: 700;
        text-align: center;
      }
      .node-sensor  { border-left: 3px solid oklch(var(--in)); }
      .node-compare { border-left: 3px solid oklch(var(--wa)); }
      .node-logic   { border-left: 3px solid oklch(var(--s)); }
      .node-action  { border-left: 3px solid oklch(var(--su)); }
      .node-time    { border-left: 3px solid oklch(var(--a)); }
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
  private nextX = 50;
  private nextY = 80;
  private initialized = false;

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

    // Connection validation
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
      this.nodeDataMap.delete(id as number);
      this.graphChanged.emit();
      this.nodeSelected.emit(null);
    });
    this.editor.on('nodeSelected', (id: unknown) => {
      const data = this.nodeDataMap.get(id as number);
      if (data) this.nodeSelected.emit({ id: id as number, data });
    });
    this.editor.on('nodeUnselected', () => this.nodeSelected.emit(null));
    this.editor.on('nodeMoved', () => this.graphChanged.emit());

    // Load initial rules
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
      type: 'compare',
      operator: '>',
      threshold: 0,
      is_primary: true,
      is_control: false,
    };
    this.addNode(data, 1, 1);
  }

  addLogicNode(): void {
    const data: LogicGateNodeData = { type: 'logic_gate', logic: 'and' };
    this.addNode(data, 4, 1);
  }

  addActionNode(): void {
    const c = this.controls();
    const data: ActionNodeData = {
      type: 'action',
      control_idx: c.length ? (c[0].control_idx ?? 0) : 0,
      action_state: 1,
      priority: 128,
      cooldown_seconds: 300,
      enabled: true,
      action_dur_x10s: 0,
      label: c.length ? (c[0].display_name || c[0].control_key) : 'Control',
    };
    this.addNode(data, 1, 0);
  }

  addTimeWindowNode(): void {
    const data: TimeWindowNodeData = { type: 'time_window', time_start: 6, time_end: 18 };
    this.addNode(data, 0, 1);
  }

  updateNodeData(id: number, data: VisualNodeData): void {
    this.nodeDataMap.set(id, data);
    // Re-render node HTML
    const nodeEl = this.container.nativeElement.querySelector(`#node-${id} .drawflow_content_node`);
    if (nodeEl) nodeEl.innerHTML = nodeHtmlFor(data);
    // Also update drawflow's internal data
    const nodeStore = this.editor.drawflow.drawflow.Home.data as Record<string, Record<string, unknown>>;
    if (nodeStore[id]) {
      nodeStore[id]['data'] = { ...data };
    }
    this.graphChanged.emit();
  }

  exportRules(deviceEui: string): { rules: Partial<DeviceRuleRecord>[]; errors: string[] } {
    const graphData = this.editor.export() as DrawflowData;
    return serializeRules(graphData, deviceEui, this.nodeDataMap);
  }

  importRules(rules: DeviceRuleRecord[]): void {
    this.editor.clear();
    this.nodeDataMap.clear();
    this.nextX = 50;
    this.nextY = 80;

    if (!rules.length) return;

    const fields = this.fields();
    const controls = this.controls();
    const { graphData, dataMap } = deserializeRules(rules, fields, controls);

    this.editor.import(graphData);
    for (const [id, data] of dataMap.entries()) {
      this.nodeDataMap.set(id, data);
    }
  }

  zoomIn(): void { this.editor.zoom_in(); }
  zoomOut(): void { this.editor.zoom_out(); }
  zoomReset(): void { this.editor.zoom_reset(); }

  // ── Private helpers ──

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
    if (this.nextY > 600) {
      this.nextY = 80;
      this.nextX += 220;
    }
    return pos;
  }

  private validateConnection(conn: { output_id: string; input_id: string }): boolean {
    const srcData = this.nodeDataMap.get(Number(conn.output_id));
    const tgtData = this.nodeDataMap.get(Number(conn.input_id));
    if (!srcData || !tgtData) return false;

    // Allowed connections: sensor→compare, compare→logic_gate, compare→action, logic_gate→action, time_window→action
    const src = srcData.type;
    const tgt = tgtData.type;

    if (src === 'sensor' && tgt === 'compare') return true;
    if (src === 'compare' && (tgt === 'logic_gate' || tgt === 'action')) return true;
    if (src === 'logic_gate' && tgt === 'action') return true;
    if (src === 'time_window' && tgt === 'action') return true;

    return false;
  }
}
