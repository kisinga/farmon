import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { BRAND_LOGO_SVG } from '../brand-logo';

export const GITHUB_URL = 'https://github.com/kisinga/majiflow';

/** A nav link: internal `route` or external `href` (rendered desktop-only). */
export interface NavLink {
  label: string;
  route?: string;
  href?: string;
}

const DEFAULT_LINKS: NavLink[] = [
  { label: 'Features', route: '/features' },
  { label: 'Pricing', route: '/pricing' },
  { label: 'GitHub', href: GITHUB_URL },
];

/**
 * Shared sticky nav for every public marketing page (landing, features, pricing).
 * One source of truth for the brand mark, link set, and the cyan "Sign in" pill so
 * the pages stop drifting (blur depth, link sets, max-width all used to differ).
 */
@Component({
  selector: 'app-marketing-nav',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: { class: 'contents' },
  template: `
    <nav class="sticky top-0 z-30 backdrop-blur-sm bg-slate-950/85 border-b border-white/10">
      <div class="max-w-6xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-2">
        <a routerLink="/" class="flex items-center gap-2.5 shrink-0">
          <span class="w-8 h-8 block" [innerHTML]="logo"></span>
          <span class="text-lg font-bold tracking-tight text-white">MajiFlow</span>
        </a>
        <div class="flex items-center gap-0.5 sm:gap-3">
          @for (l of links(); track l.label) {
            @if (l.href) {
              <a [href]="l.href" target="_blank" rel="noopener"
                 class="hidden sm:inline-flex text-sm font-medium text-white/70 hover:text-white transition-colors px-3 py-2">{{ l.label }}</a>
            } @else {
              <a [routerLink]="l.route"
                 class="text-sm font-medium text-white/70 hover:text-white transition-colors px-2 sm:px-3 py-2">{{ l.label }}</a>
            }
          }
          <a routerLink="/login"
             class="shrink-0 text-sm font-semibold rounded-full px-3.5 sm:px-4 py-2 bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors">Sign in</a>
        </div>
      </div>
    </nav>
  `,
})
export class MarketingNavComponent {
  readonly links = input<NavLink[]>(DEFAULT_LINKS);
  protected readonly logo: SafeHtml = inject(DomSanitizer).bypassSecurityTrustHtml(BRAND_LOGO_SVG);
}
