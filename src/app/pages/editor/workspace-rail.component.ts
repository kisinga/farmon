import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SystemEditorService, PANEL_LABELS, PANEL_SLUGS, type EditorPanel } from '../../core/services/system-editor.service';
import { WorkspaceService } from '../../core/services/workspace.service';

type SectionState = 'complete' | 'active' | 'untouched';

interface Section {
  id: EditorPanel;
  icon: string;
  /** Plain-language hint shown on hover. */
  hint: string;
}

/**
 * The site workspace's primary navigation — a vertical left rail. One control
 * for "which part of this site am I working on": Overview (site-wide), then the
 * per-controller sections. Each row is a real browser link
 * (`/site/:name/system/:config/:section`), so sections are bookmarkable and the
 * back/forward buttons work. Labels + URL slugs come from the editor service
 * (the single source the breadcrumb shares); active state tracks `editor.panel`,
 * which the editor sets from the URL.
 */
@Component({
  selector: 'app-workspace-rail',
  standalone: true,
  imports: [RouterLink],
  host: { class: 'shrink-0' },
  template: `
    <nav class="w-48 h-full bg-base-100 border-r border-base-300/40 flex flex-col py-2">
      @for (s of sections; track s.id) {
        @let disabled = isDisabled(s.id);
        <a
          [routerLink]="disabled ? null : linkFor(s.id)"
          [attr.aria-disabled]="disabled"
          [title]="disabled ? disabledHint(s.id) : s.hint"
          class="relative flex items-center gap-3 px-4 py-2.5 text-sm transition-colors"
          [class]="rowClass(s.id, disabled)">
          @if (state(s.id) === 'active') {
            <span class="absolute left-0 inset-y-1 w-0.5 rounded-r bg-primary"></span>
          }
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6">
            <path stroke-linecap="round" stroke-linejoin="round" [attr.d]="s.icon" />
          </svg>
          <span class="flex-1 truncate">{{ labels[s.id] }}</span>
          @if (!disabled && state(s.id) === 'complete') {
            <span class="w-1.5 h-1.5 rounded-full bg-success/70 shrink-0" title="Set up"></span>
          }
        </a>
      }

      <div class="flex-1"></div>

      @if (editor.readonly()) {
        <div class="mx-3 mb-2 text-center"><span class="badge badge-info badge-sm">Preview</span></div>
      }
      <div class="px-4 py-1.5 text-[10px] text-base-content/30 font-mono truncate" [title]="editor.controllerId() ?? ''">
        {{ editor.controllerId() }}
      </div>
    </nav>
  `,
})
export class WorkspaceRailComponent {
  protected editor = inject(SystemEditorService);
  private workspace = inject(WorkspaceService);

  protected readonly labels = PANEL_LABELS;

  /** Sharing (cross-controller) is meaningless in managed/cloud mode. */
  private managed = computed(() => this.workspace.deploymentMode() === 'managed');
  private siteId = computed(() => this.workspace.site()?.id ?? '');
  private ctrlId = this.editor.controllerId;

  protected readonly sections: Section[] = [
    { id: 'site',        hint: 'Site-wide: connection, controllers and routes',
      icon: 'M3 7l9-4 9 4M4 10v10h16V10M9 21v-6h6v6' },
    { id: 'design',      hint: 'Lay out tanks, pumps, valves and sensors',
      icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z' },
    { id: 'config',      hint: 'Board, pins, buses and safety timings',
      icon: 'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z' },
    { id: 'automations', hint: 'When routes run, on the device',
      icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
    { id: 'remotes',     hint: 'Share sensors between controllers (own-server only)',
      icon: 'M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244' },
    { id: 'deploy',      hint: 'Generate the controller firmware bundle',
      icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  ];

  /** The browser link for a section (null while it can't be addressed yet). */
  protected linkFor(id: EditorPanel): string[] | null {
    const site = this.siteId();
    if (!site) return null;
    if (id === 'site') return ['/site', site];
    const ctrl = this.ctrlId();
    if (!ctrl) return null;
    return ['/site', site, 'system', ctrl, PANEL_SLUGS[id]];
  }

  protected isDisabled(id: EditorPanel): boolean {
    if (id === 'remotes' && this.managed()) return true;
    // Per-controller sections need a controller selected.
    if (id !== 'site' && !this.ctrlId()) return true;
    return false;
  }

  protected disabledHint(id: EditorPanel): string {
    if (id === 'remotes' && this.managed()) {
      return 'Sharing sensors between controllers only works on your own server';
    }
    return 'Add a controller in Design first';
  }

  private states = computed(() => {
    const t = this.editor.topology();
    const m = new Map<EditorPanel, SectionState>();
    m.set('site', (t?.controllers?.length ?? 0) > 0 ? 'complete' : 'untouched');
    m.set('design', (t?.nodes?.length ?? 0) > 0 && (t?.pipes?.length ?? 0) > 0 ? 'complete' : 'untouched');
    const device = this.editor.controllerDevice();
    m.set('config', device?.name && device?.board ? 'complete' : 'untouched');
    m.set('automations', (t?.automations?.length ?? 0) > 0 ? 'complete' : 'untouched');
    m.set('remotes', (t?.remoteImports?.length ?? 0) > 0 ? 'complete' : 'untouched');
    m.set('deploy', 'untouched');
    m.set(this.editor.panel(), 'active');
    return m;
  });

  protected state(id: EditorPanel): SectionState {
    return this.states().get(id) ?? 'untouched';
  }

  protected rowClass(id: EditorPanel, disabled: boolean): string {
    if (disabled) return 'opacity-30 cursor-not-allowed pointer-events-none';
    return this.state(id) === 'active'
      ? 'bg-base-200 text-primary font-medium'
      : 'text-base-content/70 hover:bg-base-200/60 hover:text-base-content';
  }
}
