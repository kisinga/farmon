import { Component, inject, OnInit, OnDestroy, signal, effect, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { SystemEditorService } from '../../core/services/system-editor.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import { BoardService } from '../../core/services/board.service';
import { ElectronService } from '../../core/services/electron.service';
import { TopologyX6TabComponent } from './topology-x6-tab/topology-x6-tab.component';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [
    RouterOutlet,
    TopologyX6TabComponent,
  ],
  host: {
    class: 'flex-1 min-h-0 flex flex-col overflow-hidden',
    '[class.preview]': 'isPreview()',
  },
  template: `
    <div class="flex flex-col flex-1 min-h-0">
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

    // Ensure workspace is loaded with the correct site (handles direct URL navigation & stale state)
    if (!this.workspace.site() || this.workspace.siteName() !== this.siteName) {
      if (this.siteName) {
        await this.workspace.load(this.siteName);
      }
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
