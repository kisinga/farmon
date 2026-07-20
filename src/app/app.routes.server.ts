import { RenderMode, ServerRoute } from '@angular/ssr';
import { environment } from '../environments/environment';

const cloudServerRoutes: ServerRoute[] = [
  // Public marketing pages: prerendered to static HTML at build time so crawlers
  // and link-preview bots get full content (the app is otherwise a CSR SPA).
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'pricing', renderMode: RenderMode.Prerender },
  { path: 'features', renderMode: RenderMode.Prerender },
  { path: 'how-it-works', renderMode: RenderMode.Prerender },
  // Everything else is the authenticated app: client-rendered, no prerender.
  { path: '**', renderMode: RenderMode.Client },
];

// The device build serves a single CSR dashboard from the controller's flash —
// nothing is prerendered (the public marketing pages aren't part of it).
export const serverRoutes: ServerRoute[] = environment.deviceMode
  ? [{ path: '**', renderMode: RenderMode.Client }]
  : cloudServerRoutes;
