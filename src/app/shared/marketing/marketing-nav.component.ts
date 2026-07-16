import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { BRAND_LOGO_SVG } from '../brand-logo';
import { FeatureFlagsService } from '../../core/services/feature-flags.service';

/** A nav link: internal `route` or external `href` (rendered desktop-only).
 *  `feature` ties the link to a feature flag — hidden while the flag is off. */
export interface NavLink {
  label: string;
  route?: string;
  href?: string;
  feature?: string;
}

const DEFAULT_LINKS: NavLink[] = [
  { label: 'How it works', route: '/how-it-works' },
  { label: 'Features', route: '/features' },
  { label: 'Assessment', route: '/pricing', feature: 'pricing_page' },
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

        <!-- Desktop links -->
        <div class="hidden sm:flex items-center gap-3">
          @for (l of visibleLinks(); track l.label) {
            @if (l.href) {
              <a [href]="l.href" [target]="externalTarget(l.href)" [rel]="externalRel(l.href)"
                 class="text-sm font-medium text-white/70 hover:text-white transition-colors whitespace-nowrap px-3 py-2">{{ l.label }}</a>
            } @else {
              <a [routerLink]="l.route"
                 class="text-sm font-medium text-white/70 hover:text-white transition-colors whitespace-nowrap px-3 py-2">{{ l.label }}</a>
            }
          }
          <a routerLink="/login"
             class="shrink-0 text-sm font-semibold rounded-full px-4 py-2 bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors">Sign in</a>
        </div>

        <!-- Mobile: Sign in stays visible, links collapse behind a menu button -->
        <div class="flex sm:hidden items-center gap-1">
          <a routerLink="/login"
             class="shrink-0 text-sm font-semibold rounded-full px-3.5 py-2 bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors">Sign in</a>
          <button type="button" (click)="toggle()"
                  class="p-2 -mr-2 text-white/80 hover:text-white"
                  aria-label="Toggle navigation menu" [attr.aria-expanded]="open()">
            <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              @if (open()) {
                <path d="M6 6l12 12M18 6L6 18" />
              } @else {
                <path d="M4 7h16M4 12h16M4 17h16" />
              }
            </svg>
          </button>
        </div>
      </div>

      <!-- Mobile dropdown panel -->
      @if (open()) {
        <div class="sm:hidden border-t border-white/10 bg-slate-950/95 px-4 pb-3">
          @for (l of visibleLinks(); track l.label) {
            @if (l.href) {
              <a [href]="l.href" [target]="externalTarget(l.href)" [rel]="externalRel(l.href)" (click)="close()"
                 class="block text-sm font-medium text-white/70 hover:text-white py-3">{{ l.label }}</a>
            } @else {
              <a [routerLink]="l.route" (click)="close()"
                 class="block text-sm font-medium text-white/70 hover:text-white py-3">{{ l.label }}</a>
            }
          }
        </div>
      }
    </nav>
  `,
})
export class MarketingNavComponent {
  readonly links = input<NavLink[]>(DEFAULT_LINKS);
  protected readonly logo: SafeHtml = inject(DomSanitizer).bypassSecurityTrustHtml(BRAND_LOGO_SVG);
  protected readonly open = signal(false);
  private readonly featureFlags = inject(FeatureFlagsService);

  /** Links minus any whose feature flag is off. */
  protected readonly visibleLinks = computed(() =>
    this.links().filter((l) => !l.feature || this.featureFlags.isEnabled(l.feature)),
  );

  protected toggle(): void {
    this.open.update((v) => !v);
  }

  protected close(): void {
    this.open.set(false);
  }

  protected externalTarget(href: string): '_blank' | null {
    return href.startsWith('#') || href.startsWith('/') ? null : '_blank';
  }

  protected externalRel(href: string): 'noopener' | null {
    return this.externalTarget(href) ? 'noopener' : null;
  }
}
