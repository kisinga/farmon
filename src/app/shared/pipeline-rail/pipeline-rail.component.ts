import { Component, inject, computed } from '@angular/core';
import { SystemEditorService, type EditorPanel } from '../../core/services/system-editor.service';

type StepId = EditorPanel;
type StepState = 'complete' | 'active' | 'untouched' | 'warning';

const STEPS: { id: StepId; label: string; icon: string }[] = [
  { id: 'site',         label: 'Site',          icon: 'M3 7l9-4 9 4M4 10v10h16V10M9 21v-6h6v6' },
  { id: 'design',       label: 'Design',        icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z' },
  { id: 'remotes',      label: 'Remotes',       icon: 'M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244' },
  { id: 'config',       label: 'Config',        icon: 'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z' },
  { id: 'automations',  label: 'Automations',   icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },

];

@Component({
  selector: 'app-pipeline-rail',
  standalone: true,
  imports: [],
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
          <button
            type="button"
            (click)="editor.panel.set(step.id)"
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
          </button>
        }
      </nav>

      <!-- Generate firmware (terminal action) + device name -->
      <div class="flex items-center gap-2 shrink-0 px-3 border-l border-base-300/30">
        <button
          class="btn btn-xs gap-1"
          [class.btn-primary]="editor.panel() === 'deploy'"
          [class.btn-ghost]="editor.panel() !== 'deploy'"
          (click)="editor.panel.set('deploy')"
          title="Generate firmware"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
          </svg>
          <span class="hidden md:inline">Deploy</span>
        </button>
        <span class="text-xs text-base-content/40 font-mono truncate max-w-32 hidden lg:inline">
          {{ editor.controllerId() }}
        </span>
        @if (editor.readonly()) {
          <span class="badge badge-info badge-sm">Preview</span>
        }
      </div>
    </div>
  `,
})
export class PipelineRailComponent {
  protected editor = inject(SystemEditorService);

  protected activeStep = computed<StepId>(() => this.editor.panel());

  protected visibleSteps = computed(() => STEPS);

  private stepStates = computed(() => {
    const t = this.editor.topology();
    const active = this.activeStep();

    const states = new Map<StepId, StepState>();
    states.set('site', (t?.controllers?.length ?? 0) > 0 ? 'complete' : 'untouched');
    states.set('design', (t?.nodes?.length ?? 0) > 0 && (t?.pipes?.length ?? 0) > 0 ? 'complete' : 'untouched');
    states.set('remotes', (t?.remoteImports?.length ?? 0) > 0 ? 'complete' : 'untouched');
    const device = this.editor.controllerDevice();
    states.set('config', device?.name && device?.board ? 'complete' : 'untouched');
    states.set('automations', (t?.automations?.length ?? 0) > 0 ? 'complete' : 'untouched');

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

}
