import { Component, inject, computed, signal, OnInit, OnDestroy } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { WorkspaceService } from '../../core/services/workspace.service';

@Component({
  selector: 'app-context-strip',
  standalone: true,
  template: `
    <div class="flex items-center gap-3">
      @for (node of nodes(); track node.systemId) {
        <button
          class="flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors"
          [class.bg-base-200/60]="node.isActive"
          [class.hover:bg-base-200/40]="!node.isActive"
          (click)="navigateTo(node.systemId)"
        >
          <span
            class="w-2.5 h-2.5 rounded-full shrink-0"
            [class.bg-success]="false"
            [class.bg-base-300]="true"
            [style.box-shadow]="node.isActive ? '0 0 0 2px var(--nav-layer-system)' : 'none'"
          ></span>
          <span
            class="text-xs truncate max-w-[80px]"
            [class.font-semibold]="node.isActive"
            [class.nav-label-system]="node.isActive"
            [class.text-base-content/60]="!node.isActive"
          >{{ node.label }}</span>
        </button>
      }
    </div>
  `,
})
export class ContextStripComponent implements OnInit, OnDestroy {
  private workspace = inject(WorkspaceService);
  private router = inject(Router);

  private currentUrl = signal(this.router.url);
  private routerSub: any;

  private currentStep = computed(() => {
    const url = this.currentUrl();
    const parts = url.split('/');
    return parts[parts.length - 1] || 'device';
  });

  protected nodes = computed(() => {
    const site = this.workspace.site();
    const topology = this.workspace.siteTopology();
    const activeId = this.workspace.activeControllerId();
    if (!site || !topology || topology.controllers.length === 0) return [];

    return topology.controllers.map(ctrl => ({
      systemId: ctrl.id,
      label: ctrl.friendlyName ?? ctrl.id,
      isActive: ctrl.id === activeId,
    }));
  });

  protected navigateTo(systemId: string) {
    const siteId = this.workspace.site()?.id;
    if (!siteId) return;
    const step = this.currentStep();
    this.router.navigate(['/site', siteId, 'system', systemId, step]);
  }

  ngOnInit() {
    this.routerSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => this.currentUrl.set(e.urlAfterRedirects));
  }

  ngOnDestroy() {
    this.routerSub?.unsubscribe();
  }
}
