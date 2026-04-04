import { Component, inject } from '@angular/core';
import { SystemEditorService } from '../../../core/services/system-editor.service';

@Component({
  selector: 'app-routes-tab',
  standalone: true,
  template: `
    @if (editor.topology(); as t) {
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">Routes</h2>
          <span class="badge badge-info badge-sm gap-1">Derived from topology</span>
        </div>

        <div class="alert alert-info text-sm">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Routes are automatically computed from the topology graph. Edit nodes, pipes, and route overrides to change them.</span>
        </div>

        @if (overrideKeys(t).length === 0) {
          <div class="text-base-content/40 text-center py-8">No route overrides defined.</div>
        } @else {
          @for (key of overrideKeys(t); track key) {
            <div class="card bg-base-100 shadow-sm">
              <div class="card-body p-4 gap-2">
                <div class="flex items-center justify-between">
                  <span class="font-mono font-semibold text-sm">{{ t.route_overrides[key].name ?? key }}</span>
                  <span class="text-xs text-base-content/50">{{ key }}</span>
                </div>
                <div class="text-sm">
                  <span class="text-xs text-base-content/50">Max Runtime</span>
                  <span class="font-mono ml-2">{{ t.route_overrides[key].max_runtime_seconds ?? 1800 }}s</span>
                </div>
              </div>
            </div>
          }
        }
      </div>
    }
  `,
})
export class RoutesTabComponent {
  protected editor = inject(SystemEditorService);

  protected overrideKeys(t: { route_overrides: Record<string, unknown> }): string[] {
    return Object.keys(t.route_overrides);
  }
}
