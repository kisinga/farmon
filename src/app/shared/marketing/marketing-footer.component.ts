import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { BRAND_LOGO_SVG } from '../brand-logo';

/**
 * Shared footer for every public marketing page. The brand mark links home and the
 * tagline keeps the close simple across public pages.
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
        <p class="text-sm text-center text-slate-500">Water monitoring and automation</p>
      </div>
    </footer>
  `,
})
export class MarketingFooterComponent {
  readonly tagline = input('Started on a dry-land farm, where every drop counts.');
  protected readonly logo: SafeHtml = inject(DomSanitizer).bypassSecurityTrustHtml(BRAND_LOGO_SVG);
}
