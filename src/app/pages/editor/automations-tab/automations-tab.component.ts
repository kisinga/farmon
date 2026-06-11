import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { SectionHeaderComponent } from '../shared/section-header.component';

/**
 * Retired editor tab. Automations are no longer baked into the topology/firmware —
 * they're first-class runtime data in the `automations` collection, created and
 * edited on the operator Automations page (no design-lock, no reflash). This tab
 * is kept only to redirect anyone who lands on the old `…/schedules` URL.
 */
@Component({
  selector: 'app-automations-tab',
  standalone: true,
  imports: [RouterLink, SectionHeaderComponent],
  template: `
    <div class="content-pane space-y-6">
      <app-section-header
        title="Automations"
        subtitle="Automations now live on the dashboard's Automations page — edit them any time without a rebuild." />
      <div class="surface px-6 py-10 text-center space-y-3">
        <p class="text-sm text-base-content/60">Schedules moved out of the design and became runtime automations: schedule a route by time or tank level, and optionally run it to a target volume or duration.</p>
        @if (siteId(); as id) {
          <a [routerLink]="['/site', id, 'automations']" class="btn btn-sm btn-primary">Open Automations →</a>
        }
      </div>
    </div>
  `,
})
export class AutomationsTabComponent {
  private workspace = inject(WorkspaceService);
  protected siteId = () => this.workspace.site()?.id ?? '';
}
