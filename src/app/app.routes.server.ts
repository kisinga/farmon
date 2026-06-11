import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // Public marketing pages: prerendered to static HTML at build time so crawlers
  // and link-preview bots get full content (the app is otherwise a CSR SPA).
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'pricing', renderMode: RenderMode.Prerender },
  { path: 'features', renderMode: RenderMode.Prerender },
  // Everything else is the authenticated app: client-rendered, no prerender.
  { path: '**', renderMode: RenderMode.Client },
];
