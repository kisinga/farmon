import { Component, inject, computed, signal, OnInit, OnDestroy } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { WorkspaceService } from '../../core/services/workspace.service';

@Component({
  selector: 'app-context-strip',
  standalone: true,
  template: `
    <div class="flex items-center gap-3">
      @for (node of nodes(); track node.config) {
        <button
          class="flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors"
          [class.bg-base-200/60]="node.isActive"
          [class.hover:bg-base-200/40]="!node.isActive"
          (click)="navigateTo(node.config)"
        >
          <span
            class="w-2.5 h-2.5 rounded-full shrink-0"
            [class.bg-success]="node.deployed"
            [class.bg-base-300]="!node.deployed"
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
    const systems = this.workspace.systems();
    const active = this.workspace.activeConfig();
    if (!site || site.systems.length === 0) return [];

    return site.systems.map(sp => {
      const sys = systems.get(sp.config);
      return {
        config: sp.config,
        label: sys?.topology.device.friendly_name ?? sp.config,
        isActive: sp.config === active,
        deployed: sp.checksum !== '',
      };
    });
  });

  protected navigateTo(config: string) {
    const siteName = this.workspace.siteName();
    if (!siteName) return;
    const step = this.currentStep();
    this.router.navigate(['/site', siteName, 'system', config, step]);
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
