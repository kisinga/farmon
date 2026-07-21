import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';
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
    // Device mode: swap the dashboard's two network surfaces (realtime reads +
    // command writes) for the controller's own /local/* endpoints. The cloud
    // build's modeProviders also installs ECharts core (the lazy echarts chunk);
    // the device build's swap drops it (see mode.providers.ts).
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
