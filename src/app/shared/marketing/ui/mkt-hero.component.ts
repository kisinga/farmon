import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { BRAND_LOGO_SVG } from '../../brand-logo';

/**
 * The dark hero shell shared by the public pages. Owns the water-light
 * decoration (glow blobs, ripple logo, wave divider) so it's defined once
 * instead of re-pasted per page. The heading, lead and actions are projected,
 * so each page keeps its own copy and heading size.
 */
@Component({
  selector: 'mkt-hero',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <header class="relative overflow-hidden bg-slate-950 text-white">
      @if (blobs()) {
        <div class="mkt-glow-blob pointer-events-none absolute -top-24 -left-16 w-[28rem] h-[28rem] rounded-full bg-radial from-cyan-500/30 to-transparent to-70%"></div>
        <div class="mkt-glow-blob pointer-events-none absolute top-10 right-0 w-[24rem] h-[24rem] rounded-full bg-radial from-sky-500/25 to-transparent to-70%" style="animation-delay:-6s"></div>
      }
      <div [class]="innerCls()">
        @if (logo()) {
          <div class="relative mx-auto mb-9 w-28 h-28 sm:w-32 sm:h-32 flex items-center justify-center">
            <span class="absolute inset-0 rounded-full ring-1 ring-cyan-400/30 mkt-ripple-ring"></span>
            <span class="absolute inset-0 rounded-full ring-1 ring-cyan-400/20 mkt-ripple-ring" style="animation-delay:1.3s"></span>
            <span class="absolute inset-0 rounded-full ring-1 ring-cyan-400/10 mkt-ripple-ring" style="animation-delay:2.6s"></span>
            <span class="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-cyan-500/10 ring-1 ring-white/10 backdrop-blur-sm flex items-center justify-center">
              <span class="mkt-ripple block w-12 h-12 sm:w-14 sm:h-14" [innerHTML]="logoSvg"></span>
            </span>
          </div>
        }
        <ng-content />
      </div>
      @if (waveDivider()) {
        <svg class="block w-full text-white" viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden="true">
          <path fill="currentColor" d="M0,32 C240,72 480,72 720,48 C960,24 1200,24 1440,48 L1440,80 L0,80 Z"></path>
        </svg>
      }
    </header>
  `,
})
export class MktHeroComponent {
  /** `lg` = landing (tall); `md` = features/pricing. */
  readonly size = input<'lg' | 'md'>('md');
  readonly blobs = input(false);
  readonly logo = input(false);
  readonly waveDivider = input(false);

  protected readonly logoSvg: SafeHtml = inject(DomSanitizer).bypassSecurityTrustHtml(BRAND_LOGO_SVG);

  protected readonly innerCls = computed(() => {
    const pad = this.size() === 'lg' ? 'pt-16 sm:pt-24 pb-20 sm:pb-28' : 'pt-16 pb-14';
    return `relative max-w-5xl mx-auto px-5 sm:px-8 ${pad} text-center`;
  });
}
