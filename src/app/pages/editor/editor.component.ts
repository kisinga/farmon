import { Component, inject, OnInit, OnDestroy, signal, effect, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { SystemEditorService } from '../../core/services/system-editor.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import { BoardService } from '../../core/services/board.service';
import { ElectronService } from '../../core/services/electron.service';
import { TopologyX6TabComponent } from './topology-x6-tab/topology-x6-tab.component';

type TabId = 'device' | 'design' | 'automations' | 'timing' | 'docs' | 'deploy';

const TAB_ICONS: Record<TabId, string> = {
  device: 'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z',
  design: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z',
  automations: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  timing: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  docs: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  deploy: 'M13 10V3L4 14h7v7l9-11h-7z',
};

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    TopologyX6TabComponent,
  ],
  host: {
    class: 'flex-1 min-h-0 flex flex-col overflow-hidden',
    '[class.preview]': 'isPreview()',
  },
  template: `
    <div class="flex flex-col flex-1 min-h-0">
      <!-- Header bar -->
      <div class="flex items-center justify-between px-6 py-3 bg-base-100 border-b border-base-300/50">
        <div class="flex items-center gap-3 min-w-0">
          <div class="min-w-0">
            <h1 class="text-lg font-semibold leading-tight truncate nav-label-system">
              {{ editor.topology()?.device?.friendly_name ?? 'Loading...' }}
            </h1>
            <p class="text-xs text-base-content/40 font-mono mt-0.5">{{ editor.topology()?.device?.name }}</p>
          </div>
          @if (isPreview()) {
            <span class="badge badge-info badge-sm shrink-0">Read-Only Preview</span>
          } @else if (editor.dirty()) {
            <span class="badge badge-warning badge-sm gap-1 shrink-0">Unsaved</span>
          }
        </div>
        <div class="flex gap-2 shrink-0">
          @if (isPreview()) {
            <button class="btn btn-primary btn-sm gap-1.5" (click)="useTemplate()">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Use Template
            </button>
          } @else {
            <button
              class="btn btn-ghost btn-sm"
              (click)="save()"
              [disabled]="!editor.dirty()"
            >Save</button>
          }
        </div>
      </div>

      <!-- Horizontal tab bar -->
      <div class="bg-base-100 border-b border-base-300/50 px-6">
        <div role="tablist" class="tabs tabs-bordered -mb-px">
          @for (tab of visibleTabs(); track tab.id) {
            <a
              role="tab"
              class="tab gap-2 text-sm"
              [routerLink]="tab.id"
              routerLinkActive="tab-active"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" [attr.d]="tabIcon(tab.id)" />
              </svg>
              {{ tab.label }}
            </a>
          }
        </div>
      </div>

      <!-- Main layout -->
      <div class="flex flex-1 min-h-0 overflow-hidden">
        <!-- Design tab: always alive, hidden via display:none to preserve X6 canvas state -->
        <main class="flex-1 min-h-0 min-w-0 flex flex-col"
          [style.display]="isDesignTab() ? 'flex' : 'none'">
          <app-topology-x6-tab />
        </main>

        <!-- Other tabs: routed via child routes -->
        @if (!isDesignTab()) {
          <main class="flex-1 min-h-0 min-w-0 flex flex-col overflow-auto">
            <fieldset [disabled]="isPreview()" class="flex-1 flex flex-col min-h-0">
              <router-outlet />
            </fieldset>
          </main>
        }
      </div>
    </div>
  `,
})
export class EditorComponent implements OnInit, OnDestroy {
  protected editor = inject(SystemEditorService);
  private workspace = inject(WorkspaceService);
  private boards = inject(BoardService);
  private electron = inject(ElectronService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  protected isPreview = signal(false);

  private currentUrl = signal(this.router.url);

  protected isDesignTab = computed(() => {
    const url = this.currentUrl();
    return url.endsWith('/design');
  });

  protected tabs: { id: TabId; label: string }[] = [
    { id: 'device', label: 'Device' },
    { id: 'design', label: 'Design' },
    { id: 'automations', label: 'Automations' },
    { id: 'timing', label: 'Timing' },
    { id: 'deploy', label: 'Deploy' },
    { id: 'docs', label: 'Docs' },
  ];

  protected visibleTabs = computed(() =>
    this.isPreview() ? this.tabs.filter(t => t.id !== 'deploy') : this.tabs
  );

  protected tabIcon(id: TabId): string {
    return TAB_ICONS[id];
  }

  private routerSub: any;

  constructor() {
    effect(() => {
      const t = this.editor.topology();
      if (t) this.runValidation();
    });
  }

  private siteName: string | null = null;

  async ngOnInit() {
    const config = this.route.snapshot.paramMap.get('config');
    this.siteName = this.route.snapshot.paramMap.get('name');

    this.routerSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.currentUrl.set(e.urlAfterRedirects));

    if (!config) {
      this.router.navigate(['/overview']);
      return;
    }

    const preview = this.route.snapshot.data['preview'] === true;
    this.isPreview.set(preview);

    // Ensure workspace is loaded (handles direct URL navigation)
    if (!this.workspace.site() && this.siteName) {
      await this.workspace.load(this.siteName);
    }

    // Focus the system — workspace already has the data
    this.editor.focus(config, { readonly: preview });

    // Load board list (for the device tab dropdown) and active board SVG
    await this.boards.refresh();
    const topology = this.editor.topology();
    if (topology) {
      await this.boards.load(topology.device.board);
    }
  }

  ngOnDestroy() {
    this.routerSub?.unsubscribe();
    this.editor.clear();
    this.boards.clear();
  }

  useTemplate() {
    this.navigateBack();
  }

  private navigateBack() {
    if (this.siteName) {
      this.router.navigate(['/site', this.siteName]);
    } else {
      this.router.navigate(['/overview']);
    }
  }

  async save() {
    const config = this.editor.configName();
    if (!config) return;
    await this.workspace.saveSystem(config);
  }

  private validationGen = 0;

  private async runValidation() {
    const topology = this.editor.topology();
    const board = this.editor.board();
    if (!topology || !board) return;
    const gen = ++this.validationGen;
    const result = await this.electron.validate(topology, board);
    if (gen !== this.validationGen) return;
    this.editor.setValidation(result);
  }
}
