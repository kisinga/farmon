import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { BRAND_LOGO_SVG } from '../brand-logo';
import { MARKETING_WHATSAPP_HREF, MARKETING_WHATSAPP_NUMBER } from './marketing-contact';

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
        <a [href]="whatsappHref" target="_blank" rel="noopener"
           class="inline-flex items-center gap-2 text-sm text-center text-slate-400 hover:text-cyan-200 transition-colors">
          <svg class="h-4 w-4 text-[#25D366]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.198.296-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347M12.051 21.785h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.889-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.886 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.946L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
          </svg>
          <span>WhatsApp</span>
        </a>
      </div>
    </footer>
  `,
})
export class MarketingFooterComponent {
  readonly tagline = input('Started on a dry-land farm, where every drop counts.');
  protected readonly logo: SafeHtml = inject(DomSanitizer).bypassSecurityTrustHtml(BRAND_LOGO_SVG);
  protected readonly whatsappHref = MARKETING_WHATSAPP_HREF;
  protected readonly whatsappNumber = MARKETING_WHATSAPP_NUMBER;
}
