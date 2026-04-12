import { Component, inject, signal, computed, OnInit, OnDestroy, output } from '@angular/core';
import { Router, RouterLink, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { SystemEditorService } from '../../core/services/system-editor.service';
import { WorkspaceService } from '../../core/services/workspace.service';

type StepId = 'device' | 'design' | 'automations' | 'timing' | 'deploy' | 'docs';
type StepState = 'complete' | 'active' | 'untouched' | 'warning';

const STEPS: { id: StepId; label: string; icon: string }[] = [
  { id: 'device',      label: 'Device',  icon: 'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z' },
  { id: 'design',      label: 'Design',  icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z' },
  { id: 'automations', label: 'Auto',    icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { id: 'timing',      label: 'Timing',  icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
  { id: 'deploy',      label: 'Deploy',  icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { id: 'docs',        label: 'Docs',    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
];

@Component({
  selector: 'app-pipeline-rail',
  standalone: true,
  imports: [RouterLink],
  host: { class: 'shrink-0' },
  styles: [`
    @keyframes slideIn {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    :host .step-active-indicator {
      animation: slideIn 0.2s ease-out;
    }
  `],
  template: `
    <div class="h-[var(--pipeline-rail-h)] bg-base-100 border-t border-base-300/30 flex items-stretch">
      <!-- Pipeline steps — equal width across full bar -->
      <nav class="flex items-stretch flex-1 min-w-0">
        @for (step of visibleSteps(); track step.id; let i = $index) {
          <a
            [routerLink]="stepRoute(step.id)"
            class="flex-1 flex flex-col items-center justify-center gap-0.5 relative transition-colors hover:bg-base-200/40"
            [class.bg-base-200/50]="state(step.id) === 'active'"
            [title]="step.label"
          >
            <!-- Active top bar indicator -->
            @if (state(step.id) === 'active') {
              <div class="absolute top-0 inset-x-0 h-0.5 bg-primary step-active-indicator"></div>
            }
            <!-- Icon -->
            <div class="w-6 h-6 flex items-center justify-center rounded-full transition-all"
              [class]="dotClass(step.id)">
              @if (state(step.id) === 'complete') {
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              } @else if (state(step.id) === 'warning') {
                <span class="text-[10px] font-bold">!</span>
              } @else {
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" [attr.d]="step.icon" />
                </svg>
              }
            </div>
            <!-- Label -->
            <span class="text-[10px] leading-tight transition-colors"
              [class.font-semibold]="state(step.id) === 'active'"
              [class.text-primary]="state(step.id) === 'active'"
              [class.text-base-content/50]="state(step.id) !== 'active'"
            >{{ step.label }}</span>
          </a>
        }
      </nav>

      <!-- Device name + actions -->
      <div class="flex items-center gap-3 shrink-0 px-4 border-l border-base-300/30">
        <span class="text-xs text-base-content/40 font-mono truncate max-w-32 hidden md:inline">
          {{ editor.systemId() }}
        </span>
        @if (editor.readonly()) {
          <span class="badge badge-info badge-sm">Preview</span>
        } @else {
          <button class="btn btn-sm btn-primary" [disabled]="!editor.dirty()" (click)="save.emit()">Save</button>
        }
      </div>
    </div>
  `,
})
export class PipelineRailComponent implements OnInit, OnDestroy {
  protected editor = inject(SystemEditorService);
  private workspace = inject(WorkspaceService);
  private router = inject(Router);

  save = output<void>();

  private currentUrl = signal(this.router.url);
  private routerSub: any;

  /** Base path: /site/:name/system/:config */
  private basePath = computed(() => {
    const url = this.currentUrl();
    // Match up to /site/:name/system/:config
    const match = url.match(/^(\/site\/[^/]+\/system\/[^/]+)/);
    return match?.[1] ?? '';
  });

  protected stepRoute(id: StepId): string {
    return this.basePath() + '/' + id;
  }

  protected activeStep = computed(() => {
    const url = this.currentUrl();
    for (const s of STEPS) {
      if (url.endsWith('/' + s.id)) return s.id;
    }
    return 'device' as StepId;
  });

  protected visibleSteps = computed(() =>
    this.editor.readonly() ? STEPS.filter(s => s.id !== 'deploy') : STEPS
  );

  private stepStates = computed(() => {
    const t = this.editor.topology();
    const v = this.editor.validation();
    const gen = this.editor.generatedFiles();
    const active = this.activeStep();

    const states = new Map<StepId, StepState>();
    states.set('device', t?.device?.name && t?.device?.board ? 'complete' : 'untouched');
    states.set('design', (t?.nodes?.length ?? 0) > 0 && (t?.pipes?.length ?? 0) > 0 ? 'complete' : 'untouched');
    states.set('automations', (t?.automations?.length ?? 0) > 0 ? 'complete' : 'untouched');
    states.set('timing', 'complete');
    states.set('deploy', v && !v.ok ? 'warning' : 'untouched');
    states.set('docs', gen ? 'complete' : 'untouched');

    // Active step overrides
    states.set(active, 'active');
    return states;
  });

  protected state(id: StepId): StepState {
    return this.stepStates().get(id) ?? 'untouched';
  }

  protected dotClass(id: StepId): string {
    switch (this.state(id)) {
      case 'complete': return 'bg-success/15 text-success';
      case 'active':   return 'bg-primary/10 text-primary';
      case 'warning':  return 'bg-warning/15 text-warning';
      default:         return 'text-base-content/30';
    }
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
