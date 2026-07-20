import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';
import { provideEchartsCore } from 'ngx-echarts';

import { routes } from './app.routes';
import { modeProviders } from './mode.providers';
import { environment } from '../environments/environment';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Zoneless: the app is fully signal-based, so change detection is scheduled
    // by signal writes / events — no zone.js. (Angular 21 default for new apps.)
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideHttpClient(),
    // ECharts is lazy-loaded the first time a chart widget renders (device mode
    // renders no charts, so it never loads there).
    provideEchartsCore({ echarts: () => import('echarts') }),
    // Device mode: swap the dashboard's two network surfaces (realtime reads +
    // command writes) for the controller's own /local/* endpoints. The cloud
    // build's modeProviders is an empty array (see mode.providers.ts).
    ...modeProviders,
    // PWA shell. The ngsw worker is only emitted by the production build, so it
    // stays disabled in dev — and off entirely in device mode (no service worker
    // on the controller; the app is served straight from flash).
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode() && !environment.deviceMode,
      registrationStrategy: 'registerWhenStable:30000',
    }),
    // Hydrate the prerendered public pages (landing + pricing) instead of
    // re-rendering them; withEventReplay buffers early clicks during hydration.
    provideClientHydration(withEventReplay()),
  ]
};
