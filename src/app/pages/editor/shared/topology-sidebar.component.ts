import { Component, inject, input, output, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SystemEditorService } from '../../../core/services/system-editor.service';
import type { RuleDiagnostic } from '../../../core/models/electron-api';
import { NODE_REGISTRY } from '../../../core/models/entities.model';
import { deriveRoutes } from '../topology-tab/derive-routes';

export type Selection =
  | { kind: 'node'; nodeId: string }
  | { kind: 'pipe'; pipeId: string };

@Component({
  selector: 'app-topology-sidebar',
  standalone: true,
  imports: [FormsModule],
  template: `
    <!-- Node properties (data-driven) -->
    @if (selectedNodeData(); as sn) {
      <div class="sidebar-section">
        <h3 class="sidebar-title">{{ sn.desc.label }}</h3>
        <div class="sidebar-fields">
          @for (field of sn.desc.sidebarFields; track field.key) {
            <label class="sidebar-label">{{ field.label }}</label>
            @if (field.type === 'pin') {
              <select class="select select-xs select-bordered flex-1 font-mono"
                [ngModel]="$any(sn.node)[field.key]"
                (ngModelChange)="updateField.emit({ nodeId: sn.node.id, field: field.key, value: $event })">
                <option value="">-- select --</option>
                @for (pin of editor.availablePins(field.pinCap); track pin.gpio) {
                  <option [value]="pin.gpio" [disabled]="!!pin.usedBy">
                    {{ pin.gpio }} [{{ pin.caps.join(', ') }}]{{ pin.usedBy ? ' (' + pin.usedBy + ')' : '' }}
                  </option>
                }
              </select>
            } @else if (field.type === 'number') {
              <input type="number" class="input input-xs input-bordered w-full font-mono"
                [ngModel]="$any(sn.node)[field.key]"
                (ngModelChange)="updateField.emit({ nodeId: sn.node.id, field: field.key, value: +$event })" min="0" />
            } @else {
              <input class="input input-xs input-bordered w-full font-mono"
                [ngModel]="$any(sn.node)[field.key]"
                (ngModelChange)="updateField.emit({ nodeId: sn.node.id, field: field.key, value: $event })" />
            }
          }
        </div>
        @for (d of nodeDiagnostics(sn.node.id); track d.message) {
          <div class="flex items-start gap-1.5 py-0.5 mt-1 text-[11px]"
            [class.text-error]="d.severity === 'error'"
            [class.text-warning]="d.severity === 'warning'">
            <span class="shrink-0">{{ d.severity === 'error' ? '\u2715' : '\u26A0' }}</span>
            <span>{{ d.message }}</span>
          </div>
        }
        @if (!sn.desc.singleton) {
          <button class="btn btn-error btn-xs mt-3 w-full" (click)="deleteNode.emit(sn.node.id)">Delete {{ sn.desc.label }}</button>
        }
      </div>
    }

    <!-- Pipe properties -->
    @if (selectedPipeData(); as pipeData) {
      <div class="sidebar-section">
        <h3 class="sidebar-title">Pipe</h3>
        <div class="text-xs font-mono text-base-content/60 mb-2">{{ pipeData.pipe.from }} &rarr; {{ pipeData.pipe.to }}</div>
        <button class="btn btn-error btn-xs w-full" (click)="deletePipe.emit(pipeData.pipe.id)">Delete Pipe</button>
      </div>
    }

    <!-- Routes (default view when nothing selected) -->
    @if (!selection()) {
      <div class="sidebar-section">
        <h3 class="sidebar-title">Derived Routes</h3>
        @if (derivedRoutes().length === 0) {
          <div class="text-base-content/40 text-center py-4 text-xs">No routes derived yet.<br>Connect nodes with pipes.</div>
        } @else {
          @for (route of derivedRoutes(); track route.key) {
            <div class="flex items-center justify-between py-1.5 border-b border-base-300/20">
              <span class="font-mono text-xs">{{ route.key }}</span>
              @if (routeDiagnostics(route.key).length > 0) {
                <span class="badge badge-error badge-xs">Error</span>
              } @else if (!route.valid) {
                <span class="badge badge-warning badge-xs">Incomplete</span>
              } @else {
                <span class="badge badge-success badge-xs">Valid</span>
              }
            </div>
            @for (d of routeDiagnostics(route.key); track d.message) {
              <div class="flex items-start gap-1.5 px-2 py-0.5 text-[11px]"
                [class.text-error]="d.severity === 'error'"
                [class.text-warning]="d.severity === 'warning'">
                <span class="shrink-0">{{ d.severity === 'error' ? '\u2715' : '\u26A0' }}</span>
                <span>{{ d.message }}</span>
              </div>
            }
          }
        }
      </div>

      @if (editor.diagnostics().length > 0) {
        <div class="sidebar-section">
          <h3 class="sidebar-title">Validation</h3>
          @for (d of editor.diagnostics(); track $index) {
            <div class="flex items-start gap-1.5 py-0.5 text-[11px]"
              [class.text-error]="d.severity === 'error'"
              [class.text-warning]="d.severity === 'warning'">
              <span class="shrink-0">{{ d.severity === 'error' ? '\u2715' : '\u26A0' }}</span>
              <span>{{ d.message }}</span>
            </div>
          }
        </div>
      }

      <div class="sidebar-section">
        <h3 class="sidebar-title">Route Overrides</h3>
        @if (overrideEntries().length === 0) {
          <div class="text-base-content/40 text-center py-4 text-xs">No overrides defined.</div>
        } @else {
          @for (entry of overrideEntries(); track entry.key) {
            <div class="card bg-base-200/40 mb-2">
              <div class="card-body p-2 gap-1">
                <span class="font-mono font-semibold text-xs">{{ entry.override.name ?? entry.key }}</span>
                <div class="flex items-center gap-2">
                  <label class="text-[10px] text-base-content/50">Max Runtime</label>
                  <input type="number" class="input input-xs input-bordered w-20 font-mono"
                    [ngModel]="entry.override.max_runtime_seconds ?? 1800"
                    (ngModelChange)="updateMaxRuntime.emit({ key: entry.key, value: $event })" min="0" step="60" />
                  <span class="text-[10px] text-base-content/50">s</span>
                </div>
              </div>
            </div>
          }
        }
      </div>
    }
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
    }
    .sidebar-fields { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: center; }
    .sidebar-label { font-size: 10px; color: oklch(var(--bc) / 0.5); white-space: nowrap; }
  `],
})
export class TopologySidebarComponent {
  protected editor = inject(SystemEditorService);

  // --- Inputs ---
  selection = input<Selection | null>(null);

  // --- Outputs ---
  deleteNode = output<string>();
  deletePipe = output<string>();
  updateField = output<{ nodeId: string; field: string; value: any }>();
  updateMaxRuntime = output<{ key: string; value: number }>();

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
    return t ? deriveRoutes(t) : [];
  });

  protected overrideEntries = computed(() => {
    const t = this.editor.topology();
    if (!t) return [];
    return Object.entries(t.route_overrides).map(([key, override]) => ({ key, override }));
  });

  // --- Helpers ---
  nodeDiagnostics(nodeId: string): RuleDiagnostic[] {
    return this.editor.diagnosticsByTarget().get(nodeId) ?? [];
  }

  routeDiagnostics(routeKey: string): RuleDiagnostic[] {
    return this.editor.diagnosticsByTarget().get(routeKey) ?? [];
  }
}
