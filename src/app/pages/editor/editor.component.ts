import { Component, inject, OnInit, OnDestroy, signal, effect } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SystemEditorService } from '../../core/services/system-editor.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import { BoardService } from '../../core/services/board.service';
import { BackendService } from '../../core/services/backend.service';
import { TopologyX6TabComponent } from './topology-x6-tab/topology-x6-tab.component';
import { RemotesTabComponent } from './remotes-tab/remotes-tab.component';
import { ConfigTabComponent } from './config-tab/config-tab.component';
import { AutomationsTabComponent } from './automations-tab/automations-tab.component';
import { SitePanelComponent } from './site-panel/site-panel.component';
import { DeployPageComponent } from '../deploy/deploy-page.component';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [
    TopologyX6TabComponent,
    RemotesTabComponent,
    ConfigTabComponent,
    AutomationsTabComponent,
    SitePanelComponent,
    DeployPageComponent,
  ],
  host: {
    class: 'flex-1 min-h-0 flex flex-col overflow-hidden',
    '[class.preview]': 'isPreview()',
  },
  template: `
    <div class="flex flex-col flex-1 min-h-0">
      <!-- Design canvas: always alive, hidden via display:none to preserve X6 state -->
      <main class="flex-1 min-h-0 min-w-0 flex flex-col"
        [style.display]="editor.panel() === 'design' ? 'flex' : 'none'">
        <app-topology-x6-tab />
      </main>

      <!-- Aspect panels (rendered in place — no routing) -->
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

  private paramSub: any;

  constructor() {
    effect(() => {
      const t = this.editor.topology();
      if (t) this.runValidation();
    });
  }

  private siteName: string | null = null;

  async ngOnInit() {
    this.siteName = this.route.snapshot.paramMap.get('name');

    const preview = this.route.snapshot.data['preview'] === true;
    this.isPreview.set(preview);
    // Bare /site/:name opens the site overview; a specific controller opens Design.
    this.editor.panel.set(this.route.snapshot.paramMap.get('config') ? 'design' : 'site');

    // Ensure workspace is loaded with correct site
    if (!this.workspace.site() || this.workspace.site()?.id !== this.siteName) {
      if (this.siteName) {
        await this.workspace.load(this.siteName);
      }
    }

    // Watch for controller changes within the same editor instance
    this.paramSub = this.route.paramMap.subscribe(async (params) => {
      const systemId = params.get('config');
      if (systemId) {
        await this.focusController(systemId, preview);
        return;
      }
      // Site overview: focus the first controller so the shared canvas has context.
      const first = this.workspace.siteTopology()?.controllers[0]?.id;
      if (first) await this.focusController(first, preview);
    });
  }

  private async focusController(systemId: string, preview: boolean) {
    // Focus the system
    this.editor.focus(systemId, { readonly: preview });

    // Load board list and active board SVG
    await this.boards.refresh();
    const device = this.editor.controllerDevice();
    if (device) {
      await this.boards.load(device.board);
    }
  }

  ngOnDestroy() {
    this.paramSub?.unsubscribe();
    this.editor.clear();
    this.boards.clear();
  }

  async save() {
    await this.workspace.save();
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
