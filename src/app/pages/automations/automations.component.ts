import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AutomationsManagerComponent } from './automations-manager.component';

/**
 * AutomationsComponent (`/site/:name/automations`) - the standalone page for the
 * operator automation manager. Now a thin shell: page chrome (back link + title)
 * around {@link AutomationsManagerComponent}, which owns all the list/edit logic
 * and is shared with the dashboard's Automations modal.
 */
@Component({
  selector: 'app-automations',
  standalone: true,
  imports: [RouterLink, AutomationsManagerComponent],
  host: { class: 'flex-1 overflow-auto' },
  template: `
    <div class="max-w-6xl mx-auto w-full px-4 sm:px-6 py-5 sm:py-6 flex flex-col gap-5">
      <header class="min-w-0">
        <a [routerLink]="['/site', siteId(), 'dashboard']" class="text-xs text-base-content/50 hover:text-base-content/80 transition-colors">← Dashboard</a>
        <h1 class="app-title text-xl font-semibold mt-0.5">Automations</h1>
        <p class="text-sm text-base-content/50 mt-0.5">Run a route on a schedule, stopping at a target volume or time.</p>
      </header>

      @if (siteId()) {
        <app-automations-manager [siteId]="siteId()" />
      }
    </div>
  `,
})
export class AutomationsComponent {
  private route = inject(ActivatedRoute);
  protected siteId = signal(this.route.snapshot.paramMap.get('name') ?? '');
}
