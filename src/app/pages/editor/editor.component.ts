import { Component, inject, OnInit, OnDestroy, signal, computed, effect } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SystemEditorService, PANEL_LABELS, PANEL_SLUGS, SLUG_PANELS } from '../../core/services/system-editor.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import { BoardService } from '../../core/services/board.service';
import { BackendService } from '../../core/services/backend.service';
import { TopologyX6TabComponent } from './topology-x6-tab/topology-x6-tab.component';
import { RemotesTabComponent } from './remotes-tab/remotes-tab.component';
import { ConfigTabComponent } from './config-tab/config-tab.component';
import { AutomationsTabComponent } from './automations-tab/automations-tab.component';
import { SitePanelComponent } from './site-panel/site-panel.component';
import { DeployPageComponent } from '../deploy/deploy-page.component';
import { WorkspaceRailComponent } from './workspace-rail.component';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [
    RouterLink,
    WorkspaceRailComponent,
    TopologyX6TabComponent,
    RemotesTabComponent,
    ConfigTabComponent,
    AutomationsTabComponent,
    SitePanelComponent,
    DeployPageComponent,
  ],
  host: {
    class: 'flex-1 min-h-0 flex overflow-hidden',
    '[class.preview]': 'isPreview()',
  },
  template: `
    <!-- Primary navigation: which part of this site -->
    <app-workspace-rail />

    <div class="flex-1 flex flex-col min-h-0 min-w-0">
      <!-- Sub-header: breadcrumb + the ONE controller switcher -->
      <div class="sub-header">
        <a routerLink="/overview" class="text-base-content/50 hover:text-base-content transition-colors shrink-0">Sites</a>
        <span class="text-base-content/30 shrink-0">&rsaquo;</span>
        <a [routerLink]="['/site', siteId()]"
          class="font-medium truncate max-w-[30%] hover:text-primary transition-colors"
          [class.text-primary]="editor.panel() === 'site'">{{ siteName() }}</a>
        <span class="text-base-content/30 shrink-0">&rsaquo;</span>
        <span class="font-semibold text-primary truncate shrink-0">{{ sectionLabel() }}</span>

        <div class="flex-1"></div>

        @if (editor.panel() !== 'site' && controllers().length > 0) {
          <span class="text-xs text-base-content/50 shrink-0">Controller</span>
          <select class="select select-sm select-bordered font-mono text-xs"
            [value]="activeControllerId()" (change)="switchController($event)">
            @for (c of controllers(); track c.id) {
              <option [value]="c.id">{{ c.friendlyName }}</option>
            }
          </select>
        }
      </div>

      <!-- Content: the design canvas stays mounted (display toggle) to preserve X6 state -->
      <div class="flex flex-col flex-1 min-h-0">
        <main class="flex-1 min-h-0 min-w-0 flex flex-col"
          [style.display]="editor.panel() === 'design' ? 'flex' : 'none'">
          <app-topology-x6-tab />
        </main>

        @if (editor.panel() !== 'design') {
          <main class="flex-1 min-h-0 min-w-0 flex flex-col overflow-auto">
            <fieldset [disabled]="isPreview()" class="flex-1 flex flex-col min-h-0">
              @switch (editor.panel()) {
                @case ('site') { <app-site-panel /> }
                @case ('remotes') { <app-remotes-tab /> }
                @case ('config') { <app-config-tab /> }
                @case ('automations') { <app-automations-tab /> }
                @case ('deploy') { <app-deploy-page /> }
              }
            </fieldset>
          </main>
        }
      </div>
    </div>

    <!-- Save cue toast (workspace autosaves; this confirms it) -->
    @if (saveToastVisible()) {
      <div class="toast toast-start toast-bottom z-50">
        <div class="alert alert-success py-2 px-3 text-xs shadow-lg">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span>Saved</span>
        </div>
      </div>
    }
  `,
})
export class EditorComponent implements OnInit, OnDestroy {
  protected editor = inject(SystemEditorService);
  private workspace = inject(WorkspaceService);
  private boards = inject(BoardService);
  private backend = inject(BackendService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  protected isPreview = signal(false);

  // Sub-header state (reads off the workspace, like the other editor fields).
  protected siteName = computed(() => this.workspace.site()?.friendlyName ?? '');
  protected siteId = computed(() => this.workspace.site()?.id ?? '');
  protected sectionLabel = computed(() => PANEL_LABELS[this.editor.panel()]);
  protected activeControllerId = this.workspace.activeControllerId;
  protected controllers = computed(() =>
    (this.workspace.siteTopology()?.controllers ?? []).map((c) => ({
      id: c.id,
      friendlyName: c.friendlyName ?? c.id,
    })),
  );

  // Save cue (moved here from the shell so the global top bar carries no editor state).
  protected saveToastVisible = signal(false);
  private saveToastTimer: ReturnType<typeof setTimeout> | null = null;

  private paramSub: { unsubscribe(): void } | null = null;

  constructor() {
    effect(() => {
      const t = this.editor.topology();
      if (t) this.runValidation();
    });

    let wasDirty = false;
    effect(() => {
      const dirty = this.workspace.dirty();
      if (wasDirty && !dirty) this.showSaveCue();
      wasDirty = dirty;
    });
  }

  private siteName_param: string | null = null;
  /** Last controller actually focused — guards needless re-focus on section switch. */
  private lastFocused: string | null = null;

  async ngOnInit() {
    this.siteName_param = this.route.snapshot.paramMap.get('name');

    const preview = this.route.snapshot.data['preview'] === true;
    this.isPreview.set(preview);

    if (!this.workspace.site() || this.workspace.site()?.id !== this.siteName_param) {
      if (this.siteName_param) {
        await this.workspace.load(this.siteName_param);
      }
    }

    this.paramSub = this.route.paramMap.subscribe(async (params) => {
      const systemId = params.get('config');
      const section = params.get('section');

      // The URL is the single source of truth for which section is shown. Bare
      // /site/:name → Overview; /system/:config → Design; /…/:section → that one.
      this.editor.panel.set(systemId ? (SLUG_PANELS[section ?? 'design'] ?? 'design') : 'site');

      // Focus a controller for the canvas + per-controller sections. Overview
      // has no controller in the URL, so fall back to the first for context.
      // Only re-focus when the controller actually changes (a section switch
      // keeps the same controller and must not reload its board).
      const target = systemId ?? this.workspace.siteTopology()?.controllers[0]?.id ?? null;
      if (target && target !== this.lastFocused) {
        this.lastFocused = target;
        await this.focusController(target, preview);
      }
    });
  }

  /** The ONE controller switcher (sub-header). Navigates, preserving the section. */
  protected switchController(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    const siteId = this.workspace.site()?.id;
    if (!siteId || !id) return;
    const panel = this.editor.panel();
    const slug = panel === 'site' ? PANEL_SLUGS.design : PANEL_SLUGS[panel];
    this.router.navigate(['/site', siteId, 'system', id, slug]);
  }

  private async focusController(systemId: string, preview: boolean) {
    this.editor.focus(systemId, { readonly: preview });
    await this.boards.refresh();
    const device = this.editor.controllerDevice();
    if (device) {
      await this.boards.load(device.board);
    }
  }

  ngOnDestroy() {
    this.paramSub?.unsubscribe();
    if (this.saveToastTimer) clearTimeout(this.saveToastTimer);
    this.editor.clear();
    this.boards.clear();
  }

  private showSaveCue() {
    this.saveToastVisible.set(true);
    if (this.saveToastTimer) clearTimeout(this.saveToastTimer);
    this.saveToastTimer = setTimeout(() => this.saveToastVisible.set(false), 2000);
  }

  private validationGen = 0;

  private async runValidation() {
    const topology = this.workspace.siteTopology();
    const board = this.editor.board();
    const controllerId = this.workspace.activeControllerId();
    if (!topology || !board || !controllerId) return;
    const gen = ++this.validationGen;
    const result = await this.backend.validate({
      kind: 'live',
      topology,
      board,
      controllerId,
    });
    if (gen !== this.validationGen) return;
    this.editor.setValidation(result);
  }
}
