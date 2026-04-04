import { Component, inject, OnInit, OnDestroy, signal, effect } from '@angular/core';
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

type TabId = 'device' | 'tanks' | 'valves' | 'flows' | 'routes' | 'timing';

const TAB_ICONS: Record<TabId, string> = {
  device: 'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z',
  tanks: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  valves: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
  flows: 'M13 10V3L4 14h7v7l9-11h-7z',
  routes: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0020 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
  timing: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
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
  ],
  template: `
    <div class="flex flex-col h-full">
      <!-- Header bar -->
      <div class="flex items-center justify-between px-5 py-2.5 bg-base-100 border-b border-base-300/30">
        <div class="flex items-center gap-3">
          <div>
            <h1 class="text-base font-bold leading-tight">
              {{ editor.manifest()?.device?.friendly_name ?? 'Loading...' }}
            </h1>
            <p class="text-[11px] text-base-content/35 font-mono">{{ editor.manifest()?.device?.name }}</p>
          </div>
          @if (editor.dirty()) {
            <span class="badge badge-warning badge-xs gap-1 py-2">
              <span class="w-1 h-1 rounded-full bg-warning-content"></span>
              Unsaved
            </span>
          }
        </div>
        <div class="flex gap-2">
          <button
            class="btn btn-ghost btn-xs"
            (click)="save()"
            [disabled]="!editor.dirty()"
          >
            Save
          </button>
          <a
            [routerLink]="['/generate', editor.configName()]"
            class="btn btn-primary btn-xs gap-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Generate
          </a>
        </div>
      </div>

      <!-- Main layout -->
      <div class="flex flex-1 overflow-hidden">
        <!-- Tab nav -->
        <nav class="w-40 bg-base-100 border-r border-base-300/30 flex flex-col pt-2 gap-0.5 px-2">
          @for (tab of tabs; track tab.id) {
            <button
              class="btn btn-ghost btn-xs justify-start gap-2 font-normal h-8 min-h-8"
              [class.bg-primary/8]="activeTab() === tab.id"
              [class.text-primary]="activeTab() === tab.id"
              [class.font-semibold]="activeTab() === tab.id"
              (click)="activeTab.set(tab.id)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" [attr.d]="tabIcon(tab.id)" />
              </svg>
              <span class="text-xs">{{ tab.label }}</span>
            </button>
          }
        </nav>

        <!-- Tab content -->
        <main class="flex-1 overflow-auto p-5 bg-base-200/40">
          @switch (activeTab()) {
            @case ('device') { <app-device-tab /> }
            @case ('tanks') { <app-tanks-tab /> }
            @case ('valves') { <app-valves-tab /> }
            @case ('flows') { <app-flows-tab /> }
            @case ('routes') { <app-routes-tab /> }
            @case ('timing') { <app-timing-tab /> }
          }
        </main>

        <!-- Right panel: board + validation -->
        <aside class="w-72 bg-base-100 border-l border-base-300/30 flex flex-col overflow-auto">
          <div class="p-3 border-b border-base-300/30">
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-[10px] font-semibold text-base-content/30 uppercase tracking-widest">Board</h3>
              @if (boards.activeBoard(); as b) {
                <span class="text-[10px] text-base-content/40">{{ b.label }}</span>
              }
            </div>
            <app-board-svg
              [board]="boards.activeBoard()"
              [svgContent]="boards.activeSvg()"
              [usedPins]="editor.usedPins()"
            />
          </div>
          <div class="p-3 flex-1">
            <h3 class="text-[10px] font-semibold text-base-content/30 uppercase tracking-widest mb-2">Validation</h3>
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

  protected tabs: { id: TabId; label: string }[] = [
    { id: 'device', label: 'Device' },
    { id: 'tanks', label: 'Tanks' },
    { id: 'valves', label: 'Valves' },
    { id: 'flows', label: 'Flows' },
    { id: 'routes', label: 'Routes' },
    { id: 'timing', label: 'Timing' },
  ];

  protected tabIcon(id: TabId): string {
    return TAB_ICONS[id];
  }

  constructor() {
    // Re-validate whenever manifest changes
    effect(() => {
      const m = this.editor.manifest();
      if (m) this.runValidation();
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
      const manifest = raw as any;
      const board = await this.boards.load(manifest.device.board);
      this.editor.load(name, manifest, board);
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
    const manifest = this.editor.manifest();
    if (!name || !manifest) return;
    await this.library.save(name, manifest);
    this.editor.markSaved();
  }

  private async runValidation() {
    const manifest = this.editor.manifest();
    const board = this.editor.board();
    if (!manifest || !board) return;
    const result = await this.electron.validate(manifest, board);
    this.editor.setValidation(result);
  }
}
