import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  PLATFORM_ID,
  Renderer2,
  effect,
  inject,
  input,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { Stage } from '../stages';

/**
 * The bottom caption card: layer eyebrow, headline, body and the "Why"
 * differentiator (which lands a beat after the headline). Re-runs its swap-in
 * animation whenever the stage changes: the class is removed, the element is
 * reflowed, then re-added, so the keyframes restart (the global stylesheet owns
 * the `.caption.mf-swap` rules).
 */
@Component({
  selector: 'sim-caption',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'caption' },
  template: `
    <div class="layer">{{ stage().key }}</div>
    <h2>{{ stage().title }}</h2>
    <p>{{ stage().body }}</p>
    <div class="why"><b>Why</b><span>{{ stage().why }}</span></div>
  `,
})
export class SimCaptionComponent {
  readonly stage = input.required<Stage>();

  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly r = inject(Renderer2);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  constructor() {
    effect(() => {
      this.stage(); // track stage changes
      if (!this.isBrowser) return;
      const n = this.el.nativeElement;
      // mf-swap (not "swap"): DaisyUI ships a global .swap component that would
      // absolutely-position the children and collapse them onto each other.
      this.r.removeClass(n, 'mf-swap');
      void n.offsetWidth; // force reflow so the animation restarts
      this.r.addClass(n, 'mf-swap');
    });
  }
}
