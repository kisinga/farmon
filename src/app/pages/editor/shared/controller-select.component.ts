import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { SystemEditorService, PANEL_SLUGS } from '../../../core/services/system-editor.service';

/**
 * The ONE controller switcher. Renders the editor's controller dropdown over the shared
 * active-controller contract (`workspace.activeControllerId`) and is the single place that
 * mutates it — by navigating the URL, which is the source of truth for the active
 * controller. Every editor surface that shows a controller picker uses this component, so
 * the dropdown can never drift from the page it sits above.
 *
 * Selection is bound with `[selected]` on each option, NOT `[value]` on the `<select>`:
 * `[value]` on a native select doesn't reliably track a signal across `@for`-rendered
 * options, which left the dropdown stuck on the first controller while the page below it
 * showed the actually-active one.
 */
@Component({
  selector: 'app-controller-select',
  standalone: true,
  template: `
    @if (controllers().length > 0) {
      <span class="text-xs text-base-content/50 shrink-0">Controller</span>
      <select class="select select-sm select-bordered font-mono text-xs" (change)="switch($event)">
        @for (c of controllers(); track c.id) {
          <option [value]="c.id" [selected]="c.id === activeControllerId()">{{ c.friendlyName }}</option>
        }
      </select>
    }
  `,
})
export class ControllerSelectComponent {
  private workspace = inject(WorkspaceService);
  private editor = inject(SystemEditorService);
  private router = inject(Router);

  protected activeControllerId = this.workspace.activeControllerId;
  protected controllers = computed(() =>
    (this.workspace.siteTopology()?.controllers ?? []).map((c) => ({
      id: c.id,
      friendlyName: c.friendlyName ?? c.id,
    })),
  );

  /** Switch the active controller, preserving the current section. */
  protected switch(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    const siteId = this.workspace.site()?.id;
    if (!siteId || !id) return;
    const panel = this.editor.panel();
    const slug = panel === 'site' ? PANEL_SLUGS.design : PANEL_SLUGS[panel];
    this.router.navigate(['/site', siteId, 'system', id, slug]);
  }
}
