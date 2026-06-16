import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * The rounded icon tile that sits above a feature heading. Projects an inline
 * SVG; `tone` picks the tint. Replaces the hand-coded `w-11 h-11 rounded-xl
 * bg-cyan-100 …` blocks (which carried 3-4 colour variants across the pages).
 */
@Component({
  selector: 'mkt-icon-chip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `<span [class]="cls()"><ng-content /></span>`,
})
export class MktIconChipComponent {
  readonly tone = input<'cyan' | 'sky' | 'on-light' | 'on-dark'>('cyan');
  readonly size = input<'md' | 'sm'>('md');

  protected readonly cls = computed(() => {
    const tone =
      this.tone() === 'sky' ? 'bg-sky-100 text-sky-700'
      : this.tone() === 'on-light' ? 'bg-white ring-1 ring-slate-200 text-cyan-600'
      : this.tone() === 'on-dark' ? 'bg-cyan-400/15 text-cyan-300'
      : 'bg-cyan-100 text-cyan-700';
    const size = this.size() === 'sm' ? 'w-10 h-10 rounded-lg' : 'w-11 h-11 rounded-xl';
    return `${size} flex items-center justify-center ${tone}`;
  });
}
