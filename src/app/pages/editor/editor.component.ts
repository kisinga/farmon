import { Component, inject, OnInit, OnDestroy, signal, effect, computed } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SystemEditorService } from '../../core/services/system-editor.service';
import { BoardService } from '../../core/services/board.service';
import { LibraryService } from '../../core/services/library.service';
import { ElectronService } from '../../core/services/electron.service';
import { BoardSvgComponent } from '../../shared/board-svg/board-svg.component';
import { ValidationPanelComponent } from '../../shared/validation-panel/validation-panel.component';
import { DeviceTabComponent } from './device-tab/device-tab.component';
import { TimingTabComponent } from './timing-tab/timing-tab.component';
import { TopologyX6TabComponent } from './topology-x6-tab/topology-x6-tab.component';
import { DeployTabComponent } from './deploy-tab/deploy-tab.component';
import type { SystemTopology } from '../../core/models/topology.model';

type TabId = 'device' | 'design' | 'timing' | 'deploy';

const TAB_ICONS: Record<TabId, string> = {
  device: 'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z',
  design: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z',
  timing: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  deploy: 'M13 10V3L4 14h7v7l9-11h-7z',
};

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [
    BoardSvgComponent,
    ValidationPanelComponent,
    DeviceTabComponent,
    TimingTabComponent,
    TopologyX6TabComponent,
    DeployTabComponent,
  ],
  host: { class: 'flex-1 min-h-0 flex flex-col overflow-hidden' },
  template: `
    <div class="flex flex-col flex-1 min-h-0">
      <!-- Header bar -->
      <div class="flex items-center justify-between px-6 py-3 bg-base-100 border-b border-base-300/50">
        <div class="flex items-center gap-3">
          <div>
            <h1 class="text-lg font-semibold leading-tight">
              {{ editor.topology()?.device?.friendly_name ?? 'Loading...' }}
            </h1>
            <p class="text-xs text-base-content/50 font-mono mt-0.5">{{ editor.topology()?.device?.name }}</p>
          </div>
          @if (editor.dirty()) {
            <span class="badge badge-warning badge-sm gap-1">Unsaved</span>
          }
        </div>
        <div class="flex gap-2">
          <button
            class="btn btn-ghost btn-sm"
            (click)="save()"
            [disabled]="!editor.dirty()"
          >Save</button>
        </div>
      </div>

      <!-- Horizontal tab bar -->
      <div class="bg-base-100 border-b border-base-300/50 px-6">
        <div role="tablist" class="tabs tabs-bordered -mb-px">
          @for (tab of tabs; track tab.id) {
            <button
              role="tab"
              class="tab gap-2 text-sm"
              [class.tab-active]="activeTab() === tab.id"
              (click)="activeTab.set(tab.id)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" [attr.d]="tabIcon(tab.id)" />
              </svg>
              {{ tab.label }}
            </button>
          }
        </div>
      </div>

      <!-- Main layout -->
      <div class="flex flex-1 min-h-0 overflow-hidden">
        <!-- Design tab: always alive, hidden via display:none to preserve X6 canvas state -->
        <main class="flex-1 min-h-0 min-w-0 flex flex-col"
          [style.display]="activeTab() === 'design' ? 'flex' : 'none'">
          <app-topology-x6-tab />
        </main>

        <!-- Other tabs: created/destroyed on switch (lightweight, no canvas state to preserve) -->
        @if (activeTab() !== 'design') {
          <main class="flex-1 min-h-0 min-w-0 flex flex-col overflow-auto p-6">
            @switch (activeTab()) {
              @case ('device') { <app-device-tab /> }
              @case ('timing') { <app-timing-tab /> }
              @case ('deploy') { <app-deploy-tab /> }
            }
          </main>
        }

        <!-- Board panel (flex child, not overlay) -->
        @if (activeTab() !== 'design' && activeTab() !== 'deploy') {
          <aside
            class="w-72 shrink-0 bg-base-100 border-l border-base-300/50 flex flex-col overflow-y-auto transition-[width,padding,border] duration-200 ease-in-out"
            [class.w-72]="panelOpen()"
            [class.!w-0]="!panelOpen()"
            [class.!border-l-0]="!panelOpen()"
            [class.!overflow-hidden]="!panelOpen()"
          >
            <div class="w-72 shrink-0">
              <div class="p-4 border-b border-base-300/30">
                <div class="flex items-center justify-between mb-2">
                  <h3 class="text-xs font-semibold text-base-content/50 uppercase tracking-wider">Board</h3>
                  <div class="flex items-center gap-2">
                    @if (boards.activeBoard(); as b) {
                      <span class="text-xs text-base-content/60">{{ b.label }}</span>
                    }
                    <button class="btn btn-ghost btn-xs" (click)="panelOpen.set(false)" title="Hide panel">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>
                <app-board-svg
                  [board]="boards.activeBoard()"
                  [svgContent]="boards.activeSvg()"
                  [usedPins]="editor.usedPins()"
                />
              </div>
              <div class="p-4 flex-1">
                <h3 class="text-xs font-semibold text-base-content/50 uppercase tracking-wider mb-3">Validation</h3>
                <app-validation-panel
                  [result]="editor.validation()"
                  [gpioUsage]="editor.gpioUsage()"
                />
              </div>
            </div>
          </aside>
        }

        <!-- Panel toggle (when closed) -->
        @if (!panelOpen() && activeTab() !== 'design' && activeTab() !== 'deploy') {
          <button
            class="shrink-0 flex flex-col items-center justify-center gap-1 py-4 px-1.5 bg-base-200 hover:bg-primary/10 border-l border-base-300 transition-colors group"
            (click)="panelOpen.set(true)"
            title="Show device preview"
          >
            <svg xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4 rotate-180 group-hover:scale-110 transition-transform"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span class="text-[9px] font-semibold uppercase tracking-widest text-base-content/60 group-hover:text-primary transition-colors"
              style="writing-mode: vertical-lr;">Board</span>
          </button>
        }
      </div>
    </div>
  `,
})
export class EditorComponent implements OnInit, OnDestroy {
  protected editor = inject(SystemEditorService);
  protected boards = inject(BoardService);
  private library = inject(LibraryService);
  private electron = inject(ElectronService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  protected activeTab = signal<TabId>('device');
  protected panelOpen = signal(true);

  protected tabs: { id: TabId; label: string }[] = [
    { id: 'device', label: 'Device' },
    { id: 'design', label: 'Design' },
    { id: 'timing', label: 'Timing' },
    { id: 'deploy', label: 'Deploy' },
  ];

  protected tabIcon(id: TabId): string {
    return TAB_ICONS[id];
  }

  constructor() {
    effect(() => {
      const t = this.editor.topology();
      if (t) this.runValidation();
    });
  }

  async ngOnInit() {
    const name = this.route.snapshot.paramMap.get('name');
    if (!name) {
      this.router.navigate(['/library']);
      return;
    }

    await Promise.all([this.boards.refresh(), this.library.refresh()]);

    // Guard: templates are read-only — redirect to library if someone navigates here directly
    const entry = this.library.entries().find(e => e.name === name);
    if (entry?.library) {
      console.warn(`Cannot edit template "${name}" directly. Redirecting to library.`);
      this.router.navigate(['/library']);
      return;
    }

    try {
      const raw = await this.library.load(name);
      const topology = raw as SystemTopology;
      const board = await this.boards.load(topology.device.board);
      this.editor.load(name, topology, board);
    } catch (err) {
      console.error('Failed to load config:', err);
      this.router.navigate(['/library']);
    }
  }

  ngOnDestroy() {
    this.editor.clear();
    this.boards.clear();
  }

  async save() {
    const name = this.editor.configName();
    const topology = this.editor.topology();
    if (!name || !topology) return;
    await this.library.save(name, topology);
    this.editor.markSaved();
  }

  private async runValidation() {
    const topology = this.editor.topology();
    const board = this.editor.board();
    if (!topology || !board) return;
    const result = await this.electron.validate(topology, board);
    this.editor.setValidation(result);
  }
}
