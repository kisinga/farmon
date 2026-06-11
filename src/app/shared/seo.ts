import { DOCUMENT, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

/** Production origin, used to build absolute canonical + Open Graph URLs. */
const ORIGIN = 'https://majiflow.io';

export interface PageSeo {
  /** Full document title. */
  title: string;
  /** Meta description, reused for og/twitter description. Aim for 150-160 chars. */
  description: string;
  /** Route path without the leading slash: '' for home, 'pricing' for pricing. */
  path: string;
  /** Social card image path under the origin. Defaults to the brand OG card. */
  image?: string;
}

/**
 * Set the page title, meta description, canonical link, and Open Graph / Twitter
 * card tags for a public page. Call from a component constructor (an injection
 * context) so the tags are baked into the prerendered HTML at build time and
 * re-applied on client-side navigation. Updates the defaults already present in
 * index.html rather than appending duplicates.
 */
export function applyPageSeo(seo: PageSeo): void {
  const titleSvc = inject(Title);
  const meta = inject(Meta);
  const doc = inject(DOCUMENT);

  // Prerendered subpages are served from a directory (e.g. /pricing/index.html),
  // so the static host 301-redirects /pricing to /pricing/. Use the trailing-slash
  // form for canonical + og:url so crawlers index the real URL, not the redirect.
  const url = seo.path ? `${ORIGIN}/${seo.path}/` : `${ORIGIN}/`;
  const image = `${ORIGIN}/${seo.image ?? 'marketing/og-card.png'}`;

  titleSvc.setTitle(seo.title);
  meta.updateTag({ name: 'description', content: seo.description });

  // Single canonical link element: update in place or create if missing.
  let canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = doc.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    doc.head.appendChild(canonical);
  }
  canonical.setAttribute('href', url);

  meta.updateTag({ property: 'og:title', content: seo.title });
  meta.updateTag({ property: 'og:description', content: seo.description });
  meta.updateTag({ property: 'og:url', content: url });
  meta.updateTag({ property: 'og:image', content: image });
  meta.updateTag({ property: 'og:type', content: 'website' });
  meta.updateTag({ property: 'og:site_name', content: 'MajiFlow' });

  meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
  meta.updateTag({ name: 'twitter:title', content: seo.title });
  meta.updateTag({ name: 'twitter:description', content: seo.description });
  meta.updateTag({ name: 'twitter:image', content: image });
}
