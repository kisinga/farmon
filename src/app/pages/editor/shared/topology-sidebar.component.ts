import { Component, inject, input, output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import { ValidationPanelComponent } from '../../../shared/validation-panel/validation-panel.component';
import type { RuleDiagnostic } from '../../../core/models/backend-api';
import { NODE_REGISTRY } from '../../../core/models/entities.model';
import type { DerivedRoute } from './derive-routes';
import { buildGraph, activeGraph, deriveRoutes, RouteOverrideSchema } from '@core';
import type { RouteOverride } from '../../../core/models/topology.model';
import { routeLevelInfo } from './route-level-info';
import type { Selection } from './selection';
import { ZodInputComponent } from '../../../shared/zod-input/zod-input.component';
import { NodePropertiesComponent } from './node-properties.component';
export type { Selection };

@Component({
  selector: 'app-topology-sidebar',
  standalone: true,
  imports: [FormsModule, ValidationPanelComponent, ZodInputComponent, NodePropertiesComponent],
  template: `
    <!-- Node properties (data-driven) -->
    @if (selectedNodeData(); as sn) {
      <app-node-properties
        [node]="sn.node"
        [desc]="sn.desc"
        (updateField)="updateField.emit($event)"
        (deleteNode)="deleteNode.emit($event)" />
    }

    <!-- Pipe properties -->
    @if (selectedPipeData(); as pipeData) {
      <div class="sidebar-section">
        <button class="sidebar-title w-full flex items-center justify-between" (click)="toggleSection('pipe')">
          <span>Pipe</span>
          <span class="text-[10px]">{{ isExpanded('pipe') ? '▼' : '▶' }}</span>
        </button>
        @if (isExpanded('pipe')) {
        <div class="text-xs font-mono text-base-content/60 mb-2">{{ pipeData.pipe.from }} &rarr; {{ pipeData.pipe.to }}</div>
        <button class="btn btn-error btn-xs w-full" (click)="deletePipe.emit(pipeData.pipe.id)">Delete Pipe</button>
        }
      </div>
    }

    <!-- Routes (always visible) -->
    <div class="sidebar-section">
      <button class="sidebar-title w-full flex items-center justify-between" (click)="toggleSection('routes')">
        <span>Derived Routes</span>
        <span class="text-[10px]">{{ isExpanded('routes') ? '▼' : '▶' }}</span>
      </button>
      @if (isExpanded('routes')) {
      @if (derivedRoutes().length === 0) {
        <div class="text-base-content/40 text-center py-4 text-xs">No routes derived yet.<br>Connect nodes with pipes.</div>
      } @else {
        @for (route of derivedRoutes(); track route.key) {
          <div class="route-row flex items-center justify-between py-1.5 border-b border-base-300/20 cursor-pointer hover:bg-base-200/50 px-2 -mx-1 rounded"
            (click)="onRouteClick(route)">
            <span class="font-mono text-xs flex items-center gap-1.5">
              <span class="text-base-content/30 text-[9px]">&#x25B6;</span>
              {{ route.key }}
            </span>
            @if (hasErrorDiagnostics(route.key)) {
              <span class="badge badge-error badge-xs">Error</span>
            } @else if (hasWarningDiagnostics(route.key)) {
              <span class="badge badge-warning badge-xs">Warning</span>
            } @else if (!route.monitored) {
              <span class="badge badge-ghost badge-xs">Unmonitored</span>
            } @else if (hasInfoDiagnostics(route.key)) {
              <span class="badge badge-info badge-xs">Info</span>
            } @else {
              <span class="badge badge-success badge-xs">Valid</span>
            }
          </div>
        }
      }
      }
    </div>

    @if (!selection()) {
      <div class="sidebar-section">
        <button class="sidebar-title w-full flex items-center justify-between" (click)="toggleSection('overrides')">
          <span>Route Overrides</span>
          <span class="text-[10px]">{{ isExpanded('overrides') ? '▼' : '▶' }}</span>
        </button>
        @if (isExpanded('overrides')) {
        @if (overrideEntries().length === 0) {
          <div class="text-base-content/40 text-center py-4 text-xs">No overrides defined.</div>
        } @else {
          @for (entry of overrideEntries(); track entry.key) {
            <div class="card bg-base-200/40 mb-2">
              <div class="card-body p-2 gap-1">
                <span class="font-mono font-semibold text-xs">{{ entry.key }}</span>
                <div class="flex items-center gap-2">
                  <label class="text-[10px] text-base-content/50">Default Max Runtime</label>
                  <!-- Operator-facing unit is minutes; storage stays in seconds
                       (max_runtime_seconds) so the manifest and firmware are
                       unchanged. View → seconds happens in onMaxRuntimeChange. -->
                  <input type="number" class="input input-xs input-bordered w-20 font-mono"
                    min="1" max="120" step="1"
                    [name]="'rt-' + entry.key"
                    [ngModelOptions]="{ standalone: true }"
                    [ngModel]="maxRuntimeMinutes(entry.override.max_runtime_seconds)"
                    (ngModelChange)="onMaxRuntimeMinutesChange(entry.key, $event)" />
                  <span class="text-[10px] text-base-content/50">min</span>
                </div>
                @if (entry.sourceHasLevel) {
                  <div class="flex items-center gap-2">
                    <label class="text-[10px] text-base-content/50">Default Source Min</label>
                    <app-zod-input
                      [schema]="routeOverrideSchema"
                      fieldKey="source_min_level"
                      type="number"
                      inputClass="w-16 font-mono"
                      placeholder="—"
                      [min]="0"
                      [max]="100"
                      [value]="entry.override.source_min_level"
                      (valueChange)="updateRouteOverride.emit({ key: entry.key, field: 'source_min_level', value: $any($event) })" />
                    <span class="text-[10px] text-base-content/50">%</span>
                  </div>
                }
                @if (entry.destHasLevel) {
                  <div class="flex items-center gap-2">
                    <label class="text-[10px] text-base-content/50">Default Dest Max</label>
                    <app-zod-input
                      [schema]="routeOverrideSchema"
                      fieldKey="dest_max_level"
                      type="number"
                      inputClass="w-16 font-mono"
                      placeholder="—"
                      [min]="0"
                      [max]="100"
                      [value]="entry.override.dest_max_level"
                      (valueChange)="updateRouteOverride.emit({ key: entry.key, field: 'dest_max_level', value: $any($event) })" />
                    <span class="text-[10px] text-base-content/50">%</span>
                  </div>
                }
                <div class="text-[10px] text-base-content/45 mt-1 leading-snug">
                  Initial values, tuned live from the dashboard.
                </div>
              </div>
            </div>
          }
        }
        }
      </div>
    }

    <!-- Validation summary (always visible) -->
    <div class="sidebar-section">
      <button class="sidebar-title w-full flex items-center justify-between" (click)="toggleSection('validation')">
        <span>Validation</span>
        <span class="text-[10px]">{{ isExpanded('validation') ? '▼' : '▶' }}</span>
      </button>
      @if (isExpanded('validation')) {
      <app-validation-panel
        [result]="editor.validation()"
        [gpioUsage]="editor.gpioUsage()"
        (selectTarget)="selectNode.emit($event)"
      />
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      font-size: 12px;
    }
    .sidebar-section { padding: 12px; border-bottom: 1px solid oklch(var(--b3) / 0.3); }
    .sidebar-title {
      font-size: 10px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.05em; color: oklch(var(--bc) / 0.5); margin-bottom: 8px;
      background: none; border: none; padding: 0; cursor: pointer;
    }
    .sidebar-title:hover { color: oklch(var(--bc) / 0.7); }
  `],
})
export class TopologySidebarComponent {
  protected editor = inject(SystemEditorService);
  protected routeOverrideSchema = RouteOverrideSchema;

  private expandedSections = signal<Set<string>>(new Set(['pipe', 'routes']));

  protected isExpanded(key: string): boolean {
    return this.expandedSections().has(key);
  }

  protected toggleSection(key: string) {
    this.expandedSections.update(set => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // --- Inputs ---
  selection = input<Selection | null>(null);

  // --- Outputs ---
  deleteNode = output<string>();
  deletePipe = output<string>();
  updateField = output<{ nodeId: string; field: string; value: any }>();
  updateRouteOverride = output<{ key: string; field: keyof RouteOverride; value: number | undefined }>();
  selectRoute = output<{ route: DerivedRoute; sharedNodeIds?: string[] }>();
  selectNode = output<string>();

  // --- Computed ---
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
    if (!t) return [];
    const g = activeGraph(buildGraph(t.nodes, t.pipes));
    return deriveRoutes(g);
  });

  protected overrideEntries = computed(() => {
    const t = this.editor.topology();
    if (!t) return [];
    return Object.entries(t.route_overrides ?? {}).map(([key, override]) => ({
      key,
      override,
      ...routeLevelInfo(key, t.nodes, t.pipes),
    }));
  });

  // --- Route override unit conversion ---

  /** Display value (minutes) for a stored max_runtime_seconds. */
  protected maxRuntimeMinutes(seconds: number | undefined): number {
    return Math.max(1, Math.round((seconds ?? 1800) / 60));
  }

  /** Persist a minutes-input change as the seconds value the schema expects. */
  protected onMaxRuntimeMinutesChange(key: string, minutes: unknown): void {
    const m = Number(minutes);
    const seconds = Number.isFinite(m) && m > 0 ? Math.round(m * 60) : undefined;
    this.updateRouteOverride.emit({ key, field: 'max_runtime_seconds', value: seconds });
  }

  // --- Route & validation helpers ---

  routeDiagnostics(routeKey: string): RuleDiagnostic[] {
    return this.editor.diagnosticsByTarget().get(routeKey) ?? [];
  }

  hasErrorDiagnostics(routeKey: string): boolean {
    return this.routeDiagnostics(routeKey).some(d => d.severity === 'error');
  }

  hasWarningDiagnostics(routeKey: string): boolean {
    return this.routeDiagnostics(routeKey).some(d => d.severity === 'warning');
  }

  hasInfoDiagnostics(routeKey: string): boolean {
    return this.routeDiagnostics(routeKey).some(d => d.severity === 'info');
  }

  onRouteClick(route: DerivedRoute) {
    const diags = this.routeDiagnostics(route.key);
    const sharedNodeIds = [...new Set(diags.flatMap(d => d.sharedNodeIds ?? []))];
    this.selectRoute.emit({ route, sharedNodeIds: sharedNodeIds.length ? sharedNodeIds : undefined });
  }
}
