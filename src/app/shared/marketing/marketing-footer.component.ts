import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { BRAND_LOGO_SVG } from '../brand-logo';
import { GITHUB_URL } from './marketing-nav.component';

/**
 * Shared footer for every public marketing page. The brand mark links home and the
 * GitHub link sits on the right; only the tagline changes per page.
 */
@Component({
  selector: 'app-marketing-footer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: { class: 'contents' },
  template: `
    <footer class="bg-slate-950 text-slate-400 px-5 sm:px-8 py-10">
      <div class="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <a routerLink="/" class="flex items-center gap-2.5">
          <span class="w-6 h-6 block" [innerHTML]="logo"></span>
          <span class="font-semibold text-white">MajiFlow</span>
        </a>
        <p class="text-sm text-center">{{ tagline() }}</p>
        <a [href]="github" target="_blank" rel="noopener"
           class="text-sm hover:text-white transition-colors">Open source on GitHub →</a>
      </div>
    </footer>
  `,
})
export class MarketingFooterComponent {
  readonly tagline = input('Started on a dry-land farm, where every drop counts.');
  protected readonly github = GITHUB_URL;
  protected readonly logo: SafeHtml = inject(DomSanitizer).bypassSecurityTrustHtml(BRAND_LOGO_SVG);
}
