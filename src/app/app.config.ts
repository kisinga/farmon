import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';
import { provideEchartsCore } from 'ngx-echarts';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Zoneless: the app is fully signal-based, so change detection is scheduled
    // by signal writes / events — no zone.js. (Angular 21 default for new apps.)
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideHttpClient(),
    // ECharts is lazy-loaded the first time a chart widget renders.
    provideEchartsCore({ echarts: () => import('echarts') }),
    // PWA shell. The ngsw worker is only emitted by the production build, so it
    // stays disabled in dev. registerWhenStable defers registration until the app
    // is idle (or 30s), keeping it off the critical boot path.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ]
};
