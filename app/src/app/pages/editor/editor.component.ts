import { Component, inject, OnInit, OnDestroy, signal, effect, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SystemEditorService } from '../../core/services/system-editor.service';
import { BoardService } from '../../core/services/board.service';
import { LibraryService } from '../../core/services/library.service';
import { ElectronService } from '../../core/services/electron.service';
import { BoardSvgComponent } from '../../shared/board-svg/board-svg.component';
import { ValidationPanelComponent } from '../../shared/validation-panel/validation-panel.component';
import { DeviceTabComponent } from './device-tab/device-tab.component';
import { TanksTabComponent } from './tanks-tab/tanks-tab.component';
import { ValvesTabComponent } from './valves-tab/valves-tab.component';
import { FlowsTabComponent } from './flows-tab/flows-tab.component';
import { RoutesTabComponent } from './routes-tab/routes-tab.component';
import { TimingTabComponent } from './timing-tab/timing-tab.component';
import { TopologyTabComponent } from './topology-tab/topology-tab.component';
import type { SystemTopology } from '../../core/models/topology.model';

type TabId = 'device' | 'tanks' | 'valves' | 'flows' | 'routes' | 'timing' | 'topology';

const TAB_ICONS: Record<TabId, string> = {
  device: 'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z',
  tanks: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  valves: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
  flows: 'M13 10V3L4 14h7v7l9-11h-7z',
  routes: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0020 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
  timing: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  topology: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z',
};

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [
    RouterLink,
    BoardSvgComponent,
    ValidationPanelComponent,
    DeviceTabComponent,
    TanksTabComponent,
    ValvesTabComponent,
    FlowsTabComponent,
    RoutesTabComponent,
    TimingTabComponent,
    TopologyTabComponent,
  ],
  template: `
    <div class="flex flex-col h-full overflow-hidden">
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
          <a
            [routerLink]="['/generate', editor.configName()]"
            class="btn btn-primary btn-sm gap-1.5"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Generate
          </a>
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
      <div class="relative flex flex-1 overflow-hidden">
        <!-- Tab content — full width always -->
        <main class="flex-1 min-h-0 flex flex-col"
          [class.overflow-auto]="activeTab() !== 'topology'"
          [class.p-6]="activeTab() !== 'topology'"
        >
          @switch (activeTab()) {
            @case ('device') { <app-device-tab /> }
            @case ('tanks') { <app-tanks-tab /> }
            @case ('valves') { <app-valves-tab /> }
            @case ('flows') { <app-flows-tab /> }
            @case ('routes') { <app-routes-tab /> }
            @case ('timing') { <app-timing-tab /> }
            @case ('topology') { <app-topology-tab /> }
          }
        </main>

        <!-- Toggle button — pinned to right edge, tall vertical strip -->
        @if (activeTab() !== 'topology') {
          <button
            class="absolute top-1/2 -translate-y-1/2 z-20 flex flex-col items-center justify-center gap-1 py-4 px-1.5 bg-base-200 hover:bg-primary/10 hover:border-primary/30 border border-r-0 border-base-300 rounded-l-lg shadow-md transition-all duration-200 ease-in-out group"
            [class.right-72]="panelVisible()"
            [class.right-0]="!panelVisible()"
            (click)="panelOpen.set(!panelOpen())"
            [title]="panelOpen() ? 'Hide device preview' : 'Show device preview'"
          >
            <svg xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4 transition-transform duration-200 group-hover:scale-110"
              [class.rotate-180]="!panelOpen()"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span class="text-[9px] font-semibold uppercase tracking-widest text-base-content/60 group-hover:text-primary transition-colors duration-200"
              style="writing-mode: vertical-lr;">Board</span>
          </button>
        }

        <!-- Collapsible overlay panel — slides in from right -->
        <aside
          class="absolute top-0 right-0 h-full z-10 w-72 bg-base-100 border-l border-base-300/50 shadow-lg flex flex-col overflow-y-auto transition-transform duration-200 ease-in-out"
          [class.translate-x-0]="panelVisible()"
          [class.translate-x-full]="!panelVisible()"
        >
          <div class="p-4 border-b border-base-300/30">
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-xs font-semibold text-base-content/50 uppercase tracking-wider">Board</h3>
              @if (boards.activeBoard(); as b) {
                <span class="text-xs text-base-content/60">{{ b.label }}</span>
              }
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
        </aside>
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

  /** Panel is visible when user has it open AND not on topology tab. */
  protected panelVisible = computed(() =>
    this.panelOpen() && this.activeTab() !== 'topology'
  );

  protected tabs: { id: TabId; label: string }[] = [
    { id: 'device', label: 'Device' },
    { id: 'tanks', label: 'Tanks' },
    { id: 'valves', label: 'Valves' },
    { id: 'flows', label: 'Flows' },
    { id: 'routes', label: 'Routes' },
    { id: 'timing', label: 'Timing' },
    { id: 'topology', label: 'Topology' },
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

    await this.boards.refresh();

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
